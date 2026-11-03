export function getMessageOnlyReply(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const response = value as { message?: unknown; files?: unknown };
  if (!Array.isArray(response.files) || response.files.length !== 0) return null;
  if (typeof response.message !== "string" || !response.message.trim()) return null;
  return response.message.trim();
}

export function getGeneratedJsonBlock(text: string): { hasJsonBlock: boolean; content: string } {
  const complete = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (complete) return { hasJsonBlock: true, content: complete[1] };

  const opening = /```json\b\s*/i.exec(text);
  if (!opening) return { hasJsonBlock: false, content: "" };
  return {
    hasJsonBlock: true,
    content: text.slice(opening.index + opening[0].length),
  };
}

export function extractAssistantProse(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").replace(/\s{3,}/g, "\n\n").trim();
}
