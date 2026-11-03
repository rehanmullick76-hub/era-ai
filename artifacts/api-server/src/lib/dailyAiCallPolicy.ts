export const DAILY_AI_CALL_CAP = 10;
export const DAILY_AI_CALL_LIMIT_MESSAGE = "Daily AI call limit reached. Try again tomorrow.";

export interface DailyAiCallState {
  callsUsed: number;
  resetAt: Date;
}

export interface DailyAiCallDecision extends DailyAiCallState {
  allowed: boolean;
}

function nextUtcMidnight(now: Date): Date {
  const resetAt = new Date(now);
  resetAt.setUTCHours(24, 0, 0, 0);
  return resetAt;
}

export function decideDailyAiCall(
  state: DailyAiCallState,
  now: Date,
): DailyAiCallDecision {
  if (state.resetAt.getTime() <= now.getTime()) {
    return {
      allowed: true,
      callsUsed: 1,
      resetAt: nextUtcMidnight(now),
    };
  }

  if (state.callsUsed >= DAILY_AI_CALL_CAP) {
    return { ...state, allowed: false };
  }

  return {
    ...state,
    allowed: true,
    callsUsed: state.callsUsed + 1,
  };
}

export function dailyAiCallLimitFailure(): { status: 429; error: string } {
  return { status: 429, error: DAILY_AI_CALL_LIMIT_MESSAGE };
}
