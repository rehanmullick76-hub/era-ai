export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export const INPUT_TOKENS_PER_CREDIT = 1_000;
export const OUTPUT_TOKENS_PER_CREDIT = 500;

export function creditsForTokenUsage(usage: TokenUsage): number {
  const inputTokens = Number.isSafeInteger(usage.inputTokens) && usage.inputTokens > 0
    ? usage.inputTokens
    : 0;
  const outputTokens = Number.isSafeInteger(usage.outputTokens) && usage.outputTokens > 0
    ? usage.outputTokens
    : 0;
  if (inputTokens + outputTokens === 0) return 0;
  return Math.max(1, Math.ceil(
    inputTokens / INPUT_TOKENS_PER_CREDIT +
    outputTokens / OUTPUT_TOKENS_PER_CREDIT,
  ));
}

export function creditAdjustmentForUsage(usage: TokenUsage, reservedCredits: number): number {
  const reserved = Number.isSafeInteger(reservedCredits) && reservedCredits >= 0 ? reservedCredits : 0;
  return creditsForTokenUsage(usage) - reserved;
}

export interface CreditUsageSettlement {
  additionalCharge: number;
  refund: number;
  creditsCharged: number;
  creditsRemaining: number;
}

/**
 * Charge the token-based amount when possible, but never discard completed
 * work just because the user's remaining balance is lower than the estimate.
 */
export function settleCreditUsage(
  usage: TokenUsage,
  reservedCredits: number,
  availableCredits: number,
): CreditUsageSettlement {
  const reserved = Number.isSafeInteger(reservedCredits) && reservedCredits >= 0
    ? reservedCredits
    : 0;
  const available = Number.isSafeInteger(availableCredits) && availableCredits >= 0
    ? availableCredits
    : 0;
  const tokenCharge = creditsForTokenUsage(usage);
  const additionalCharge = Math.min(Math.max(0, tokenCharge - reserved), available);
  const refund = Math.max(0, reserved - tokenCharge);
  const creditsCharged = tokenCharge <= reserved
    ? tokenCharge
    : reserved + additionalCharge;

  return {
    additionalCharge,
    refund,
    creditsCharged,
    creditsRemaining: available - additionalCharge + refund,
  };
}

export function readTokenUsage(metadata: unknown): TokenUsage {
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Gemini did not return token usage. Please retry the generation.");
  }
  const usage = metadata as Record<string, unknown>;
  const inputTokens = usage.promptTokenCount;
  const outputTokens = usage.candidatesTokenCount;
  if (
    !Number.isSafeInteger(inputTokens) || (inputTokens as number) < 0 ||
    !Number.isSafeInteger(outputTokens) || (outputTokens as number) < 0
  ) {
    throw new Error("Gemini returned invalid token usage. Please retry the generation.");
  }
  return { inputTokens: inputTokens as number, outputTokens: outputTokens as number };
}
