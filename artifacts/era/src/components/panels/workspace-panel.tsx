import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWorkspace,
  useGetRuntimeCapabilities,
  useControlWorkspace,
  useCreateWorkspacePreview,
  getGetWorkspaceQueryKey,
  type WorkspaceControl,
} from "@workspace/api-client-react";
import { Loader2, Play, Square, RotateCcw, Hammer, RefreshCw, Trash2, Database, Globe, AlertTriangle, Info, Terminal, Sparkles, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildWorkspaceFixPrompt, explainWorkspaceLogs } from "@/lib/workspace-log-help";

function errMsg(e: unknown, fallback: string): string {
  const d = e && typeof e === "object" ? (e as { data?: unknown }).data : null;
  if (d && typeof d === "object" && "error" in d && typeof (d as { error: unknown }).error === "string") return (d as { error: string }).error;
  return fallback;
}

const BUSY = ["queued", "provisioning", "building", "deleting"];
const STATE_STYLE: Record<string, string> = {
  running: "text-green-300 border-green-500/30 bg-green-500/10",
  failed: "text-red-300 border-red-500/30 bg-red-500/10",
  stopped: "text-muted-foreground border-border bg-secondary",
  unprovisioned: "text-muted-foreground border-border bg-secondary",
};

export function WorkspacePanel({
  projectId,
  onFixWithEra,
}: {
  projectId: string;
  onFixWithEra: (prompt: string) => void;
}) {
  const qc = useQueryClient();
  const { data: ws, isLoading, isFetching, error, refetch } = useGetWorkspace(projectId, {
    query: { queryKey: getGetWorkspaceQueryKey(projectId), refetchInterval: 5000 },
  });
  const { data: runtimeCapabilities } = useGetRuntimeCapabilities({
    query: { refetchInterval: 60_000, staleTime: 30_000 },
  });
  const control = useControlWorkspace();
  const createPreview = useCreateWorkspacePreview();
  const [preview, setPreview] = useState<{ url: string; expiresAt: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ack, setAck] = useState(false);
  const [mobileTab, setMobileTab] = useState<"workspace" | "logs" | "preview">("workspace");
  const logRef = useRef<HTMLPreElement>(null);
  const autoActionKeyRef = useRef<string | null>(null);
  const autoPreviewKeyRef = useRef<string | null>(null);
  const runningProjectRef = useRef<string | null>(null);
  const stopMutationRef = useRef(control.mutate);

  const state = ws?.state ?? "unprovisioned";
  const busy = BUSY.includes(state) || control.isPending;
  if (state === "running") runningProjectRef.current = projectId;
  else if (!busy && !actionError && ["stopped", "deleted", "failed", "unprovisioned"].includes(state) && runningProjectRef.current === projectId) {
    runningProjectRef.current = null;
  }
  stopMutationRef.current = control.mutate;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [ws?.logs, mobileTab]);

  // Drop the preview when the runtime is no longer running.
  useEffect(() => {
    if (state !== "running") setPreview(null);
  }, [state]);

  useEffect(() => {
    if (!isFullscreenPreview) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreenPreview(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFullscreenPreview]);

  useEffect(() => {
    if (!preview) setIsFullscreenPreview(false);
  }, [preview]);

  const run = async (data: WorkspaceControl) => {
    setActionError(null);
    if (data.action === "start" || data.action === "restart" || data.action === "rebuild") {
      // Keep a stop-on-close handle even while the server is still building.
      runningProjectRef.current = projectId;
    }
    try {
      const next = await control.mutateAsync({ id: projectId, data });
      qc.setQueryData(getGetWorkspaceQueryKey(projectId), next);
      void qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(projectId) });
      if (data.action !== "start" && data.action !== "restart" && data.action !== "rebuild") setPreview(null);
    } catch (e) {
      setActionError(errMsg(e, "That action could not be completed."));
    }
  };

  const loadPreview = async () => {
    setPreviewError(null);
    try {
      setPreview(await createPreview.mutateAsync({ id: projectId }));
    } catch (e) {
      setPreviewError(errMsg(e, "Could not create a private preview link."));
    }
  };
  const runRef = useRef(run);
  runRef.current = run;
  const loadPreviewRef = useRef(loadPreview);
  loadPreviewRef.current = loadPreview;

  // The workspace panel is mounted only while the project Preview view is
  // open. Start an idle runtime, rebuild stale running source, then load its
  // private preview as soon as the deployed revision is current.
  useEffect(() => {
    if (!ws || busy || !ws.currentRevision) return;
    if (state === "running" && ws.revision === ws.currentRevision) {
      const key = `${projectId}:${ws.revision}`;
      if (autoPreviewKeyRef.current === key) return;
      autoPreviewKeyRef.current = key;
      void loadPreviewRef.current();
      return;
    }
    // A missing or expired free-trial funding attestation must never trigger
    // provider provisioning/build requests automatically.
    if (!runtimeCapabilities?.enabled) return;
    if (state === "unprovisioned" || state === "deleted" || state === "stopped") {
      const key = `${projectId}:start:${state}:${ws.currentRevision}`;
      if (autoActionKeyRef.current === key) return;
      autoActionKeyRef.current = key;
      void runRef.current({ action: "start" });
      return;
    }
    if (state === "running" && ws.revision !== ws.currentRevision) {
      const key = `${projectId}:rebuild:${ws.currentRevision}`;
      if (autoActionKeyRef.current === key) return;
      autoActionKeyRef.current = key;
      void runRef.current({ action: "rebuild" });
    }
  }, [projectId, state, busy, runtimeCapabilities?.enabled, ws?.currentRevision, ws?.revision]);

  // Leaving Preview or closing the project suspends the trial runtime.
  useEffect(() => () => {
    const runningProjectId = runningProjectRef.current;
    if (runningProjectId) {
      stopMutationRef.current({ id: runningProjectId, data: { action: "stop" } });
    }
  }, [projectId]);

  const btn = "flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50";
  const primary = "flex min-h-10 items-center gap-1.5 rounded-lg bg-green-500 px-3 py-2 text-xs font-medium text-black hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50";
  const logCount = ws?.logs?.trim() ? ws.logs.trim().split(/\r?\n/).length : 0;
  const logHelp = explainWorkspaceLogs([ws?.logs, ws?.error].filter(Boolean).join("\n"));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="panel-workspace">
      <div className="shrink-0 border-b border-border bg-card/80 px-2 py-2 md:hidden">
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-border/70 bg-background/70 p-1" role="group" aria-label="Workspace views">
          <button
            type="button"
            aria-pressed={mobileTab === "workspace"}
            onClick={() => setMobileTab("workspace")}
            className={cn("flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mobileTab === "workspace" ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground")}
          >
            <Hammer className="h-3.5 w-3.5" /> Workspace
          </button>
          <button
            type="button"
            aria-pressed={mobileTab === "logs"}
            onClick={() => setMobileTab("logs")}
            className={cn("flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mobileTab === "logs" ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground")}
          >
            <Terminal className="h-3.5 w-3.5" />
            Logs
            {logCount > 0 && <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] leading-none text-muted-foreground">{logCount}</span>}
          </button>
          <button
            type="button"
            aria-pressed={mobileTab === "preview"}
            onClick={() => setMobileTab("preview")}
            className={cn("flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mobileTab === "preview" ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground")}
          >
            <Globe className="h-3.5 w-3.5" /> Preview
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <aside className={cn(
        "min-h-0 w-full flex-1 flex-col overflow-y-auto scrollbar-thin border-border md:w-[340px] md:flex-none md:border-r",
        mobileTab === "preview" ? "hidden md:flex" : "flex",
      )}>
        <div className={cn("space-y-4 p-4", mobileTab === "logs" && "hidden md:block")}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">Full-stack workspace</p>
          {ws && (
            <span data-testid="status-workspace" className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", STATE_STYLE[state] ?? "text-yellow-300 border-yellow-500/30 bg-yellow-500/10")}>
              {state}
            </span>
          )}
        </div>

        {isLoading && <div className="h-16 animate-pulse rounded-lg bg-secondary" />}
        {error && !ws && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <p>{errMsg(error, "Could not load the workspace status.")}</p>
            <button className={cn(btn, "mt-2")} onClick={() => void refetch()}>Retry</button>
          </div>
        )}

        {ws && (
          <>
            {runtimeCapabilities && !runtimeCapabilities.enabled && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                {runtimeCapabilities.notice}
              </div>
            )}
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Phase: <span className="text-foreground">{ws.phase || "idle"}</span></p>
              <p className="flex items-center gap-1"><Database className="h-3 w-3" /> Database: <span className="text-foreground">{ws.databaseState}</span></p>
              {ws.revision && <p>Revision: <span className="font-mono text-foreground">{ws.revision.slice(0, 12)}</span></p>}
            </div>
            {ws.error && (
              <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p>{ws.error}</p>
                  <button className={cn(btn, "mt-2 border-red-400/30 text-red-200")} onClick={() => void run({ action: "restart" })}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restart Workspace
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {actionError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300" data-testid="text-action-error">
            <p>{actionError}</p>
            <button className={cn(btn, "mt-2 border-red-400/30 text-red-200")} onClick={() => void run({ action: "restart" })}>
              <RotateCcw className="h-3.5 w-3.5" /> Restart Workspace
            </button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Preview starts or updates this free-trial workspace automatically. Leaving Preview stops the runtime. Rebuild preserves existing database records.</p>

        <div className="flex flex-wrap gap-2">
          {(state === "unprovisioned" || state === "deleted") && (
            <button className={primary} disabled={busy} onClick={() => void run({ action: "start" })} data-testid="button-workspace-build">
              <Hammer className="h-3.5 w-3.5" /> Build workspace
            </button>
          )}
          {state === "stopped" && (
            <button className={primary} disabled={busy} onClick={() => void run({ action: "start" })} data-testid="button-workspace-start">
              <Play className="h-3.5 w-3.5" /> Start
            </button>
          )}
          {state === "failed" && (
            <>
              <button className={primary} disabled={busy} onClick={() => void run({ action: "rebuild" })} data-testid="button-workspace-retry">
                <RotateCcw className="h-3.5 w-3.5" /> Retry build
              </button>
              <button className={btn} disabled={busy} onClick={() => void run({ action: "stop" })} data-testid="button-workspace-stop-failed">
                <Square className="h-3.5 w-3.5" /> Stop runtime
              </button>
            </>
          )}
          {state === "running" && (
            <>
              <button className={btn} disabled={busy} onClick={() => void run({ action: "stop" })} data-testid="button-workspace-stop"><Square className="h-3.5 w-3.5" /> Stop</button>
              <button className={btn} disabled={busy} onClick={() => void run({ action: "restart" })} data-testid="button-workspace-restart"><RotateCcw className="h-3.5 w-3.5" /> Restart</button>
            </>
          )}
          {(state === "running" || state === "stopped") && (
            <button className={btn} disabled={busy} onClick={() => void run({ action: "rebuild" })} data-testid="button-workspace-rebuild"><Hammer className="h-3.5 w-3.5" /> Rebuild</button>
          )}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground self-center" />}
        </div>
        </div>

        <div className={cn("space-y-1 p-4 md:pt-0", mobileTab !== "logs" && "hidden md:block")}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Logs{logCount > 0 ? ` · ${logCount}` : ""}
            </p>
            <button
              type="button"
              className={cn(btn, "min-h-8 px-2.5 py-1")}
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Refresh workspace logs"
              title="Fetch the latest workspace status and logs"
              data-testid="button-refresh-workspace-logs"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {logHelp && (
            <div className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed" role="note" data-testid="workspace-log-help">
              <p className="font-medium text-amber-200">{logHelp.title}</p>
              <p className="mt-1 text-muted-foreground">{logHelp.explanation}</p>
              <p className="mt-1.5 text-foreground/80"><span className="font-medium">Try this:</span> {logHelp.nextStep}</p>
              <button
                type="button"
                className={cn(btn, "mt-2 min-h-9 border-green-500/30 text-green-200 hover:bg-green-500/10")}
                onClick={() => onFixWithEra(buildWorkspaceFixPrompt(ws?.logs ?? "", logHelp))}
                data-testid="button-fix-workspace-with-era"
              >
                <Sparkles className="h-3.5 w-3.5" /> Fix with ERA
              </button>
            </div>
          )}
          <pre ref={logRef} data-testid="text-workspace-logs" className="h-[58dvh] max-h-[560px] overflow-auto rounded-lg border border-border bg-black/30 p-3 text-[11px] leading-relaxed font-mono text-foreground/80 whitespace-pre-wrap break-words md:h-44">
            {ws?.logs?.trim() || "No logs yet. Logs appear after you build the workspace."}
          </pre>
        </div>

        <div className={cn("space-y-4 p-4 pt-0", mobileTab === "logs" && "hidden md:block")}>
        <div className="rounded-lg border border-border bg-secondary/50 p-3 text-[11px] leading-relaxed text-muted-foreground space-y-1">
          <p className="flex items-center gap-1.5 font-medium text-foreground"><Info className="h-3 w-3" /> Trial workspace limits</p>
          <p>Runtimes stop after 10 minutes and are suspended after 5 minutes idle. Opening Preview starts or rebuilds the workspace when needed.</p>
          <p>Provisioning is capped per user and across all users during the trial.</p>
          <p>Running a workspace consumes provider resources. Daytona/Neon credits and billing follow your account settings; ERA does not check balances or change auto-top-up. The $5 ERA reservation cap is not a provider spending limit.</p>
        </div>

        <div className="border-t border-border pt-3">
          {!confirmDelete ? (
            <button className={cn(btn, "text-red-300 border-red-500/30 hover:bg-red-500/10")} disabled={busy || state === "unprovisioned" || state === "deleted"} onClick={() => { setConfirmDelete(true); setAck(false); }} data-testid="button-workspace-delete">
              <Trash2 className="h-3.5 w-3.5" /> Delete workspace
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <p>This removes the runtime and its database permanently. Your source files are kept.</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" data-testid="checkbox-confirm-data-loss" />
                <span>I understand all database data will be lost.</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button className={cn(btn, "bg-red-500/20")} disabled={!ack || control.isPending} onClick={async () => { await run({ action: "delete", confirmDataLoss: true }); setConfirmDelete(false); }} data-testid="button-confirm-delete-workspace">Delete runtime and database</button>
                <button className={btn} onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
        </div>
      </aside>

      <section className={cn(
        "min-h-0 flex-1 flex-col bg-background",
        isFullscreenPreview
          ? "fixed inset-0 z-[100] flex h-[100dvh] w-screen"
          : mobileTab === "preview" ? "flex" : "hidden md:flex",
      )}>
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 shrink-0">
          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {preview ? `Private preview, expires ${new Date(preview.expiresAt).toLocaleTimeString()}` : "Private preview"}
          </span>
          {preview && (
            <button
              type="button"
              className={cn(btn, "min-h-9 shrink-0 px-2 py-1.5 text-[11px]")}
              onClick={() => setIsFullscreenPreview(value => !value)}
              aria-label={isFullscreenPreview ? "Exit full screen preview" : "View preview full screen"}
              aria-pressed={isFullscreenPreview}
              title={isFullscreenPreview ? "Exit full screen (Esc)" : "View preview full screen"}
              data-testid="button-preview-fullscreen"
            >
              {isFullscreenPreview
                ? <Minimize2 className="h-3.5 w-3.5" />
                : <Maximize2 className="h-3.5 w-3.5" />}
              {isFullscreenPreview ? "Exit full screen" : "Full screen"}
            </button>
          )}
          <button className={cn(btn, "min-h-9 shrink-0 px-2 py-1.5 text-[11px]")} disabled={state !== "running" || createPreview.isPending} onClick={() => void loadPreview()} data-testid="button-preview-load">
            {createPreview.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {preview ? "Refresh" : "Load preview"}
          </button>
        </div>
        <div className="flex-1 min-h-0">
          {previewError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              <AlertTriangle className="h-6 w-6 text-red-400" />
              <p className="text-foreground">{previewError}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button className={primary} onClick={() => void run({ action: "restart" })}>
                  <RotateCcw className="h-3.5 w-3.5" /> Restart Workspace
                </button>
                <button className={btn} onClick={() => void loadPreview()}>Reload Preview</button>
              </div>
            </div>
          ) : createPreview.isPending && !preview ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating private link…</div>
          ) : preview ? (
            <iframe
              key={preview.url}
              src={preview.url}
              title="Full-stack preview"
              className="h-full w-full border-none bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms"
              referrerPolicy="no-referrer"
              data-testid="iframe-workspace-preview"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
              <Globe className="h-8 w-8 text-muted-foreground/30" />
              <p className="font-medium text-foreground">{state === "running" ? "Preview is idle" : "Workspace is not running"}</p>
              <p className="text-xs max-w-xs">
                {state === "running" ? "Load a short-lived private preview served from a separate origin." : "Build or start the workspace, then load the preview."}
              </p>
            </div>
          )}
        </div>
      </section>
      </div>
    </div>
  );
}
