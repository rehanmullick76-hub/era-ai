export interface WorkspaceLogHelp {
  title: string;
  explanation: string;
  nextStep: string;
}

export function buildWorkspaceFixPrompt(logs: string, help: WorkspaceLogHelp | null): string {
  const recentLogs = logs
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-12)
    .join("\n")
    .replace(/((?:API[_ -]?KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|CONNECTION_STRING)\s*[:=]\s*)["']?[^\s,"']+/gi, "$1[redacted]")
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|rzp_(?:test|live)_[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{20,})\b/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/(?:postgres(?:ql)?|mysql|redis):\/\/[^\s"'<>]+/gi, "[redacted database connection]")
    .slice(-3000);

  return [
    "Fix the full-stack workspace error below. Inspect the existing project source and make the smallest safe fix. Preserve unrelated files and all database data; do not edit or delete existing database migrations.",
    help ? `ERA's log summary: ${help.title} ${help.explanation}` : "",
    recentLogs ? `Recent runtime logs (secrets redacted):\n${recentLogs}` : "",
  ].filter(Boolean).join("\n\n");
}

export function explainWorkspaceLogs(logs: string): WorkspaceLogHelp | null {
  const lines = logs.split(/\r?\n/);
  const errorPattern = /(?:\bERROR\b|\bError:|\bfailed\b|\bexception\b|EADDRINUSE|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|ERR_[A-Z_]+|SyntaxError|TypeError|FATAL|timeout|Cannot find (?:module|package)|Module not found)/i;
  let errorIndex = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (errorPattern.test(lines[index])) {
      errorIndex = index;
      break;
    }
  }
  if (errorIndex < 0) return null;

  const successPattern = /\b(?:ready|listening|server started|build complete|workspace running)\b/i;
  for (let index = lines.length - 1; index > errorIndex; index--) {
    if (successPattern.test(lines[index])) return null;
  }

  const errorContext = lines.slice(errorIndex, Math.min(lines.length, errorIndex + 12)).join(" ");
  if (/EADDRINUSE|address already in use|port.{0,30}in use/i.test(errorContext)) {
    return {
      title: "The app could not start because a port is already in use.",
      explanation: "Usually, two server processes are trying to use the same connection port.",
      nextStep: "Ask ERA to fix the “port already in use” error, then rebuild the workspace.",
    };
  }
  if (/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|Module not found|Cannot resolve/i.test(errorContext)) {
    return {
      title: "The app needs a package that is missing.",
      explanation: "A required library may not be listed or installed correctly.",
      nextStep: "Ask ERA to fix the missing package shown in the logs, then rebuild the workspace.",
    };
  }
  if (/database|neon|postgres|ECONNREFUSED|ENOTFOUND|authentication failed/i.test(errorContext)) {
    return {
      title: "The app could not connect to its database.",
      explanation: "The database may be unavailable, or the app's connection setup may need a fix.",
      nextStep: "Check the database status, then ask ERA to fix the database connection error. Don't paste passwords or keys into chat.",
    };
  }
  if (/SyntaxError|Unexpected token|parse error|failed to compile|TypeError/i.test(errorContext)) {
    return {
      title: "The app stopped because of a code error.",
      explanation: "A file may contain a typo or an invalid instruction, so the server could not finish starting.",
      nextStep: "Ask ERA to fix the first code error in the logs, then rebuild the workspace.",
    };
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(errorContext)) {
    return {
      title: "The app took too long to respond.",
      explanation: "A server or database operation may be stuck or temporarily unavailable.",
      nextStep: "Try restarting the workspace. If the error returns, ask ERA to investigate the latest log error.",
    };
  }
  return {
    title: "The workspace reported an error.",
    explanation: "The exact cause isn't recognized yet. The technical details are still available in the logs below.",
    nextStep: "Copy the latest error into Chat or Build and ask ERA to explain it and suggest a fix.",
  };
}
