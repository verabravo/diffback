import http from "node:http";
import { execSync, execFileSync, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { resolve, basename, dirname, relative, isAbsolute } from "node:path";
import type { ReviewState, ChangedFile, FileReview, GeneralComment, ArchivedComment } from "./types.js";
import { generateFeedback } from "./feedback.js";
import { reconcileState } from "./state.js";

declare const __CLIENT_HTML__: string;

const cwd = process.cwd();
const projectName = basename(cwd);

function getBranchName(): string {
  try {
    return git("rev-parse", "--abbrev-ref", "HEAD").trim();
  } catch {
    return "unknown";
  }
}

function getStateDir(compareRef?: string): string {
  const branch = getBranchName();
  const suffix = compareRef ? `${branch}-vs-${compareRef.replace(/\//g, "_")}` : branch;
  return resolve(cwd, ".diffback-local-diffs", suffix);
}

function getStateFile(compareRef?: string): string {
  return resolve(getStateDir(compareRef), "state.json");
}

// --- Security ---

function validatePath(filePath: string): string {
  // Prevent path traversal: resolve and ensure it's within cwd
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path traversal blocked");
  }
  return rel;
}

// Generate a token for the session to protect destructive endpoints
const sessionToken = randomBytes(16).toString("hex");

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

// --- Git functions ---

function isGitRepo(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasCommits(): boolean {
  try {
    execFileSync("git", ["rev-parse", "HEAD"], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getChangedFiles(baseRef = "HEAD"): ChangedFile[] {
  const files: ChangedFile[] = [];
  const isBranchCompare = baseRef !== "HEAD";

  // For branch comparison, compute the merge-base so we only see changes
  // on the current branch (not commits merged into the base since it diverged).
  let effectiveRef = baseRef;
  if (isBranchCompare && hasCommits()) {
    try {
      effectiveRef = git("merge-base", "HEAD", baseRef).trim();
    } catch {
      effectiveRef = baseRef;
    }
  }

  if (hasCommits()) {
    // Tracked changes (modified, deleted, renamed)
    const diff = git("diff", "--name-status", effectiveRef).trim();
    if (diff) {
      for (const line of diff.split("\n")) {
        const parts = line.split("\t");
        const code = parts[0]!;
        if (code.startsWith("R")) {
          files.push({ path: parts[2]!, status: "renamed", oldPath: parts[1]! });
        } else if (code === "M") {
          files.push({ path: parts[1]!, status: "modified" });
        } else if (code === "D") {
          files.push({ path: parts[1]!, status: "deleted" });
        } else if (code === "A") {
          files.push({ path: parts[1]!, status: "added" });
        }
      }
    }
  }

  // Untracked files (only in default HEAD mode — branch compare includes them via diff)
  if (!isBranchCompare) {
    const untracked = git("ls-files", "--others", "--exclude-standard").trim();
    if (untracked) {
      for (const path of untracked.split("\n")) {
        // Skip diffback state files
        if (path.startsWith(".diffback-local-diffs/")) continue;
        if (!files.some((f) => f.path === path)) {
          files.push({ path, status: "added" });
        }
      }
    }
  }

  // Also check staged files
  if (hasCommits()) {
    const staged = git("diff", "--name-status", "--cached", effectiveRef).trim();
    if (staged) {
      for (const line of staged.split("\n")) {
        const parts = line.split("\t");
        const code = parts[0]!;
        const path = code.startsWith("R") ? parts[2]! : parts[1]!;
        if (!files.some((f) => f.path === path)) {
          if (code.startsWith("R")) {
            files.push({ path, status: "renamed", oldPath: parts[1]! });
          } else if (code === "M") {
            files.push({ path, status: "modified" });
          } else if (code === "D") {
            files.push({ path, status: "deleted" });
          } else if (code === "A") {
            files.push({ path, status: "added" });
          }
        }
      }
    }
  }

  // Get line stats (+/-)
  if (hasCommits()) {
    try {
      const numstat = git("diff", "--numstat", effectiveRef).trim();
      if (numstat) {
        for (const line of numstat.split("\n")) {
          const [add, del, path] = line.split("\t");
          const file = files.find((f) => f.path === path);
          if (file && add !== "-") {
            file.additions = parseInt(add!) || 0;
            file.deletions = parseInt(del!) || 0;
          }
        }
      }
    } catch { /* ignore */ }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function getFileDiff(filePath: string, baseRef = "HEAD"): string {
  const absPath = resolve(cwd, filePath);
  const isBranchCompare = baseRef !== "HEAD";

  let effectiveRef = baseRef;
  if (isBranchCompare && hasCommits()) {
    try {
      effectiveRef = git("merge-base", "HEAD", baseRef).trim();
    } catch {
      effectiveRef = baseRef;
    }
  }

  // Check if file is binary
  try {
    const numstat = git("diff", "--numstat", effectiveRef, "--", filePath).trim();
    if (numstat && numstat.startsWith("-\t-\t")) {
      return `Binary file ${filePath} has changed`;
    }
  } catch {
    // Ignore errors for untracked files
  }

  if (hasCommits()) {
    // Try tracked diff first
    const diff = git("diff", effectiveRef, "--", filePath);
    if (diff.trim()) return diff;

    // Try staged diff
    const stagedDiff = git("diff", "--cached", effectiveRef, "--", filePath);
    if (stagedDiff.trim()) return stagedDiff;
  }

  // Untracked file: synthesize a diff (only in HEAD mode)
  if (!isBranchCompare && existsSync(absPath)) {
    const content = readFileSync(absPath, "utf-8");
    const lines = content.split("\n");
    const diffLines = [
      `--- /dev/null`,
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((l) => `+${l}`),
    ];
    return diffLines.join("\n");
  }

  // Deleted file
  if (hasCommits()) {
    try {
      const content = git("show", `${effectiveRef}:${filePath}`);
      const lines = content.split("\n");
      const diffLines = [
        `--- a/${filePath}`,
        `+++ /dev/null`,
        `@@ -1,${lines.length} +0,0 @@`,
        ...lines.map((l) => `-${l}`),
      ];
      return diffLines.join("\n");
    } catch {
      return `File ${filePath} was deleted`;
    }
  }

  return "";
}

// --- Hash functions ---

function hashFile(filePath: string): string {
  const absPath = resolve(cwd, filePath);
  try {
    const content = readFileSync(absPath);
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return "deleted";
  }
}

// --- State management ---

function loadState(compareRef?: string): ReviewState {
  try {
    const data = readFileSync(getStateFile(compareRef), "utf-8");
    const state = JSON.parse(data);
    if (!state.round) state.round = 1;
    return state;
  } catch {
    return { round: 1, files: {}, generalComments: [] };
  }
}

function saveState(state: ReviewState, compareRef?: string): void {
  mkdirSync(getStateDir(compareRef), { recursive: true });
  writeFileSync(getStateFile(compareRef), JSON.stringify(state, null, 2));
}

// reconcileState imported from ./state.js

// generateFeedback imported from ./feedback.js

// --- Clipboard ---

function copyToClipboard(text: string): boolean {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execFileSync("pbcopy", [], { input: text });
    } else if (platform === "linux") {
      execFileSync("xclip", ["-selection", "clipboard"], { input: text });
    } else if (platform === "win32") {
      execFileSync("clip", [], { input: text });
    }
    return true;
  } catch {
    return false;
  }
}

// --- HTTP Server ---

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function getCompareBranches(): string[] {
  const current = getBranchName();
  const branches: string[] = [];

  // Local branches (except current)
  try {
    const local = git("branch", "--format=%(refname:short)").trim();
    if (local) {
      for (const b of local.split("\n")) {
        if (b !== current) branches.push(b);
      }
    }
  } catch { /* ignore */ }

  // Remote branches
  try {
    const remote = git("branch", "-r", "--format=%(refname:short)").trim();
    if (remote) {
      for (const b of remote.split("\n")) {
        if (!b.includes("HEAD") && !branches.includes(b)) branches.push(b);
      }
    }
  } catch { /* ignore */ }

  // Sort: main/master first (in any remote prefix), rest alphabetical
  return branches.sort((a, b) => {
    const aBase = a.replace(/^[^/]+\//, "");
    const bBase = b.replace(/^[^/]+\//, "");
    if (aBase === "main") return -1;
    if (bBase === "main") return 1;
    if (aBase === "master") return -1;
    if (bBase === "master") return 1;
    return a.localeCompare(b);
  });
}

function startServer(port: number, initialCompareRef?: string) {
  let isShuttingDown = false;
  let compareRef: string | undefined = initialCompareRef;
  let changedFiles = getChangedFiles(compareRef);

  if (changedFiles.length === 0) {
    if (compareRef) {
      console.log(`No changes found compared to ${compareRef}. Nothing to review.`);
    } else {
      console.log("No uncommitted changes found. Nothing to review.");
    }
    process.exit(0);
  }

  let state = loadState(compareRef);
  state = reconcileState(state, changedFiles, hashFile);
  saveState(state, compareRef);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    try {
      // Serve client HTML
      if (path === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(__CLIENT_HTML__);
        return;
      }

      // API: List files
      if (path === "/api/files" && req.method === "GET") {
        if (isShuttingDown) { json(res, { error: "shutting down" }, 503); return; }
        // Refresh file list and reconcile state
        const currentFiles = getChangedFiles(compareRef);
        changedFiles = currentFiles;
        state = reconcileState(state, currentFiles, hashFile);
        saveState(state, compareRef);

        const filesWithReview = currentFiles.map((f) => ({
          ...f,
          review: state.files[f.path] || null,
        }));
        const reviewed = Object.values(state.files).filter((f) => f.status === "reviewed").length;
        const hasFeedback = Object.values(state.files).filter((f) => f.status === "has-feedback").length;

        json(res, {
          files: filesWithReview,
          generalComments: state.generalComments,
          summary: {
            total: currentFiles.length,
            reviewed,
            hasFeedback,
            pending: currentFiles.length - reviewed - hasFeedback,
          },
          projectName,
          round: state.round,
          sessionToken,
          compareRef: compareRef || null,
        });
        return;
      }

      // API: Get diff
      if (path === "/api/diff" && req.method === "GET") {
        const filePath = url.searchParams.get("path");
        if (!filePath) {
          json(res, { error: "Missing path parameter" }, 400);
          return;
        }
        try { validatePath(filePath); } catch { json(res, { error: "Invalid path" }, 400); return; }
        const diff = getFileDiff(filePath, compareRef);
        const file = changedFiles.find((f) => f.path === filePath);
        json(res, {
          path: filePath,
          diff,
          status: file?.status || "modified",
        });
        return;
      }

      // API: Get file content (for expanding folds)
      if (path === "/api/file-content" && req.method === "GET") {
        const filePath = url.searchParams.get("path");
        if (!filePath) {
          json(res, { error: "Missing path parameter" }, 400);
          return;
        }
        try { validatePath(filePath); } catch { json(res, { error: "Invalid path" }, 400); return; }
        const absPath = resolve(cwd, filePath);
        try {
          const content = readFileSync(absPath, "utf-8");
          json(res, { path: filePath, content });
        } catch {
          // Try from git for deleted files
          try {
            const content = git("show", `HEAD:${filePath}`);
            json(res, { path: filePath, content });
          } catch {
            json(res, { error: "File not found" }, 404);
          }
        }
        return;
      }

      // API: Save review
      if (path === "/api/review" && req.method === "POST") {
        const body = JSON.parse(await parseBody(req));
        const { path: filePath, status, comments } = body;
        try { validatePath(filePath); } catch { json(res, { error: "Invalid path" }, 400); return; }

        const existing = state.files[filePath];
        state.files[filePath] = {
          status,
          hash: hashFile(filePath),
          comments: comments || [],
          archivedComments: existing?.archivedComments || [],
          changedSinceReview: false,
        };
        saveState(state, compareRef);
        json(res, { ok: true });
        return;
      }

      // API: Save general comments
      if (path === "/api/general-comments" && req.method === "POST") {
        const body = JSON.parse(await parseBody(req));
        state.generalComments = body.comments as GeneralComment[];
        saveState(state, compareRef);
        json(res, { ok: true });
        return;
      }

      // API: Generate feedback
      if (path === "/api/generate" && req.method === "POST") {
        // Re-read from disk to ensure we have the latest state
        state = loadState();
        const prompt = generateFeedback(state);
        json(res, { prompt });
        return;
      }

      // API: Copy to clipboard
      if (path === "/api/clipboard" && req.method === "POST") {
        const body = JSON.parse(await parseBody(req));
        const ok = copyToClipboard(body.text);
        json(res, { ok });
        return;
      }

      // API: List remote branches (triggers background git fetch on first call)
      if (path === "/api/branches" && req.method === "GET") {
        // Return current branches immediately, then fetch in background
        const branches = getCompareBranches();
        json(res, { branches, compareRef: compareRef || null });
        // Fetch in background (non-blocking) so next call sees new branches
        execFile("git", ["fetch", "--quiet"], { cwd, timeout: 15000 }, () => {});
        return;
      }

      // API: Switch comparison base ref
      if (path === "/api/compare" && req.method === "POST") {
        const body = JSON.parse(await parseBody(req));
        const newRef: string | null = body.ref;
        compareRef = newRef || undefined;

        // Reload state for the new comparison
        changedFiles = getChangedFiles(compareRef);
        state = loadState(compareRef);
        state = reconcileState(state, changedFiles, hashFile);
        saveState(state, compareRef);
        json(res, { ok: true, compareRef: compareRef || null, fileCount: changedFiles.length });
        return;
      }

      // API: Reset state (finish review) -- protected by session token
      if (path === "/api/reset" && req.method === "POST") {
        const body = JSON.parse(await parseBody(req));
        if (body.token !== sessionToken) {
          json(res, { error: "Invalid session token" }, 403);
          return;
        }
        isShuttingDown = true;
        try {
          rmSync(getStateDir(compareRef), { recursive: true, force: true });
        } catch {
          // Ignore
        }
        json(res, { ok: true });
        // Shut down after the client countdown finishes (5s + buffer)
        setTimeout(() => {
          console.log("\n  Review finished. State cleared. Bye!");
          server.close();
          process.exit(0);
        }, 6000);
        return;
      }

      // 404
      res.writeHead(404);
      res.end("Not found");
    } catch (err) {
      console.error("Server error:", err);
      json(res, { error: String(err) }, 500);
    }
  });

  server.listen(port, () => {
    console.log(`\n  diffback: ${projectName}`);
    if (compareRef) console.log(`  comparing against: ${compareRef}`);
    console.log(`  ${changedFiles.length} files with changes`);
    console.log(`  http://localhost:${port}\n`);
    console.log("  Press Ctrl+C to stop\n");

    // Open browser
    // Open browser without external dependency
    const url = `http://localhost:${port}`;
    const platform = process.platform;
    if (platform === "darwin") execFileSync("open", [url]);
    else if (platform === "win32") execFileSync("cmd", ["/c", "start", url]);
    else try { execFileSync("xdg-open", [url]); } catch { /* ignore */ }
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n  Stopped.");
    server.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
  });
}

// --- CLI entry ---

function main() {
  if (!isGitRepo()) {
    console.error("Error: not a git repository. Run diffback from a git project directory.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let port = 3847;
  let compareRef: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1]!, 10);
      i++;
    } else if ((args[i] === "--compare" || args[i] === "-c") && args[i + 1]) {
      compareRef = args[i + 1]!;
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
  diffback - Review AI-generated code changes

  Usage: diffback [options]

  Options:
    --port <number>       Port to use (default: 3847)
    --compare, -c <ref>   Compare against a branch (e.g. origin/main)
    --help, -h            Show this help
`);
      process.exit(0);
    }
  }

  startServer(port, compareRef);
}

main();
