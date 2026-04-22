    // --- State ---
    let appState = {
      files: [],
      generalComments: [],
      summary: null,
      projectName: '',
      selectedFile: null,
      currentDiff: null,
      fileContents: {},
      filter: 'all',
      round: 1,
      sessionToken: null,
      drafts: {},
      compareRef: null,
    };

    // Save the WIP comment (unsaved textarea state) for the current file so it survives
    // a re-render or switching to another file and back.
    function saveCurrentDraft() {
      if (!appState.selectedFile) return;
      const lineEl = document.getElementById('comment-line');
      const textEl = document.getElementById('comment-text');
      const suggestionEl = document.getElementById('comment-suggestion');
      const suggestionContainer = document.getElementById('suggestion-input');
      if (!textEl) return;
      const text = textEl.value;
      const line = lineEl ? lineEl.value : '';
      const suggestion = suggestionEl ? suggestionEl.value : '';
      const suggestionOpen = suggestionContainer ? suggestionContainer.style.display !== 'none' : false;
      if (text.trim() || line.trim() || suggestion.trim()) {
        appState.drafts[appState.selectedFile] = { line, text, suggestion, suggestionOpen };
      } else {
        delete appState.drafts[appState.selectedFile];
      }
    }

    // --- API ---
    async function api(path, opts = {}) {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      return res.json();
    }

    async function loadFiles() {
      const data = await api('/api/files');
      appState.files = data.files;
      appState.generalComments = data.generalComments || [];
      appState.summary = data.summary;
      appState.projectName = data.projectName;
      appState.round = data.round || 1;
      appState.sessionToken = data.sessionToken || null;
      appState.compareRef = data.compareRef || null;
      renderToolbar();
      renderFileList();
    }

    async function loadDiff(filePath) {
      saveCurrentDraft();
      const data = await api(`/api/diff?path=${encodeURIComponent(filePath)}`);
      appState.currentDiff = data;
      appState.selectedFile = filePath;
      renderContent();
      document.querySelectorAll('.file-item').forEach(el => {
        el.classList.toggle('active', el.dataset.path === filePath);
      });
    }

    async function saveReview(filePath, status, comments) {
      await api('/api/review', {
        method: 'POST',
        body: { path: filePath, status, comments },
      });
      await loadFiles();
    }

    async function saveGeneralComments() {
      await api('/api/general-comments', {
        method: 'POST',
        body: { comments: appState.generalComments },
      });
    }

    async function getFileContent(filePath) {
      if (appState.fileContents[filePath]) return appState.fileContents[filePath];
      const data = await api(`/api/file-content?path=${encodeURIComponent(filePath)}`);
      if (data.content) {
        appState.fileContents[filePath] = data.content;
      }
      return data.content || '';
    }

    // --- Navigation helpers ---
    function getFilteredFiles() {
      return appState.files.filter(f => {
        if (appState.filter === 'all') return true;
        const status = f.review?.status;
        if (appState.filter === 'pending') return !status || status === 'pending';
        if (appState.filter === 'viewed') return status === 'reviewed';
        if (appState.filter === 'feedback') return status === 'has-feedback' || (f.review?.comments?.length > 0);
        return true;
      });
    }

    function navigateFile(direction) {
      const files = getFilteredFiles();
      if (files.length === 0) return;
      const currentIdx = files.findIndex(f => f.path === appState.selectedFile);
      let next;
      if (direction === 'next') {
        next = currentIdx < files.length - 1 ? currentIdx + 1 : 0;
      } else {
        next = currentIdx > 0 ? currentIdx - 1 : files.length - 1;
      }
      loadDiff(files[next].path);
    }

    // --- Render: Toolbar ---
    function renderToolbar() {
      const label = appState.compareRef
        ? `diffback: ${appState.projectName} vs ${appState.compareRef}`
        : `diffback: ${appState.projectName}`;
      document.getElementById('toolbar-title').textContent = label;
      document.title = appState.compareRef
        ? `Review: ${appState.projectName} vs ${appState.compareRef}`
        : `Review: ${appState.projectName}`;
      const s = appState.summary;
      if (s) {
        document.getElementById('toolbar-stats').innerHTML =
          `<span class="count">${s.reviewed + s.hasFeedback}</span>/${s.total} reviewed`;
      }
    }

    // --- Render: File List ---
    function renderFileList() {
      const container = document.getElementById('file-list');
      container.innerHTML = '';

      const filtered = getFilteredFiles();

      for (const file of filtered) {
        const el = document.createElement('div');
        el.className = 'file-item' + (appState.selectedFile === file.path ? ' active' : '');
        el.dataset.path = file.path;

        const statusIcon = document.createElement('span');
        statusIcon.className = 'file-status-icon';
        if (file.status === 'added') { statusIcon.textContent = 'A'; statusIcon.style.color = 'var(--accent)'; }
        else if (file.status === 'modified') { statusIcon.textContent = 'M'; statusIcon.style.color = 'var(--yellow)'; }
        else if (file.status === 'deleted') { statusIcon.textContent = 'D'; statusIcon.style.color = 'var(--orange)'; }
        else if (file.status === 'renamed') { statusIcon.textContent = 'R'; statusIcon.style.color = 'var(--violet)'; }

        const reviewIcon = document.createElement('span');
        reviewIcon.className = 'file-review-icon';
        if (file.review?.status === 'reviewed') {
          reviewIcon.textContent = '\u2713';
          reviewIcon.style.color = 'var(--cyan)';
        } else if (file.review?.status === 'has-feedback') {
          reviewIcon.textContent = '\u25CF';
          reviewIcon.style.color = 'var(--yellow)';
        } else {
          reviewIcon.textContent = '\u25CB';
          reviewIcon.style.color = 'var(--text-muted)';
        }

        const pathEl = document.createElement('span');
        pathEl.className = 'file-path';
        const parts = file.path.split('/');
        if (parts.length > 1) {
          const dir = document.createElement('span');
          dir.className = 'file-dir';
          dir.textContent = parts.slice(0, -1).join('/') + '/';
          pathEl.appendChild(dir);
          pathEl.appendChild(document.createTextNode(parts[parts.length - 1]));
        } else {
          pathEl.textContent = file.path;
        }

        el.appendChild(statusIcon);
        el.appendChild(reviewIcon);
        el.appendChild(pathEl);

        // Line stats (+/-)
        if (file.additions !== undefined || file.deletions !== undefined) {
          const stats = document.createElement('span');
          stats.className = 'file-stats';
          const add = file.additions || 0;
          const del = file.deletions || 0;
          if (add > 0) stats.innerHTML += `<span class="stat-add">+${add}</span>`;
          if (del > 0) stats.innerHTML += `<span class="stat-del">-${del}</span>`;
          el.appendChild(stats);
        }

        el.addEventListener('click', () => loadDiff(file.path));
        container.appendChild(el);
      }

      // Update filter button counts
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === appState.filter);
      });
    }

    // --- Filter handlers ---
    document.getElementById('filter-bar').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      appState.filter = btn.dataset.filter;
      renderFileList();
    });

    // --- Parse hunk ranges from @@ header ---
    function parseHunkHeader(headerText) {
      // @@ -oldStart,oldCount +newStart,newCount @@
      const match = headerText.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!match) return null;
      return {
        oldStart: parseInt(match[1]),
        oldCount: match[2] !== undefined ? parseInt(match[2]) : 1,
        newStart: parseInt(match[3]),
        newCount: match[4] !== undefined ? parseInt(match[4]) : 1,
      };
    }

    // --- Insert fold indicators between hunks ---
    async function insertFoldIndicators(diffContainer, diffText, filePath) {
      const hunkHeaders = [];
      const lines = diffText.split('\n');
      for (const line of lines) {
        const parsed = parseHunkHeader(line);
        if (parsed) hunkHeaders.push(parsed);
      }

      if (hunkHeaders.length === 0) return;

      const infoElements = [...diffContainer.querySelectorAll('.d2h-info')]
        .filter(el => /@@ -\d+/.test(el.textContent));

      // Gap before first hunk (lines 1 to firstHunk.newStart - 1)
      const firstHunk = hunkHeaders[0];
      if (firstHunk.newStart > 1 && infoElements.length > 0) {
        const hiddenLines = firstHunk.newStart - 1;
        insertFoldAtElement(infoElements[0], filePath, 1, hiddenLines, hiddenLines, 'fold-before');
      }

      // Gaps between consecutive hunks
      for (let i = 1; i < hunkHeaders.length && i < infoElements.length; i++) {
        const prevHunk = hunkHeaders[i - 1];
        const currHunk = hunkHeaders[i];
        const prevEnd = prevHunk.newStart + prevHunk.newCount - 1;
        const currStart = currHunk.newStart;
        const hiddenLines = currStart - prevEnd - 1;

        if (hiddenLines <= 0) continue;

        insertFoldAtElement(infoElements[i], filePath, prevEnd + 1, currStart - 1, hiddenLines, `fold-${i}`);
      }

      // Gap after last hunk
      const lastHunk = hunkHeaders[hunkHeaders.length - 1];
      if (lastHunk.newCount > 0) {
        const lastVisibleLine = lastHunk.newStart + lastHunk.newCount - 1;
        const fileContent = await getFileContent(filePath);
        if (fileContent) {
          const contentLines = fileContent.split('\n');
          // Don't count trailing empty line from split
          const totalLines = contentLines.length > 0 && contentLines[contentLines.length - 1] === ''
            ? contentLines.length - 1
            : contentLines.length;
          if (lastVisibleLine < totalLines) {
            const hiddenLines = totalLines - lastVisibleLine;
            insertFoldAfterTable(diffContainer, filePath, lastVisibleLine + 1, totalLines, hiddenLines);
          }
        }
      }
    }

    function insertFoldAtElement(infoEl, filePath, startLine, endLine, hiddenLines, foldId) {
      const parentRow = infoEl.closest('tr');
      if (!parentRow) return;

      const fold = document.createElement('div');
      fold.className = 'fold-indicator';
      fold.innerHTML = `<span class="fold-icon">\u25B6</span> ${hiddenLines} lines hidden (${startLine}\u2013${endLine})`;

      const foldContent = document.createElement('div');
      foldContent.className = 'fold-lines collapsed';

      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 99;
      td.style.padding = '0';
      td.style.border = 'none';
      td.appendChild(fold);
      td.appendChild(foldContent);
      tr.appendChild(td);

      parentRow.parentElement.insertBefore(tr, parentRow);

      fold.addEventListener('click', async () => {
        const isExpanded = !foldContent.classList.contains('collapsed');
        if (isExpanded) {
          foldContent.classList.add('collapsed');
          fold.classList.remove('expanded');
        } else {
          if (!foldContent.dataset.loaded) {
            const fileContent = await getFileContent(filePath);
            const allLines = fileContent.split('\n');
            const start = startLine - 1;
            const end = endLine;
            const slice = allLines.slice(start, end);

            foldContent.innerHTML = slice.map((line, idx) => {
              const lineNum = start + idx + 1;
              return `<div class="fold-line"><span class="fold-line-num">${lineNum}</span><span class="fold-line-num">${lineNum}</span><span class="fold-line-content">${escapeHtml(line)}</span></div>`;
            }).join('');
            foldContent.dataset.loaded = 'true';
          }
          foldContent.classList.remove('collapsed');
          fold.classList.add('expanded');
        }
      });
    }

    function insertFoldAfterTable(diffContainer, filePath, startLine, endLine, hiddenLines) {
      const tbody = diffContainer.querySelector('.d2h-diff-tbody');
      if (!tbody) return;

      const fold = document.createElement('div');
      fold.className = 'fold-indicator';
      fold.innerHTML = `<span class="fold-icon">\u25B6</span> ${hiddenLines} lines hidden (${startLine}\u2013${endLine})`;

      const foldContent = document.createElement('div');
      foldContent.className = 'fold-lines collapsed';

      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 99;
      td.style.padding = '0';
      td.style.border = 'none';
      td.appendChild(fold);
      td.appendChild(foldContent);
      tr.appendChild(td);
      tbody.appendChild(tr);

      fold.addEventListener('click', async () => {
        const isExpanded = !foldContent.classList.contains('collapsed');
        if (isExpanded) {
          foldContent.classList.add('collapsed');
          fold.classList.remove('expanded');
        } else {
          if (!foldContent.dataset.loaded) {
            const fileContent = await getFileContent(filePath);
            const allLines = fileContent.split('\n');
            const start = startLine - 1;
            const end = endLine;
            const slice = allLines.slice(start, end);
            foldContent.innerHTML = slice.map((line, idx) => {
              const lineNum = start + idx + 1;
              return `<div class="fold-line"><span class="fold-line-num">${lineNum}</span><span class="fold-line-num">${lineNum}</span><span class="fold-line-content">${escapeHtml(line)}</span></div>`;
            }).join('');
            foldContent.dataset.loaded = 'true';
          }
          foldContent.classList.remove('collapsed');
          fold.classList.add('expanded');
        }
      });
    }

    // --- Insert inline comment markers & bubbles ---
    function getCommentEndLine(comment) {
      // Returns the last line number for a comment (for range "15-22" returns 22, for "15" returns 15)
      if (!comment.line) return null;
      const parts = String(comment.line).split('-');
      return parseInt(parts[parts.length - 1]);
    }
    function getCommentStartLine(comment) {
      if (!comment.line) return null;
      return parseInt(String(comment.line).split('-')[0]);
    }

    function insertInlineComments(diffContainer, comments, archivedComments, onEdit) {
      // Build a map of line -> { current: [...], archived: [...] }
      const lineData = {};

      for (const c of comments.filter(c => c.line !== null)) {
        const endLine = getCommentEndLine(c);
        const startLine = getCommentStartLine(c);
        if (!endLine) continue;
        if (!lineData[endLine]) lineData[endLine] = { current: [], archived: [], markerLines: new Set() };
        lineData[endLine].current.push(c);
        for (let l = startLine; l <= endLine; l++) lineData[endLine].markerLines.add(l);
      }

      for (const c of (archivedComments || []).filter(c => c.line !== null)) {
        const endLine = getCommentEndLine(c);
        if (!endLine) continue;
        if (!lineData[endLine]) lineData[endLine] = { current: [], archived: [], markerLines: new Set() };
        lineData[endLine].archived.push(c);
      }

      // Collect all marker lines (for range highlighting)
      const allMarkerLines = new Set();
      for (const data of Object.values(lineData)) {
        for (const l of data.markerLines) allMarkerLines.add(l);
      }

      diffContainer.querySelectorAll('.d2h-code-linenumber').forEach(el => {
        const lineNum2 = el.querySelector('.line-num2')?.textContent?.trim();
        const num = parseInt(lineNum2);
        if (isNaN(num)) return;

        const data = lineData[num];
        const hasCurrent = data?.current.length > 0;
        const hasArchived = data?.archived.length > 0;
        const isInRange = allMarkerLines.has(num) && !data; // part of a range but not the end line

        if (!hasCurrent && !hasArchived && !isInRange) return;

        // NOTE: do NOT set `el.style.position = 'relative'` here. The linenumber td
        // is already `position: absolute` via diff2html CSS, which is itself a
        // positioned context for absolute children, so the markers anchor correctly.
        // Adding inline `position: relative` pulls the td into the table's flow and
        // forces the browser to recompute column widths, which shifts all code
        // content right.

        // Add marker dots (can have both current and archived on same line)
        if (hasCurrent) {
          const marker = document.createElement('span');
          marker.className = 'comment-marker marker-current';
          marker.title = 'Toggle comments';
          el.appendChild(marker);
        }
        if (hasArchived) {
          const marker = document.createElement('span');
          marker.className = 'comment-marker marker-archived';
          marker.style.left = hasCurrent ? '12px' : '2px'; // offset if both
          marker.title = 'Toggle archived comments';
          el.appendChild(marker);
        }
        if (isInRange) {
          const marker = document.createElement('span');
          marker.className = 'comment-marker marker-current';
          marker.style.opacity = '0.4';
          el.appendChild(marker);
        }

        if (!data) return;
        const tr = el.closest('tr');
        if (!tr) return;

        // Create current comment bubbles (visible by default)
        const currentRows = [];
        for (const comment of data.current) {
          const commentTr = document.createElement('tr');
          commentTr.className = 'inline-comment-row inline-current';
          const td = document.createElement('td');
          td.colSpan = 99;
          td.innerHTML = `
            <div class="inline-comment-bubble">
              <div class="inline-content">
                <span class="inline-line-ref">L${comment.line}</span>
                ${escapeHtml(comment.text)}
                ${comment.suggestion ? `<div class="inline-suggestion">${escapeHtml(comment.suggestion)}</div>` : ''}
              </div>
              <span class="inline-comment-edit" data-id="${comment.id}" title="Edit comment">&#x270F;</span>
              <span class="inline-comment-delete" data-id="${comment.id}" title="Delete comment">&times;</span>
            </div>
          `;
          if (onEdit) {
            td.querySelector('.inline-comment-edit').addEventListener('click', () => onEdit(comment));
          }
          td.querySelector('.inline-comment-delete').addEventListener('click', () => {
            const file = appState.files.find(f => f.path === appState.selectedFile);
            if (!file) return;
            const review = file.review || { comments: [] };
            const newComments = (review.comments || []).filter(c => c.id !== comment.id);
            const newStatus = newComments.length > 0 ? 'has-feedback' : 'pending';
            const diffEl2 = document.querySelector('.diff-container');
            const scrollTop = diffEl2 ? diffEl2.scrollTop : 0;
            saveReview(file.path, newStatus, newComments).then(() => {
              loadDiff(file.path).then(() => {
                const newDiffEl = document.querySelector('.diff-container');
                if (newDiffEl) newDiffEl.scrollTop = scrollTop;
              });
            });
          });
          commentTr.appendChild(td);
          currentRows.push(commentTr);
        }

        // Create archived comment bubbles (hidden by default)
        const archivedRows = [];
        for (const ac of data.archived) {
          const archTr = document.createElement('tr');
          archTr.className = 'inline-comment-row inline-archived';
          archTr.style.display = 'none';
          const td = document.createElement('td');
          td.colSpan = 99;
          td.innerHTML = `
            <div class="inline-archived-bubble">
              <span class="archived-round">R${ac.round}</span>
              <span class="inline-line-ref">L${ac.line}</span>
              <span>${escapeHtml(ac.text)}${ac.suggestion ? `<div class="inline-suggestion">${escapeHtml(ac.suggestion)}</div>` : ''}</span>
            </div>
          `;
          archTr.appendChild(td);
          archivedRows.push(archTr);
        }

        // Insert all rows after tr
        let insertAfter = tr;
        for (const row of currentRows) {
          insertAfter.after(row);
          insertAfter = row;
        }
        for (const row of archivedRows) {
          insertAfter.after(row);
          insertAfter = row;
        }

        // Click orange marker to toggle current bubbles
        const currentMarker = el.querySelector('.marker-current');
        if (currentMarker && currentRows.length > 0) {
          currentMarker.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
          currentMarker.addEventListener('mouseup', (ev) => {
            ev.stopPropagation();
            const visible = currentRows[0].style.display !== 'none';
            currentRows.forEach(r => r.style.display = visible ? 'none' : '');
          });
        }

        // Click violet marker to toggle archived bubbles
        const archivedMarker = el.querySelector('.marker-archived');
        if (archivedMarker && archivedRows.length > 0) {
          archivedMarker.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
          archivedMarker.addEventListener('mouseup', (ev) => {
            ev.stopPropagation();
            const visible = archivedRows[0].style.display !== 'none';
            archivedRows.forEach(r => r.style.display = visible ? 'none' : '');
          });
        }

        delete lineData[num];
      });
    }

    // --- Render: Content (diff + review) ---
    function renderContent() {
      const container = document.getElementById('content');
      const file = appState.files.find(f => f.path === appState.selectedFile);
      if (!file || !appState.currentDiff) {
        container.innerHTML = '<div class="empty-state">Select a file to review</div>';
        return;
      }

      const review = file.review || { status: 'pending', comments: [], hash: '' };
      const comments = review.comments || [];

      container.innerHTML = '';

      let editingCommentId = null;
      function editComment(comment) {
        editingCommentId = comment.id;
        const lineInput = document.getElementById('comment-line');
        const textInput = document.getElementById('comment-text');
        const suggestionTextarea = document.getElementById('comment-suggestion');
        const suggestionContainer = document.getElementById('suggestion-input');
        const addBtn = document.getElementById('btn-add-comment');
        const cancelBtn = document.getElementById('btn-cancel-edit');
        if (lineInput) lineInput.value = comment.line || '';
        if (textInput) { textInput.value = comment.text; textInput.focus(); }
        if (comment.suggestion) {
          if (suggestionContainer) suggestionContainer.style.display = 'block';
          if (suggestionTextarea) suggestionTextarea.value = comment.suggestion;
        } else {
          if (suggestionContainer) suggestionContainer.style.display = 'none';
          if (suggestionTextarea) suggestionTextarea.value = '';
        }
        if (addBtn) addBtn.textContent = 'Update';
        if (cancelBtn) cancelBtn.style.display = '';
        document.querySelector('.review-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // File header with navigation arrows
      const currentIdx = appState.files.findIndex(f => f.path === appState.selectedFile);
      const header = document.createElement('div');
      header.className = 'file-header';
      header.innerHTML = `
        <button class="file-nav-btn" id="btn-prev" title="Previous file (k)">\u25B2</button>
        <button class="file-nav-btn" id="btn-next" title="Next file (j)">\u25BC</button>
        <span style="display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden;">
          <span class="file-header-path" style="flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(file.path)}</span>
          <button class="file-nav-btn btn-copy-path" id="btn-copy-path" title="Copy file path" style="flex-shrink:0;">\u29C9</button>
        </span>
        <span style="color: var(--text-muted); font-size: 12px;">${currentIdx + 1}/${appState.files.length}</span>
        ${file.review?.changedSinceReview ? '<span class="badge badge-changed">Changed since review</span>' : ''}
        <span class="badge badge-${file.status}">${file.status}</span>
        <button class="btn ${review.status === 'reviewed' ? 'btn-primary' : ''}" id="btn-approve">
          ${review.status === 'reviewed' ? '\u2713 Viewed' : 'Mark Viewed'}
        </button>
      `;
      container.appendChild(header);

      // Nav button handlers
      header.querySelector('#btn-prev').addEventListener('click', () => navigateFile('prev'));
      header.querySelector('#btn-next').addEventListener('click', () => navigateFile('next'));

      // Copy path handler
      header.querySelector('#btn-copy-path').addEventListener('click', async (e) => {
        await api('/api/clipboard', { method: 'POST', body: { text: file.path } });
        const btn = e.currentTarget;
        const original = btn.textContent;
        btn.textContent = '\u2713';
        btn.style.color = 'var(--cyan)';
        setTimeout(() => { btn.textContent = original; btn.style.color = ''; }, 1500);
      });

      // Diff viewer
      const diffContainer = document.createElement('div');
      diffContainer.className = 'diff-container';
      if (appState.currentDiff.diff) {
        try {
          const diff2htmlUi = new Diff2HtmlUI(diffContainer, appState.currentDiff.diff, {
            drawFileList: false,
            matching: 'lines',
            outputFormat: 'line-by-line',
            highlight: true,
            fileListToggle: false,
            fileListStartVisible: false,
            fileContentToggle: false,
          });
          diff2htmlUi.draw();

          // Hide diff2html's own file header
          const d2hHeader = diffContainer.querySelector('.d2h-file-header');
          if (d2hHeader) d2hHeader.style.display = 'none';

          // Post-render: folds, inline comments, line click handlers
          setTimeout(() => {
            insertFoldIndicators(diffContainer, appState.currentDiff.diff, file.path);
            insertInlineComments(diffContainer, comments, review.archivedComments || [], editComment);

            // Line selection state
            let rangeStart = null;

            function highlightRange(s, e) {
              diffContainer.querySelectorAll('tr.line-selected').forEach(r => r.classList.remove('line-selected'));
              diffContainer.querySelectorAll('.fold-line.fold-line-selected').forEach(r => r.classList.remove('fold-line-selected'));
              if (s === null) return;
              diffContainer.querySelectorAll('.d2h-code-linenumber').forEach(numEl => {
                const ln = parseInt(numEl.querySelector('.line-num2')?.textContent?.trim());
                if (!isNaN(ln) && ln >= s && ln <= e) {
                  const row = numEl.closest('tr');
                  if (row) row.classList.add('line-selected');
                }
              });
              diffContainer.querySelectorAll('.fold-line').forEach(foldLine => {
                const ln = parseInt(foldLine.querySelector('.fold-line-num')?.textContent?.trim());
                if (!isNaN(ln) && ln >= s && ln <= e) foldLine.classList.add('fold-line-selected');
              });
            }

            // Click and drag line numbers to select range; shift+click to extend; click to toggle
            let isDragging = false;
            let dragStartLine = null;

            document.addEventListener('mouseup', () => { isDragging = false; }, { capture: true });

            diffContainer.querySelectorAll('.d2h-code-linenumber').forEach(el => {
              function getLineNum(el) {
                const n = parseInt(el.querySelector('.line-num2')?.textContent?.trim() || el.querySelector('.line-num1')?.textContent?.trim());
                return isNaN(n) ? null : n;
              }

              el.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                const num = getLineNum(el);
                if (num === null) return;
                isDragging = true;
                dragStartLine = num;
                // Start with single line selected
                rangeStart = num;
                const lineInput = document.getElementById('comment-line');
                if (lineInput) lineInput.value = String(num);
                highlightRange(num, num);
              });

              el.addEventListener('mouseover', () => {
                if (!isDragging || dragStartLine === null) return;
                const num = getLineNum(el);
                if (num === null) return;
                const s = Math.min(dragStartLine, num);
                const e = Math.max(dragStartLine, num);
                const lineInput = document.getElementById('comment-line');
                if (lineInput) lineInput.value = s === e ? String(s) : `${s}-${e}`;
                highlightRange(s, e);
              });

              el.addEventListener('mouseup', (ev) => {
                if (!isDragging) return;
                isDragging = false;
                const num = getLineNum(el);
                if (num === null) { dragStartLine = null; return; }

                if (ev.shiftKey && rangeStart !== null) {
                  // Shift+click extends range from rangeStart
                  const s = Math.min(rangeStart, num);
                  const e = Math.max(rangeStart, num);
                  const lineInput = document.getElementById('comment-line');
                  if (lineInput) lineInput.value = s === e ? String(s) : `${s}-${e}`;
                  highlightRange(s, e);
                } else if (num === dragStartLine) {
                  // Plain click on same line: toggle deselect if already selected
                  const lineInput = document.getElementById('comment-line');
                  const currentVal = lineInput?.value.trim() || '';
                  if (currentVal && rangeStart === num && !currentVal.includes('-')) {
                    rangeStart = null;
                    if (lineInput) lineInput.value = '';
                    highlightRange(null, null);
                  } else {
                    rangeStart = num;
                    document.getElementById('comment-text')?.focus();
                  }
                } else {
                  // Drag ended: range already set via mouseover, just focus textarea
                  rangeStart = dragStartLine;
                  document.getElementById('comment-text')?.focus();
                }
                dragStartLine = null;
              });
            });

            // Event delegation for fold line numbers (dynamically inserted when fold is expanded)
            function getFoldLineNum(target) {
              const el = target.closest('.fold-line-num');
              if (!el) return null;
              const n = parseInt(el.textContent?.trim());
              return isNaN(n) ? null : n;
            }

            diffContainer.addEventListener('mousedown', (ev) => {
              const num = getFoldLineNum(ev.target);
              if (num === null) return;
              ev.preventDefault();
              isDragging = true;
              dragStartLine = num;
              rangeStart = num;
              const lineInput = document.getElementById('comment-line');
              if (lineInput) lineInput.value = String(num);
              highlightRange(num, num);
            });

            diffContainer.addEventListener('mouseover', (ev) => {
              if (!isDragging || dragStartLine === null) return;
              const num = getFoldLineNum(ev.target);
              if (num === null) return;
              const s = Math.min(dragStartLine, num);
              const e = Math.max(dragStartLine, num);
              const lineInput = document.getElementById('comment-line');
              if (lineInput) lineInput.value = s === e ? String(s) : `${s}-${e}`;
              highlightRange(s, e);
            });

            diffContainer.addEventListener('mouseup', (ev) => {
              const num = getFoldLineNum(ev.target);
              if (num === null) return;
              if (!isDragging) return;
              isDragging = false;
              if (ev.shiftKey && rangeStart !== null) {
                const s = Math.min(rangeStart, num);
                const e = Math.max(rangeStart, num);
                const lineInput = document.getElementById('comment-line');
                if (lineInput) lineInput.value = s === e ? String(s) : `${s}-${e}`;
                highlightRange(s, e);
              } else if (num === dragStartLine) {
                const lineInput = document.getElementById('comment-line');
                const currentVal = lineInput?.value.trim() || '';
                if (currentVal && rangeStart === num && !currentVal.includes('-')) {
                  rangeStart = null;
                  if (lineInput) lineInput.value = '';
                  highlightRange(null, null);
                } else {
                  rangeStart = num;
                  document.getElementById('comment-text')?.focus();
                }
              } else {
                rangeStart = dragStartLine;
                document.getElementById('comment-text')?.focus();
              }
              dragStartLine = null;
            });

          }, 80);
        } catch (err) {
          diffContainer.innerHTML = `<pre style="padding: 16px; font-size: 13px; white-space: pre-wrap;">${escapeHtml(appState.currentDiff.diff)}</pre>`;
        }
      } else {
        diffContainer.innerHTML = '<div class="empty-state">No diff available</div>';
      }
      container.appendChild(diffContainer);

      // Review section
      const reviewSection = document.createElement('div');
      reviewSection.className = 'review-section';

      const reviewHeader = document.createElement('div');
      reviewHeader.className = 'review-header';
      reviewHeader.textContent = `File Comments (${comments.length})`;
      reviewSection.appendChild(reviewHeader);

      if (comments.length > 0) {
        const commentsList = document.createElement('div');
        commentsList.className = 'comments-list';
        for (const comment of comments) {
          const item = document.createElement('div');
          item.className = 'comment-item';
          item.innerHTML = `
            <span class="comment-line-ref">${comment.line ? 'L' + comment.line : 'General'}</span>
            <div class="comment-text">
              ${escapeHtml(comment.text)}
              ${comment.suggestion ? `<div class="comment-suggestion">${escapeHtml(comment.suggestion)}</div>` : ''}
            </div>
            <span class="comment-edit" data-id="${comment.id}" title="Edit comment">&#x270F;</span>
            <span class="comment-delete" data-id="${comment.id}" title="Delete comment">&times;</span>
          `;
          commentsList.appendChild(item);
        }
        reviewSection.appendChild(commentsList);

        commentsList.querySelectorAll('.comment-edit').forEach(el => {
          el.addEventListener('click', () => {
            const comment = comments.find(c => c.id === el.dataset.id);
            if (comment) editComment(comment);
          });
        });

        commentsList.querySelectorAll('.comment-delete').forEach(el => {
          el.addEventListener('click', () => {
            const id = el.dataset.id;
            const newComments = comments.filter(c => c.id !== id);
            const newStatus = newComments.length > 0 ? 'has-feedback' : 'pending';
            saveReview(file.path, newStatus, newComments).then(() => {
              if (appState.selectedFile === file.path) loadDiff(file.path);
            });
          });
        });
      }

      const addComment = document.createElement('div');
      addComment.className = 'add-comment';
      addComment.innerHTML = `
        <div class="add-comment-row">
          <input type="text" id="comment-line" placeholder="L# or L#-#" style="width:80px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:12px;font-family:'SF Mono','Fira Code',monospace;" title="Line number or range (e.g. 42 or 15-22). Leave empty for general file comment.">
          <textarea id="comment-text" placeholder="Add a comment (line optional)..." rows="1"></textarea>
          <button class="btn" id="btn-add-comment">Add</button>
          <span id="btn-cancel-edit" style="display:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:0 4px;" title="Cancel editing">cancel</span>
        </div>
        <span class="suggestion-toggle" id="toggle-suggestion">+ Add code suggestion</span>
        <div class="suggestion-input" id="suggestion-input" style="display: none;">
          <textarea id="comment-suggestion" placeholder="Suggested code..." rows="3"></textarea>
        </div>
      `;
      reviewSection.appendChild(addComment);

      // Quick comment buttons
      const quickComments = document.createElement('div');
      quickComments.className = 'quick-comments';
      const presets = ['Naming', 'Missing test', 'Unnecessary change', 'Delete this file', 'Needs refactor', 'Wrong approach'];
      for (const preset of presets) {
        const btn = document.createElement('button');
        btn.className = 'quick-btn';
        btn.textContent = preset;
        btn.addEventListener('click', () => {
          const textArea = document.getElementById('comment-text');
          if (textArea) {
            textArea.value = preset;
            textArea.focus();
          }
        });
        quickComments.appendChild(btn);
      }
      reviewSection.appendChild(quickComments);

      // Archived comments from previous rounds
      const archived = review.archivedComments || [];
      if (archived.length > 0) {
        const archivedSection = document.createElement('div');
        archivedSection.className = 'archived-section';
        archivedSection.innerHTML = `<div class="archived-header" id="toggle-archived">Previous round comments (${archived.length}) \u25B8</div>`;
        const archivedList = document.createElement('div');
        archivedList.id = 'archived-list';
        archivedList.style.display = 'none';
        for (const ac of archived) {
          const item = document.createElement('div');
          item.className = 'archived-item';
          item.innerHTML = `
            <span class="archived-round">R${ac.round}</span>
            <span class="comment-line-ref">${ac.line ? 'L' + ac.line : 'General'}</span>
            <span class="archived-text">${escapeHtml(ac.text)}${ac.suggestion ? `<div class="comment-suggestion">${escapeHtml(ac.suggestion)}</div>` : ''}</span>
          `;
          archivedList.appendChild(item);
        }
        archivedSection.appendChild(archivedList);
        reviewSection.appendChild(archivedSection);
      }

      container.appendChild(reviewSection);

      // General comments section
      const generalSection = document.createElement('div');
      generalSection.className = 'general-section';
      generalSection.innerHTML = `
        <div class="general-header" id="toggle-general">
          General Comments (${appState.generalComments.length}) \u25BE
        </div>
        <div class="general-body" id="general-body">
          <div class="comments-list" id="general-comments-list"></div>
          <div class="add-comment">
            <div class="add-comment-row">
              <textarea id="general-comment-text" placeholder="Add a general comment (not tied to any file)..." rows="1" style="flex:1;"></textarea>
              <button class="btn" id="btn-add-general">Add</button>
            </div>
          </div>
        </div>
      `;
      container.appendChild(generalSection);

      renderGeneralComments();

      // --- Event handlers ---

      document.getElementById('btn-approve').addEventListener('click', () => {
        if (review.status === 'reviewed') {
          // Un-view: stay on same file
          saveReview(file.path, 'pending', comments).then(() => loadDiff(file.path));
        } else {
          // Viewed and advance to next file
          saveReview(file.path, 'reviewed', comments).then(() => navigateFile('next'));
        }
      });

      document.getElementById('btn-add-comment').addEventListener('click', addFileComment);
      document.getElementById('comment-text').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addFileComment();
      });

      // Restore the WIP draft for this file if one was captured before a previous rebuild.
      const draft = appState.drafts[file.path];
      if (draft) {
        const lineEl = document.getElementById('comment-line');
        const textEl = document.getElementById('comment-text');
        const suggestionEl = document.getElementById('comment-suggestion');
        const suggestionContainer = document.getElementById('suggestion-input');
        if (lineEl) lineEl.value = draft.line || '';
        if (textEl) textEl.value = draft.text || '';
        if (draft.suggestion && suggestionEl) suggestionEl.value = draft.suggestion;
        if (draft.suggestionOpen && suggestionContainer) suggestionContainer.style.display = 'block';
      }

      document.getElementById('btn-cancel-edit').addEventListener('click', () => {
        editingCommentId = null;
        document.getElementById('comment-line').value = '';
        document.getElementById('comment-text').value = '';
        const suggestionContainer = document.getElementById('suggestion-input');
        const suggestionTextarea = document.getElementById('comment-suggestion');
        if (suggestionContainer) suggestionContainer.style.display = 'none';
        if (suggestionTextarea) suggestionTextarea.value = '';
        document.getElementById('btn-add-comment').textContent = 'Add';
        document.getElementById('btn-cancel-edit').style.display = 'none';
      });

      document.getElementById('toggle-suggestion').addEventListener('click', () => {
        const input = document.getElementById('suggestion-input');
        const isHiding = input.style.display !== 'none';
        input.style.display = isHiding ? 'none' : 'block';
        if (isHiding) {
          const textarea = document.getElementById('comment-suggestion');
          if (textarea) textarea.value = '';
        }
      });

      document.getElementById('btn-add-general').addEventListener('click', addGeneralComment);
      document.getElementById('general-comment-text').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addGeneralComment();
      });

      document.getElementById('toggle-general').addEventListener('click', () => {
        const body = document.getElementById('general-body');
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });

      // Archived comments toggle
      const toggleArchived = document.getElementById('toggle-archived');
      if (toggleArchived) {
        toggleArchived.addEventListener('click', () => {
          const list = document.getElementById('archived-list');
          const isHidden = list.style.display === 'none';
          list.style.display = isHidden ? 'block' : 'none';
          toggleArchived.textContent = `Previous round comments (${archived.length}) ${isHidden ? '\u25BE' : '\u25B8'}`;
        });
      }

      function addFileComment() {
        const text = document.getElementById('comment-text').value.trim();
        if (!text) return;

        const lineRaw = document.getElementById('comment-line').value.trim();
        const line = lineRaw || null; // Keep as string for ranges like "15-22"
        const suggestion = document.getElementById('comment-suggestion')?.value.trim() || null;

        let newComments;
        if (editingCommentId) {
          // Update existing comment
          newComments = comments.map(c =>
            c.id === editingCommentId ? { ...c, line, text, suggestion } : c
          );
          editingCommentId = null;
        } else {
          // Add new comment
          const newComment = { id: 'c-' + Date.now(), line, text, suggestion };
          newComments = [...comments, newComment];
        }

        // Comment submitted: clear the form and the WIP draft so the next
        // loadDiff doesn't re-capture them via saveCurrentDraft().
        delete appState.drafts[file.path];
        document.getElementById('comment-line').value = '';
        document.getElementById('comment-text').value = '';
        const sugEl = document.getElementById('comment-suggestion');
        if (sugEl) sugEl.value = '';
        const sugCont = document.getElementById('suggestion-input');
        if (sugCont) sugCont.style.display = 'none';

        // Save scroll position before re-render
        const diffEl = document.querySelector('.diff-container');
        const scrollTop = diffEl ? diffEl.scrollTop : 0;

        saveReview(file.path, 'has-feedback', newComments).then(() => {
          loadDiff(file.path).then(() => {
            // Restore scroll position
            const newDiffEl = document.querySelector('.diff-container');
            if (newDiffEl) newDiffEl.scrollTop = scrollTop;
          });
        });
      }

      function addGeneralComment() {
        const text = document.getElementById('general-comment-text').value.trim();
        if (!text) return;

        appState.generalComments.push({
          id: 'g-' + Date.now(),
          text,
        });
        saveGeneralComments().then(() => {
          document.getElementById('general-comment-text').value = '';
          renderGeneralComments();
          loadFiles();
        });
      }
    }

    function renderGeneralComments() {
      const list = document.getElementById('general-comments-list');
      if (!list) return;

      list.innerHTML = '';
      for (const comment of appState.generalComments) {
        const item = document.createElement('div');
        item.className = 'comment-item';
        item.innerHTML = `
          <span class="comment-text">${escapeHtml(comment.text)}</span>
          <span class="comment-delete" data-id="${comment.id}" title="Delete">&times;</span>
        `;
        list.appendChild(item);
      }

      list.querySelectorAll('.comment-delete').forEach(el => {
        el.addEventListener('click', () => {
          appState.generalComments = appState.generalComments.filter(c => c.id !== el.dataset.id);
          saveGeneralComments().then(() => {
            renderGeneralComments();
            loadFiles();
          });
        });
      });

      const header = document.getElementById('toggle-general');
      if (header) {
        header.textContent = `General Comments (${appState.generalComments.length}) \u25BE`;
      }
    }

    // --- Generate Feedback ---
    document.getElementById('btn-generate').addEventListener('click', async () => {
      const data = await api('/api/generate', { method: 'POST', body: {} });
      showFeedbackModal(data.prompt);
    });

    function showFeedbackModal(prompt) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">Generated Feedback Prompt</span>
            <button class="btn" id="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <pre id="modal-prompt">${escapeHtml(prompt)}</pre>
          </div>
          <div class="modal-footer">
            <span class="copied-msg" id="copied-msg" style="display: none;">Copied!</span>
            <button class="btn btn-primary" id="modal-copy">Copy to Clipboard</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
      document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape') {
          overlay.remove();
          document.removeEventListener('keydown', handler);
        }
      });

      overlay.querySelector('#modal-copy').addEventListener('click', async () => {
        await api('/api/clipboard', { method: 'POST', body: { text: prompt } });
        const msg = overlay.querySelector('#copied-msg');
        msg.style.display = 'inline';
        setTimeout(() => msg.style.display = 'none', 2000);
      });

      // Auto-copy on open
      api('/api/clipboard', { method: 'POST', body: { text: prompt } });
    }

    // --- Finish Review ---
    document.getElementById('btn-finish').addEventListener('click', async () => {
      if (!confirm('Finish review and clear all state? This cannot be undone.')) return;
      clearInterval(pollingInterval);
      await api('/api/reset', { method: 'POST', body: { token: appState.sessionToken } });

      // Show goodbye screen with countdown
      document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#002b36;color:#93a1a1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;text-align:center;gap:16px;">
          <div style="font-size:48px;">&#128640;</div>
          <div style="font-size:22px;color:#eee8d5;font-weight:600;">Thanks for using diffback!</div>
          <div style="font-size:14px;color:#657b83;">Review state cleared. Go ship that feedback.</div>
          <div style="margin-top:24px;font-size:13px;color:#586e75;">Closing in <span id="countdown">5</span>s...</div>
        </div>
      `;

      let seconds = 5;
      const interval = setInterval(() => {
        seconds--;
        const el = document.getElementById('countdown');
        if (el) el.textContent = String(seconds);
        if (seconds <= 0) {
          clearInterval(interval);
          window.close();
        }
      }, 1000);
    });

    // --- Helpers ---
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'j') {
        e.preventDefault();
        navigateFile('next');
      } else if (e.key === 'k') {
        e.preventDefault();
        navigateFile('prev');
      } else if (e.key === 'a') {
        if (appState.selectedFile) {
          document.getElementById('btn-approve')?.click();
        }
      } else if (e.key === 'c') {
        e.preventDefault();
        document.getElementById('comment-text')?.focus();
      } else if (e.key === 'g') {
        document.getElementById('btn-generate').click();
      }
    });

    // --- Polling: refresh file list every 3s to detect external changes ---
    const pollingInterval = setInterval(async () => {
      const prev = JSON.stringify(appState.files.map(f => ({ p: f.path, s: f.review?.status, h: f.review?.hash, ch: f.review?.changedSinceReview })));
      await loadFiles();
      const curr = JSON.stringify(appState.files.map(f => ({ p: f.path, s: f.review?.status, h: f.review?.hash, ch: f.review?.changedSinceReview })));
      // If the currently selected file changed, refresh its diff
      if (prev !== curr && appState.selectedFile) {
        const file = appState.files.find(f => f.path === appState.selectedFile);
        if (file?.review?.changedSinceReview) {
          // Preserve scroll
          const diffEl = document.querySelector('.diff-container');
          const scrollTop = diffEl ? diffEl.scrollTop : 0;
          await loadDiff(appState.selectedFile);
          const newDiffEl = document.querySelector('.diff-container');
          if (newDiffEl) newDiffEl.scrollTop = scrollTop;
        }
      }
    }, 3000);

    // --- Shortcuts toggle ---
    document.getElementById('shortcuts-toggle').addEventListener('click', () => {
      const body = document.getElementById('shortcuts-body');
      const arrow = document.getElementById('shortcuts-arrow');
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      arrow.innerHTML = hidden ? '\u25BE' : '\u25B8';
    });

    // --- Sidebar resize ---
    (() => {
      const sidebar = document.getElementById('sidebar');
      const handle = document.getElementById('sidebar-resize');
      let dragging = false;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const newWidth = Math.min(600, Math.max(180, e.clientX));
        sidebar.style.width = newWidth + 'px';
      });

      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('diffback-sidebar-width', sidebar.style.width);
      });

      // Restore saved width
      const saved = localStorage.getItem('diffback-sidebar-width');
      if (saved) sidebar.style.width = saved;
    })();

    // --- Theme switcher ---
    function setTheme(name) {
      document.documentElement.className = `theme-${name}`;
      localStorage.setItem('diffback-theme', name);
      document.getElementById('theme-selector').value = name;
    }

    document.getElementById('theme-selector').addEventListener('change', (e) => {
      setTheme(e.target.value);
      // Re-render diff to apply new colors
      if (appState.selectedFile) loadDiff(appState.selectedFile);
    });

    // Load saved theme
    const savedTheme = localStorage.getItem('diffback-theme') || 'solarized-dark';
    setTheme(savedTheme);

    // --- Branch compare selector ---
    const compareSelector = document.getElementById('compare-selector');
    let branchesLoaded = false;

    compareSelector.addEventListener('focus', async () => {
      if (branchesLoaded) return;
      branchesLoaded = true;
      // Snapshot current options count before fetch (just the default option)
      const before = compareSelector.options.length;
      const data = await api('/api/branches');
      // The endpoint triggers git fetch in background; meanwhile render what we have
      for (const branch of data.branches || []) {
        const opt = document.createElement('option');
        opt.value = branch;
        opt.textContent = `vs ${branch}`;
        compareSelector.appendChild(opt);
      }
      // Set current value if server started with --compare
      if (data.compareRef) {
        compareSelector.value = data.compareRef;
      }
      // After a short delay, re-fetch to pick up any new branches from git fetch
      setTimeout(async () => {
        const fresh = await api('/api/branches');
        const existing = new Set(Array.from(compareSelector.options).map(o => o.value));
        for (const branch of fresh.branches || []) {
          if (!existing.has(branch)) {
            const opt = document.createElement('option');
            opt.value = branch;
            opt.textContent = `vs ${branch}`;
            compareSelector.appendChild(opt);
          }
        }
      }, 3000);
    });

    compareSelector.addEventListener('change', async (e) => {
      const ref = e.target.value || null;
      await api('/api/compare', { method: 'POST', body: { ref } });
      // Reset client state for the new comparison
      appState.selectedFile = null;
      appState.currentDiff = null;
      appState.fileContents = {};
      appState.drafts = {};
      await loadFiles();
      document.getElementById('content').innerHTML = '<div class="empty-state">Select a file to review</div>';
    });

    // --- Init ---
    // If server started with --compare, sync the selector after first load
    loadFiles().then(() => {
      if (appState.compareRef) {
        branchesLoaded = true;
        api('/api/branches').then(data => {
          for (const branch of data.branches || []) {
            const opt = document.createElement('option');
            opt.value = branch;
            opt.textContent = `vs ${branch}`;
            compareSelector.appendChild(opt);
          }
          compareSelector.value = appState.compareRef;
        });
      }
    });
