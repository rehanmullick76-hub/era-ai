export interface PendingPromptTimer {
  schedule(callback: () => void, delayMs: number): number;
  cancel(timerId: number): void;
}

const browserTimer: PendingPromptTimer = {
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (timerId) => window.clearTimeout(timerId),
};

export function schedulePendingPromptSend(
  send: () => void,
  timer: PendingPromptTimer = browserTimer,
): () => void {
  let sent = false;
  const timerId = timer.schedule(() => {
    sent = true;
    send();
  }, 300);

  return () => {
    if (!sent) timer.cancel(timerId);
  };
}
