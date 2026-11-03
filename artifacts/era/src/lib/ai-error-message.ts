export function getApiErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function getApiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === "string") return message;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

export function getAiFailureMessage(error: unknown, fallback: string): string {
  switch (getApiErrorStatus(error)) {
    case 402: return "Out of credits, please add more.";
    case 429:
      if (/daily ai call limit reached/i.test(getApiErrorMessage(error) ?? "")) {
        return "Daily AI call limit reached. Try again tomorrow.";
      }
      return getApiErrorMessage(error) || "ERA is busy, try again shortly.";
    case 413: return "Project too large for one request, try a smaller change.";
    default: {
      // API and persisted-job failures contain a curated public error. Do not
      // replace it with a generic message, or users cannot tell quota, timeout
      // and source-validation failures apart. Raw network errors use fallback.
      const data = error && typeof error === "object"
        ? (error as { data?: unknown }).data : null;
      if (data && typeof data === "object" && "error" in data) {
        const message = (data as { error?: unknown }).error;
        if (typeof message === "string" && message.trim()) return message;
      }
      return fallback;
    }
  }
}
