import http from "node:http";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import type { ReviewState, ChangedFile, FileReview, GeneralComment } from "./types.js";

declare const __CLIENT_HTML__: string;

const cwd = process.cwd();
const projectName = basename(cwd);

function getBranchName(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getStateDir(): string {
  const branch = getBranchName();
  return resolve(cwd, ".diffback-local-diffs", branch);
}

function getStateFile(): string {
  return resolve(getStateDir(), "state.json");
}

// --- Git functions ---

function isGitRepo(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasCommits(): boolean {
  try {
    execSync("git rev-parse HEAD", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getChangedFiles(): ChangedFile[] {
  const files: ChangedFile[] = [];

  if (hasCommits()) {
    // Tracked changes (modified, deleted, renamed)
    const diff = execSync("git diff --name-status HEAD", { cwd, encoding: "utf-8" }).trim();
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

  // Untracked files
  const untracked = execSync("git ls-files --others --exclude-standard", {
    cwd,
    encoding: "utf-8",
  }).trim();
  if (untracked) {
    for (const path of untracked.split("\n")) {
      // Skip diffback state files
      if (path.startsWith(".diffback-local-diffs/")) continue;
      if (!files.some((f) => f.path === path)) {
        files.push({ path, status: "added" });
      }
    }
  }

  // Also check staged files
  if (hasCommits()) {
    const staged = execSync("git diff --name-status --cached HEAD", { cwd, encoding: "utf-8" }).trim();
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

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function getFileDiff(filePath: string): string {
  const absPath = resolve(cwd, filePath);

  // Check if file is binary
  try {
    const numstat = execSync(`git diff --numstat HEAD -- "${filePath}"`, {
      cwd,
      encoding: "utf-8",
    }).trim();
    if (numstat && numstat.startsWith("-\t-\t")) {
      return `Binary file ${filePath} has changed`;
    }
  } catch {
    // Ignore errors for untracked files
  }

  if (hasCommits()) {
    // Try tracked diff first
    const diff = execSync(`git diff HEAD -- "${filePath}"`, { cwd, encoding: "utf-8" });
    if (diff.trim()) return diff;

    // Try staged diff
    const stagedDiff = execSync(`git diff --cached HEAD -- "${filePath}"`, { cwd, encoding: "utf-8" });
    if (stagedDiff.trim()) return stagedDiff;
  }

  // Untracked file: synthesize a diff
  if (existsSync(absPath)) {
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
      const content = execSync(`git show HEAD:"${filePath}"`, { cwd, encoding: "utf-8" });
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

function loadState(): ReviewState {
  try {
    const data = readFileSync(getStateFile(), "utf-8");
    return JSON.parse(data);
  } catch {
    return { files: {}, generalComments: [] };
  }
}

function saveState(state: ReviewState): void {
  mkdirSync(getStateDir(), { recursive: true });
  writeFileSync(getStateFile(), JSON.stringify(state, null, 2));
}

function reconcileState(state: ReviewState, changedFiles: ChangedFile[]): ReviewState {
  const currentPaths = new Set(changedFiles.map((f) => f.path));

  // Remove files no longer in diff
  for (const path of Object.keys(state.files)) {
    if (!currentPaths.has(path)) {
      delete state.files[path];
    }
  }

  // Check hashes for existing files
  for (const path of currentPaths) {
    const currentHash = hashFile(path);
    const existing = state.files[path];

    if (existing) {
      if (existing.hash !== currentHash) {
        // File changed since last review
        existing.status = "pending";
        existing.hash = currentHash;
        existing.changedSinceReview = true;
      }
    }
    // New files get added when user first interacts with them
  }

  return state;
}

// --- Prompt generator ---

function generateFeedback(state: ReviewState): string {
  const lines: string[] = [];
  const filesWithFeedback: string[] = [];

  // Any file with comments has feedback, regardless of status
  for (const [path, review] of Object.entries(state.files)) {
    if (review.comments.length > 0) {
      filesWithFeedback.push(path);
    }
  }

  const totalComments =
    filesWithFeedback.reduce((sum, p) => sum + state.files[p]!.comments.length, 0) +
    state.generalComments.length;

  lines.push("# Code Review Feedback");
  lines.push("");
  lines.push(
    `${filesWithFeedback.length} files need changes. ${totalComments} comments total.`
  );

  // File-specific feedback
  for (const path of filesWithFeedback) {
    const review = state.files[path]!;
    lines.push("");
    lines.push(`## ${path}`);
    for (const comment of review.comments) {
      const lineRef = comment.line ? `L${comment.line}` : "General";
      if (comment.suggestion) {
        lines.push(`- ${lineRef}: ${comment.text}`);
        lines.push("  ```");
        lines.push(`  ${comment.suggestion}`);
        lines.push("  ```");
      } else {
        lines.push(`- ${lineRef}: ${comment.text}`);
      }
    }
  }

  // General comments
  if (state.generalComments.length > 0) {
    lines.push("");
    lines.push("## General");
    for (const comment of state.generalComments) {
      lines.push(`- ${comment.text}`);
    }
  }

  return lines.join("\n");
}

// --- Clipboard ---

function copyToClipboard(text: string): boolean {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync("pbcopy", { input: text });
    } else if (platform === "linux") {
      execSync("xclip -selection clipboard", { input: text });
    } else if (platform === "win32") {
      execSync("clip", { input: text });
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

function startServer(port: number) {
  const changedFiles = getChangedFiles();

  if (changedFiles.length === 0) {
    console.log("No uncommitted changes found. Nothing to review.");
    process.exit(0);
  }

  let state = loadState();
  state = reconcileState(state, changedFiles);
  saveState(state);

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
        // Refresh file list and reconcile state
        const currentFiles = getChangedFiles();
        state = reconcileState(state, currentFiles);
        saveState(state);

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
        const diff = getFileDiff(filePath);
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
        const absPath = resolve(cwd, filePath);
        try {
          const content = readFileSync(absPath, "utf-8");
          json(res, { path: filePath, content });
        } catch {
          // Try from git for deleted files
          try {
            const content = execSync(`git show HEAD:"${filePath}"`, { cwd, encoding: "utf-8" });
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

        state.files[filePath] = {
          status,
          hash: hashFile(filePath),
          comments: comments || [],
          changedSinceReview: false,
        };
        saveState(state);
        json(res, { ok: true });
        return;
      }

      // API: Save general comments
      if (path === "/api/general-comments" && req.method === "POST") {
        const body = JSON.parse(await parseBody(req));
        state.generalComments = body.comments as GeneralComment[];
        saveState(state);
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

      // API: Reset state (finish review)
      if (path === "/api/reset" && req.method === "POST") {
        try {
          rmSync(getStateDir(), { recursive: true, force: true });
        } catch {
          // Ignore
        }
        state = { files: {}, generalComments: [] };
        json(res, { ok: true });
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
    console.log(`  ${changedFiles.length} files with changes`);
    console.log(`  http://localhost:${port}\n`);
    console.log("  Press Ctrl+C to stop\n");

    // Open browser
    import("open").then((mod) => mod.default(`http://localhost:${port}`));
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

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
  diffback - Review AI-generated code changes

  Usage: diffback [options]

  Options:
    --port <number>  Port to use (default: 3847)
    --help, -h       Show this help
`);
      process.exit(0);
    }
  }

  startServer(port);
}

main();
