import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePlanFiles } from "../src/lib/ai-plan-normalization.ts";

test("normalizes string file entries and preserves object entries", () => {
  assert.deepEqual(normalizePlanFiles([
    "public/index.html",
    { path: "server.mjs", description: "HTTP API", language: "javascript" },
  ]), [
    {
      path: "public/index.html",
      description: "Project file: public/index.html.",
      language: "html",
    },
    { path: "server.mjs", description: "HTTP API", language: "javascript" },
  ]);
});

test("fills omitted file metadata and drops invalid entries", () => {
  assert.deepEqual(normalizePlanFiles([
    { path: "migrations/001_init.sql" },
    null,
    { description: "No path" },
    "",
  ]), [{
    path: "migrations/001_init.sql",
    description: "Project file: migrations/001_init.sql.",
    language: "sql",
  }]);
});
