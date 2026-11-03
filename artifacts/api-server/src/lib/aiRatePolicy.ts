/** Polling an existing job is not a model call; do not exhaust generation limits. */
export function isAiJobRead(method: string, path: string): boolean {
  return method === "GET" && (path === "/jobs" || path.startsWith("/jobs/"));
}
