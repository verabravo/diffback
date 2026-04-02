import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateFeedback } from "./feedback.js";
import type { ReviewState } from "./types.js";

describe("generateFeedback", () => {
  it("generates empty feedback when no comments", () => {
    const state: ReviewState = {
      round: 1,
      files: {
        "src/app.ts": { status: "reviewed", hash: "abc", comments: [] },
      },
      generalComments: [],
    };
    const result = generateFeedback(state);
    assert.ok(result.includes("0 files need changes"));
    assert.ok(result.includes("0 comments total"));
  });

  it("includes file comments with line references", () => {
    const state: ReviewState = {
      round: 1,
      files: {
        "src/utils.ts": {
          status: "reviewed",
          hash: "abc",
          comments: [
            { id: "c1", line: "42", text: "Handle null case", suggestion: null },
          ],
        },
      },
      generalComments: [],
    };
    const result = generateFeedback(state);
    assert.ok(result.includes("1 files need changes"));
    assert.ok(result.includes("## src/utils.ts"));
    assert.ok(result.includes("L42: Handle null case"));
  });

  it("includes line ranges", () => {
    const state: ReviewState = {
      round: 1,
      files: {
        "src/app.ts": {
          status: "has-feedback",
          hash: "abc",
          comments: [
            { id: "c1", line: "15-22", text: "Refactor this block", suggestion: null },
          ],
        },
      },
      generalComments: [],
    };
    const result = generateFeedback(state);
    assert.ok(result.includes("L15-22: Refactor this block"));
  });

  it("includes suggestions as code blocks", () => {
    const state: ReviewState = {
      round: 1,
      files: {
        "src/app.ts": {
          status: "has-feedback",
          hash: "abc",
          comments: [
            { id: "c1", line: "10", text: "Use Map", suggestion: "const cache = new Map();" },
          ],
        },
      },
      generalComments: [],
    };
    const result = generateFeedback(state);
    assert.ok(result.includes("L10: Use Map"));
    assert.ok(result.includes("```"));
    assert.ok(result.includes("const cache = new Map();"));
  });

  it("includes general comments in separate section", () => {
    const state: ReviewState = {
      round: 1,
      files: {},
      generalComments: [
        { id: "g1", text: "Run the tests" },
        { id: "g2", text: "Delete generated config" },
      ],
    };
    const result = generateFeedback(state);
    assert.ok(result.includes("## General"));
    assert.ok(result.includes("- Run the tests"));
    assert.ok(result.includes("- Delete generated config"));
    assert.ok(result.includes("2 comments total"));
  });

  it("includes file-level comments without line reference", () => {
    const state: ReviewState = {
      round: 1,
      files: {
        "src/app.ts": {
          status: "has-feedback",
          hash: "abc",
          comments: [
            { id: "c1", line: null, text: "Naming is inconsistent", suggestion: null },
          ],
        },
      },
      generalComments: [],
    };
    const result = generateFeedback(state);
    assert.ok(result.includes("General: Naming is inconsistent"));
  });

  it("counts comments from files regardless of review status", () => {
    const state: ReviewState = {
      round: 1,
      files: {
        "a.ts": {
          status: "reviewed",
          hash: "abc",
          comments: [{ id: "c1", line: "1", text: "Fix", suggestion: null }],
        },
        "b.ts": {
          status: "has-feedback",
          hash: "def",
          comments: [{ id: "c2", line: "2", text: "Change", suggestion: null }],
        },
        "c.ts": {
          status: "reviewed",
          hash: "ghi",
          comments: [],
        },
      },
      generalComments: [{ id: "g1", text: "General note" }],
    };
    const result = generateFeedback(state);
    assert.ok(result.includes("2 files need changes"));
    assert.ok(result.includes("3 comments total"));
    assert.ok(!result.includes("## c.ts"));
  });

  it("produces valid markdown structure", () => {
    const state: ReviewState = {
      round: 1,
      files: {
        "src/api.ts": {
          status: "has-feedback",
          hash: "abc",
          comments: [
            { id: "c1", line: "5", text: "Error handling", suggestion: null },
          ],
        },
      },
      generalComments: [{ id: "g1", text: "Run tests" }],
    };
    const result = generateFeedback(state);
    const lines = result.split("\n");
    assert.equal(lines[0], "# Code Review Feedback");
    assert.ok(lines.some((l) => l === "## src/api.ts"));
    assert.ok(lines.some((l) => l === "## General"));
  });
});
