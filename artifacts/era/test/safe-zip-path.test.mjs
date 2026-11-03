import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSafeZipPath } from "../src/lib/safe-zip-path.ts";

test("accepts safe relative paths and rejects traversal or absolute paths", () => {
  assert.equal(normalizeSafeZipPath("public/index.html"), "public/index.html");
  for (const path of ["../secret.txt", "public/../../secret.txt", "/etc/passwd", "C:/secret.txt", "a\\b", "a\u0000b"]) {
    assert.equal(normalizeSafeZipPath(path), null, path);
  }
});

test("rejects hidden runtime state and unsafe environment files", () => {
  for (const path of ["node_modules/pkg/index.js", ".git/config", ".env", "config/.env.production"]) {
    assert.equal(normalizeSafeZipPath(path), null, path);
  }
  assert.equal(normalizeSafeZipPath(".env.example"), ".env.example");
});
