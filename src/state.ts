import type { ReviewState, ChangedFile, ArchivedComment } from "./types.js";

export function reconcileState(
  state: ReviewState,
  changedFiles: ChangedFile[],
  hashFile: (path: string) => string,
): ReviewState {
  const currentPaths = new Set(changedFiles.map((f) => f.path));
  let hasChanges = false;

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
        // File changed since last review - archive existing comments
        if (existing.comments.length > 0) {
          const archived: ArchivedComment[] = existing.comments.map((c) => ({
            ...c,
            archivedAt: new Date().toISOString(),
            round: state.round,
          }));
          existing.archivedComments = [...(existing.archivedComments || []), ...archived];
        }
        existing.status = "pending";
        existing.hash = currentHash;
        existing.comments = [];
        existing.changedSinceReview = true;
        hasChanges = true;
      }
    }
  }

  // If any files changed, bump the round
  if (hasChanges) {
    state.round = (state.round || 1) + 1;
  }

  return state;
}
