export interface ChatHistoryMessage {
  type: string;
  content: string;
  hiddenContext?: string;
  testSummary?: string;
  testIssues?: readonly { severity: string }[];
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_OLDER_ATTACHMENT_CONTEXT_CHARS = 800;
const MAX_HISTORY_CHARS = 26_000;

function capMessageText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_MESSAGE_CHARS
    ? `${trimmed.slice(0, MAX_MESSAGE_CHARS - 3)}...`
    : trimmed;
}

export function buildHistorySnapshot(messages: readonly ChatHistoryMessage[]): ChatHistoryEntry[] {
  const recentContextIndexes = new Set<number>();
  for (let index = messages.length - 1; index >= 0 && recentContextIndexes.size < 2; index -= 1) {
    const message = messages[index];
    if (message?.type === "user" && message.hiddenContext?.trim()) {
      recentContextIndexes.add(index);
    }
  }

  const recentStartIndex = Math.max(0, messages.length - MAX_HISTORY_MESSAGES);
  const history = messages.slice(recentStartIndex).map((message, relativeIndex) => {
    const absoluteIndex = recentStartIndex + relativeIndex;
    const visibleText = message.type === "test"
      ? message.testSummary?.trim() ||
        (message.testIssues?.length
          ? `Quality analysis found ${message.testIssues.length} issue${message.testIssues.length === 1 ? "" : "s"}.`
          : "Quality analysis completed; no issues found.")
      : capMessageText(message.content);

    let hiddenContext = "";
    if (message.type === "user" && message.hiddenContext?.trim()) {
      const context = message.hiddenContext.trim();
      hiddenContext = recentContextIndexes.has(absoluteIndex)
        ? context
        : context.length > MAX_OLDER_ATTACHMENT_CONTEXT_CHARS
          ? `${context.slice(0, MAX_OLDER_ATTACHMENT_CONTEXT_CHARS)}…`
          : context;
    }

    return {
      role: (message.type === "user" ? "user" : "assistant") as "user" | "assistant",
      content: [visibleText, hiddenContext].filter(Boolean).join("\n\n"),
    };
  }).filter(entry => entry.content.length > 0);

  let excess = history.reduce((total, entry) => total + entry.content.length, 0) - MAX_HISTORY_CHARS;
  for (let index = 0; excess > 0 && index < history.length; index += 1) {
    const oldest = history[index];
    if (!oldest) continue;
    if (oldest.content.length <= excess) {
      excess -= oldest.content.length;
      oldest.content = "";
    } else {
      const keepLength = Math.max(0, oldest.content.length - excess - 1);
      oldest.content = keepLength > 0 ? `${oldest.content.slice(0, keepLength)}…` : "";
      excess = 0;
    }
  }

  return history.filter(entry => entry.content.length > 0);
}
