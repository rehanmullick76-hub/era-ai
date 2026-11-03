import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_INPUT_LIMITS,
  isFilePromptWithinLimits,
  isGenerationInputWithinLimits,
  isHistoryWithinLimits,
  isTextWithinLimit,
} from "../src/lib/ai-input-policy.ts";

test("AI text and context limits include the exact allowed boundary", () => {
  assert.equal(isTextWithinLimit("x".repeat(AI_INPUT_LIMITS.messageChars), AI_INPUT_LIMITS.messageChars), true);
  assert.equal(isTextWithinLimit("x".repeat(AI_INPUT_LIMITS.messageChars + 1), AI_INPUT_LIMITS.messageChars), false);
  assert.equal(isTextWithinLimit("x".repeat(AI_INPUT_LIMITS.projectContextChars), AI_INPUT_LIMITS.projectContextChars), true);
});

test("file analysis limits cap count and complete prompt size", () => {
  assert.equal(isFilePromptWithinLimits(Array(100).fill(null), "x".repeat(120_000)), true);
  assert.equal(isFilePromptWithinLimits(Array(101).fill(null), ""), false);
  assert.equal(isFilePromptWithinLimits([], "x".repeat(120_001)), false);
});

test("chat history is bounded by message count and combined characters", () => {
  assert.equal(isHistoryWithinLimits([{ content: "x".repeat(30_000) }]), true);
  assert.equal(isHistoryWithinLimits([{ content: "x".repeat(30_001) }]), false);
  assert.equal(isHistoryWithinLimits(Array(101).fill({ content: "" })), false);
});

test("generation requests enforce prompt, history, file-count, and combined file-content limits", () => {
  assert.equal(isGenerationInputWithinLimits(
    "x".repeat(AI_INPUT_LIMITS.messageChars),
    [{ content: "x".repeat(AI_INPUT_LIMITS.historyChars) }],
    [{ content: "x".repeat(AI_INPUT_LIMITS.filePromptChars) }],
  ), true);

  assert.equal(isGenerationInputWithinLimits(
    "x".repeat(AI_INPUT_LIMITS.messageChars + 1), [], [],
  ), false);
  assert.equal(isGenerationInputWithinLimits(
    "", [{ content: "x".repeat(AI_INPUT_LIMITS.historyChars + 1) }], [],
  ), false);
  assert.equal(isGenerationInputWithinLimits(
    "", [], Array(AI_INPUT_LIMITS.fileCount + 1).fill({ content: "" }),
  ), false);
  assert.equal(isGenerationInputWithinLimits(
    "", [], [{ content: "x".repeat(AI_INPUT_LIMITS.filePromptChars + 1) }],
  ), false);
});
