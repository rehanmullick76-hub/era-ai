import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_FILES,
  MAX_PROJECT_SOURCE_BYTES,
  getProjectFileViolation,
  isProjectFileUsageWithinLimits,
  projectFileUsageAfterUpsert,
} from "../src/lib/project-file-limits.ts";
import { safeWorkspacePath } from "../src/lib/workspace-policy.ts";

test("project file limits enforce 500 KB per file, 100 files, and 1 MB total", () => {
  assert.equal(MAX_PROJECT_FILE_BYTES, 500_000);
  assert.equal(MAX_PROJECT_FILES, 100);
  assert.equal(MAX_PROJECT_SOURCE_BYTES, 1_000_000);
});

test("generated project files must have safe paths and fit the UTF-8 byte limit", () => {
  assert.match(getProjectFileViolation({
    path: "../outside.js",
    content: "",
    action: "create",
  }, safeWorkspacePath), /safe relative project file path/);
  assert.equal(getProjectFileViolation({
    path: "index.html",
    content: "é".repeat(250_000),
    action: "create",
  }, safeWorkspacePath), null);
  assert.match(getProjectFileViolation({
    path: "index.html",
    content: "é".repeat(250_001),
    action: "delete",
  }, safeWorkspacePath), /500000-byte project file limit/);
});

test("file upserts account for replacements rather than double-counting", () => {
  const files = [{ path: "index.html", content: "é" }, { path: "app.js", content: "1234" }];
  assert.deepEqual(projectFileUsageAfterUpsert(files, "index.html", "12345"), {
    fileCount: 2,
    totalBytes: 9,
    fileBytes: 5,
  });
});

test("new file upserts increase count and UTF-8 byte totals", () => {
  assert.deepEqual(projectFileUsageAfterUpsert([], "note.txt", "é"), {
    fileCount: 1,
    totalBytes: 2,
    fileBytes: 2,
  });
});

test("project capacity accepts exactly 100 files and 1 MB but rejects overflow", () => {
  assert.equal(isProjectFileUsageWithinLimits({ fileCount: 100, totalBytes: 1_000_000 }), true);
  assert.equal(isProjectFileUsageWithinLimits({ fileCount: 101, totalBytes: 1_000_000 }), false);
  assert.equal(isProjectFileUsageWithinLimits({ fileCount: 100, totalBytes: 1_000_001 }), false);
});
