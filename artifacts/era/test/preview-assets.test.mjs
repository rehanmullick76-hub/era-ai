import assert from "node:assert/strict";
import { test } from "node:test";
import { inlinePreviewAssets } from "../src/lib/preview-assets.ts";

test("inlines relative and root-relative CSS paths from nested pages", () => {
  const html = '<link rel="stylesheet" href="../styles.css"><link href="/theme.css?v=2">';
  const result = inlinePreviewAssets(html, [
    { path: "styles.css", content: "body { color: navy; }" },
    { path: "theme.css", content: "h1 { color: teal; }" },
  ], "pages/signup.html");
  assert.match(result, /<style>\s*body \{ color: navy; \}\s*<\/style>/);
  assert.match(result, /<style>\s*h1 \{ color: teal; \}\s*<\/style>/);
});

test("inlines JavaScript with whitespace before the closing tag and escapes HTML delimiters", () => {
  const html = '<script defer src="/assets/app.js"></script   >';
  const result = inlinePreviewAssets(html, [
    { path: "assets/app.js", content: 'const text = "</script>"; window.ready = true;' },
  ], "pages/signup.html");
  assert.match(result, /<script>\s*const text = "<\\\/script>"; window\.ready = true;\s*<\/script>/);
});

test("preserves module script type when inlining local ES module assets", () => {
  const result = inlinePreviewAssets('<script type="module" src="/assets/app.js"></script>', [
    { path: "assets/app.js", content: 'import { ready } from "./ready.js"; window.ready = ready;' },
  ], "index.html");
  assert.match(result, /<script type="module">/);
  assert.match(result, /import \{ ready \} from "\.\/ready\.js"/);
});

test("leaves external references unchanged", () => {
  const html = '<link href="https://cdn.example.com/site.css"><script src="//cdn.example.com/app.js"></script>';
  assert.equal(inlinePreviewAssets(html, [], "index.html"), html);
});
