import type { ReviewState } from "./types.js";

export function generateFeedback(state: ReviewState): string {
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
