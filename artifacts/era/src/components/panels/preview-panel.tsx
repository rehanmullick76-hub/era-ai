import React, { useState, useEffect, useRef, useCallback } from "react";
import { ProjectFile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { injectPreviewScript, normalizePreviewPath } from "@/lib/preview-navigation";
import { inlinePreviewAssets } from "@/lib/preview-assets";

interface PreviewPanelProps {
  files: ProjectFile[];
}

/**
 * Build the nav interceptor script with the parent origin injected at render time.
 * The origin is embedded as a literal string so the sandboxed iframe (which cannot
 * read window.parent.location) can still address postMessage to the correct target.
 * We keep the fallback '*' only when the parent origin is genuinely unavailable.
 */
function buildNavInterceptor(parentOrigin: string, navigationNonce: string, currentPage: string): string {
  const safeOrigin = JSON.stringify(parentOrigin);
  const safeNonce = JSON.stringify(navigationNonce);
  return `
<script>
(function() {
  var TARGET_ORIGIN = ${safeOrigin};
  var NAVIGATION_NONCE = ${safeNonce};
  var normalizePath = ${normalizePreviewPath.toString()};
  function intercept(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el) return;
    var href = el.getAttribute('href');
    if (!href) return;
    var path = normalizePath(href, ${JSON.stringify(currentPage)});
    if (path) {
      e.preventDefault();
      window.parent.postMessage({ type: 'era-navigate', path: path, nonce: NAVIGATION_NONCE }, TARGET_ORIGIN);
      return;
    }
  }
  document.addEventListener('click', intercept, true);
})();
</script>
`;
}

export function PreviewPanel({ files }: PreviewPanelProps) {
  const [currentPage, setCurrentPage] = useState("index.html");
  const [navigationHistory, setNavigationHistory] = useState<string[]>(["index.html"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [srcDoc, setSrcDoc] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigationNonceRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
  );
  const navigationHistoryRef = useRef(["index.html"]);
  const historyIndexRef = useRef(0);

  const navigateToPage = useCallback((page: string) => {
    const index = historyIndexRef.current;
    if (navigationHistoryRef.current[index] === page) return;
    const nextHistory = [...navigationHistoryRef.current.slice(0, index + 1), page];
    navigationHistoryRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setNavigationHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setCurrentPage(page);
  }, []);

  const navigateHistory = useCallback((direction: -1 | 1) => {
    const nextIndex = historyIndexRef.current + direction;
    if (nextIndex < 0 || nextIndex >= navigationHistoryRef.current.length) return;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    setCurrentPage(navigationHistoryRef.current[nextIndex]);
  }, []);

  const htmlFiles = files.filter(f => f.path.endsWith(".html")).sort((a, b) => {
    if (a.path === "index.html") return -1;
    if (b.path === "index.html") return 1;
    return a.path.localeCompare(b.path);
  });

  const renderPage = useCallback((pagePath: string, allFiles: ProjectFile[]) => {
    setError(null);
    const target = allFiles.find(f => f.path === pagePath) ??
      allFiles.find(f => f.path === "index.html") ??
      allFiles.filter(f => f.path.toLowerCase().endsWith(".html"))
        .sort((a, b) => a.path.localeCompare(b.path))[0];
    if (!target) {
      setError("No index.html found. Generate a website to see the preview.");
      setSrcDoc("");
      return;
    }
    try {
      const navInterceptor = buildNavInterceptor(window.location.origin, navigationNonceRef.current, target.path);
      const htmlWithNavigation = injectPreviewScript(target.content, navInterceptor);
      const html = inlinePreviewAssets(htmlWithNavigation, allFiles, target.path);
      setSrcDoc(html);
      // Mount only a complete document, with a fresh browsing context on
      // render/reload. Reusing an initially empty iframe can leave a stale
      // zero-sized document layout in embedded browser previews.
      setPreviewRevision(revision => revision + 1);
    } catch (err: any) {
      setError(`Preview error: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    if (files.length === 0) {
      setSrcDoc("");
      setCurrentPage("index.html");
      navigationHistoryRef.current = ["index.html"];
      historyIndexRef.current = 0;
      setNavigationHistory(["index.html"]);
      setHistoryIndex(0);
      setError("No files to preview. Generate a website to get started.");
      return;
    }
    const defaultPage = files.find(f => f.path === "index.html")?.path ??
      files.filter(f => f.path.toLowerCase().endsWith(".html"))
        .sort((a, b) => a.path.localeCompare(b.path))[0]?.path ??
      "index.html";
    const pageExists = files.some(f => f.path === currentPage);
    const page = pageExists ? currentPage : defaultPage;
    if (page !== currentPage) {
      setCurrentPage(page);
      navigationHistoryRef.current = [page];
      historyIndexRef.current = 0;
      setNavigationHistory([page]);
      setHistoryIndex(0);
    }
    renderPage(page, files);
  }, [files, currentPage]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
       if (e.source !== iframeRef.current?.contentWindow) return;
       if (e.origin !== window.location.origin && e.origin !== "null") return;
       if (
         e.data?.type === "era-navigate" &&
         e.data.nonce === navigationNonceRef.current &&
         typeof e.data.path === "string"
       ) {
        const target = normalizePreviewPath(`/${e.data.path}`);
        if (!target) return;
        const exists = files.some(f => f.path === target);
        if (exists) {
          navigateToPage(target);
        } else {
          setError(`Page "${target}" not found in project files.`);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [files, navigateToPage]);

  const openInNewTab = () => {
    if (!srcDoc) return;
    // The outer document owns every page; generated code stays in an opaque
    // sandbox and can navigate without depending on the original app tab.
    const pages = Object.fromEntries(htmlFiles.map(file => [
      file.path,
      inlinePreviewAssets(
        injectPreviewScript(
          file.content,
          buildNavInterceptor("*", navigationNonceRef.current, file.path),
        ),
        files,
        file.path,
      ),
    ]));
    const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
    const standalone = `<!doctype html><html><head><title>ERA Preview</title>
      <style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style></head>
      <body><iframe sandbox="allow-scripts allow-forms allow-popups" title="Website preview"></iframe>
      <script>
      const pages=${safeJson(pages)};
      const frame=document.querySelector('iframe');
      frame.srcdoc=pages[${safeJson(currentPage)}]||Object.values(pages)[0]||'';
      window.addEventListener('message',function(event){
        if(event.source!==frame.contentWindow || event.data?.type!=='era-navigate' ||
          event.data.nonce!==${safeJson(navigationNonceRef.current)}) return;
        const page=pages[event.data.path];
        if(typeof page==='string') frame.srcdoc=page;
      });
      </script></body></html>`;
    const blob = new Blob([standalone], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  function pageName(path: string) {
    return path.replace(".html", "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || path;
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Browser chrome */}
      <div className="bg-card border-b border-border shrink-0">
        {/* URL bar row */}
        <div className="flex items-center justify-between px-3 py-2 gap-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex gap-1">
              <div className="w-3 h-3 rounded-full bg-red-500/40 border border-red-500/60" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/40 border border-yellow-500/60" />
              <div className="w-3 h-3 rounded-full bg-green-500/40 border border-green-500/60" />
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"
              title="Back" aria-label="Back" disabled={historyIndex === 0}
              onClick={() => navigateHistory(-1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"
              title="Next" aria-label="Next" disabled={historyIndex >= navigationHistory.length - 1}
              onClick={() => navigateHistory(1)}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="flex-1 bg-background border border-border rounded-md flex items-center gap-1.5 px-2.5 py-1 min-w-0">
            <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-xs font-mono text-muted-foreground truncate">
              era.app/{currentPage}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => renderPage(currentPage, files)} title="Reload">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openInNewTab} title="Open in new tab">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Page tabs — only show when multiple HTML pages */}
        {htmlFiles.length > 1 && (
          <div className="flex items-center gap-0.5 px-2 pb-1.5 overflow-x-auto scrollbar-none">
            {htmlFiles.map(f => (
              <button
                key={f.path}
                onClick={() => navigateToPage(f.path)}
                className={cn(
                  "px-3 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors shrink-0",
                  currentPage === f.path
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                {pageName(f.path)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* iframe area */}
      <div className="flex-1 overflow-hidden bg-white">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground bg-background">
            <Globe className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-foreground font-medium text-sm mb-1">{error}</p>
            <p className="text-xs">Describe what you want to build in the Chat tab.</p>
            <Button variant="outline" className="mt-3" onClick={() => renderPage(currentPage, files)}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Reload Preview
            </Button>
          </div>
        ) : srcDoc ? (
          <iframe
            ref={iframeRef}
            key={previewRevision}
            srcDoc={srcDoc}
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-forms allow-popups"
            title="Preview"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground bg-background">
            Preparing preview…
          </div>
        )}
      </div>
    </div>
  );
}
