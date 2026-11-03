import assert from "node:assert/strict";
import { test } from "node:test";
import { extractAssistantProse, getGeneratedJsonBlock, getMessageOnlyReply } from "../src/lib/generateMessage.ts";

test("a concise message with an empty files array is a valid generation reply", () => {
  assert.equal(
    getMessageOnlyReply({ message: "  Hi! What would you like to build?  ", files: [] }),
    "Hi! What would you like to build?",
  );
});

test("message-only parsing rejects non-empty files and malformed objects", () => {
  assert.equal(getMessageOnlyReply({ message: "Hello", files: [{ path: "index.html" }] }), null);
  assert.equal(getMessageOnlyReply({ message: "Hello" }), null);
  assert.equal(getMessageOnlyReply({ message: "  ", files: [] }), null);
  assert.equal(getMessageOnlyReply(["Hello"]), null);
});

test("an opening JSON fence without a closing fence is still detected", () => {
  const result = getGeneratedJsonBlock('Result:\n```json\n[{"path":"index.html","content":"<main>');
  assert.equal(result.hasJsonBlock, true);
  assert.equal(result.content, '[{"path":"index.html","content":"<main>');
});

test("assistant prose can be retained when a later fallback contains only JSON", () => {
  const original = extractAssistantProse('I added the requested page.\n\n```json\n[{"path":"new.html"}]\n```');
  const fallback = extractAssistantProse('```json\n[{"path":"index.html"}]\n```');
  assert.equal(original, "I added the requested page.");
  assert.equal(fallback || original, "I added the requested page.");
});
