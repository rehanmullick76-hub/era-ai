import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPatchFallbackPlan,
  normalizeGeneratedFilePath,
  normalizePatchFile,
  resolvePatches,
  selectPatchFallbackUpdates,
} from "../src/lib/patchSafety.ts";

function patch(path, edits) {
  return { path, action: "patch", edits };
}

test("generated paths normalize repeated ./ and leading / prefixes", () => {
  assert.equal(normalizeGeneratedFilePath("  ././index.html  "), "index.html");
  assert.equal(normalizeGeneratedFilePath("/styles.css"), "styles.css");
  assert.equal(normalizeGeneratedFilePath("./"), "");

  const normalizedPatch = normalizePatchFile({
    path: "./src/app.js",
    action: "patch",
    edits: [{ find: "old", replace: "new" }],
  });
  assert.equal(normalizedPatch.path, "src/app.js");
  assert.equal(normalizePatchFile({
    path: "/",
    action: "patch",
    edits: [{ find: "old", replace: "new" }],
  }), null);
});

test("a patch applies only when its exact find text occurs once", () => {
  const result = resolvePatches(
    [patch("src/app.js", [{ find: "const title = 'Old';", replace: "const title = 'New';" }])],
    [{ path: "src/app.js", content: "const title = 'Old';\n", language: "javascript" }],
  );

  assert.deepEqual(result, {
    files: [{
      path: "src/app.js",
      content: "const title = 'New';\n",
      language: "javascript",
      action: "update",
    }],
    failedPatches: [],
  });
});

test("a duplicated exact match is rejected instead of guessing", () => {
  const generated = patch("src/app.js", [{ find: "return value;", replace: "return next;" }]);
  const result = resolvePatches(
    [generated],
    [{ path: "src/app.js", content: "return value;\nreturn value;\n", language: "javascript" }],
  );

  assert.deepEqual(result.files, []);
  assert.deepEqual(result.failedPatches, [generated]);
});

test("whitespace-normalized matching is used only when it identifies one location", () => {
  const safe = resolvePatches(
    [patch("src/app.js", [{ find: "const name = 'ERA';", replace: "const name = 'New ERA';" }])],
    [{
      path: "src/app.js",
      content: "const   name =  'ERA';\n",
      language: "javascript",
    }],
  );
  assert.equal(safe.files[0]?.content, "const name = 'New ERA';\n");
  assert.deepEqual(safe.failedPatches, []);
});

test("ambiguous whitespace-normalized matches are rejected", () => {
  const generated = patch("src/app.js", [{ find: "a b", replace: "a c" }]);
  const result = resolvePatches(
    [generated],
    [{ path: "src/app.js", content: "a  b\nx\na   b\n", language: "javascript" }],
  );

  assert.deepEqual(result.files, []);
  assert.deepEqual(result.failedPatches, [generated]);
});

test("if any edit in a file fails, none of that patch's earlier edits are returned", () => {
  const original = "const first = 1;\nconst second = 2;\n";
  const generated = patch("src/app.js", [
    { find: "const first = 1;", replace: "const first = 10;" },
    { find: "const missing = 3;", replace: "const missing = 30;" },
  ]);
  const result = resolvePatches(
    [generated],
    [{ path: "src/app.js", content: original, language: "javascript" }],
  );

  assert.deepEqual(result.files, []);
  assert.deepEqual(result.failedPatches, [generated]);
  assert.equal(original, "const first = 1;\nconst second = 2;\n");
});

test("patches use the full stored file, including content beyond the prompt truncation range", () => {
  const tail = "const keepThisTail = 'full-source';";
  const original = `${"x".repeat(35_000)}\n${tail}\n`;
  const result = resolvePatches(
    [patch("src/large.js", [{ find: tail, replace: "const keepThisTail = 'patched';" }])],
    [{ path: "src/large.js", content: original, language: "javascript" }],
  );

  assert.equal(result.files.length, 1);
  assert.ok(result.files[0].content.startsWith("x".repeat(35_000)));
  assert.ok(result.files[0].content.includes("const keepThisTail = 'patched';"));
  assert.deepEqual(result.failedPatches, []);
});

test("a patch cannot target a file absent from the supplied project files", () => {
  const generated = patch("../outside.js", [{ find: "secret", replace: "changed" }]);
  const result = resolvePatches(
    [generated],
    [{ path: "src/app.js", content: "secret", language: "javascript" }],
  );

  assert.deepEqual(result.files, []);
  assert.deepEqual(result.failedPatches, [generated]);
});

test("malformed patch edits fail safely and are queued for a full-file fallback", () => {
  const malformed = normalizePatchFile({
    path: "src/app.js",
    action: "patch",
    edits: [
      { find: "const x = 1;", replace: "const x = 2;" },
      { find: "", replace: "ignored malformed edit" },
    ],
  });
  assert.equal(malformed.invalidPatch, true);
  assert.deepEqual(malformed.edits, []);

  const result = resolvePatches(
    [malformed],
    [{ path: "src/app.js", content: "const x = 1;", language: "javascript" }],
  );
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.failedPatches, [malformed]);

  const missingEdits = normalizePatchFile({
    path: "src/app.js",
    action: "patch",
    edits: [{ find: "const x = 1;" }],
  });
  assert.equal(missingEdits.invalidPatch, true);
  assert.deepEqual(missingEdits.edits, []);
});

test("duplicate patch entries for one path are rejected rather than returning conflicting updates", () => {
  const first = patch("src/app.js", [{ find: "one", replace: "ONE" }]);
  const second = patch("src/app.js", [{ find: "two", replace: "TWO" }]);
  const result = resolvePatches(
    [first, second],
    [{ path: "src/app.js", content: "one two", language: "javascript" }],
  );

  assert.deepEqual(result.files, []);
  assert.deepEqual(result.failedPatches, [first, second]);
});

test("a patch colliding with a full-file output for the same path is not emitted twice", () => {
  const generatedPatch = patch("src/app.js", [{ find: "one", replace: "ONE" }]);
  const generatedUpdate = {
    path: "src/app.js",
    action: "update",
    content: "separate full-file response",
    language: "javascript",
  };
  const result = resolvePatches(
    [generatedPatch, generatedUpdate],
    [{ path: "src/app.js", content: "one two", language: "javascript" }],
  );

  assert.deepEqual(result.files, []);
  assert.deepEqual(result.failedPatches, [generatedPatch]);
});

test("fallback context is limited to failed patch paths and uses their full original contents", () => {
  const originals = [
    { path: "src/a.js", content: `${"a".repeat(31_000)}\nTAIL_A`, language: "javascript" },
    { path: "src/untouched.js", content: "do not include", language: "javascript" },
  ];
  const plan = buildPatchFallbackPlan([
    patch("src/a.js", [{ find: "no match", replace: "x" }]),
    patch("src/missing.js", [{ find: "x", replace: "y" }]),
    patch("src/a.js", [{ find: "duplicate failure", replace: "x" }]),
  ], originals);

  assert.deepEqual(plan.paths, ["src/a.js", "src/missing.js"]);
  assert.ok(plan.filesContext.includes("TAIL_A"));
  assert.ok(plan.filesContext.includes("(No existing file content; create a complete file.)"));
  assert.ok(!plan.filesContext.includes("src/untouched.js"));
  assert.ok(!plan.filesContext.includes("do not include"));
});

test("fallback accepts only one complete update per failed path", () => {
  const updates = selectPatchFallbackUpdates([
    { path: "src/a.js", action: "update", content: "first", language: "javascript" },
    { path: "src/a.js", action: "update", content: "ambiguous", language: "javascript" },
    { path: "src/b.js", action: "update", content: "unrequested", language: "javascript" },
    { path: "src/c.js", action: "patch", edits: [{ find: "x", replace: "y" }] },
    { path: "src/d.js", action: "update", content: "missing language" },
  ], ["src/a.js", "src/c.js", "src/d.js"]);

  assert.equal(updates.has("src/a.js"), false);
  assert.equal(updates.has("src/b.js"), false);
  assert.equal(updates.has("src/c.js"), false);
  assert.equal(updates.has("src/d.js"), false);

  const complete = selectPatchFallbackUpdates([
    { path: "src/c.js", action: "update", content: "complete source", language: "javascript" },
  ], ["src/c.js"]);
  assert.equal(complete.get("src/c.js")?.content, "complete source");
});

test("fallback creates missing files but cannot create over existing files", () => {
  const plan = buildPatchFallbackPlan([
    patch("exists.js", [{ find: "missing", replace: "x" }]),
    patch("new.js", [{ find: "missing", replace: "x" }]),
  ], [{ path: "exists.js", content: "original", language: "javascript" }]);
  const candidates = [
    { path: "exists.js", action: "create", content: "unsafe", language: "javascript" },
    { path: "new.js", action: "create", content: "new source", language: "javascript" },
  ];
  const selected = selectPatchFallbackUpdates(candidates, plan.paths, plan.expectedActions);
  assert.equal(selected.has("exists.js"), false);
  assert.equal(selected.get("new.js")?.action, "create");
});
