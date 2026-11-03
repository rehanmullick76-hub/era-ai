import assert from "node:assert/strict";
import test from "node:test";
import { appendRecognizedText, isSpeechRecognitionAbort } from "../src/lib/speech-input.ts";

test("appends recognized speech to an existing prompt with a separating space", () => {
  assert.equal(appendRecognizedText("Build a shop", "with online payments"), "Build a shop with online payments");
});

test("preserves existing whitespace and ignores empty recognition results", () => {
  assert.equal(appendRecognizedText("Build a shop ", "with online payments"), "Build a shop with online payments");
  assert.equal(appendRecognizedText("Build a shop", "  "), "Build a shop");
});

test("recognition aborts are treated as intentional stops, not user-facing errors", () => {
  assert.equal(isSpeechRecognitionAbort("aborted"), true);
  assert.equal(isSpeechRecognitionAbort("no-speech"), false);
});
