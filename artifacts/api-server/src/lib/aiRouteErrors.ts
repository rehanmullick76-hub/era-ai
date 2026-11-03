export class QuotaExhaustedError extends Error {
  constructor(message = "All Gemini models have exhausted their daily quota. Please try again tomorrow or add a paid API key.") {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

export type AiRouteFailure =
  | { status: 429; message: string }
  | { status: 503; message: string }
  | { status: 500; message: string };

export function getAiRouteFailure(error: unknown, fallback: string): AiRouteFailure {
  if (error instanceof Error && error.name === "GoogleSearchUnavailableError") {
    return { status: 503, message: error.message };
  }
  if (error instanceof Error && error.name === "GeminiDeadlineError") {
    return { status: 500, message: error.message };
  }
  if (error instanceof QuotaExhaustedError) {
    return { status: 429, message: error.message };
  }
  return { status: 500, message: fallback };
}
