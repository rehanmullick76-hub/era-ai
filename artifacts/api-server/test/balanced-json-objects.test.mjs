import assert from "node:assert/strict";
import { test } from "node:test";
import { extractBalancedJsonObjects } from "../src/lib/balanced-json-objects.ts";

test("braces inside JSON strings do not break object boundary detection", () => {
  const first = JSON.stringify({
    path: "index.html",
    content: `<script>const braces = "{ }"; const escaped = "\\\"{";</script>`,
  });
  const second = JSON.stringify({
    path: "styles.css",
    content: `body::after { content: "}"; }`,
  });
  const truncated = `[${first},${second},{"path":"unfinished","content":"`;
  assert.deepEqual(extractBalancedJsonObjects(truncated), [first, second]);
});
