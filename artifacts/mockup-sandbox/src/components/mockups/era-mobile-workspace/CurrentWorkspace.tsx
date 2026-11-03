import "./_group.css";

const logs = `added 80 packages in 4s
npm notice
npm notice New major version of npm available! 10.9.2 -> 12.2.1
npm notice To update run: npm install -g npm@12.2.1
npm notice
npm notice`;

export function CurrentWorkspace() {
  return (
    <main className="era-workspace-prototype min-h-screen bg-background text-foreground">
      <div className="flex h-screen min-h-[700px] flex-col overflow-hidden md:flex-row">
        <aside className="max-h-[50%] shrink-0 space-y-4 overflow-y-auto border-b border-border p-4 md:max-h-none md:w-[340px] md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Full-stack workspace</p>
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-300">Failed</span>
          </div>

          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Phase: <span className="text-foreground">Operation failed</span></p>
            <p>◉ Database: <span className="text-foreground">provisioned</span></p>
          </div>

          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
            <span className="shrink-0">!</span>
            <span>Unsafe migration: trial migrations allow additive schema changes only. Existing data was not reset.</span>
          </div>

          <p className="text-xs text-muted-foreground">After generating or editing code, use Rebuild to apply saved changes. Existing database records are preserved.</p>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg bg-green-500 px-3 py-2 text-xs font-medium text-black">↻ Retry build</button>
          </div>

          <section>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Logs</p>
            <pre className="h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/80">{logs}</pre>
          </section>

          <div className="space-y-1 rounded-lg border border-border bg-secondary/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">ⓘ Free trial limits</p>
            <p>Runtimes stop after 10 minutes and are suspended after 5 minutes idle. Nothing starts automatically; you must press Build or Start.</p>
            <p>Provisioning is capped per user and across all users during the trial.</p>
          </div>

          <button className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300">Delete workspace</button>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col bg-background">
          <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
            <span className="text-muted-foreground">◎</span>
            <span className="flex-1 truncate text-xs text-muted-foreground">Private preview</span>
            <button className="rounded-lg border border-border px-3 py-2 text-xs">↻ Load preview</button>
          </header>
          <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
            <span className="text-2xl opacity-40">◎</span>
            <p className="font-medium text-foreground">Workspace is not running</p>
            <p className="max-w-xs text-xs">Build or start the workspace, then load the preview.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
