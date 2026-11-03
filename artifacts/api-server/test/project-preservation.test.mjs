import assert from "node:assert/strict";
import { test } from "node:test";
import { EDIT_PROJECT_SYSTEM, getProjectChangeViolation, isPageAddition } from "../src/lib/project-preservation.ts";
import { resolvePatches } from "../src/lib/patchSafety.ts";
import { getProjectFileViolation } from "../src/lib/project-file-limits.ts";
import { safeWorkspacePath } from "../src/lib/workspace-policy.ts";

const home = '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><nav><a href="index.html">Original Brand</a></nav><main><h1>Our original products</h1><p>Keep this content.</p></main></body></html>';
const originals = [
  { path: "index.html", content: home, language: "html" },
  { path: "styles.css", content: "body { background: white; color: navy; }", language: "css" },
  { path: "script.js", content: "window.originalFeature = true;", language: "javascript" },
];
const newPage = {
  path: "signup.html", content: '<html><a href="index.html">Home</a><form>Sign up</form></html>',
  language: "html", action: "create",
};
const check = files => getProjectChangeViolation("Add a sign up page", originals, files);

test("page addition intent covers English, Bangla, and transliterated requests", () => {
  for (const prompt of ["Add a sign up page", "Create a login page", "Akta signup page banao", "একটা নতুন পেজ তৈরি করো"]) {
    assert.equal(isPageAddition(prompt), true, prompt);
  }
  assert.equal(isPageAddition("Change the home page title"), false);
  assert.equal(isPageAddition("Add a signup form to the home page"), false);
  assert.equal(isPageAddition("Add a button on the page"), false);
  assert.equal(isPageAddition("Create a signup page with a form"), true);
  assert.equal(isPageAddition("Redesign the entire website and add a signup page"), false);
});

test("automatic QA fixes are not treated as a second page-addition request", () => {
  const prompt = "Add a signup page\n\nAdditionally, fix these issues found in the code:\n- [error] signup.html — missing label";
  assert.equal(isPageAddition(prompt), false);
  assert.equal(getProjectChangeViolation(prompt, originals, [{
    path: "signup.html",
    action: "update",
    language: "html",
    content: "<html><form><label>Email</label><input type=\"email\"></form></html>",
  }]), null);
});

test("existing projects use preservation instructions, not fresh palette/page-count defaults", () => {
  assert.match(EDIT_PROJECT_SYSTEM, /Do not invent a new palette/);
  assert.match(EDIT_PROJECT_SYSTEM, /Do not regenerate every page/);
  assert.match(EDIT_PROJECT_SYSTEM, /omitted from source context STILL EXIST/);
});

test("existing SQL migrations cannot be updated or deleted", () => {
  const migration = { path: "migrations/001_initial.sql", content: "CREATE TABLE IF NOT EXISTS products(id serial PRIMARY KEY);" };
  const source = [...originals, migration];
  assert.match(
    getProjectChangeViolation("Add some demo product", source, [{
      ...migration, action: "update", content: `${migration.content}\nINSERT INTO products DEFAULT VALUES;`,
    }]),
    /Existing SQL migration .* is immutable/,
  );
  assert.match(
    getProjectChangeViolation("Add some demo product", source, [{
      ...migration, action: "delete",
    }]),
    /Existing SQL migration .* is immutable/,
  );
  assert.equal(getProjectChangeViolation("Add some demo product", source, [{
    path: "migrations/002_products.sql",
    content: "CREATE TABLE IF NOT EXISTS product_tags(id serial PRIMARY KEY);",
    action: "create",
  }]), null);
});

test("a separate signup page and page-specific assets leave the old website intact", () => {
  assert.equal(check([newPage, {
    path: "signup.css", content: ".signup-form { display: grid; }", language: "css", action: "create",
  }]), null);
});

test("minimal navigation patches can link the old home to the new page", () => {
  const result = resolvePatches([newPage, {
    path: "index.html", action: "patch", edits: [{
      find: "</nav>", replace: '<a href="signup.html">Sign up</a></nav>',
    }],
  }], originals);
  assert.equal(result.failedPatches.length, 0);
  assert.equal(check(result.files), null);
  assert.match(result.files[1].content, /Our original products/);
});

test("new links in list items, relative paths and nested pages are supported", () => {
  assert.equal(check([newPage, {
    path: "index.html", action: "update", language: "html",
    content: home.replace("</nav>", '<li><a class="button" href="./signup.html">Sign up</a></li></nav>'),
  }]), null);
  const nested = [{ path: "pages/about.html", content: "<nav></nav><h1>About us</h1>", language: "html" }];
  assert.equal(getProjectChangeViolation("Add a signup page", nested, [newPage, {
    path: "pages/about.html", action: "update", language: "html",
    content: '<nav><a href="../signup.html">Join</a></nav><h1>About us</h1>',
  }]), null);
});

test("whole-home rewrites are rejected even when labeled update or resolved from a patch", () => {
  const rewrite = { path: "index.html", action: "update", language: "html", content: "<html>Only a signup form</html>" };
  assert.match(check([newPage, rewrite]), /preserve index.html/);
  const patched = resolvePatches([newPage, {
    path: "index.html", action: "patch", edits: [{ find: home, replace: rewrite.content }],
  }], originals);
  assert.match(check(patched.files), /preserve index.html/);
});

test("full-file patch fallbacks must pass exactly the same preservation guard", () => {
  assert.match(check([newPage, {
    path: "index.html", language: "html", action: "update",
    content: home.replace("Our original products", "Welcome to a completely new company"),
  }]), /preserve index.html/);
});

test("global CSS and JS cannot be redesigned while adding signup", () => {
  for (const original of originals.slice(1)) {
    assert.match(check([newPage, {
      ...original, action: "update", content: `${original.content}\n/* new global overrides */`,
    }]), /must preserve existing/);
  }
});

test("create actions must not overwrite existing files or path aliases", () => {
  assert.match(check([{ ...newPage, path: "index.html" }]), /already exists/);
  assert.match(check([{ ...newPage, path: "./index.html" }]), /already exists/);
  assert.match(check([newPage, { ...newPage, path: "./signup.html" }]), /Duplicate/);
  assert.match(check([{ ...newPage, path: "../index.html" }]), /relative project path/);
});

test("deleting old pages or silently replacing a page instead of adding one is rejected", () => {
  assert.match(check([newPage, { path: "index.html", action: "delete", content: "", language: "html" }]), /must not delete/);
  assert.match(check([{ ...originals[0], action: "update" }]), /separate new HTML page/);
});

test("existing navigation cannot be replaced, and links cannot carry global side effects", () => {
  assert.match(check([newPage, {
    path: "index.html", action: "update", language: "html",
    content: home.replace('<a href="index.html">Original Brand</a>', '<a href="signup.html">Join</a>'),
  }]), /preserve index.html/);
  for (const link of [
    '<a href="signup.html" onclick="document.body.innerHTML=\'Signup\'">Join</a>',
    '<a href="signup.html"><style>body { display: none; }</style>Join</a>',
    '<a href="signup.html"><img src=x onerror="document.body.innerHTML=\'Signup\'">Join</a>',
    '<a href="signup.html"><form><input name="x"></form>Join</a>',
    '<a href="signup.html"><svg onload="alert(1)"></svg>Join</a>',
    '<a href="signup.html"><button type="submit">Join</button></a>',
    '<a href="signup.html"><span onmouseover="alert(1)">Join</span></a>',
  ]) {
    assert.match(check([newPage, {
      path: "index.html", action: "update", language: "html", content: home.replace("</nav>", `${link}</nav>`),
    }]), /preserve index.html/);
  }
});

test("initial generation and explicit non-additive edits still work", () => {
  assert.equal(getProjectChangeViolation("Build a website", [], [{ ...newPage, path: "index.html" }]), null);
  assert.equal(getProjectChangeViolation("Change the home title", originals, [{
    ...originals[0], action: "update", content: home.replace("Our original products", "Requested title"),
  }]), null);
  assert.equal(getProjectChangeViolation("Redesign the entire website and add a signup page", originals, [
    newPage, { ...originals[0], action: "update", content: "<html>Requested redesign</html>" },
  ]), null);
});

test("frontend generated outputs reject unsafe paths and files over the byte limit", () => {
  const validate = generated => getProjectChangeViolation(
    "Build a website",
    [],
    generated,
    file => getProjectFileViolation(file, safeWorkspacePath),
  );
  assert.match(validate([{
    path: ".env",
    content: "not allowed",
    language: "plaintext",
    action: "create",
  }]), /safe relative project file path/);
  assert.equal(validate([{
    path: "index.html",
    content: "é".repeat(250_000),
    language: "html",
    action: "create",
  }]), null);
  assert.match(validate([{
    path: "index.html",
    content: "é".repeat(250_001),
    language: "html",
    action: "create",
  }]), /500000-byte project file limit/);
});
