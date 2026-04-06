# diffback

A local web tool to review AI-generated code changes. Think GitHub PR reviews, but for uncommitted diffs in your terminal workflow.

Instead of manually reading `git diff` output and typing feedback into a chat, `diffback` gives you a visual interface to browse changes, mark files as viewed, leave comments on specific lines, and generate a structured feedback prompt you can paste directly into your AI agent.

![diffback diff view with syntax highlighting](https://raw.githubusercontent.com/verabravo/diffback/main/docs/screenshot-diff-view.png)

## Why

When working with AI coding agents (Claude Code, Cursor, Copilot, etc.), the review loop is painful:

1. The AI makes changes across multiple files
2. You run `git diff` and scroll through walls of text
3. You mentally track what you've reviewed and what needs fixing
4. You type feedback into the chat, forgetting half of what you noticed
5. The AI applies fixes, and you start over -- re-reviewing files that didn't change

`diffback` fixes this by giving you a proper review interface with persistent state that survives between rounds.

## Features

### File browser with diff stats

Browse all changed files with status indicators (Added, Modified, Deleted, Renamed) and line stats (+/-). Filter by review status: All, Pending, Viewed, or Feedback.

![File list with filters and stats](https://raw.githubusercontent.com/verabravo/diffback/main/docs/screenshot-overview.png)

### Inline comments with line ranges

Click line numbers to reference them (shift+click for ranges). Comments appear as bubbles directly in the diff. Quick comment presets for common feedback.

![Inline comment on a line range](https://raw.githubusercontent.com/verabravo/diffback/main/docs/screenshot-inline-comment.png)

### Generate feedback prompt

One click to produce a structured, token-efficient markdown prompt. Auto-copied to clipboard, ready to paste into your AI agent.

![Generated feedback modal](https://raw.githubusercontent.com/verabravo/diffback/main/docs/screenshot-feedback.png)

### Themes

Three built-in themes: Solarized Dark (default), Monokai, and GitHub Light. Syntax highlighting adapts to each theme. Preference persists across sessions.

| Solarized Dark | Monokai | GitHub Light |
|:-:|:-:|:-:|
| ![Solarized Dark](https://raw.githubusercontent.com/verabravo/diffback/main/docs/screenshot-diff-view.png) | ![Monokai](https://raw.githubusercontent.com/verabravo/diffback/main/docs/screenshot-monokai.png) | ![GitHub Light](https://raw.githubusercontent.com/verabravo/diffback/main/docs/screenshot-github-light.png) |

### More features

- **Persistent state between rounds** -- files you viewed stay viewed if unchanged; modified files get flagged automatically
- **Review round history** -- comments from previous rounds are archived and shown as violet markers in the diff
- **Auto-refresh** -- detects external file changes every 3 seconds without manual reload
- **Code fold/expand** -- hidden code between hunks shown as expandable sections
- **Resizable sidebar** -- drag to adjust the file list width
- **Keyboard shortcuts** -- `j/k` navigate files, `a` mark viewed, `c` comment, `g` generate feedback

## Requirements

- Node.js >= 24
- Git

## Install

```bash
npm install -g diffback-review
```

Or run directly with npx:

```bash
npx diffback-review
```

## Usage

From any git repository with uncommitted changes:

```bash
npx diffback-review
```

This starts a local server and opens your browser. Review the changes, add comments, then click **Generate Feedback** to get a prompt you can paste into your AI agent.

### Options

```
diffback [options]

  --port <number>  Port to use (default: 3847)
  --help, -h       Show help
```

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous file |
| `a` | Mark current file as viewed (advances to next) |
| `c` | Focus comment input |
| `g` | Generate feedback prompt |
| `Cmd+Enter` | Submit comment |

## How state works

Review state is stored in `.diffback-local-diffs/<branch_name>/state.json` inside the reviewed project. Add `.diffback-local-diffs` to your `.gitignore`.

Between review rounds:

- **File unchanged** since last review -- stays marked as viewed
- **File modified** since last review -- automatically flagged as "changed since review", status reset to pending. Previous comments are archived with their round number.
- **File no longer in diff** (reverted or committed) -- removed from state
- **"Finish Review"** button -- deletes all state for the current branch, shows goodbye screen, shuts down the server

## Generated feedback format

The output is designed to be token-efficient and easy for AI agents to parse:

```
# Code Review Feedback

1 files need changes. 2 comments total.

## src/users/model.py
- L42: Handle the null case before accessing user.name
- L15-22: Use a dataclass instead
```

## Tech stack

- **TypeScript + Node.js** -- server, feedback generator, and state manager as separate modules
- **Vanilla JS client** -- HTML + CSS + JS, no frameworks
- **Node built-in `http`** -- no Express or framework dependencies
- **diff2html** -- diff rendering with syntax highlighting (loaded via CDN)
- **3 themes** -- Solarized Dark, Monokai, GitHub Light

## Development

```bash
git clone https://github.com/verabravo/diffback.git
cd diffback
npm install
npm run build
npm test
```

Test against any repo with uncommitted changes:

```bash
cd /path/to/your/project
node /path/to/diffback/dist/cli.js
```

Watch mode for development:

```bash
npm run dev
```

## License

MIT
