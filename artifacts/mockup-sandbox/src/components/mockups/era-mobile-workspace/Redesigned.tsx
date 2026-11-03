import "./_group.css";
import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  Globe2,
  Hammer,
  Info,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
  X,
} from "lucide-react";

type WorkspaceState = "failed" | "building" | "deleted";
type MobileView = "workspace" | "logs" | "preview";

const initialLogs = [
  { time: "14:32:08", text: "Starting workspace build", tone: "normal" },
  { time: "14:32:09", text: "Provisioning runtime · eu-west-1", tone: "normal" },
  { time: "14:32:12", text: "Database provisioned successfully", tone: "success" },
  { time: "14:32:19", text: "Installing project dependencies", tone: "normal" },
  { time: "14:32:41", text: "Build failed: package script exited with code 1", tone: "error" },
  { time: "14:32:41", text: "Workspace is ready to retry", tone: "muted" },
];

export function Redesigned() {
  const [state, setState] = useState<WorkspaceState>("failed");
  const [mobileView, setMobileView] = useState<MobileView>("workspace");
  const [retrying, setRetrying] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState("");

  const runRetry = () => {
    if (retrying) return;
    setNotice("");
    setState("building");
    setRetrying(true);
    window.setTimeout(() => {
      setState("failed");
      setRetrying(false);
      setNotice("Build failed again. Review the latest log output and try once more.");
    }, 1500);
  };

  const deleteWorkspace = () => {
    if (!acknowledged) return;
    setState("deleted");
    setConfirmDelete(false);
    setNotice("Workspace runtime and database deleted. Source files are kept.");
  };

  return (
    <main className="era-workspace-prototype">
      <div className="era-ws-shell">
        <header className="era-ws-topbar">
          <div className="era-ws-brandmark" aria-hidden="true">E</div>
          <div className="era-ws-topcopy">
            <span className="era-ws-eyebrow">ERA <i>/</i> WORKSPACE</span>
            <span className="era-ws-project">Northstar Studio</span>
          </div>
          <span className="era-ws-private"><LockKeyhole size={12} /> Private</span>
        </header>

        <nav className="era-ws-switcher" role="group" aria-label="Workspace views">
          <button type="button" aria-pressed={mobileView === "workspace"} aria-controls="era-ws-workspace-panel" onClick={() => setMobileView("workspace")}>
            <Hammer size={15} /> <span>Workspace</span>
          </button>
          <button type="button" aria-pressed={mobileView === "logs"} aria-controls="era-ws-logs-panel" onClick={() => setMobileView("logs")}>
            <Server size={15} /> <span>Logs</span>
          </button>
          <button type="button" aria-pressed={mobileView === "preview"} aria-controls="era-ws-preview-panel" onClick={() => setMobileView("preview")}>
            <Globe2 size={15} /> <span>Preview</span>
          </button>
        </nav>

        <div className="era-ws-content">
          <section id="era-ws-workspace-panel" className={`era-ws-overview era-ws-mobile-panel ${mobileView === "workspace" ? "view-active" : ""}`} aria-label="Workspace status and actions">
            <div className="era-ws-heading-row">
              <div>
                <p className="era-ws-kicker">FULL-STACK ENVIRONMENT</p>
                <h1>Workspace</h1>
              </div>
              <span className={`era-ws-status ${state === "failed" ? "is-failed" : state === "building" ? "is-building" : "is-deleted"}`}>
                <span className="era-ws-status-dot" />
                {state === "failed" ? "Failed" : state === "building" ? "Building" : "Deleted"}
              </span>
            </div>

            {state === "failed" && (
              <div className="era-ws-failure">
                <div className="era-ws-failure-icon"><AlertTriangle size={16} /></div>
                <div className="era-ws-failure-copy">
                  <strong>Build did not complete</strong>
                  <span>Dependency install exited with code 1.</span>
                </div>
              </div>
            )}
            {state === "building" && (
              <div className="era-ws-progress">
                <LoaderCircle className="era-ws-spin" size={17} />
                <div><strong>Retrying build</strong><span>Applying saved project changes…</span></div>
              </div>
            )}
            {state === "deleted" && (
              <div className="era-ws-deleted-note"><Check size={16} /> Runtime and database removed</div>
            )}

            <div className="era-ws-facts">
              <div className="era-ws-fact">
                <span className="era-ws-fact-label">Phase</span>
                <span className="era-ws-fact-value">{state === "building" ? "building" : state === "deleted" ? "deleted" : "build"}</span>
              </div>
              <div className="era-ws-fact">
                <span className="era-ws-fact-label"><Database size={13} /> Database</span>
                <span className="era-ws-db-state"><span /> Provisioned</span>
              </div>
              <div className="era-ws-fact">
                <span className="era-ws-fact-label">Revision</span>
                <span className="era-ws-fact-value era-ws-revision">a84c29f10d6e</span>
              </div>
            </div>

            <div className="era-ws-actions">
              {state === "failed" && (
                <button className="era-ws-primary" onClick={runRetry} data-testid="button-workspace-retry">
                  <RotateCcw size={15} /> Retry build
                </button>
              )}
              {state === "building" && (
                <button className="era-ws-primary" disabled><LoaderCircle className="era-ws-spin" size={15} /> Building…</button>
              )}
              {state === "deleted" && (
                <button className="era-ws-primary" onClick={() => { setState("failed"); setNotice("Workspace can be rebuilt from your saved source files."); }}>
                  <Hammer size={15} /> Build workspace
                </button>
              )}
              <p>Rebuild applies saved code changes. Existing database records are preserved.</p>
            </div>

            {notice && <div className="era-ws-notice" role="status">{notice}</div>}
          </section>

          <section id="era-ws-logs-panel" className={`era-ws-logs-panel era-ws-mobile-panel ${mobileView === "logs" ? "view-active" : ""}`} aria-label="Build logs">
            <button className="era-ws-section-toggle" onClick={() => setLogsOpen(!logsOpen)} aria-expanded={logsOpen}>
              <span className="era-ws-section-title">
                <span className="era-ws-section-icon"><Server size={15} /></span>
                <span>Build logs<small>Latest attempt · 14:32</small></span>
              </span>
              <span className="era-ws-log-count">6 lines</span>
              {logsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {logsOpen && (
              <div className="era-ws-log-view" data-testid="text-workspace-logs">
                <div className="era-ws-log-toolbar">
                  <span><i /> LIVE OUTPUT</span>
                  <span>BUILD&nbsp; #18</span>
                </div>
                <div className="era-ws-log-lines">
                  {initialLogs.map((line) => (
                    <div className={`era-ws-log-line tone-${line.tone}`} key={line.time + line.text}>
                      <time>{line.time}</time><span className="era-ws-log-marker" /><span>{line.text}</span>
                    </div>
                  ))}
                </div>
                <div className="era-ws-log-end">END OF LOG</div>
              </div>
            )}
          </section>

          <section id="era-ws-preview-panel" className={`era-ws-preview era-ws-mobile-panel ${mobileView === "preview" ? "view-active" : ""}`} aria-label="Private preview">
            <div className="era-ws-preview-head">
              <div className="era-ws-preview-title">
                <span className="era-ws-section-icon"><Globe2 size={15} /></span>
                <span>Private preview<small>Short-lived · separate origin</small></span>
              </div>
              <button className="era-ws-refresh" disabled={state !== "failed"} title="Preview requires a running workspace" aria-label="Load private preview">
                <RefreshCw size={15} />
              </button>
            </div>
            <div className="era-ws-preview-empty">
              <div className="era-ws-preview-illustration">
                <div className="era-ws-browser-top"><i /><i /><i /><span /></div>
                <div className="era-ws-browser-body"><Globe2 size={21} /><span>Preview unavailable</span></div>
              </div>
              <strong>Workspace is not running</strong>
              <p>Retry the build first. Once running, you can load a private preview link.</p>
              <button className="era-ws-load-preview" disabled><Globe2 size={14} /> Load preview <span>Workspace offline</span></button>
            </div>
          </section>

          <aside className={`era-ws-trial era-ws-workspace-extra ${mobileView === "workspace" ? "view-active" : ""}`}>
            <Info size={15} />
            <div><strong>Free trial limits</strong><p>Runtimes stop after 10 minutes and are suspended after 5 minutes idle. Nothing starts automatically; press Build or Start. Provisioning is capped during the trial.</p></div>
          </aside>

          <footer className={`era-ws-danger era-ws-workspace-extra ${mobileView === "workspace" ? "view-active" : ""}`}>
            {!confirmDelete ? (
              <button className="era-ws-delete-link" disabled={state === "deleted"} onClick={() => { setConfirmDelete(true); setAcknowledged(false); }}>
                <Trash2 size={14} /> Delete workspace
              </button>
            ) : (
              <div className="era-ws-confirm">
                <div className="era-ws-confirm-title"><AlertTriangle size={16} /> Delete workspace?</div>
                <p>This removes the runtime and its database permanently. Your source files are kept.</p>
                <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I understand all database data will be lost.</label>
                <div className="era-ws-confirm-actions">
                  <button className="era-ws-delete-confirm" disabled={!acknowledged} onClick={deleteWorkspace}><Trash2 size={14} /> Delete runtime and database</button>
                  <button className="era-ws-cancel" onClick={() => setConfirmDelete(false)}><X size={14} /> Cancel</button>
                </div>
              </div>
            )}
            <span><Clock3 size={12} /> Workspace updates automatically</span>
          </footer>
        </div>
      </div>
      <style>{`
        .era-ws-shell{height:100dvh;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:#111312;color:#ededeb;font-family:"Geist",ui-sans-serif,system-ui,sans-serif}
        .era-ws-topbar{height:58px;display:flex;align-items:center;gap:11px;padding:0 18px;border-bottom:1px solid #292d2b;background:#141615}
        .era-ws-switcher{height:50px;flex:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:6px 12px;border-bottom:1px solid #292d2b;background:#141615}
        .era-ws-switcher button{min-width:0;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid transparent;border-radius:8px;background:transparent;color:#8d968f;font-size:11px;font-weight:600;cursor:pointer;transition:background .16s,color .16s,border-color .16s}
        .era-ws-switcher button[aria-pressed="true"]{border-color:#34453a;background:#202a23;color:#8ce5a8}
        .era-ws-switcher button:focus-visible{outline:2px solid #68d88e;outline-offset:1px}
        .era-ws-switcher button svg{flex:none}
        .era-ws-brandmark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#1d3024;color:#6ce398;font-size:15px;font-weight:750;letter-spacing:-.06em}
        .era-ws-topcopy{display:flex;flex-direction:column;gap:2px}
        .era-ws-eyebrow{font-size:9px;font-weight:700;letter-spacing:.16em;color:#737b75}
        .era-ws-eyebrow i{font-style:normal;color:#3b4740;padding:0 3px}
        .era-ws-project{font-size:12px;font-weight:550;color:#d7dad7}
        .era-ws-private{margin-left:auto;display:flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid #303632;border-radius:999px;color:#a3aaa4;font-size:10px}
        .era-ws-content{width:100%;max-width:1120px;min-height:0;flex:1;margin:0 auto;padding:12px 14px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
        .era-ws-mobile-panel{display:none}
        .era-ws-mobile-panel.view-active{display:block;flex:0 0 auto;min-height:0}
        .era-ws-logs-panel.view-active{display:flex;flex-direction:column}
        .era-ws-logs-panel.view-active{flex:1}
        .era-ws-preview.view-active{display:flex;flex-direction:column}
        .era-ws-preview.view-active{flex:1}
        .era-ws-workspace-extra{display:none}
        .era-ws-workspace-extra.view-active{display:flex}
        .era-ws-overview,.era-ws-logs-panel,.era-ws-preview,.era-ws-trial{border:1px solid #2b302d;border-radius:12px;background:#171a18;animation:era-ws-arrive .42s ease both}
        .era-ws-overview{padding:16px}
        .era-ws-heading-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .era-ws-kicker{margin:0 0 5px;color:#858d87;font-size:9px;font-weight:700;letter-spacing:.14em}
        .era-ws-heading-row h1{margin:0;font-size:21px;line-height:1.15;letter-spacing:-.045em;font-weight:640}
        .era-ws-status{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;text-transform:capitalize;font-size:10px;font-weight:650;white-space:nowrap}
        .era-ws-status-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
        .is-failed{color:#f18a7d;background:#3a211f;border:1px solid #56302d}
        .is-building{color:#e6bd70;background:#332c1f;border:1px solid #53462c}
        .is-deleted{color:#a1aaa3;background:#262a27;border:1px solid #383e3a}
        .era-ws-failure{display:flex;align-items:center;gap:10px;margin-top:15px;padding:11px;border:1px solid #55302d;border-radius:9px;background:#2a1c1b}
        .era-ws-failure-icon{display:grid;place-items:center;width:29px;height:29px;flex:none;border-radius:8px;background:#452522;color:#f18a7d}
        .era-ws-failure-copy,.era-ws-progress>div{display:flex;flex-direction:column;gap:3px}
        .era-ws-failure-copy strong,.era-ws-progress strong{font-size:12px;font-weight:620;color:#f1d2cd}
        .era-ws-failure-copy span,.era-ws-progress span{font-size:11px;color:#b48b86}
        .era-ws-progress{display:flex;align-items:center;gap:10px;margin-top:15px;padding:11px;border:1px solid #52462c;border-radius:9px;background:#28251e;color:#e6bd70}
        .era-ws-progress strong{color:#eddfbf}.era-ws-progress span{color:#b8a981}
        .era-ws-spin{animation:era-ws-rotate 1.2s linear infinite}
        @keyframes era-ws-rotate{to{transform:rotate(360deg)}}
        .era-ws-deleted-note{display:flex;align-items:center;gap:8px;margin-top:15px;padding:11px;border-radius:8px;background:#202b23;color:#8bd6a5;font-size:12px}
        .era-ws-facts{display:grid;grid-template-columns:1fr 1fr;gap:12px 8px;margin-top:15px;padding:13px 0;border-top:1px solid #292e2b;border-bottom:1px solid #292e2b}
        .era-ws-fact{min-width:0;display:flex;flex-direction:column;gap:6px}
        .era-ws-fact-label{display:flex;align-items:center;gap:5px;color:#858d87;font-size:10px}
        .era-ws-fact-value{color:#dce0dc;font-size:12px;font-weight:560}
        .era-ws-revision{font-family:var(--app-font-mono);font-size:11px;letter-spacing:.01em}
        .era-ws-db-state{display:flex;align-items:center;gap:6px;color:#9ed8ae;font-size:12px;font-weight:550}
        .era-ws-db-state span{width:6px;height:6px;background:#62c985;border-radius:50%}
        .era-ws-actions{display:flex;align-items:center;gap:11px;margin-top:14px}
        .era-ws-primary{min-height:40px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 14px;border:0;border-radius:8px;background:#5de18c;color:#102018;font-size:12px;font-weight:700;cursor:pointer;transition:transform .16s,opacity .16s}
        .era-ws-primary:hover:not(:disabled){transform:translateY(-1px)}
        .era-ws-primary:disabled{opacity:.65;cursor:wait}
        .era-ws-actions p{margin:0;max-width:260px;color:#8b938d;font-size:10px;line-height:1.5}
        .era-ws-notice{margin-top:10px;color:#dfa8a1;font-size:11px;line-height:1.45}
        .era-ws-section-toggle{width:100%;min-height:59px;display:flex;align-items:center;gap:9px;padding:10px 13px;border:0;background:transparent;color:#adb4ae;text-align:left;cursor:pointer}
        .era-ws-section-title,.era-ws-preview-title{display:flex;align-items:center;gap:9px;flex:1;min-width:0;color:#e2e6e2;font-size:12px;font-weight:620}
        .era-ws-section-title>span:last-child,.era-ws-preview-title>span:last-child{display:flex;flex-direction:column;gap:3px}
        .era-ws-section-title small,.era-ws-preview-title small{font-size:10px;font-weight:400;color:#818983}
        .era-ws-section-icon{width:29px;height:29px;display:grid;place-items:center;flex:none;border-radius:8px;background:#222a25;color:#8bc99d}
        .era-ws-log-count{font-family:var(--app-font-mono);font-size:9px;color:#7f8881}
        .era-ws-log-view{min-height:0;flex:1;margin:0 10px 10px;overflow:auto;border:1px solid #2d3430;border-radius:8px;background:#101311}
        .era-ws-log-toolbar{height:31px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;border-bottom:1px solid #272d29;background:#151916;color:#757e77;font-family:var(--app-font-mono);font-size:8px;letter-spacing:.06em}
        .era-ws-log-toolbar span:first-child{display:flex;align-items:center;gap:6px}
        .era-ws-log-toolbar i{width:5px;height:5px;border-radius:50%;background:#60ce82}
        .era-ws-log-lines{padding:6px 8px}
        .era-ws-log-line{min-height:25px;display:grid;grid-template-columns:56px 7px 1fr;align-items:start;gap:6px;padding:5px 0;font-family:var(--app-font-mono);font-size:9px;line-height:1.45;color:#b3bbb4}
        .era-ws-log-line time{color:#69736c;font-variant-numeric:tabular-nums}
        .era-ws-log-marker{width:5px;height:5px;margin-top:4px;border-radius:50%;background:#59625c}
        .tone-success{color:#9ed8ae}.tone-success .era-ws-log-marker{background:#62c985}
        .tone-error{color:#f18a7d}.tone-error .era-ws-log-marker{background:#e47b6f}
        .tone-muted{color:#818982}.tone-muted .era-ws-log-marker{background:#616a63}
        .era-ws-log-end{padding:7px 9px;border-top:1px solid #272d29;color:#5e6861;font-family:var(--app-font-mono);font-size:8px;letter-spacing:.1em}
        .era-ws-preview{overflow:hidden}
        .era-ws-preview-head{min-height:58px;display:flex;align-items:center;gap:10px;padding:10px 13px;border-bottom:1px solid #292e2b}
        .era-ws-refresh{width:32px;height:32px;display:grid;place-items:center;border:1px solid #303733;border-radius:8px;background:#202421;color:#7c857e}
        .era-ws-refresh:disabled{opacity:.55}
        .era-ws-preview-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:15px 14px 16px;text-align:center}
        .era-ws-preview-illustration{width:min(100%,250px);height:91px;margin-bottom:12px;overflow:hidden;border:1px solid #333a35;border-radius:8px;background:#121613}
        .era-ws-browser-top{height:22px;display:flex;align-items:center;gap:4px;padding:0 8px;border-bottom:1px solid #262d28;background:#191e1a}
        .era-ws-browser-top i{width:5px;height:5px;border-radius:50%;background:#535b55}
        .era-ws-browser-top span{height:9px;flex:1;margin-left:5px;border:1px solid #303832;border-radius:4px}
        .era-ws-browser-body{height:68px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:#5f6a62}
        .era-ws-browser-body span{font-family:var(--app-font-mono);font-size:8px;letter-spacing:.04em}
        .era-ws-preview-empty>strong{font-size:12px;font-weight:620;color:#e1e5e1}
        .era-ws-preview-empty>p{max-width:270px;margin:5px 0 12px;color:#858e87;font-size:10px;line-height:1.5}
        .era-ws-load-preview{min-height:35px;display:flex;align-items:center;gap:7px;padding:0 10px;border:1px solid #303733;border-radius:7px;background:#202421;color:#7e8780;font-size:10px;font-weight:600}
        .era-ws-load-preview:disabled{cursor:not-allowed}
        .era-ws-load-preview span{margin-left:4px;padding-left:8px;border-left:1px solid #3b413d;color:#69726b;font-size:9px;font-weight:400}
        .era-ws-trial{display:flex;align-items:flex-start;gap:9px;padding:12px;color:#8d978f;background:#191c1a}
        .era-ws-trial>svg{flex:none;margin-top:1px;color:#9eae9e}
        .era-ws-trial strong{display:block;margin-bottom:4px;color:#d3d9d3;font-size:10px;font-weight:620}
        .era-ws-trial p{margin:0;font-size:10px;line-height:1.5}
        .era-ws-danger{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 2px 0}
        .era-ws-delete-link{display:flex;align-items:center;gap:6px;padding:7px 4px;border:0;background:transparent;color:#cf827a;font-size:10px;cursor:pointer}
        .era-ws-delete-link:disabled{opacity:.4;cursor:not-allowed}
        .era-ws-danger>span{display:flex;align-items:center;gap:5px;color:#677169;font-size:9px}
        .era-ws-confirm{width:100%;padding:12px;border:1px solid #60322f;border-radius:9px;background:#291d1c}
        .era-ws-confirm-title{display:flex;align-items:center;gap:7px;color:#f09a8e;font-size:12px;font-weight:650}
        .era-ws-confirm>p{margin:8px 0;color:#c19a95;font-size:10px;line-height:1.5}
        .era-ws-confirm label{display:flex;align-items:flex-start;gap:8px;color:#ded2cf;font-size:10px;line-height:1.4}
        .era-ws-confirm input{accent-color:#ec776b}
        .era-ws-confirm-actions{display:flex;gap:8px;margin-top:11px}
        .era-ws-delete-confirm,.era-ws-cancel{min-height:34px;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 9px;border:1px solid #71413c;border-radius:7px;background:#492723;color:#f5c7c0;font-size:10px;cursor:pointer}
        .era-ws-delete-confirm:disabled{opacity:.45;cursor:not-allowed}
        .era-ws-cancel{border-color:#3b403d;background:#222623;color:#b3bbb4}
        @media(min-width:768px){
          .era-ws-shell{height:auto;min-height:100dvh;display:block;overflow:visible}
          .era-ws-switcher{display:none}
          .era-ws-topbar{padding:0 max(24px,calc((100vw - 1080px)/2))}
          .era-ws-content{min-height:0;flex:initial;padding:28px 24px 36px;overflow:visible;display:grid;grid-template-columns:minmax(340px,.88fr) minmax(380px,1.12fr);align-items:start;gap:16px}
          .era-ws-mobile-panel,.era-ws-mobile-panel.view-active{display:block;flex:initial;min-height:initial}
          .era-ws-logs-panel.view-active{display:block}
          .era-ws-preview.view-active{display:block}
          .era-ws-trial.era-ws-workspace-extra,.era-ws-danger.era-ws-workspace-extra{display:flex}
          .era-ws-overview{grid-column:1;grid-row:1;padding:20px}
          .era-ws-logs-panel{grid-column:1;grid-row:2}
          .era-ws-preview{grid-column:2;grid-row:1 / span 2;min-height:400px}
          .era-ws-preview-empty{min-height:340px;justify-content:center}
          .era-ws-trial{grid-column:1;grid-row:3}
          .era-ws-danger{grid-column:1 / -1}
          .era-ws-facts{grid-template-columns:1fr 1fr}
          .era-ws-actions{align-items:flex-start;flex-direction:column}
        }
        @media(max-width:767px){
          .era-ws-actions{align-items:flex-start;flex-direction:column;gap:8px}
          .era-ws-actions p{max-width:100%}
        }
        @media(max-width:360px){
          .era-ws-content{padding-left:11px;padding-right:11px}
          .era-ws-overview{padding:13px}
          .era-ws-log-line{grid-template-columns:49px 6px 1fr;font-size:8px;gap:4px}
          .era-ws-actions{align-items:flex-start;flex-direction:column}
        }
      `}</style>
    </main>
  );
}
