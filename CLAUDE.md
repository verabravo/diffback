# CLAUDE.md

## Project overview

`diffback` is a CLI tool that starts a local web server to review uncommitted git changes. It's designed for reviewing AI-generated code changes and producing structured feedback prompts.

## Architecture

This project is intentionally simple -- 3 source files, no frameworks:

- `src/cli.ts` -- HTTP server, git operations, state management, prompt generation. All backend logic in one file.
- `src/client.html` -- Complete web UI with inline CSS and JS. Served as a string embedded at build time.
- `src/types.ts` -- Shared TypeScript interfaces.

The build tool (tsup) reads `client.html` at build time and injects it as a string constant (`__CLIENT_HTML__`) into the compiled `cli.js`.

## Key design decisions

- **No backend/frontend separation** -- the server is ~400 lines, the HTML is self-contained. Don't split into routes/services/components.
- **No frameworks** -- vanilla TypeScript on both sides. Node built-in `http` module for the server, vanilla JS for the client.
- **State as JSON files** -- stored in `.diffback-local-diffs/<branch>/state.json` inside the reviewed project.
- **diff2html via CDN** -- the only client-side dependency, loaded as a script tag.
- **Solarized Dark theme** -- the color scheme is intentional for accessibility (colorblind-friendly). Diffs use strong red/green backgrounds for contrast rather than subtle tints.

## Build

```bash
npm run build    # Compiles to dist/cli.js
npm run dev      # Watch mode
```

## Testing locally

```bash
cd /path/to/any-git-repo-with-changes
node /path/to/this-project/dist/cli.js
```

## Common tasks

- **Adding an API endpoint**: Add a new `if (path === "/api/..." ...)` block in `startServer()` in `cli.ts`.
- **Changing the UI**: Edit `src/client.html` directly. CSS is in the `<style>` block, JS is in the `<script>` block.
- **Changing the feedback prompt format**: Edit `generateFeedback()` in `cli.ts`.
- **Changing state structure**: Update interfaces in `types.ts`, then update `loadState`/`saveState`/`reconcileState` in `cli.ts`.
