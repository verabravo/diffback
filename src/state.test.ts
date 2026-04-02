import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileState } from "./state.js";
import type { ReviewState, ChangedFile } from "./types.js";

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return { round: 1, files: {}, generalComments: [], ...overrides };
}

describe("reconcileState", () => {
  it("removes files no longer in diff", () => {
    const state = makeState({
      files: {
        "old.ts": { status: "reviewed", hash: "abc", comments: [] },
        "still.ts": { status: "reviewed", hash: "def", comments: [] },
      },
    });
    const changed: ChangedFile[] = [{ path: "still.ts", status: "modified" }];
    const result = reconcileState(state, changed, () => "def");
    assert.ok(!result.files["old.ts"]);
    assert.ok(result.files["still.ts"]);
  });

  it("keeps reviewed status when hash matches", () => {
    const state = makeState({
      files: {
        "app.ts": { status: "reviewed", hash: "same", comments: [] },
      },
    });
    const changed: ChangedFile[] = [{ path: "app.ts", status: "modified" }];
    const result = reconcileState(state, changed, () => "same");
    assert.equal(result.files["app.ts"]!.status, "reviewed");
    assert.ok(!result.files["app.ts"]!.changedSinceReview);
  });

  it("resets status to pending when hash changes", () => {
    const state = makeState({
      files: {
        "app.ts": { status: "reviewed", hash: "old", comments: [] },
      },
    });
    const changed: ChangedFile[] = [{ path: "app.ts", status: "modified" }];
    const result = reconcileState(state, changed, () => "new");
    assert.equal(result.files["app.ts"]!.status, "pending");
    assert.equal(result.files["app.ts"]!.hash, "new");
    assert.equal(result.files["app.ts"]!.changedSinceReview, true);
  });

  it("archives comments when file changes", () => {
    const state = makeState({
      round: 1,
      files: {
        "app.ts": {
          status: "has-feedback",
          hash: "old",
          comments: [
            { id: "c1", line: "10", text: "Fix this", suggestion: null },
          ],
        },
      },
    });
    const changed: ChangedFile[] = [{ path: "app.ts", status: "modified" }];
    const result = reconcileState(state, changed, () => "new");

    assert.equal(result.files["app.ts"]!.comments.length, 0);
    assert.equal(result.files["app.ts"]!.archivedComments!.length, 1);
    assert.equal(result.files["app.ts"]!.archivedComments![0]!.text, "Fix this");
    assert.equal(result.files["app.ts"]!.archivedComments![0]!.round, 1);
  });

  it("preserves existing archived comments when archiving more", () => {
    const state = makeState({
      round: 2,
      files: {
        "app.ts": {
          status: "has-feedback",
          hash: "v2",
          comments: [
            { id: "c2", line: "20", text: "New comment", suggestion: null },
          ],
          archivedComments: [
            { id: "c1", line: "10", text: "Old comment", suggestion: null, archivedAt: "2026-01-01", round: 1 },
          ],
        },
      },
    });
    const changed: ChangedFile[] = [{ path: "app.ts", status: "modified" }];
    const result = reconcileState(state, changed, () => "v3");

    assert.equal(result.files["app.ts"]!.archivedComments!.length, 2);
    assert.equal(result.files["app.ts"]!.archivedComments![0]!.round, 1);
    assert.equal(result.files["app.ts"]!.archivedComments![1]!.round, 2);
  });

  it("bumps round when files change", () => {
    const state = makeState({
      round: 1,
      files: {
        "app.ts": { status: "reviewed", hash: "old", comments: [] },
      },
    });
    const changed: ChangedFile[] = [{ path: "app.ts", status: "modified" }];
    const result = reconcileState(state, changed, () => "new");
    assert.equal(result.round, 2);
  });

  it("does not bump round when no files changed", () => {
    const state = makeState({
      round: 1,
      files: {
        "app.ts": { status: "reviewed", hash: "same", comments: [] },
      },
    });
    const changed: ChangedFile[] = [{ path: "app.ts", status: "modified" }];
    const result = reconcileState(state, changed, () => "same");
    assert.equal(result.round, 1);
  });

  it("does not touch new files not in state", () => {
    const state = makeState({ files: {} });
    const changed: ChangedFile[] = [{ path: "new.ts", status: "added" }];
    const result = reconcileState(state, changed, () => "abc");
    assert.ok(!result.files["new.ts"]);
  });
});
