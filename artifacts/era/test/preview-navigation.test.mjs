import assert from "node:assert/strict";
import { test } from "node:test";
import { injectPreviewScript, normalizePreviewPath } from "../src/lib/preview-navigation.ts";
import { inlinePreviewAssets } from "../src/lib/preview-assets.ts";

test("preview navigation resolves prefixes, nested relative paths and query/hash suffixes", () => {
  for (const href of ["about.html", "./about.html", "/about.html", "about.html?x=1#team", "/about.html#team"]) {
    assert.equal(normalizePreviewPath(href), "about.html");
  }
  assert.equal(normalizePreviewPath("../about.html?q=2", "pages/contact.html"), "about.html");
  assert.equal(normalizePreviewPath("./team.html#name", "pages/contact.html"), "pages/team.html");
  assert.equal(normalizePreviewPath("/about%20us.html"), "about us.html");
});

test("preview leaves non-page anchors, external URLs and unsafe schemes alone", () => {
  for (const href of ["", "#section", "https://example.com/a.html", "//example.com/a.html",
    "mailto:hello@example.com", "javascript:alert(1)", "data:text/html,hello", "styles.css", "/%ZZ.html"]) {
    assert.equal(normalizePreviewPath(href), null);
  }
});

test("standalone navigation script injection preserves doctype and standards mode", () => {
  const source = '<!doctype html><html><head><title>Example</title></head><body><main>Hello</main></body></html>';
  const result = injectPreviewScript(source, "<script>window.navReady=true;</script>");
  assert.ok(result.startsWith("<!doctype html>"));
  assert.match(result, /<head><title>Example<\/title><script>window\.navReady=true;<\/script><\/head>/);
  const missingHead = injectPreviewScript("<!doctype html><html><main>Text</main></html>", "<script>ready()</script>");
  assert.ok(missingHead.startsWith("<!doctype html>"));
  assert.match(missingHead, /<html><head><script>ready\(\)<\/script><\/head>/);
  const missingHeadWithBody = injectPreviewScript("<!doctype html><html><body>Text</body></html>", "<script>ready()</script>");
  assert.match(missingHeadWithBody, /<body><script>ready\(\)<\/script>Text<\/body>/);
});

test("preview script injection handles uppercase HTML head and body tags", () => {
  const script = "<script>window.navReady=true;</script>";
  assert.match(
    injectPreviewScript("<HTML><HEAD><title>Example</title></HEAD><BODY>Text</BODY></HTML>", script),
    /<HEAD><title>Example<\/title><script>window\.navReady=true;<\/script><\/HEAD>/,
  );
  assert.match(
    injectPreviewScript("<HTML><BODY class=\"app\">Text</BODY></HTML>", script),
    /<BODY class="app"><script>window\.navReady=true;<\/script>Text<\/BODY>/,
  );
});

test("navigation interception is injected before inline project scripts", () => {
  const source = '<!doctype html><html><head></head><body><script src="./app.js"></script></body></html>';
  const withNavigation = injectPreviewScript(source, '<script>window.navInterceptor=true;</script>');
  const bundled = inlinePreviewAssets(withNavigation, [{
    path: "app.js",
    content: "window.projectScript=true;",
  }], "index.html");
  assert.ok(bundled.indexOf("window.navInterceptor=true") < bundled.indexOf("window.projectScript=true"));
});
