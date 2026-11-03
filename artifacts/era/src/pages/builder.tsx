import React, { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import { useParams, useLocation } from "wouter";
import { useEraAuth } from "@/context/auth-context";
import {
  useGetProject,
  useListFiles,
  useUpsertFile,
  useDeleteFile,
  useAiGenerate,
  useAiTest,
  useAiChat,
  useAiPlan,
  useAiSecurity,
  useAiReadAttachments,
  getAiJob,
  getGetProjectQueryKey,
  getListFilesQueryKey,
  type PlanResult,
  type ProjectFile,
  type SecurityResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useApp,
  PENDING_PROMPT_KEY,
  PENDING_PROMPT_CONTEXT_KEY,
  PENDING_PROMPT_ATTACHMENTS_KEY,
  PENDING_PROMPT_PROJECT_KEY,
  PENDING_VIEW_KEY,
} from "@/context/app-context";
import { useToast } from "@/hooks/use-toast";
import { useTypingEffect } from "@/hooks/use-typing-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FileTree } from "@/components/editor/file-tree";
import { CodeEditor } from "@/components/editor/code-editor";
import { PreviewPanel } from "@/components/panels/preview-panel";
import { WorkspacePanel } from "@/components/panels/workspace-panel";
import { VoiceInputButton } from "@/components/voice-input-button";
import {
  PromptAttachmentBadges,
  PromptAttachmentButton,
  PromptAttachmentFiles,
} from "@/components/prompt-attachment-picker";
import { collectExportFiles } from "@/lib/fullstack-export";
import { getAiFailureMessage, getApiErrorStatus } from "@/lib/ai-error-message";
import { normalizeSafeZipPath } from "@/lib/safe-zip-path";
import { schedulePendingPromptSend } from "@/lib/pending-prompt-handoff";
import { appendRecognizedText } from "@/lib/speech-input";
import {
  clearPromptAttachmentStorage,
  usePersistedPromptAttachments,
} from "@/hooks/use-persisted-prompt-attachments";
import {
  assertAttachmentReadRequestFits,
  composePromptWithAttachments,
  preparePromptAttachmentContext,
  promptAttachmentFingerprint,
  shouldAnswerQuestionAboutAttachments,
} from "@/lib/prompt-attachments";
import { buildHistorySnapshot } from "@/lib/chat-history";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Send, Loader2, Code2, Eye, Rocket, ChevronDown, FileCode,
  X, Home, AlertTriangle, Info, CheckCircle2, Palette, Cpu,
  Sparkles, Menu, Zap, FolderOpen, Download, MessageCircle,
  ShieldCheck, ListChecks,
  Copy, RotateCcw,
} from "lucide-react";
import { format } from "date-fns";

type ViewMode = "chat" | "code" | "preview" | "plan" | "security" | "deploy";
type MsgType = "user" | "code" | "test" | "design" | "info";

interface TestIssue {
  file: string; line?: number | null;
  severity: "error" | "warning" | "info";
  message: string; suggestion: string;
}
interface ChatMsg {
  id: string; type: MsgType; content: string;
  hiddenContext?: string;
  attachmentNames?: string[];
  createdFiles?: { path: string; action: string }[];
  sources?: { title: string; url: string }[];
  searchStatus?: "not_used" | "used" | "unavailable";
  testIssues?: TestIssue[]; testSummary?: string;
  designSuggestions?: string; colorPalette?: string[]; typography?: string;
  retryPrompt?: string; retryMode?: "build" | "ask";
  retryAttachmentContext?: string; retryAttachmentNames?: string[];
  timestamp: Date;
}

function uid() { return Math.random().toString(36).slice(2); }

const GENERATION_JOB_POLL_MS = 5000;
type AiGeneratedResult = NonNullable<Awaited<ReturnType<typeof getAiJob>>["result"]>;
type PollError = Error & { status?: number; data?: unknown; jobTerminal?: boolean };

function generationInfoText(result: AiGeneratedResult, note?: string): string {
  const message = typeof result.message === "string" && result.message.trim()
    ? result.message.trim()
    : result.files.length > 0
      ? "Your project files are ready."
      : "What would you like to build?";
  const usage = `Usage: ${(result.inputTokens ?? 0).toLocaleString()} input tokens, ${(result.outputTokens ?? 0).toLocaleString()} output tokens · ${result.creditsCharged ?? 1} credits`;
  return [message, note, usage].filter(Boolean).join("\n\n");
}

function generatedFilesForMessage(result: AiGeneratedResult) {
  return result.files.map(file => ({ path: file.path, action: file.action }));
}

function GoogleSearchSources({
  sources,
  status,
}: {
  sources?: { title: string; url: string }[];
  status?: "not_used" | "used" | "unavailable";
}) {
  const safeSources = (sources ?? []).flatMap(source => {
    try {
      const url = new URL(source.url);
      return url.protocol === "https:"
        ? [{ title: source.title || url.hostname, url: url.href }]
        : [];
    } catch {
      return [];
    }
  });
  if (status === "unavailable" || (status === "used" && safeSources.length === 0)) {
    return (
      <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
        Live web search was requested but no sources could be verified. Current details may be incomplete.
      </p>
    );
  }
  if (status !== "used" || safeSources.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Web sources</p>
      <ul className="space-y-1.5">
        {safeSources.map((source, index) => (
          <li key={`${source.url}-${index}`} className="min-w-0">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-xs text-green-300 underline decoration-green-300/40 underline-offset-2 hover:text-green-200"
            >
              {source.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function waitForPollInterval(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForAiGenerationJob(
  jobId: string,
  expectedProjectId: string,
  signal?: AbortSignal,
  onProgress?: (progress: { stage: "queued" | "design" | "code" | "repair" | "fallback"; model: string | null }) => void,
): Promise<{ result: AiGeneratedResult; creditsRemaining: number }> {
  while (true) {
    let job;
    try {
      job = await getAiJob(jobId, { signal });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      const status = getApiErrorStatus(cause);
      if (status === 404) {
        const error = Object.assign(
          new Error("This generation job could not be found."),
          { status, jobTerminal: status === 404 } satisfies Partial<PollError>,
        );
        throw error;
      }
      await waitForPollInterval(GENERATION_JOB_POLL_MS, signal);
      continue;
    }

    if (job.projectId !== expectedProjectId) {
      throw Object.assign(new Error("This generation belongs to a different project."), {
        status: 404,
        jobTerminal: true,
      } satisfies Partial<PollError>);
    }
    onProgress?.({ stage: job.stage, model: job.model });
    if (job.status === "succeeded") {
      if (job.result) return { result: job.result, creditsRemaining: job.creditsRemaining };
      throw Object.assign(new Error("The generation job completed without a result."), {
        status: 500,
        jobTerminal: true,
      } satisfies Partial<PollError>);
    }
    if (job.status === "failed") {
      const message = job.error || "Failed to generate code. Please try again.";
      throw Object.assign(new Error(message), {
        status: job.errorStatus ?? 500,
        data: { error: message },
        jobTerminal: true,
      } satisfies Partial<PollError>);
    }
    await waitForPollInterval(GENERATION_JOB_POLL_MS, signal);
  }
}

function selectRelevantAskFiles(prompt: string, files: ProjectFile[]): ProjectFile[] {
  if (files.length === 0) return [];
  const ignoredTerms = new Set([
    "about", "after", "before", "could", "does", "from", "have", "help", "into",
    "make", "please", "project", "should", "that", "their", "there", "this", "what",
    "when", "where", "which", "with", "would",
  ]);
  const terms = [...new Set(prompt.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [])]
    .filter(term => !ignoredTerms.has(term));
  const ranked = files.map((file, index) => {
    const path = file.path.toLowerCase();
    const content = file.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (path.includes(term)) score += 6;
      if (content.includes(term)) score += 1;
    }
    if (/^index\.html?$/.test(path)) score += 2;
    return { file, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const matching = ranked.filter(item => item.score > 0).slice(0, 3);
  return (matching.length > 0 ? matching : ranked.slice(0, 3)).map(item => item.file);
}

function buildAskProjectContext(prompt: string, files: ProjectFile[]): string | null {
  const selected = selectRelevantAskFiles(prompt, files);
  if (selected.length === 0) return null;
  return selected.map(file => {
    const content = file.content.length > 8000
      ? `${file.content.slice(0, 8000)}\n[File content truncated for context.]`
      : file.content;
    return `=== ${file.path} ===\n${content}`;
  }).join("\n\n");
}

/* ── ERA avatar ─────────────────────────────────────── */
function EraAvatar({ icon, color = "green" }: { icon?: React.ReactNode; color?: string }) {
  return (
    <div className={cn(
      "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
      color === "green" ? "bg-green-600/20 border border-green-600/30" :
      color === "blue" ? "bg-blue-600/20 border border-blue-600/30" :
      color === "purple" ? "bg-purple-600/20 border border-purple-600/30" :
      color === "red" ? "bg-red-600/20 border border-red-600/30" :
      "bg-muted border border-border"
    )}>
      {icon ?? <span className="text-green-400 text-xs font-bold">E</span>}
    </div>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+?\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.9em] text-green-200">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function MarkdownCodeBlock({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-black/30">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{language || "code"}</span>
        <button onClick={() => void handleCopy()} className="flex items-center gap-1 hover:text-foreground" aria-label="Copy code">
          <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed text-foreground/90">
        <code className="font-mono">{content}</code>
      </pre>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const fence = line.trimStart().match(/^```(.*)$/);
    if (fence) {
      const language = fence[1].trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        code.push(lines[index++]);
      }
      if (index < lines.length) index++;
      nodes.push(<MarkdownCodeBlock key={`code-${index}`} language={language} content={code.join("\n")} />);
      continue;
    }

    const listMatch = line.match(/^\s*(?:[-*]\s+|\d+\.\s+)/);
    if (listMatch) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*(?:[-*]\s+|\d+\.\s+)/);
        if (!match || /^\s*\d+\.\s+/.test(lines[index]) !== ordered) break;
        items.push(lines[index].slice(match[0].length));
        index++;
      }
      const List = ordered ? "ol" : "ul";
      nodes.push(
        <List key={`list-${index}`} className={cn("my-2 space-y-1 pl-5 text-sm leading-relaxed", ordered ? "list-decimal" : "list-disc")}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}
        </List>,
      );
      continue;
    }

    if (!line.trim()) {
      index++;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trimStart().startsWith("```") &&
      !/^\s*(?:[-*]\s+|\d+\.\s+)/.test(lines[index])
    ) {
      paragraph.push(lines[index++]);
    }
    nodes.push(
      <p key={`paragraph-${index}`} className="my-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {paragraph.map((part, partIndex) => (
          <React.Fragment key={partIndex}>
            {partIndex > 0 && <br />}
            {renderInlineMarkdown(part)}
          </React.Fragment>
        ))}
      </p>,
    );
  }

  return <div className="min-w-0 break-words">{nodes}</div>;
}

function InfoMessage({
  msg,
  isLatest,
  onRetry,
}: {
  msg: ChatMsg;
  isLatest: boolean;
  onRetry?: () => void;
}) {
  const { displayed, isDone } = useTypingEffect(isLatest ? msg.content : "", 8);
  const content = isLatest ? displayed : msg.content;
  return (
    <div className="mb-5 flex gap-3">
      <EraAvatar />
      <div className="min-w-0 flex-1">
        <MarkdownContent content={content} />
        {isLatest && !isDone && <span className="inline-block h-3.5 w-0.5 animate-pulse bg-green-400 align-middle" />}
        <GoogleSearchSources sources={msg.sources} status={msg.searchStatus} />
        {msg.retryPrompt && isDone && onRetry && (
          <button type="button" onClick={onRetry} className="mt-2 flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-secondary">
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground">{format(msg.timestamp, "h:mm a")}</p>
      </div>
    </div>
  );
}

/* ── Streaming code message ─────────────────────────── */
function CodeMessage({ msg, isLatest }: { msg: ChatMsg; isLatest: boolean }) {
  // Strip all code blocks — show only the prose summary
  const clean = msg.content.replace(/```[\s\S]*?```/g, "").trim();
  const { displayed, isDone } = useTypingEffect(isLatest ? clean : "", 8);
  const text = isLatest ? displayed : clean;

  return (
    <div className="flex gap-3 mb-5">
      <EraAvatar />
      <div className="flex-1 min-w-0">
        {text ? (
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
            {text}
            {isLatest && !isDone && (
              <span className="inline-block w-0.5 h-4 bg-green-400 ml-0.5 animate-pulse align-middle" />
            )}
          </p>
        ) : (isLatest && !isDone) ? (
          <span className="inline-block w-0.5 h-4 bg-green-400 animate-pulse" />
        ) : null}

        <GoogleSearchSources sources={msg.sources} status={msg.searchStatus} />
        {(isDone || !isLatest) && msg.createdFiles && msg.createdFiles.length > 0 && (
          <div className="mt-3 space-y-0.5 bg-white/5 rounded-lg p-2.5 border border-white/10">
            {msg.createdFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono">
                <FileCode className="w-3.5 h-3.5 text-green-400 shrink-0" />
                <span className={cn("flex-1 truncate",
                  f.action === "create" ? "text-green-400" :
                  f.action === "delete" ? "text-red-400" : "text-yellow-400"
                )}>
                  {f.action === "create" ? "Created" : f.action === "update" ? "Updated" : "Deleted"} {f.path}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-2">{format(msg.timestamp, "h:mm a")}</p>
      </div>
    </div>
  );
}

/* ── Test card ───────────────────────────────────────── */
function TestCard({ msg }: { msg: ChatMsg }) {
  const issues = msg.testIssues ?? [];
  const summary = msg.testSummary?.trim();
  return (
    <div className="mb-5 flex gap-3">
      <EraAvatar />
      <div className="min-w-0 flex-1">
        {issues.length === 0 ? (
          <p className="text-sm leading-relaxed text-foreground/90">
            {summary || "No issues found — code looks great!"}
          </p>
        ) : (
          <>
            {summary && <p className="mb-2 text-sm leading-relaxed text-foreground/90">{summary}</p>}
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/90">
              {issues.map((issue, i) => (
                <li key={i}>
                  {issue.message} <span className="text-muted-foreground">({issue.file})</span>
                  {issue.suggestion && <span className="text-muted-foreground"> — {issue.suggestion}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-[10px] text-muted-foreground mt-2">{format(msg.timestamp, "h:mm a")}</p>
      </div>
    </div>
  );
}

function PlanCard({
  result,
  onCreate,
  busy,
}: {
  result: PlanResult;
  onCreate: () => void;
  busy: boolean;
}) {
  return (
    <div className="max-w-3xl mx-auto w-full space-y-4">
      <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
        <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">Project Plan</p>
        <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{result.plan}</p>
      </div>
      <GoogleSearchSources sources={result.sources} status={result.searchStatus} />
      {result.techStack.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Suggested stack</p>
          <div className="flex flex-wrap gap-2">
            {result.techStack.map(item => (
              <span key={item} className="text-xs rounded-full border border-border bg-secondary px-2.5 py-1 text-foreground/80">
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
      {result.files.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Planned files</p>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {result.files.map(file => (
              <div key={file.path} className="px-3 py-2.5">
                <p className="text-xs font-mono text-foreground">{file.path}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{file.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={onCreate}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-black hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {busy ? "Creating…" : "Create this project"}
      </button>
    </div>
  );
}

const SECURITY_SEVERITY: Record<string, string> = {
  critical: "text-red-300 border-red-500/30 bg-red-500/10",
  high: "text-orange-300 border-orange-500/30 bg-orange-500/10",
  medium: "text-yellow-300 border-yellow-500/30 bg-yellow-500/10",
  low: "text-blue-300 border-blue-500/30 bg-blue-500/10",
  info: "text-muted-foreground border-border bg-secondary",
};

function SecurityCard({
  result,
  onFixAll,
  busy,
}: {
  result: SecurityResult;
  onFixAll: () => void;
  busy: boolean;
}) {
  return (
    <div className="max-w-3xl mx-auto w-full space-y-4">
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">Security Score</p>
            <p className="text-sm text-foreground/90 leading-relaxed">{result.summary}</p>
          </div>
          <span className="text-2xl font-semibold text-green-300 shrink-0">{result.score}<span className="text-xs text-muted-foreground">/100</span></span>
        </div>
      </div>
      {result.vulnerabilities.length === 0 ? (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 flex items-center gap-2 text-sm text-green-300">
          <CheckCircle2 className="w-4 h-4" /> No vulnerabilities found.
        </div>
      ) : (
        <div className="space-y-2">
          {result.vulnerabilities.map((vulnerability, index) => (
            <div key={`${vulnerability.file}-${vulnerability.type}-${index}`} className={cn("rounded-xl border p-3", SECURITY_SEVERITY[vulnerability.severity] ?? SECURITY_SEVERITY.info)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{vulnerability.type}</p>
                  <p className="text-xs mt-1">{vulnerability.message}</p>
                  <p className="text-[11px] mt-2 font-mono opacity-80">
                    {vulnerability.file}{vulnerability.line ? `:${vulnerability.line}` : ""}
                  </p>
                </div>
                <span className="text-[10px] uppercase font-bold shrink-0">{vulnerability.severity}</span>
              </div>
              <p className="text-xs mt-2 opacity-80">Fix: {vulnerability.fix}</p>
            </div>
          ))}
        </div>
      )}
      {result.vulnerabilities.length > 0 && (
        <button
          onClick={onFixAll}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-black hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ? "Fixing…" : "Fix all issues"}
        </button>
      )}
    </div>
  );
}

/* ── Design card ─────────────────────────────────────── */
function DesignCard({ msg }: { msg: ChatMsg }) {
  return (
    <div className="flex gap-3 mb-5">
      <EraAvatar color="purple" icon={<Palette className="w-3.5 h-3.5 text-purple-400" />} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">Design Suggestions</p>
        {msg.colorPalette && msg.colorPalette.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {msg.colorPalette.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full border border-white/10" style={{ backgroundColor: c }} />
                <span className="text-[11px] text-muted-foreground font-mono">{c}</span>
              </div>
            ))}
          </div>
        )}
        {msg.designSuggestions && <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{msg.designSuggestions}</p>}
        {msg.typography && <p className="text-xs text-muted-foreground mt-2 italic">🔤 {msg.typography}</p>}
        <p className="text-[10px] text-muted-foreground mt-2">{format(msg.timestamp, "h:mm a")}</p>
      </div>
    </div>
  );
}

/* ── User message ────────────────────────────────────── */
function UserMessage({ msg, userColor, userLetter }: { msg: ChatMsg; userColor: string; userLetter: string }) {
  return (
    <div className="flex gap-3 mb-5 flex-row-reverse">
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5"
        style={{ backgroundColor: userColor }}>
        {userLetter}
      </div>
      <div className="bg-secondary rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%]">
        <PromptAttachmentBadges names={msg.attachmentNames ?? []} />
        <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
        <p className="text-[10px] text-muted-foreground mt-1 text-right">{format(msg.timestamp, "h:mm a")}</p>
      </div>
    </div>
  );
}

/* ── Pipeline indicator ──────────────────────────────── */
type GenerationStage = "queued" | "design" | "code" | "repair" | "fallback";
type PipelineStep = "idle" | "generating" | "testing";
const STEP_META: Record<PipelineStep, { label: string; color: string; dot: string }> = {
  idle:       { label: "",                    color: "text-muted-foreground", dot: "bg-muted" },
  generating: { label: "Generating website…", color: "text-green-400",        dot: "bg-green-400" },
  testing:    { label: "Testing website…",    color: "text-blue-400",         dot: "bg-blue-400" },
};
const GENERATION_STAGE_LABEL: Record<GenerationStage, string> = {
  queued: "Waiting for generation to start…",
  design: "Working on the design…",
  code: "Writing code…",
  repair: "Repairing the generated result…",
  fallback: "Generating website…",
};
function PipelineBar({
  step,
  progress,
  elapsedSeconds,
}: {
  step: PipelineStep;
  progress: { stage: GenerationStage; model: string | null } | null;
  elapsedSeconds: number;
}) {
  if (step === "idle") return null;
  const { label, color, dot } = STEP_META[step];
  const visibleLabel = step === "generating" && progress
    ? GENERATION_STAGE_LABEL[progress.stage]
    : label;
  const activeStep = step === "testing"
    ? 2
    : progress?.stage === "design"
      ? 0
      : 1;
  const checklist = ["Designing UI", "Writing code", "Testing & auto-fix"];
  return (
    <div className="mb-4 rounded-xl border border-green-500/20 bg-card/80 p-3 sm:p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div className={cn("flex min-w-0 items-center gap-2 text-sm", color)}>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className="truncate">{visibleLabel}</span>
          <span className="flex shrink-0 gap-0.5">
            {[0, 150, 300].map(d => (
              <span key={d} className={cn("h-1 w-1 rounded-full animate-bounce", dot)} style={{ animationDelay: `${d}ms` }} />
            ))}
          </span>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{elapsedSeconds}s</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {checklist.map((item, index) => (
          <div key={item} className={cn(
            "rounded-lg border px-2 py-2 text-[10px] leading-tight sm:text-xs",
            index < activeStep ? "border-green-500/20 bg-green-500/5 text-green-300" :
              index === activeStep ? "border-green-500/40 bg-green-500/10 text-foreground" :
                "border-border bg-background/50 text-muted-foreground",
          )}>
            <span className="mr-1 font-semibold">{index < activeStep ? "✓" : index + 1}</span>{item}
          </div>
        ))}
      </div>
      {progress?.model && (
        <p className="mt-2 text-[10px] text-muted-foreground">Active model: <span className="font-medium text-foreground">{progress.model}</span></p>
      )}
    </div>
  );
}

/* ── Main component ──────────────────────────────────── */
export default function Builder() {
  const params = useParams<{ id: string }>();
  const projectId = params.id || "";
  const { userId } = useEraAuth();
  const generationJobKey = `era_generation_job_${projectId}`;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { openTab, credits, setCreditsFromServer, user } = useApp();

  const [view, setView] = useState<ViewMode>("chat");
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>("idle");
  const [generationProgress, setGenerationProgress] = useState<{
    stage: GenerationStage;
    model: string | null;
  } | null>(null);
  const [latestCodeMsgId, setLatestCodeMsgId] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<ProjectFile | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [unsaved, setUnsaved] = useState(false);
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false);
  const [interactionMode, setInteractionMode] = useState<"build" | "ask">("build");
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [securityResult, setSecurityResult] = useState<SecurityResult | null>(null);
  const [planPrompt, setPlanPrompt] = useState("");
  const inputAttachmentState = usePersistedPromptAttachments(userId, `project:${projectId}:build`);
  const planAttachmentState = usePersistedPromptAttachments(userId, `project:${projectId}:plan`);
  const inputAttachments = inputAttachmentState.files;
  const setInputAttachments = inputAttachmentState.setFiles;
  const planAttachments = planAttachmentState.files;
  const setPlanAttachments = planAttachmentState.setFiles;
  const isRestoringAttachments = inputAttachmentState.isRestoring || planAttachmentState.isRestoring;
  const [planAttachmentCache, setPlanAttachmentCache] = useState<{
    fingerprint: string;
    context: string;
  } | null>(null);
  const [inputAttachmentCache, setInputAttachmentCache] = useState<{
    fingerprint: string;
    context: string;
  } | null>(null);
  const [homePlanAttachmentContext, setHomePlanAttachmentContext] = useState("");
  const [homePlanAttachmentNames, setHomePlanAttachmentNames] = useState<string[]>([]);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [resumedJobId, setResumedJobId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const handleInputAttachmentsChange = (nextFiles: File[]) => {
    const nextFingerprint = promptAttachmentFingerprint(nextFiles);
    setInputAttachmentCache(current => (
      current && current.fingerprint !== nextFingerprint ? null : current
    ));
    setInputAttachments(nextFiles);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeFileRef = useRef<ProjectFile | null>(null);
  const activeGenerationJobIdRef = useRef<string | null>(null);
  activeFileRef.current = activeFile;
  const autoSentRef = useRef(false);
  const autoSentProjectIdRef = useRef(projectId);
  const stoppedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recoveredJobControllerRef = useRef<AbortController | null>(null);
  const generationStartedAtRef = useRef<number | null>(null);
  const requestOptionsRef = useRef<RequestInit>({});
  const { data: project, isLoading: projectLoading } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: files, isLoading: filesLoading } = useListFiles(projectId, {
    query: { enabled: !!projectId, queryKey: getListFilesQueryKey(projectId) },
  });

  useEffect(() => {
    if (!unsaved) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [unsaved]);

  /* ── Persist messages to localStorage ── */
  const CHAT_KEY = `era_chat_${projectId}`;

  // Save messages whenever they change
  useEffect(() => {
    if (messages.length === 0) return;
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-100))); } catch {}
  }, [messages]);

  // Load saved messages once on mount
  useEffect(() => {
    // Do not display browser-cached messages until the authenticated API has
    // confirmed this project belongs to the current account.
    if (!projectId || project?.id !== projectId) return;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    try {
      const saved = localStorage.getItem(CHAT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMsg[];
        // Restore Date objects (JSON stringifies them to strings)
        setMessages(parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));
        const latestAssistant = [...parsed].reverse().find(m => m.type === "code" || m.type === "info");
        setLatestCodeMsgId(latestAssistant?.id ?? null);
        firstFrame = requestAnimationFrame(() => {
          secondFrame = requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          });
        });
      } else {
        setMessages([]);
        setLatestCodeMsgId(null);
      }
    } catch {
      setMessages([]);
      setLatestCodeMsgId(null);
    }
    return () => {
      if (firstFrame !== null) cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    };
  }, [projectId, project?.id]);

  useEffect(() => {
    try {
      setResumedJobId(localStorage.getItem(generationJobKey));
    } catch {
      setResumedJobId(null);
    }
  }, [generationJobKey]);

  const upsertFile = useUpsertFile();
  const deleteFile = useDeleteFile();
  const aiGenerate = useAiGenerate({ request: requestOptionsRef.current });
  const aiTest = useAiTest({ request: requestOptionsRef.current });
  const aiChat = useAiChat({ request: requestOptionsRef.current });
  const aiPlan = useAiPlan({ request: requestOptionsRef.current });
  const aiSecurity = useAiSecurity({ request: requestOptionsRef.current });
  const aiReadAttachments = useAiReadAttachments();

  useEffect(() => {
    if (!inputAttachmentState.persistenceError && !planAttachmentState.persistenceError) return;
    toast({
      title: "Attachments are not saved on this browser",
      description: "You can still use them now, but they may disappear after a reload.",
      variant: "destructive",
    });
  }, [inputAttachmentState.persistenceError, planAttachmentState.persistenceError, toast]);

  const isWorking = pipelineStep !== "idle";
  const isChatBusy = aiChat.isPending;
  const isBusy = isWorking || isChatBusy;

  useEffect(() => { if (project) openTab(project.id, project.name); }, [project?.id]);

  const selectedFileProjectRef = useRef(projectId);
  useEffect(() => {
    const projectChanged = selectedFileProjectRef.current !== projectId;
    if (projectChanged) {
      selectedFileProjectRef.current = projectId;
      setActiveFile(null);
      setFileContent("");
      setUnsaved(false);
    }
    if (files && files.length > 0 && (projectChanged || !activeFile)) {
      const def = files.find(f => f.path === "index.html") || files[0];
      setActiveFile(def); setFileContent(def.content);
    } else if (files && activeFile && !unsaved) {
      const current = files.find(f => f.path === activeFile.path) ?? files[0] ?? null;
      if (!current || current.id !== activeFile.id || current.content !== activeFile.content) {
        setActiveFile(current);
        setFileContent(current?.content ?? "");
      }
    }
  }, [files, projectId, activeFile, unsaved]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [messages, pipelineStep]);

  useEffect(() => {
    if (pipelineStep === "idle" || generationStartedAtRef.current === null) return;
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - generationStartedAtRef.current!) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [pipelineStep]);

  useEffect(() => {
    if (view !== "chat") return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const chatContainer = scrollRef.current;
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [view]);

  const addMsg = (msg: Omit<ChatMsg, "id" | "timestamp">): ChatMsg => {
    const full = { ...msg, id: uid(), timestamp: new Date() };
    setMessages(prev => [...prev, full]);
    if (full.type === "code" || full.type === "info") setLatestCodeMsgId(full.id);
    return full;
  };

  const applyGeneratedFilesRef = useRef<
    (generatedFiles: AiGeneratedResult["files"], expectedProjectId: string) => Promise<ProjectFile[]>
  >(async () => []);
  applyGeneratedFilesRef.current = async (generatedFiles, expectedProjectId) => {
    if (expectedProjectId !== projectId) throw new Error("Project changed; the saved generation can be recovered in its original project.");
    if (!project) throw new Error("Project metadata is not loaded yet.");
    if (project.mode === "fullstack") {
      // Full-stack jobs already committed atomically on the server. Replaying
      // their old response can overwrite newer edits from this or another tab.
      await queryClient.refetchQueries(
        { queryKey: getListFilesQueryKey(projectId) },
        { throwOnError: true },
      );
      return queryClient.getQueryData<ProjectFile[]>(getListFilesQueryKey(projectId)) ?? [];
    }
    if (generatedFiles.some(file => file.action === "patch")) {
      throw new Error("ERA returned a patch that was not resolved by the server.");
    }

    let latestFiles: ProjectFile[] =
      queryClient.getQueryData<ProjectFile[]>(getListFilesQueryKey(projectId)) || [];
    const generatedHtmlReplacement = generatedFiles.some(
      file => (file.action === "create" || file.action === "update") &&
        file.path.toLowerCase().endsWith(".html") &&
        file.path.toLowerCase() !== "index.html",
    );
    const currentPaths = new Set(latestFiles.map(file => file.path));
    const safeDeletes = generatedFiles.filter(
      file => file.action === "delete" &&
        currentPaths.has(file.path) &&
        (file.path.toLowerCase() !== "index.html" || generatedHtmlReplacement),
    );

    await Promise.all(
      generatedFiles
        .filter(file => file.action === "create" || file.action === "update")
        .map(file => {
          if (typeof file.content !== "string" || typeof file.language !== "string") {
            throw new Error(`Generated file ${file.path} is missing content or language.`);
          }
          return upsertFile.mutateAsync({
            id: projectId,
            data: { path: file.path, content: file.content, language: file.language },
          });
        }),
    );

    const deletedPaths = new Set<string>();
    await Promise.all(safeDeletes.map(async file => {
      try {
        await deleteFile.mutateAsync({ id: projectId, filePath: file.path });
        deletedPaths.add(file.path);
      } catch (err) {
        if (getApiErrorStatus(err) !== 404) throw err;
        deletedPaths.add(file.path);
      }
    }));

    await queryClient.refetchQueries({ queryKey: getListFilesQueryKey(projectId) });
    latestFiles = queryClient.getQueryData<ProjectFile[]>(getListFilesQueryKey(projectId)) || latestFiles;
    const currentActiveFile = activeFileRef.current;
    if (currentActiveFile && deletedPaths.has(currentActiveFile.path)) {
      const fallbackFile = latestFiles.find(file => file.path === "index.html") || latestFiles[0] || null;
      setActiveFile(fallbackFile);
      setFileContent(fallbackFile?.content ?? "");
      setUnsaved(false);
    }
    return latestFiles;
  };

  useEffect(() => {
    if (!resumedJobId || filesLoading || projectLoading || !project) return;
    const controller = new AbortController();
    recoveredJobControllerRef.current = controller;
    activeGenerationJobIdRef.current = resumedJobId;
    generationStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setPipelineStep("generating");
    setGenerationProgress({ stage: "queued", model: null });

    const recoverGeneration = async () => {
      try {
        const completedJob = await waitForAiGenerationJob(
          resumedJobId,
          projectId,
          controller.signal,
          setGenerationProgress,
        );
        if (controller.signal.aborted) return;
        const result = completedJob.result;
        setCreditsFromServer(completedJob.creditsRemaining);
        setCurrentModel(result.model);

        if (result.files.length > 0) {
          await applyGeneratedFilesRef.current(result.files, projectId);
          if (controller.signal.aborted) return;
        }

        try { localStorage.removeItem(generationJobKey); } catch {}
        activeGenerationJobIdRef.current = null;
        setResumedJobId(null);
        const recoveredMessage: ChatMsg = {
          id: uid(),
          type: result.files.length > 0 ? "code" : "info",
          content: generationInfoText(
            result,
            result.files.length > 0
              ? "The generated files were saved. Automatic quality checks were not resumed after the reload."
              : undefined,
          ),
          createdFiles: generatedFilesForMessage(result),
          sources: result.sources,
          searchStatus: result.searchStatus,
          timestamp: new Date(),
        };
        setMessages(previous => [...previous, recoveredMessage]);
        setLatestCodeMsgId(recoveredMessage.id);
      } catch (err) {
        if (controller.signal.aborted) return;
        const pollError = err as PollError;
        if (pollError.jobTerminal) {
          try { localStorage.removeItem(generationJobKey); } catch {}
          activeGenerationJobIdRef.current = null;
          setResumedJobId(null);
        }
        const recoveryError: ChatMsg = {
          id: uid(),
          type: "info",
          content: getAiFailureMessage(
            err,
            "Could not recover this generation right now. Its job ID is saved, so reload the project to try again.",
          ),
          timestamp: new Date(),
        };
        setMessages(previous => [...previous, recoveryError]);
        setLatestCodeMsgId(recoveryError.id);
      } finally {
        if (!controller.signal.aborted) {
          generationStartedAtRef.current = null;
          setPipelineStep("idle");
          setGenerationProgress(null);
        }
      }
    };

    void recoverGeneration();
    return () => {
      controller.abort();
      if (recoveredJobControllerRef.current === controller) {
        recoveredJobControllerRef.current = null;
      }
    };
  }, [resumedJobId, filesLoading, projectLoading, project?.mode, generationJobKey, projectId, setCreditsFromServer]);

  const beginAiRequest = () => {
    stoppedRef.current = false;
    abortControllerRef.current = new AbortController();
    requestOptionsRef.current.signal = abortControllerRef.current.signal;
  };

  /* ── Pipeline: Design → Code → Test → auto-fix loop ──
   * Design and coding agent output are used ONLY internally — never shown to
   * the user. Only the testing agent's final result is rendered in chat,
   * once, after the whole pipeline (including any auto-fix retries) is done.
   * If testing finds issues, we silently feed them back to the coding agent
   * to fix, retrying once before reporting the final result. Keeping this
   * bounded prevents one prompt from turning into a long chain of AI calls. */
  const MAX_FIX_ATTEMPTS = 2;

  const handleStop = useCallback(() => {
    let jobContinues = Boolean(activeGenerationJobIdRef.current);
    try { jobContinues ||= Boolean(localStorage.getItem(generationJobKey)); } catch {}
    stoppedRef.current = true;
    abortControllerRef.current?.abort();
    recoveredJobControllerRef.current?.abort();
    generationStartedAtRef.current = null;
    if (jobContinues) {
      activeGenerationJobIdRef.current = null;
      setResumedJobId(null);
    }
    setPipelineStep("idle");
    setGenerationProgress(null);
    addMsg({
      type: "info",
      content: jobContinues
        ? "Stopped waiting. This generation continues on the server and will be restored when you reopen this project."
        : "Stopped.",
    });
  }, [generationJobKey]);

  const handleAsk = async (
    text: string,
    attachmentContext = "",
    attachmentNames: string[] = [],
  ) => {
    const displayText = text.trim();
    if (!displayText || aiChat.isPending) return false;

    beginAiRequest();
    const historySnapshot = buildHistorySnapshot(messages);
    addMsg({
      type: "user",
      content: displayText,
      hiddenContext: attachmentContext || undefined,
      attachmentNames: attachmentNames.length ? attachmentNames : undefined,
    });

    try {
      const result = await aiChat.mutateAsync({
        data: {
          message: displayText,
          history: historySnapshot,
          projectContext: [
            buildAskProjectContext(displayText, files ?? []),
            attachmentContext,
          ].filter(Boolean).join("\n\n") || undefined,
        },
      });
      if (stoppedRef.current) return false;
      setCurrentModel(result.model);
      addMsg({
        type: "info",
        content: result.reply,
        sources: result.sources,
        searchStatus: result.searchStatus,
      });
      return true;
    } catch (err) {
      if (!stoppedRef.current) {
        addMsg({
          type: "info",
          content: getAiFailureMessage(err, "ERA could not answer right now. Please try again."),
          retryPrompt: displayText,
          retryMode: "ask",
          retryAttachmentContext: attachmentContext || undefined,
          retryAttachmentNames: attachmentNames.length ? attachmentNames : undefined,
        });
      }
      return false;
    }
  };

  const handlePlan = async () => {
    if (isBusy || isRestoringAttachments || isPreparingAttachments || aiPlan.isPending) return;
    const defaultPrompt = `Create an implementation plan for ${project?.name || "this website"}.`;
    const fingerprint = promptAttachmentFingerprint(planAttachments);
    setIsPreparingAttachments(true);
    try {
      let attachmentContext = homePlanAttachmentContext;
      let extraCredits = 0;
      if (planAttachments.length > 0) {
        const matchingCache = planAttachmentCache?.fingerprint === fingerprint ? planAttachmentCache : null;
        if (matchingCache) {
          attachmentContext = [attachmentContext, matchingCache.context].filter(Boolean).join("\n\n");
        } else {
          const prepared = await preparePromptAttachmentContext(planAttachments, async attachments => {
            assertAttachmentReadRequestFits(attachments);
            return aiReadAttachments.mutateAsync({ data: { attachments } });
          });
          setPlanAttachmentCache({ fingerprint, context: prepared.context });
          attachmentContext = [attachmentContext, prepared.context].filter(Boolean).join("\n\n");
          extraCredits = prepared.extraCredits;
        }
      }
      const description = composePromptWithAttachments(planPrompt, attachmentContext, defaultPrompt);
      if (extraCredits > 0) {
        toast({
          title: "Reference files read",
          description: `Gemini used ${extraCredits} credit${extraCredits === 1 ? "" : "s"} to read the photos/PDFs.`,
        });
      }
      beginAiRequest();
      setPlanResult(null);
      const result = await aiPlan.mutateAsync({
        data: { description, projectType: project?.mode === "fullstack" ? "fullstack" : "website", projectId },
      });
      if (!stoppedRef.current) {
        setCurrentModel(result.model);
        setPlanResult(result);
        setPlanAttachments([]);
        await clearPromptAttachmentStorage(planAttachmentState.storageKey).catch(() => undefined);
        setPlanAttachmentCache(null);
        setHomePlanAttachmentContext("");
        setHomePlanAttachmentNames([]);
        try {
          sessionStorage.removeItem(PENDING_PROMPT_KEY);
          sessionStorage.removeItem(PENDING_PROMPT_CONTEXT_KEY);
          sessionStorage.removeItem(PENDING_PROMPT_ATTACHMENTS_KEY);
          sessionStorage.removeItem(PENDING_PROMPT_PROJECT_KEY);
          sessionStorage.removeItem(PENDING_VIEW_KEY);
        } catch {}
      }
    } catch (err) {
      const dataError = (err as { data?: { error?: string } })?.data?.error;
      toast({
        title: "Planning failed",
        description: dataError ?? (err instanceof Error ? err.message : getAiFailureMessage(err, "ERA could not create a plan right now.")),
        variant: "destructive",
      });
    } finally {
      setIsPreparingAttachments(false);
    }
  };

  const handleSecurityScan = async () => {
    if (!files || files.length === 0) {
      toast({ title: "No files to scan", description: "Generate or save some project files first.", variant: "destructive" });
      return;
    }

    beginAiRequest();
    setSecurityResult(null);
    try {
      const result = await aiSecurity.mutateAsync({ data: { files } });
      if (!stoppedRef.current) {
        setCurrentModel(result.model);
        setSecurityResult(result);
      }
    } catch (err) {
      if (!stoppedRef.current) {
        toast({ title: "Security scan failed", description: getAiFailureMessage(err, "ERA could not scan the project right now."), variant: "destructive" });
      }
    }
  };

  const runPipeline = useCallback(async (
    text: string,
    attachmentContext = "",
    attachmentNames: string[] = [],
  ) => {
    const displayText = text.trim();
    if (!displayText) return false;
    let baseGenerationPrompt: string;
    try {
      baseGenerationPrompt = composePromptWithAttachments(displayText, attachmentContext);
    } catch (error) {
      toast({
        title: "Prompt is too long",
        description: error instanceof Error ? error.message : "Shorten the prompt or remove an attachment.",
        variant: "destructive",
      });
      return false;
    }
    if (resumedJobId || activeGenerationJobIdRef.current) {
      toast({ title: "Generation still running", description: "Wait for the saved generation to finish before starting another." });
      return false;
    }
    if (credits <= 0) {
      toast({ title: "No credits left", description: "Buy credits to keep building.", variant: "destructive" });
      return false;
    }

    beginAiRequest();
    generationStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    addMsg({
      type: "user",
      content: displayText,
      hiddenContext: attachmentContext || undefined,
      attachmentNames: attachmentNames.length ? attachmentNames : undefined,
    });
    let latestFiles: ProjectFile[] = queryClient.getQueryData<ProjectFile[]>(getListFilesQueryKey(projectId)) || [];

    // Build history snapshot before any state updates
    const historySnapshot = buildHistorySnapshot(messages);

    let genPrompt = baseGenerationPrompt;
    let finalIssues: TestIssue[] = [];
    let finalSummary = "";
    let latestCredits = credits;
    let codeMessageId: string | null = null;

    for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      if (stoppedRef.current) return false;

      /* Step 2 — Generate / fix (internal only, never shown to user) */
      setPipelineStep("generating");
      setGenerationProgress({ stage: "queued", model: null });
      try {
        const acceptedJob = await aiGenerate.mutateAsync({
          data: {
            projectId,
            prompt: genPrompt,
            files: latestFiles,
            history: historySnapshot,
          },
        });
        activeGenerationJobIdRef.current = acceptedJob.id;
        try {
          localStorage.setItem(generationJobKey, acceptedJob.id);
        } catch {
          addMsg({
            type: "info",
            content: "Generation is running on the server, but this browser could not save its job ID for recovery after a reload.",
          });
        }
        const completedJob = await waitForAiGenerationJob(
          acceptedJob.id,
          projectId,
          abortControllerRef.current?.signal,
          setGenerationProgress,
        );
        const result = completedJob.result;
        latestCredits = completedJob.creditsRemaining;
        setCreditsFromServer(latestCredits);
        setCurrentModel(result.model);

        if (result.files.length === 0) {
          try { localStorage.removeItem(generationJobKey); } catch {}
          activeGenerationJobIdRef.current = null;
          addMsg({
            type: "info",
            content: generationInfoText(result),
            sources: result.sources,
            searchStatus: result.searchStatus,
          });
          generationStartedAtRef.current = null;
          setPipelineStep("idle");
          setGenerationProgress(null);
          return true;
        }
        latestFiles = await applyGeneratedFilesRef.current(result.files, projectId);
        const updatedMessage = {
          type: "code" as const,
          content: generationInfoText(result),
          createdFiles: generatedFilesForMessage(result),
          sources: result.sources,
          searchStatus: result.searchStatus,
        };
        if (codeMessageId) {
          const existingCodeMessageId = codeMessageId;
          setMessages(previous => previous.map(msg => msg.id === existingCodeMessageId
            ? { ...msg, ...updatedMessage, timestamp: new Date() }
            : msg));
          setLatestCodeMsgId(codeMessageId);
        } else {
          codeMessageId = addMsg(updatedMessage).id;
        }
        try { localStorage.removeItem(generationJobKey); } catch {}
        activeGenerationJobIdRef.current = null;
        setGenerationProgress(null);
      } catch (err) {
        if (stoppedRef.current) return false;
        if ((err as PollError).jobTerminal) {
          try { localStorage.removeItem(generationJobKey); } catch {}
          activeGenerationJobIdRef.current = null;
        }
        if (attempt === 2 && getApiErrorStatus(err) === 402) {
          finalSummary = [finalSummary, "Automatic fix was skipped because there are no credits left."]
            .filter(Boolean).join("\n\n");
          addMsg({ type: "test", content: "", testIssues: finalIssues, testSummary: finalSummary });
          generationStartedAtRef.current = null;
          setPipelineStep("idle");
          setGenerationProgress(null);
          return true;
        }
        const fallback = latestFiles.length > 0
          ? "Automatic fix could not finish. Your latest code and preview are still available—try again when ready."
          : "Code generation failed before any files were created. Please try again.";
        addMsg({
          type: "info",
          content: getAiFailureMessage(err, fallback),
          retryPrompt: displayText,
          retryMode: "build",
          retryAttachmentContext: attachmentContext || undefined,
          retryAttachmentNames: attachmentNames.length ? attachmentNames : undefined,
        });
        generationStartedAtRef.current = null;
        setPipelineStep("idle");
        setGenerationProgress(null);
        return false;
      }

      if (stoppedRef.current) return false;

      /* Step 3 — Test (internal, but its final result is shown to the user) */
      setPipelineStep("testing");
      setGenerationProgress(null);
      let issues: TestIssue[] = [];
      let summary = "";
      if (latestCredits < 2) {
        summary = "The generated files are saved. Quality checks were skipped because fewer than 2 credits remain.";
      } else try {
        const testResult = await aiTest.mutateAsync({ data: { files: latestFiles } });
        setCurrentModel(testResult.model);
        issues = (testResult.issues as TestIssue[]) ?? [];
        summary = testResult.summary ?? "";
        latestCredits = Math.max(0, latestCredits - 2);
        setCreditsFromServer(latestCredits);
      } catch (err) {
        if (getApiErrorStatus(err) === 402) {
          latestCredits = 0;
          setCreditsFromServer(0);
          summary = "Quality checks were skipped because the remaining credits were used by another request.";
        } else {
          summary = getAiFailureMessage(err, "ERA could not analyze the project right now.");
        }
      }

      if (stoppedRef.current) return false;

      finalIssues = issues;
      finalSummary = summary;

      if (!issues.some(issue => issue.severity === "error") || attempt === MAX_FIX_ATTEMPTS) break;
      if (latestCredits < 1) {
        finalSummary = [finalSummary, "Automatic fix was skipped because fewer than 1 credit remains."]
          .filter(Boolean).join("\n\n");
        break;
      }

      const issueList = issues
        .map(i => `- [${i.severity}] ${i.file}${i.line ? `:${i.line}` : ""} — ${i.message} (fix: ${i.suggestion})`)
        .join("\n");
      genPrompt = `${baseGenerationPrompt}\n\nAdditionally, fix these issues found in the code:\n${issueList}\n\nDo not introduce new issues.`;
    }

    if (stoppedRef.current) return;

    if (finalIssues.some(issue => issue.severity === "error")) {
      const unresolvedMessage = `I couldn't automatically fix these remaining issues after ${MAX_FIX_ATTEMPTS} attempts.`;
      finalSummary = [finalSummary.trim(), unresolvedMessage].filter(Boolean).join("\n\n");
    }
    addMsg({ type: "test", content: "", testIssues: finalIssues, testSummary: finalSummary });
    generationStartedAtRef.current = null;
    setPipelineStep("idle");
    return true;
  }, [credits, messages, projectId, queryClient, generationJobKey, resumedJobId, setCreditsFromServer, toast]);
  const runPipelineRef = useRef(runPipeline);
  runPipelineRef.current = runPipeline;

  const handleCreateFromPlan = () => {
    if (!planResult) return;
    const fullstack = project?.mode === "fullstack";
    const plannedFiles = planResult.files
      .map(file => `- ${file.path} (${file.language}): ${file.description}`)
      .join("\n");
    const prompt = [
      fullstack
        ? "Build this full-stack project from the approved plan."
        : "Build this frontend project from the approved plan.",
      fullstack
        ? "Generate the frontend, backend API, database schema, and migrations required by the plan. Follow ERA's full-stack runtime contract."
        : "Generate frontend files only; do not create a backend or database.",
      planResult.plan,
      plannedFiles ? `Planned files:\n${plannedFiles}` : "",
    ].filter(Boolean).join("\n\n");
    setView("chat");
    void runPipeline(prompt);
  };

  const handleFixSecurityIssues = () => {
    if (!securityResult || securityResult.vulnerabilities.length === 0) return;
    const issues = securityResult.vulnerabilities
      .map(v => `- ${v.file}: ${v.type} — ${v.message} Fix: ${v.fix}`)
      .join("\n");
    setView("chat");
    const scope = project?.mode === "fullstack"
      ? "Fix these security issues across the full-stack project, including the frontend, server/API, and database files where applicable. Follow ERA's full-stack runtime contract."
      : "Fix all of these security issues in the frontend project.";
    void runPipeline(`${scope}\n${issues}`);
  };

  /* ── Auto-send prompt from home page (sessionStorage) ── */
  useEffect(() => {
    if (autoSentProjectIdRef.current !== projectId) {
      autoSentProjectIdRef.current = projectId;
      autoSentRef.current = false;
    }
    if (autoSentRef.current || projectLoading || !project) return;
    let pending = "";
    let pendingView = "";
    let pendingContext = "";
    let pendingProjectId = "";
    let attachmentNames: string[] = [];
    try { pending = sessionStorage.getItem(PENDING_PROMPT_KEY) || ""; } catch {}
    try { pendingView = sessionStorage.getItem(PENDING_VIEW_KEY) || ""; } catch {}
    try { pendingContext = sessionStorage.getItem(PENDING_PROMPT_CONTEXT_KEY) || ""; } catch {}
    try { pendingProjectId = sessionStorage.getItem(PENDING_PROMPT_PROJECT_KEY) || ""; } catch {}
    try {
      const parsed = JSON.parse(sessionStorage.getItem(PENDING_PROMPT_ATTACHMENTS_KEY) || "[]");
      if (Array.isArray(parsed)) attachmentNames = parsed.filter((name): name is string => typeof name === "string");
    } catch {}
    if (!pending) return;
    if (pendingProjectId && pendingProjectId !== projectId) {
      try {
        sessionStorage.removeItem(PENDING_PROMPT_KEY);
        sessionStorage.removeItem(PENDING_PROMPT_CONTEXT_KEY);
        sessionStorage.removeItem(PENDING_PROMPT_ATTACHMENTS_KEY);
        sessionStorage.removeItem(PENDING_PROMPT_PROJECT_KEY);
        sessionStorage.removeItem(PENDING_VIEW_KEY);
      } catch {}
      return;
    }
    if (pendingView === "plan") {
      autoSentRef.current = true;
      setPlanPrompt(pending);
      setHomePlanAttachmentContext(pendingContext);
      setHomePlanAttachmentNames(attachmentNames);
      setView("plan");
      return;
    }
    // Delay slightly so the component is fully mounted
    return schedulePendingPromptSend(() => {
      autoSentRef.current = true;
      try {
        sessionStorage.removeItem(PENDING_PROMPT_KEY);
        sessionStorage.removeItem(PENDING_PROMPT_CONTEXT_KEY);
        sessionStorage.removeItem(PENDING_PROMPT_ATTACHMENTS_KEY);
        sessionStorage.removeItem(PENDING_PROMPT_PROJECT_KEY);
        sessionStorage.removeItem(PENDING_VIEW_KEY);
      } catch {}
      void runPipelineRef.current(pending, pendingContext, attachmentNames);
    });
  }, [projectLoading, project?.id, projectId]);

  const clearInputAttachmentDraft = async () => {
    setInputAttachments([]);
    setInputAttachmentCache(null);
    await clearPromptAttachmentStorage(inputAttachmentState.storageKey).catch(() => undefined);
  };

  const handleSend = async () => {
    if (isBusy || isRestoringAttachments || isPreparingAttachments || (!input.trim() && inputAttachments.length === 0)) return;
    const promptText = input.trim();
    const answerAttachmentQuestion = shouldAnswerQuestionAboutAttachments(promptText, inputAttachments);
    const defaultPrompt = interactionMode === "ask"
      ? "Please read and explain the attached reference files."
      : "Create or update this project using the attached reference files.";
    const displayText = promptText || defaultPrompt;
    const attachmentNames = inputAttachments.map(file => file.name);
    const fingerprint = promptAttachmentFingerprint(inputAttachments);
    let attachmentContext = "";
    let directReply = "";
    let directModel = "";
    let gotDirectAnswer = false;
    setIsPreparingAttachments(true);
    try {
      const cachedInput = !answerAttachmentQuestion && inputAttachmentCache?.fingerprint === fingerprint
        ? inputAttachmentCache
        : null;
      if (cachedInput) {
        attachmentContext = cachedInput.context;
      } else {
        const prepared = await preparePromptAttachmentContext(inputAttachments, async (attachments, referenceText) => {
          if (answerAttachmentQuestion) {
            assertAttachmentReadRequestFits(attachments, referenceText, promptText);
          } else {
            assertAttachmentReadRequestFits(attachments);
          }
          const result = await aiReadAttachments.mutateAsync({
            data: {
              attachments,
              ...(answerAttachmentQuestion
                ? {
                    question: promptText,
                    ...(referenceText ? { referenceText } : {}),
                  }
                : {}),
            },
          });
          if (answerAttachmentQuestion) {
            directReply = result.context;
            directModel = result.model;
            gotDirectAnswer = true;
          }
          return result;
        });
        attachmentContext = gotDirectAnswer ? "" : prepared.context;
        if (!answerAttachmentQuestion && inputAttachments.length > 0) {
          setInputAttachmentCache({ fingerprint, context: prepared.context });
        }
        if (prepared.extraCredits > 0) {
          toast({
            title: answerAttachmentQuestion ? "Answer ready" : "Reference files read",
            description: answerAttachmentQuestion
              ? `Gemini used ${prepared.extraCredits} credit${prepared.extraCredits === 1 ? "" : "s"} to answer from the photo/PDF.`
              : `Gemini used ${prepared.extraCredits} credit${prepared.extraCredits === 1 ? "" : "s"} to read the photos/PDFs.`,
          });
        }
      }
      if (!gotDirectAnswer) composePromptWithAttachments(displayText, attachmentContext);
    } catch (err) {
      const dataError = (err as { data?: { error?: string } })?.data?.error;
      const promptTooLong = err instanceof Error && err.message.includes("exceed 10,000 characters");
      toast({
        title: promptTooLong
          ? "Prompt is too long"
          : answerAttachmentQuestion ? "Could not answer that" : "Could not read attached files",
        description: dataError ?? (err instanceof Error ? err.message : getAiFailureMessage(err, "Please try again.")),
        variant: "destructive",
      });
      return;
    } finally {
      setIsPreparingAttachments(false);
    }

    setInput("");
    if (answerAttachmentQuestion) {
      setInteractionMode("ask");
      if (gotDirectAnswer) {
        addMsg({
          type: "user",
          content: promptText,
          attachmentNames,
        });
        setCurrentModel(directModel);
        addMsg({ type: "info", content: directReply });
        await clearInputAttachmentDraft();
      } else if (await handleAsk(displayText, attachmentContext, attachmentNames)) {
        await clearInputAttachmentDraft();
      }
      return;
    }

    const succeeded = interactionMode === "ask"
      ? await handleAsk(displayText, attachmentContext, attachmentNames)
      : await runPipeline(displayText, attachmentContext, attachmentNames);
    if (succeeded) await clearInputAttachmentDraft();
  };

  const handleDownloadZip = async () => {
    if (!files || files.length === 0) {
      toast({ title: "No files to download", description: "Generate some code first.", variant: "destructive" });
      return;
    }
    const zip = new JSZip();
    const exportable = project?.mode === "fullstack"
      ? collectExportFiles(files, project.name)
      : files;
    const unsafeFile = exportable.find(file => !normalizeSafeZipPath(file.path));
    if (unsafeFile) {
      toast({
        title: "ZIP export stopped for safety",
        description: `The file path "${unsafeFile.path}" is unsafe. Remove or rename it before exporting.`,
        variant: "destructive",
      });
      return;
    }
    for (const file of exportable) {
      const safePath = normalizeSafeZipPath(file.path);
      if (!safePath) return;
      zip.file(safePath, file.content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.name ?? "era-project"}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded!", description: `${exportable.length} file(s) saved as ZIP.` });
  };

  const handleFileSelect = (file: ProjectFile) => {
    setActiveFile(file); setFileContent(file.content); setUnsaved(false); setMobileFilesOpen(false);
  };

  const handleSaveFile = async () => {
    if (!activeFile || !unsaved) return;
    await upsertFile.mutateAsync({ id: projectId, data: { path: activeFile.path, content: fileContent, language: activeFile.language } });
    setUnsaved(false);
    queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) });
    toast({ title: "Saved" });
  };

  if (projectLoading) return (
    <div className="flex flex-col h-full">
      <div className="era-tab-bar h-11 flex items-center px-4"><Skeleton className="h-5 w-40" /></div>
      <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
    </div>
  );

  if (!project) return (
    <div className="flex flex-col h-full items-center justify-center gap-3">
      <p className="text-muted-foreground">Project not found</p>
      <button onClick={() => setLocation("/")} className="text-sm text-primary hover:underline flex items-center gap-1">
        <Home className="w-3.5 h-3.5" /> Go Home
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ── */}
      <div className="era-tab-bar grid h-14 shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 px-3 sm:px-5">
        <div className="flex justify-start">
          <button
            onClick={() => setLocation("/")}
            aria-label="Go to Home"
            title="Home"
            className="rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <Home className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-w-0 max-w-[60vw] items-center justify-center">
          <button
            onClick={() => setView("chat")}
            aria-label={`Return to chat for ${project.name}`}
            className="min-w-0 rounded-l-lg px-3 py-2 text-left text-base font-semibold text-foreground transition-colors hover:bg-white/5"
          >
            <span className="block truncate">{project.name}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Open project menu"
                title="Project menu"
                className="rounded-r-lg p-2.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" sideOffset={8} className="w-64">
              <DropdownMenuLabel className="truncate text-sm">{project.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setView("plan")} className="py-2.5 text-sm">
                <ListChecks className="h-4 w-4" /> Plan
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setView("code")} className="py-2.5 text-sm">
                <Code2 className="h-4 w-4" /> Code
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setView("security")} className="py-2.5 text-sm">
                <ShieldCheck className="h-4 w-4" /> Security
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setView("deploy")} className="py-2.5 text-sm">
                <Rocket className="h-4 w-4" /> Deploy
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled className="py-2.5 text-sm">
                <Zap className="h-4 w-4 text-yellow-400" />
                <span>Credits</span>
                <span className="ml-auto font-semibold text-foreground">{credits}</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="py-2.5 text-sm">
                <Cpu className="h-4 w-4" />
                <span className="truncate">
                  {pipelineStep !== "idle" || aiChat.isPending || aiPlan.isPending || aiSecurity.isPending
                    ? "Automatic · trying available models"
                    : currentModel
                      ? `Last response: ${currentModel}`
                      : "Automatic · best available model"}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => setView("preview")}
            aria-label="Open Preview"
            title="Preview"
            className={cn(
              "rounded-lg p-2.5 transition-colors hover:bg-white/5",
              view === "preview" ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Eye className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden flex">

        {/* Chat */}
        {view === "chat" && (
          <div className="flex flex-col flex-1 overflow-hidden era-chat-bg">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 sm:pt-8 scrollbar-thin">
              {messages.length === 0 && pipelineStep === "idle" ? (
                <div className="flex flex-col items-center justify-center h-full text-center pb-8 px-4">
                  <div className="w-12 h-12 rounded-full bg-green-600/10 border border-green-600/20 flex items-center justify-center mb-4">
                    <Sparkles className="w-5 h-5 text-green-400" />
                  </div>
                  <h2 className="text-lg font-medium mb-2">What do you want to build?</h2>
                  <p className="text-sm text-muted-foreground max-w-xs mb-2">ERA builds multi-page websites and runs:</p>
                  <div className="flex flex-col items-center gap-1 mb-6 text-xs">
                    <span className="text-purple-400 flex items-center gap-1.5"><Palette className="w-3 h-3" />Planning design</span>
                    <span className="text-green-400 flex items-center gap-1.5"><Sparkles className="w-3 h-3" />Generating website</span>
                    <span className="text-blue-400 flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" />Testing website</span>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center max-w-md">
                    {["Add navigation bar", "Create contact form", "Make it responsive", "Add a team page", "Add pricing section"].map((s, i) => (
                      <button key={i} onClick={() => setInput(s)}
                        className="text-xs text-muted-foreground hover:text-foreground bg-secondary hover:bg-secondary/80 px-3 py-1.5 rounded-full transition-colors border border-border/40">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto w-full pb-4">
                  {messages.map(msg => {
                    if (msg.type === "user") return <UserMessage key={msg.id} msg={msg} userColor={user.avatarColor} userLetter={user.avatarLetter} />;
                    if (msg.type === "code") return <CodeMessage key={msg.id} msg={msg} isLatest={msg.id === latestCodeMsgId} />;
                    if (msg.type === "test") return <TestCard key={msg.id} msg={msg} />;
                    if (msg.type === "design") return <DesignCard key={msg.id} msg={msg} />;
                    return (
                      <InfoMessage
                        key={msg.id}
                        msg={msg}
                        isLatest={msg.id === latestCodeMsgId}
                        onRetry={msg.retryPrompt && !isBusy
                          ? () => msg.retryMode === "ask"
                            ? void handleAsk(msg.retryPrompt!, msg.retryAttachmentContext, msg.retryAttachmentNames)
                            : void runPipeline(msg.retryPrompt!, msg.retryAttachmentContext, msg.retryAttachmentNames)
                          : undefined}
                      />
                    );
                  })}
                  <PipelineBar step={pipelineStep} progress={generationProgress} elapsedSeconds={elapsedSeconds} />
                </div>
              )}
            </div>

            {/* Input */}
            <div className="shrink-0 px-3 sm:px-4 pb-3 sm:pb-4 pt-2 border-t border-border/50">
              <div className="max-w-2xl mx-auto">
                {credits < 15 && (
                  <p className="text-[11px] text-yellow-400 mb-1.5 flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Only {credits} credits left
                  </p>
                )}
                <div className="era-input-bg rounded-xl p-3">
                  <div className="flex items-center gap-1 mb-2">
                    <button
                      onClick={() => setInteractionMode("build")}
                      className={cn(
                        "text-[11px] px-2 py-1 rounded-md transition-colors",
                        interactionMode === "build" ? "bg-green-500/15 text-green-300" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Build
                    </button>
                    <button
                      onClick={() => setInteractionMode("ask")}
                      className={cn(
                        "flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors",
                        interactionMode === "ask" ? "bg-blue-500/15 text-blue-300" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <MessageCircle className="w-3 h-3" /> Ask ERA
                    </button>
                  </div>
                  <PromptAttachmentFiles
                    files={inputAttachments}
                    onFilesChange={handleInputAttachmentsChange}
                    disabled={isRestoringAttachments || isBusy || isPreparingAttachments}
                  />
                  <textarea
                    className="w-full bg-transparent text-foreground placeholder:text-muted-foreground resize-none outline-none text-sm leading-relaxed min-h-[52px] max-h-[160px]"
                    placeholder={isWorking ? "ERA is working…" : interactionMode === "ask" ? "Ask ERA a web development question…" : "Tell ERA what to build or change…"}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    disabled={isRestoringAttachments || isBusy || isPreparingAttachments}
                  />
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                      <PromptAttachmentButton
                        files={inputAttachments}
                        onFilesChange={handleInputAttachmentsChange}
                        disabled={isRestoringAttachments || isBusy || isPreparingAttachments}
                      />
                      <span className="min-w-0 truncate">
                        {isRestoringAttachments ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" /> Restoring attached files…
                          </span>
                        ) : isPreparingAttachments ? (
                          <span className="flex items-center gap-1 text-purple-300">
                            <Loader2 className="w-3 h-3 animate-spin" /> ERA is reading attachments…
                          </span>
                        ) : pipelineStep !== "idle" ? (
                          <span className={cn("flex items-center gap-1", STEP_META[pipelineStep].color)}>
                            <Loader2 className="w-3 h-3 animate-spin" />{STEP_META[pipelineStep].label}
                          </span>
                        ) : isChatBusy ? (
                          <span className="flex items-center gap-1 text-blue-300">
                            <Loader2 className="w-3 h-3 animate-spin" /> ERA is thinking…
                          </span>
                        ) : "Use the send button to submit"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isBusy ? (
                        <button
                          onClick={handleStop}
                          title="Stop request"
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all"
                        >
                          <X className="w-3 h-3" />
                          Stop
                        </button>
                      ) : (
                        <VoiceInputButton
                          onTranscript={transcript => setInput(current => appendRecognizedText(current, transcript))}
                          disabled={isPreparingAttachments}
                        />
                      )}
                      <button onClick={() => void handleSend()} disabled={(!input.trim() && inputAttachments.length === 0) || isRestoringAttachments || isBusy || isPreparingAttachments}
                        className={cn("w-7 h-7 rounded-full flex items-center justify-center transition-all",
                          (input.trim() || inputAttachments.length > 0) && !isBusy && !isPreparingAttachments ? "bg-green-500 text-black hover:bg-green-400" : "bg-secondary text-muted-foreground cursor-not-allowed"
                        )}>
                        {isBusy || isPreparingAttachments ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Plan */}
        {view === "plan" && (
          <div className="flex-1 overflow-y-auto era-chat-bg px-4 sm:px-6 py-6 sm:py-8">
            <div className="max-w-3xl mx-auto">
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <ListChecks className="w-5 h-5 text-purple-400" />
                  <h2 className="text-lg font-medium">Plan your website</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Ask ERA to outline the architecture, technology choices, and files before you generate code.
                </p>
              </div>

              <div className="era-input-bg rounded-xl p-3 mb-6">
                <PromptAttachmentBadges names={homePlanAttachmentNames} />
                <PromptAttachmentFiles
                  files={planAttachments}
                  onFilesChange={setPlanAttachments}
                  disabled={isRestoringAttachments || aiPlan.isPending || isPreparingAttachments}
                />
                <textarea
                  className="w-full bg-transparent text-foreground placeholder:text-muted-foreground resize-none outline-none text-sm leading-relaxed min-h-[84px]"
                  placeholder={`What should ${project.name} include?`}
                  value={planPrompt}
                  onChange={e => setPlanPrompt(e.target.value)}
                  disabled={isRestoringAttachments || aiPlan.isPending || isPreparingAttachments}
                />
                <div className="flex items-center justify-between mt-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <PromptAttachmentButton
                      files={planAttachments}
                      onFilesChange={setPlanAttachments}
                      disabled={isRestoringAttachments || aiPlan.isPending || isPreparingAttachments}
                    />
                    <span className="truncate text-[10px] text-muted-foreground">
                      {isRestoringAttachments ? "Restoring files…" : "Planning does not change project files"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <VoiceInputButton
                      onTranscript={transcript => setPlanPrompt(current => appendRecognizedText(current, transcript))}
                      disabled={isRestoringAttachments || aiPlan.isPending || isPreparingAttachments}
                    />
                    <button
                      onClick={() => void handlePlan()}
                      disabled={isRestoringAttachments || aiPlan.isPending || isPreparingAttachments}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500 text-white hover:bg-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {aiPlan.isPending || isPreparingAttachments ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListChecks className="w-3 h-3" />}
                      {isPreparingAttachments ? "Reading files…" : aiPlan.isPending ? "Planning…" : "Create plan"}
                    </button>
                  </div>
                </div>
              </div>

              {aiPlan.isPending && (
                <div className="flex items-center justify-center gap-2 text-sm text-purple-300 py-10">
                  <Loader2 className="w-4 h-4 animate-spin" /> ERA is preparing your plan…
                </div>
              )}
              {!aiPlan.isPending && planResult && (
                <PlanCard result={planResult} onCreate={handleCreateFromPlan} busy={isBusy} />
              )}
              {!aiPlan.isPending && !planResult && (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  Your implementation plan will appear here.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Security */}
        {view === "security" && (
          <div className="flex-1 overflow-y-auto era-chat-bg px-4 sm:px-6 py-6 sm:py-8">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-5 h-5 text-green-400" />
                    <h2 className="text-lg font-medium">Security scan</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Review the current project files for common security vulnerabilities before sharing or deploying.
                  </p>
                </div>
                <button
                  onClick={() => void handleSecurityScan()}
                  disabled={aiSecurity.isPending || !files || files.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {aiSecurity.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                  {aiSecurity.isPending ? "Scanning…" : "Run scan"}
                </button>
              </div>

              <div className="text-xs text-muted-foreground mb-5">
                {files?.length ?? 0} project file{(files?.length ?? 0) === 1 ? "" : "s"} available for scanning.
              </div>
              {aiSecurity.isPending && (
                <div className="flex items-center justify-center gap-2 text-sm text-green-300 py-10">
                  <Loader2 className="w-4 h-4 animate-spin" /> ERA is scanning your code…
                </div>
              )}
              {!aiSecurity.isPending && securityResult && (
                <SecurityCard result={securityResult} onFixAll={handleFixSecurityIssues} busy={isBusy} />
              )}
              {!aiSecurity.isPending && !securityResult && (
                <div className="rounded-xl border border-border bg-card/50 text-center py-12 text-sm text-muted-foreground">
                  Run a scan to see security findings for this project.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Code */}
        {view === "code" && (
          <div className="flex flex-1 overflow-hidden">
            {/* Desktop file tree */}
            <div className="hidden sm:flex w-52 bg-card border-r border-border flex-col shrink-0">
              <div className="px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border flex items-center justify-between">
                <span>Files</span>
                {filesLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              </div>
              <div className="flex-1 overflow-auto">
                <FileTree files={files || []} activeFile={activeFile} onSelect={handleFileSelect} projectId={projectId} />
              </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Mobile top bar */}
              <div className="sm:hidden h-9 border-b border-border bg-card flex items-center px-3 gap-2 shrink-0">
                <button onClick={() => setMobileFilesOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[160px]">{activeFile ? activeFile.path : "Files"}</span>
                  {unsaved && <span className="text-yellow-400">●</span>}
                </button>
                {unsaved && (
                  <button onClick={handleSaveFile} disabled={upsertFile.isPending} className="ml-auto text-xs text-primary">
                    {upsertFile.isPending ? "Saving…" : "Save"}
                  </button>
                )}
              </div>

              {/* Desktop file header */}
              {activeFile && (
                <div className="hidden sm:flex h-9 border-b border-border bg-card items-center justify-between px-4 shrink-0">
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {activeFile.path}{unsaved && <span className="text-yellow-400 ml-1">●</span>}
                  </span>
                  {unsaved && (
                    <button onClick={handleSaveFile} disabled={upsertFile.isPending} className="text-xs text-primary ml-2 shrink-0">
                      {upsertFile.isPending ? "Saving…" : "Save"}
                    </button>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-hidden">
                {activeFile ? (
                  <CodeEditor content={fileContent} onChange={c => { setFileContent(c); setUnsaved(c !== activeFile.content); }} language={activeFile.language} />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    {filesLoading ? "Loading files…" : "Select a file to edit"}
                  </div>
                )}
              </div>
            </div>

            {/* Mobile files sheet */}
            <Sheet open={mobileFilesOpen} onOpenChange={setMobileFilesOpen}>
              <SheetContent side="left" className="w-64 p-0">
                <SheetHeader className="px-4 py-3 border-b border-border">
                  <SheetTitle className="text-sm">Project Files</SheetTitle>
                </SheetHeader>
                <div className="overflow-auto h-full pb-20">
                  <FileTree files={files || []} activeFile={activeFile} onSelect={handleFileSelect} projectId={projectId} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        )}

        {view === "preview" && <div className="flex-1 overflow-hidden">{project?.mode === "fullstack" ? (
          <WorkspacePanel
            projectId={projectId}
            onFixWithEra={prompt => {
              setInteractionMode("build");
              setInput(prompt);
              setView("chat");
            }}
          />
        ) : <PreviewPanel files={files || []} />}</div>}

        {view === "deploy" && (
          <div className="flex-1 flex items-center justify-center flex-col gap-6 text-center px-6">
            <div className="w-14 h-14 rounded-full bg-green-600/10 border border-green-600/20 flex items-center justify-center">
              <Download className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground mb-1">Export your project</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Download all {files?.length ?? 0} file{(files?.length ?? 0) !== 1 ? "s" : ""} as a ZIP archive.
              </p>
            </div>
            <button
              onClick={handleDownloadZip}
              disabled={!files || files.length === 0}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all",
                files && files.length > 0
                  ? "bg-green-600 text-white hover:bg-green-500"
                  : "bg-secondary text-muted-foreground cursor-not-allowed"
              )}
            >
              <Download className="w-4 h-4" />
              Download ZIP
            </button>
            <div className="mt-4 text-center">
              <p className="text-xs text-muted-foreground/60">Hosting &amp; custom domain coming soon</p>
              <div className="flex items-center justify-center gap-2 mt-2 opacity-40">
                <Rocket className="w-4 h-4" />
                <span className="text-xs">One-click deploy</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
