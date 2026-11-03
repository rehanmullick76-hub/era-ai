export const AI_INPUT_LIMITS = {
  messageChars: 10_000,
  projectContextChars: 30_000,
  fileCount: 100,
  filePromptChars: 120_000,
  historyMessages: 100,
  historyChars: 30_000,
} as const;

export function isTextWithinLimit(value: string, limit: number): boolean {
  return value.length <= limit;
}

export function isFilePromptWithinLimits(
  files: readonly unknown[],
  fullPrompt: string,
): boolean {
  return files.length <= AI_INPUT_LIMITS.fileCount &&
    fullPrompt.length <= AI_INPUT_LIMITS.filePromptChars;
}

export function isHistoryWithinLimits(
  history: readonly { content: string }[],
): boolean {
  return history.length <= AI_INPUT_LIMITS.historyMessages &&
    history.reduce((total, message) => total + message.content.length, 0) <= AI_INPUT_LIMITS.historyChars;
}

export function isGenerationInputWithinLimits(
  prompt: string,
  history: readonly { content: string }[],
  files: readonly { content: string }[],
): boolean {
  return isTextWithinLimit(prompt, AI_INPUT_LIMITS.messageChars) &&
    isHistoryWithinLimits(history) &&
    files.length <= AI_INPUT_LIMITS.fileCount &&
    files.reduce((total, file) => total + file.content.length, 0) <= AI_INPUT_LIMITS.filePromptChars;
}
