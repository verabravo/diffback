# diffback

A local web tool to review AI-generated code changes. Think GitHub PR reviews, but for uncommitted diffs in your terminal workflow.

Instead of manually reading `git diff` output and typing feedback into a chat, `diffback` gives you a visual interface to browse changes, mark files as viewed, leave comments on specific lines, and generate a structured feedback prompt you can paste directly into your AI agent.

## Why

When working with AI coding agents (Claude Code, Cursor, Copilot, etc.), the review loop is painful:

1. The AI makes changes across multiple files
2. You run `git diff` and scroll through walls of text
3. You mentally track what you've reviewed and what needs fixing
4. You type feedback into the chat, forgetting half of what you noticed
5. The AI applies fixes, and you start over -- re-reviewing files that didn't change

`diffback` fixes this by giving you a proper review interface with persistent state that survives between rounds.

## Features

- **Web UI on localhost** -- file list + diff viewer + comment panel, opens in your browser
- **Mark files as viewed** -- track your progress across many files
- **Line comments** -- click a line number to reference it, add text or code suggestions
- **General comments** -- feedback not tied to any file ("run the tests", "don't generate config files")
- **Inline comment display** -- comments appear as bubbles directly under the referenced line
- **Generate feedback prompt** -- one click to produce a structured markdown prompt, auto-copied to clipboard
- **Persistent state between rounds** -- files you viewed stay viewed if unchanged; modified files get flagged automatically
- **Auto-refresh** -- detects external file changes every 3 seconds without manual reload
- **Code fold/expand** -- hidden code between hunks shown as expandable sections
- **Keyboard shortcuts** -- `j/k` navigate files, `a` mark viewed, `c` comment, `g` generate feedback

## Install

```bash
npm install -g diffback
```

Or run directly with npx:

```bash
npx diffback
```

## Usage

From any git repository with uncommitted changes:

```bash
diffback
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
- **File modified** since last review -- automatically flagged as "changed since review", status reset to pending
- **File no longer in diff** (reverted or committed) -- removed from state
- **"Finish Review"** button -- deletes all state for the current branch

## Generated feedback format

The output is designed to be token-efficient and easy for AI agents to parse:

```markdown
# Code Review Feedback

2 files need changes. 3 comments total.

## src/users/model.py
- L42: Handle the null case before accessing user.name
- L58: Use a dataclass instead
  ```
  @dataclass
  class UserProfile:
      name: str
      email: str
  ```

## General
- Run the tests before finishing
```

## Tech stack

- **TypeScript + Node.js** -- single `cli.ts` file for the server (~400 lines)
- **Single HTML file** -- all CSS and JS inline, served from the server
- **Node built-in `http`** -- no Express or framework dependencies
- **diff2html** -- diff rendering (loaded via CDN)
- **Solarized Dark theme** -- designed for accessibility

## Development

```bash
git clone https://github.com/verabravo/diffback.git
cd diffback
npm install
npm run build
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
