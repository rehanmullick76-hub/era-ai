import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  Database,
  FileCode2,
  Layers3,
  Menu,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { applyPageSeo } from "@/lib/seo";
import "./marketing.css";

type MarketingProps = { isSignedIn: boolean };

const navItems = [
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/database", label: "Database" },
  { href: "/about", label: "About" },
];

const pageMeta: Record<string, { title: string; description: string }> = {
  "/": {
    title: "AI Website Builder for Full-Stack Web Apps | ERA Platform",
    description: "Build full-stack websites with ERA. Generate editable frontend and backend code, test projects in isolated workspaces, and preview your app as you build.",
  },
  "/pricing": {
    title: "ERA Pricing: AI Website Builder Credit Packages and Costs",
    description: "Compare ERA AI website builder credit packages, one-time prices, and token-based billing to choose the right option for your next full-stack web app.",
  },
  "/docs": {
    title: "Full-Stack AI Website Builder Docs and Guides | ERA",
    description: "Learn to build with ERA: choose a project mode, write effective prompts, generate and review code, run security checks, connect databases, and export source.",
  },
  "/database": {
    title: "Full-Stack App Database and Cloud Runtime Guide | ERA",
    description: "See how ERA runs full-stack apps in isolated cloud workspaces, connects project-specific Neon Postgres databases, and shows runtime status and logs.",
  },
  "/about": {
    title: "About ERA | AI Website and Full-Stack App Builder Platform",
    description: "Meet ERA, an AI website builder for turning product ideas into editable full-stack apps, with a connected workflow for design, code, review, and runtime.",
  },
};

function Metadata({ path }: { path: string }) {
  useEffect(() => {
    const normalizedPath = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
    const meta = pageMeta[normalizedPath] ?? pageMeta["/"];
    applyPageSeo({ path: normalizedPath, ...meta });
  }, [path]);
  return null;
}

function Brand() {
  return (
    <Link href="/" className="era-brand" aria-label="ERA home" data-testid="link-era-home">
      <span className="era-brand-mark" aria-hidden="true">E</span>
      <span>ERA<span className="era-brand-period">.</span></span>
    </Link>
  );
}

export function MarketingLayout({
  isSignedIn,
  children,
}: MarketingProps & { children: ReactNode }) {
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [path]);

  return (
    <div className="era-marketing">
      <Metadata path={path} />
      <header className="era-header">
        <div className="era-header-inner">
          <Brand />
          <nav className={`era-nav ${menuOpen ? "is-open" : ""}`} aria-label="Main navigation">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`era-nav-link ${path === item.href ? "is-current" : ""}`}
                aria-current={path === item.href ? "page" : undefined}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                {item.label}
              </Link>
            ))}
            <div className="era-nav-mobile-actions">
              {isSignedIn ? (
                <Link href="/" className="era-button era-button-dark" data-testid="link-dashboard-mobile">Back to Dashboard <ArrowRight size={15} /></Link>
              ) : (
                <>
                  <Link href="/sign-in" className="era-nav-link" data-testid="link-sign-in-mobile">Sign in</Link>
                  <Link href="/sign-up" className="era-button era-button-dark" data-testid="link-sign-up-mobile">Start building <ArrowRight size={15} /></Link>
                </>
              )}
            </div>
          </nav>
          <div className="era-header-actions">
            {isSignedIn ? (
              <Link href="/" className="era-button era-button-dark era-header-cta" data-testid="link-dashboard">Back to Dashboard <ArrowRight size={15} /></Link>
            ) : (
              <>
                <Link href="/sign-in" className="era-signin" data-testid="link-sign-in">Sign in</Link>
                <Link href="/sign-up" className="era-button era-button-dark era-header-cta" data-testid="link-sign-up">Start building <ArrowRight size={15} /></Link>
              </>
            )}
          </div>
          <button
            type="button"
            className="era-menu-toggle"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="era-mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
            data-testid="button-menu-toggle"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <div id="era-mobile-navigation" className={`era-mobile-nav-wrap ${menuOpen ? "is-open" : ""}`}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="era-mobile-nav-link" data-testid={`link-mobile-${item.label.toLowerCase()}`}>
              {item.label}<ArrowUpRight size={15} />
            </Link>
          ))}
          {isSignedIn ? (
            <Link href="/" className="era-button era-button-dark" data-testid="link-mobile-dashboard">Back to Dashboard <ArrowRight size={15} /></Link>
          ) : (
            <div className="era-mobile-cta-row">
              <Link href="/sign-in" className="era-button era-button-quiet" data-testid="link-mobile-sign-in">Sign in</Link>
              <Link href="/sign-up" className="era-button era-button-dark" data-testid="link-mobile-sign-up">Start building <ArrowRight size={15} /></Link>
            </div>
          )}
        </div>
      </header>
      {children}
      <MarketingFooter isSignedIn={isSignedIn} />
    </div>
  );
}

function MarketingFooter({ isSignedIn }: MarketingProps) {
  return (
    <footer className="era-footer">
      <div className="era-footer-top">
        <div className="era-footer-brand">
          <Brand />
          <p>Make the thing you keep<br />thinking about.</p>
        </div>
        <div className="era-footer-links">
          <div><span className="era-footer-label">Explore</span>{navItems.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}</div>
          <div><span className="era-footer-label">Your workspace</span>{isSignedIn ? <Link href="/">Back to Dashboard</Link> : <><Link href="/sign-in">Sign in</Link><Link href="/sign-up">Create an account</Link></>}</div>
        </div>
      </div>
      <div className="era-footer-bottom"><span>ERA / AI app builder</span><span>Ideas deserve a real URL.</span></div>
    </footer>
  );
}

function PageFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`era-page ${className}`}>{children}</main>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="era-eyebrow"><span className="era-eyebrow-dot" />{children}</div>;
}

function CtaLink({ href, children, light = false, testId }: { href: string; children: ReactNode; light?: boolean; testId?: string }) {
  return <Link href={href} className={`era-button ${light ? "era-button-light" : "era-button-lime"}`} data-testid={testId}>{children}<ArrowRight size={16} /></Link>;
}

const pipeline = [
  { key: "design", number: "01", label: "Design", icon: Layers3, title: "Shape the experience.", body: "Start with the product you have in mind. ERA turns a clear brief into a considered UI direction and a plan for the work.", detail: "Structure · visual direction · plan" },
  { key: "build", number: "02", label: "Build", icon: Code2, title: "Make it real.", body: "Generate working frontend and full-stack source, then keep iterating through a conversation that understands your project.", detail: "UI · server · source files" },
  { key: "verify", number: "03", label: "Verify", icon: ShieldCheck, title: "Check before you ship.", body: "Use QA and security tools to inspect what you have built, surface issues, and make the next fix easier to see.", detail: "Tests · findings · repair" },
  { key: "run", number: "04", label: "Run", icon: Database, title: "See it running.", body: "Full-stack projects can run in an isolated Daytona environment with a provisioned Neon Postgres database.", detail: "Cloud sandbox · database · logs" },
];

function PipelinePreview() {
  const [active, setActive] = useState(1);
  const current = pipeline[active];
  const Icon = current.icon;
  return (
    <section className="era-pipeline" aria-label="Interactive ERA build pipeline" data-testid="section-pipeline-preview">
      <div className="era-pipeline-top">
        <div><span className="era-live-dot" /> WORKSPACE PREVIEW</div>
        <span className="era-mono">APP / 07</span>
      </div>
      <div className="era-preview-window">
        <div className="era-preview-rail" aria-label="Choose a pipeline stage">
          {pipeline.map((stage, index) => {
            const StageIcon = stage.icon;
            return (
              <button key={stage.key} type="button" onClick={() => setActive(index)} className={`era-stage-button ${index === active ? "is-active" : ""}`} aria-pressed={index === active} data-testid={`button-stage-${stage.key}`}>
                <span className="era-stage-index">{stage.number}</span><StageIcon size={16} /><span>{stage.label}</span>{index < pipeline.length - 1 && <span className="era-stage-line" />}
              </button>
            );
          })}
        </div>
        <div className="era-preview-content" key={current.key}>
          <div className="era-preview-heading"><span className="era-preview-icon"><Icon size={19} /></span><span className="era-mono">{current.label.toUpperCase()} / ACTIVE</span><span className="era-preview-ready"><Check size={12} /> READY</span></div>
          <h3>{current.title}</h3>
          <p>{current.body}</p>
          <div className="era-preview-detail"><span>{current.detail}</span><ArrowUpRight size={15} /></div>
          <div className="era-terminal">
            <div className="era-terminal-top"><span /><span /><span /><span className="era-terminal-name">era — workspace</span></div>
            <div className="era-terminal-line"><span className="era-terminal-prompt">›</span> <span className="era-terminal-command">era</span> <span className="era-terminal-faint">/ build</span></div>
            <div className="era-terminal-result"><span className="era-terminal-check">✓</span> {active === 0 ? "Design direction mapped" : active === 1 ? "Files generated and ready to inspect" : active === 2 ? "Quality checks completed" : "Sandbox is ready to run"}<span className="era-terminal-cursor" /></div>
          </div>
        </div>
      </div>
      <div className="era-pipeline-caption"><span>ONE WORKSPACE, FROM FIRST PROMPT TO RUNNING APP</span><span className="era-mono">SELECT A STAGE ↑</span></div>
    </section>
  );
}

export function MarketingLanding({ isSignedIn }: MarketingProps) {
  return (
    <MarketingLayout isSignedIn={isSignedIn}>
      <PageFrame className="era-home">
        <section className="era-hero">
          <div className="era-hero-inner">
            <div className="era-hero-copy">
              <Eyebrow>AI WEBSITE BUILDER FOR FULL-STACK APPS</Eyebrow>
              <h1>Build it.<br /><span>Test it.</span><br />Ship it.</h1>
              <p className="era-hero-subtitle">Turn a prompt into a working full-stack app. Design, generate, check, and run it in one place.</p>
              <div className="era-hero-actions">
                <CtaLink href={isSignedIn ? "/" : "/sign-up"} testId="link-hero-start">{isSignedIn ? "Back to your workspace" : "Start building"}</CtaLink>
                <Link href="/docs" className="era-text-link" data-testid="link-hero-docs">See how ERA works <ArrowUpRight size={15} /></Link>
              </div>
              <div className="era-hero-note"><span className="era-note-rule" />100 credits included when you sign up</div>
            </div>
            <div className="era-hero-art">
              <div className="era-art-index"><span>FROM IDEA</span><ArrowDownRight size={15} /><span>TO APP</span></div>
              <PipelinePreview />
              <div className="era-hero-orbit" aria-hidden="true"><span>ERA</span></div>
            </div>
          </div>
          <div className="era-hero-bottom"><span>BUILT FOR PEOPLE WHO MAKE THINGS</span><span>DESIGN / CODE / SHIP <ArrowRight size={13} /></span></div>
        </section>

        <section className="era-proof-strip" aria-label="ERA platform capabilities">
          <div className="era-proof-label">A REAL PRODUCT<br />UNDER THE PROMPT</div>
          <div className="era-proof-item"><span className="era-proof-mark"><Terminal size={18} /></span><span><strong>Daytona</strong><small>Isolated runtime</small></span></div>
          <div className="era-proof-item"><span className="era-proof-mark"><Database size={18} /></span><span><strong>Neon</strong><small>Postgres database</small></span></div>
          <div className="era-proof-item"><span className="era-proof-mark"><ShieldCheck size={18} /></span><span><strong>QA + security</strong><small>Checks in the loop</small></span></div>
          <Link href="/database" className="era-proof-link" data-testid="link-proof-database">Explore the stack <ArrowUpRight size={15} /></Link>
        </section>

        <section className="era-section era-workflow-section">
          <div className="era-section-heading">
            <Eyebrow>FROM FIRST THOUGHT TO LIVE PREVIEW</Eyebrow>
            <h2>One build loop.<br /><span>Every layer connected.</span></h2>
            <p>ERA brings product thinking, source generation, review, and an isolated runtime into one practical workflow.</p>
          </div>
          <div className="era-workflow-list">
            {pipeline.map((stage, index) => {
              const Icon = stage.icon;
              return <article className="era-workflow-row" key={stage.key} data-testid={`text-workflow-${stage.key}`}>
                <span className="era-workflow-number">{stage.number}</span><span className="era-workflow-icon"><Icon size={20} /></span>
                <div className="era-workflow-main"><h3>{stage.label}</h3><p>{stage.body}</p></div>
                <span className="era-workflow-detail">{stage.detail}</span><ArrowUpRight className="era-workflow-arrow" size={18} />
                {index < pipeline.length - 1 && <span className="era-workflow-divider" />}
              </article>;
            })}
          </div>
        </section>

        <section className="era-runtime-band">
          <div className="era-runtime-copy">
            <Eyebrow>NOT JUST A PRETTY PREVIEW</Eyebrow>
            <h2>A sandbox with<br />room to <em>actually build.</em></h2>
            <p>Full-stack projects can start in an isolated Daytona runtime, with a Neon Postgres database provisioned for the project. Inspect runtime status and logs as you work.</p>
            <Link href="/database" className="era-button era-button-light" data-testid="link-runtime-details">How the runtime works <ArrowRight size={16} /></Link>
          </div>
          <div className="era-runtime-visual" aria-label="Illustration of an isolated app runtime and database">
            <div className="era-runtime-grid" />
            <div className="era-runtime-card era-runtime-app"><div className="era-runtime-card-label"><span className="era-live-dot" /> ISOLATED SANDBOX</div><div className="era-runtime-app-icon"><Code2 size={24} /></div><strong>your-app</strong><span className="era-runtime-pill">RUNNING</span><div className="era-runtime-url">localhost:<b>PORT</b></div></div>
            <div className="era-runtime-connector"><span /><span /><span /></div>
            <div className="era-runtime-card era-runtime-db"><div className="era-runtime-card-label">PROJECT DATABASE</div><div className="era-db-cylinder"><Database size={23} /></div><strong>Neon Postgres</strong><span>ISOLATED INSTANCE</span></div>
            <div className="era-runtime-log"><span>›</span> server listening on PORT <b>●</b></div>
            <span className="era-runtime-stamp">YOUR CODE.<br />YOUR SANDBOX.</span>
          </div>
        </section>

        <section className="era-section era-use-section">
          <div className="era-use-aside"><Eyebrow>GOOD IDEAS, LESS DISTANCE</Eyebrow><h2>Made for the<br />next version of<br /><span>your idea.</span></h2><p>Start with a rough brief. Stay in control of the files and the direction.</p></div>
          <div className="era-use-grid">
            <article><span>01 / FOUNDERS</span><h3>Prove the shape.</h3><p>Turn a product idea into something people can click, test, and react to.</p></article>
            <article><span>02 / BUILDERS</span><h3>Skip the blank page.</h3><p>Get a working starting point, then make the important decisions yourself.</p></article>
            <article><span>03 / TEAMS</span><h3>Keep the loop tight.</h3><p>Design, source, checks, and runtime details stay close to the work.</p></article>
          </div>
        </section>

        <section className="era-last-cta">
          <div><Eyebrow>THE FIRST BUILD IS YOURS</Eyebrow><h2>Enough planning.<br /><span>Make something.</span></h2></div>
          <div className="era-last-cta-side"><p>Start with a prompt. ERA gives you a place to take it further.</p><CtaLink href={isSignedIn ? "/" : "/sign-up"} testId="link-final-start">{isSignedIn ? "Back to your workspace" : "Build your first app"}</CtaLink><span>100 welcome credits on signup</span></div>
          <span className="era-cta-asterisk" aria-hidden="true">+</span>
        </section>
      </PageFrame>
    </MarketingLayout>
  );
}

const plans = [
  { name: "Starter", credits: "100", price: "₹2,000", note: "A first serious build.", feature: ["100 credits", "Full ERA build workflow", "QA and security tools"], id: "starter" },
  { name: "Pro", credits: "500", price: "₹5,000", note: "Room to find the edges.", feature: ["500 credits", "Full ERA build workflow", "QA and security tools"], id: "pro", popular: true },
  { name: "Max", credits: "2,000", price: "₹10,000", note: "For ideas that keep growing.", feature: ["2,000 credits", "Full ERA build workflow", "QA and security tools"], id: "max" },
];

export function MarketingPricing({ isSignedIn }: MarketingProps) {
  return (
    <MarketingLayout isSignedIn={isSignedIn}>
      <PageFrame className="era-interior-page era-pricing-page">
        <section className="era-page-hero era-pricing-hero">
          <div className="era-page-hero-main"><Eyebrow>STRAIGHT NUMBERS. NO GUESSWORK.</Eyebrow><h1>Pay for the work.<br /><span>Keep the momentum.</span></h1><p>Credits cover the AI work you ask ERA to do. Your package, your balance, and the billing math stay visible.</p></div>
          <div className="era-page-hero-aside"><span>01 — PRICING</span><div className="era-aside-line" /><span>BUILT TO BE READ</span></div>
        </section>
        <section className="era-pricing-content">
          <div className="era-pricing-intro"><span>CHOOSE YOUR STARTING POINT</span><p>100 welcome credits are added when you sign up. Packages shown in INR.</p></div>
          <div className="era-plan-grid">
            {plans.map((plan) => <article key={plan.id} className={`era-plan-card ${plan.popular ? "is-featured" : ""}`} data-testid={`card-plan-${plan.id}`}>
              {plan.popular && <div className="era-plan-tag">MOST ROOM TO ITERATE</div>}
              <div className="era-plan-top"><span>{plan.name}</span><span className="era-mono">ERA / {plan.id.toUpperCase()}</span></div>
              <div className="era-plan-credits">{plan.credits}<small> credits</small></div>
              <p className="era-plan-price">{plan.price}<span> one-time package</span></p>
              <p className="era-plan-note">{plan.note}</p>
              <div className="era-plan-rule" />
              <ul>{plan.feature.map((feature) => <li key={feature}><Check size={14} />{feature}</li>)}</ul>
              <CtaLink href={isSignedIn ? "/" : "/sign-up"} light={plan.popular} testId={`link-plan-${plan.id}`}>{isSignedIn ? "Go to workspace" : "Get started"}</CtaLink>
            </article>)}
          </div>
          <div className="era-welcome-banner"><span className="era-welcome-icon">+</span><div><strong>A little room to begin.</strong><p>Every new account starts with 100 welcome credits.</p></div><Link href={isSignedIn ? "/" : "/sign-up"} data-testid="link-welcome-credits">{isSignedIn ? "Open your workspace" : "Create your account"} <ArrowUpRight size={15} /></Link></div>
        </section>
        <section className="era-billing-section">
          <div className="era-billing-heading"><Eyebrow>THE BILLING MATH</Eyebrow><h2>Simple inputs.<br /><span>Clear arithmetic.</span></h2><p>Credits are calculated from model tokens used for each request. The same formula applies across the AI-powered tools.</p></div>
          <div className="era-billing-card">
            <div className="era-billing-formula"><div><span>INPUT</span><strong>tokens ÷ 1,000</strong><small>rounded up</small></div><b>+</b><div><span>OUTPUT</span><strong>tokens ÷ 500</strong><small>rounded up</small></div><b>=</b><div className="era-billing-result"><span>CHARGED</span><strong>credits</strong><small>1 credit minimum</small></div></div>
            <div className="era-billing-foot"><span>INPUT TOKENS</span><span>OUTPUT TOKENS</span><span>PER REQUEST</span></div>
          </div>
          <div className="era-usage-block"><div><span className="era-mono">CREDITS COVER</span><h3>Every useful turn<br />in the build loop.</h3></div><div className="era-usage-items">{["Chat and project assistance", "UI design suggestions", "Planning and file outlines", "Code generation and iteration", "QA checks and issue review", "Security analysis"].map((item, index) => <div key={item}><span>0{index + 1}</span>{item}<Check size={14} /></div>)}</div></div>
        </section>
        <section className="era-pricing-bottom"><span>Still deciding?</span><p>Read the docs for a practical walkthrough of what ERA can do.</p><Link href="/docs" className="era-text-link" data-testid="link-pricing-docs">Explore the documentation <ArrowRight size={15} /></Link></section>
      </PageFrame>
    </MarketingLayout>
  );
}

const docs = [
  { id: "getting-started", label: "01", title: "Getting started", text: "Create an account to begin with 100 welcome credits. Start a project with a description of what you want to make, then choose the project mode that fits." },
  { id: "app-modes", label: "02", title: "App modes", text: "Choose frontend for an interface-focused app, or full-stack when the project needs a server and database-backed capabilities." },
  { id: "prompts", label: "03", title: "Prompts that move work forward", text: "Describe the audience, the job the app should do, and the important screens or interactions. Specific constraints give ERA a better starting point." },
  { id: "build-chat", label: "04", title: "Build, chat, and plan", text: "Use chat to explore a change, planning to map an approach, and generation to create or update source files. Design suggestions help set visual direction." },
  { id: "security", label: "05", title: "QA and security", text: "Run the available checks to review issues and security findings in the project files. Treat findings as a useful review, not a substitute for your own release process." },
  { id: "limits", label: "06", title: "Project limits", text: "A project supports up to 100 source files and 1 MB of total source. Keep the file set focused and split larger work into smaller projects when useful." },
  { id: "server", label: "07", title: "Server and database", text: "Full-stack projects use an Express server. The runtime provides DATABASE_URL for the project database and PORT for the server to listen on." },
  { id: "export", label: "08", title: "Export and run locally", text: "Export your project source to continue working outside ERA. Install the project's dependencies, configure the environment values it needs, and run the Express server locally." },
];

export function MarketingDocs({ isSignedIn }: MarketingProps) {
  const [activeDoc, setActiveDoc] = useState("getting-started");
  return (
    <MarketingLayout isSignedIn={isSignedIn}>
      <PageFrame className="era-interior-page era-docs-page">
        <section className="era-page-hero era-docs-hero">
          <div className="era-page-hero-main"><Eyebrow>A FIELD GUIDE, NOT A MANUAL</Eyebrow><h1>Get from prompt<br />to <span>your first build.</span></h1><p>The essentials for making a project in ERA, understanding what it generates, and taking your source with you.</p></div>
          <div className="era-docs-index-card"><span>IN THIS GUIDE</span><strong>08</strong><small>short, useful chapters</small><span className="era-docs-index-arrow"><ArrowDownRight size={19} /></span></div>
        </section>
        <div className="era-docs-layout">
          <aside className="era-docs-sidebar" aria-label="Documentation chapters"><span className="era-docs-side-label">CHAPTERS</span>{docs.map((item) => <Link href={`#${item.id}`} key={item.id} className={activeDoc === item.id ? "is-current" : ""} onClick={() => setActiveDoc(item.id)} data-testid={`link-docs-${item.id}`}><span>{item.label}</span>{item.title}</Link>)}</aside>
          <div className="era-docs-content">
            <div className="era-docs-lede"><span className="era-mono">ERA / QUICKSTART</span><p>ERA is a workspace for turning a product brief into editable app source. These notes explain the shape of the workflow and what to expect from each tool.</p></div>
            {docs.map((item) => <article id={item.id} key={item.id} className="era-doc-article" data-testid={`section-doc-${item.id}`} onMouseEnter={() => setActiveDoc(item.id)}>
              <span className="era-doc-number">{item.label} / GUIDE</span><h2>{item.title}</h2><p>{item.text}</p>
              {item.id === "server" && <div className="era-code-snippet"><span className="era-code-comment"># values available to your Express server</span><br /><span>DATABASE_URL</span><span className="era-code-eq">=</span><span>project database connection</span><br /><span>PORT</span><span className="era-code-eq">=</span><span>runtime-provided port</span></div>}
              {item.id === "limits" && <div className="era-doc-callout"><FileCode2 size={17} /><span><strong>Keep the project lean.</strong> Limits apply to the total source in a project.</span><b>100 files · 1 MB</b></div>}
              {item.id === "getting-started" && <div className="era-doc-callout"><Check size={17} /><span><strong>Start with the outcome.</strong> Describe what a person should be able to do in the app.</span><Link href="/sign-up" data-testid="link-docs-start">{isSignedIn ? "Open workspace" : "Create an account"} <ArrowUpRight size={14} /></Link></div>}
            </article>)}
            <div className="era-docs-next"><div><span>READY WHEN YOU ARE</span><strong>Take the first idea out of your head.</strong></div><CtaLink href={isSignedIn ? "/" : "/sign-up"} testId="link-docs-build">{isSignedIn ? "Open workspace" : "Start building"}</CtaLink></div>
          </div>
        </div>
      </PageFrame>
    </MarketingLayout>
  );
}

export function MarketingDatabase({ isSignedIn }: MarketingProps) {
  return (
    <MarketingLayout isSignedIn={isSignedIn}>
      <PageFrame className="era-interior-page era-database-page">
        <section className="era-page-hero era-db-hero">
          <div className="era-page-hero-main"><Eyebrow>THE PART THAT MAKES IT FULL-STACK</Eyebrow><h1>Your app gets<br />a place to <span>run.</span></h1><p>ERA connects project source to an isolated runtime and a project-scoped Neon Postgres database. The infrastructure is part of the build loop, not a footnote.</p><Link href="/docs#server" className="era-text-link" data-testid="link-db-docs">Read about server configuration <ArrowRight size={15} /></Link></div>
          <RuntimeDiagram />
        </section>
        <section className="era-db-statement"><span>01 / THE SETUP</span><p>One project.<br /><em>Its own workspace.</em></p><span className="era-db-statement-aside">ISOLATED BY PROJECT<br />OBSERVABLE WHILE RUNNING</span></section>
        <section className="era-db-detail-grid">
          <article className="era-db-detail-card era-db-neon"><div className="era-db-card-top"><span>01</span><Database size={19} /></div><Eyebrow>DATA / NEON</Eyebrow><h2>A dedicated<br />database context.</h2><p>Full-stack projects can be provisioned with an isolated Neon Postgres database. Your app's runtime receives its database connection through <code>DATABASE_URL</code>.</p><div className="era-db-card-foot"><span>POSTGRESQL</span><span>PROJECT-SCOPED</span></div></article>
          <article className="era-db-detail-card era-db-daytona"><div className="era-db-card-top"><span>02</span><Terminal size={19} /></div><Eyebrow>RUNTIME / DAYTONA</Eyebrow><h2>Code running<br />in a sandbox.</h2><p>ERA uses an isolated Daytona runtime for full-stack project execution. The Express server listens on the runtime-provided <code>PORT</code>.</p><div className="era-db-card-foot"><span>ISOLATED ENVIRONMENT</span><span>EXPRESS SERVER</span></div></article>
        </section>
        <section className="era-migration-section">
          <div className="era-migration-heading"><Eyebrow>CHANGE WITHOUT THE GUESSWORK</Eyebrow><h2>Database changes<br />stay <span>additive.</span></h2><p>When generated work needs a schema change, ERA's migration approach is designed to add what is needed without treating existing data as disposable.</p></div>
          <div className="era-migration-visual">
            <div className="era-migration-version"><span>BEFORE</span><div><Database size={17} /><b>projects</b><small>existing table</small></div><div><Database size={17} /><b>members</b><small>existing table</small></div></div>
            <div className="era-migration-arrow"><span>SAFE ADDITION</span><ArrowRight size={21} /></div>
            <div className="era-migration-version is-after"><span>AFTER</span><div><Database size={17} /><b>projects</b><small>kept in place</small></div><div><Database size={17} /><b>members</b><small>kept in place</small></div><div className="era-new-table"><span>+</span><b>new feature</b><small>added schema</small></div></div>
          </div>
        </section>
        <section className="era-logs-band"><div className="era-logs-copy"><Eyebrow>MAKE THE RUNTIME LEGIBLE</Eyebrow><h2>Status and logs,<br /><span>close to the code.</span></h2><p>View runtime status and logs from the project workspace to understand what the server is doing as your app runs.</p></div><div className="era-log-panel"><div className="era-log-head"><span><span className="era-live-dot" /> RUNTIME LOGS</span><span>PROJECT / LIVE</span></div><div><span>09:41:03</span><b>runtime</b> workspace provisioning</div><div><span>09:41:09</span><b>server</b> Express server starting</div><div><span>09:41:10</span><b className="era-log-good">ready</b> listening on PORT</div><div><span>09:41:10</span><b>database</b> Neon connection available</div><div className="era-log-end">END OF CURRENT LOG <span>▾</span></div></div></section>
        <section className="era-page-end"><span>BUILD A FULL-STACK PROJECT</span><CtaLink href={isSignedIn ? "/" : "/sign-up"} testId="link-db-start">{isSignedIn ? "Back to workspace" : "Start building"}</CtaLink></section>
      </PageFrame>
    </MarketingLayout>
  );
}

function RuntimeDiagram() {
  return <div className="era-db-diagram" aria-label="Diagram: app source runs in a Daytona sandbox and connects to an isolated Neon Postgres database">
    <div className="era-diagram-caption"><span>PROJECT INFRASTRUCTURE</span><span>02 NODES / 01 PROJECT</span></div>
    <div className="era-diagram-source"><FileCode2 size={19} /><div><span>SOURCE</span><strong>your-app/</strong></div><span className="era-diagram-source-count">FILES</span></div>
    <div className="era-diagram-branches"><span /><span /></div>
    <div className="era-diagram-nodes">
      <div className="era-diagram-node"><span className="era-diagram-node-icon"><Terminal size={19} /></span><small>RUNTIME</small><strong>Daytona</strong><span>Isolated sandbox</span><i>RUNNING</i></div>
      <div className="era-diagram-node era-diagram-db"><span className="era-diagram-node-icon"><Database size={19} /></span><small>DATABASE</small><strong>Neon Postgres</strong><span>Isolated database</span><i>PROVISIONED</i></div>
    </div>
    <div className="era-diagram-footer"><span><span className="era-live-dot" /> CONNECTED BY PROJECT</span><span>DATABASE_URL <ArrowRight size={12} /> EXPRESS</span></div>
  </div>;
}

export function MarketingAbout({ isSignedIn }: MarketingProps) {
  return (
    <MarketingLayout isSignedIn={isSignedIn}>
      <PageFrame className="era-interior-page era-about-page">
        <section className="era-about-hero">
          <div className="era-about-hero-main"><Eyebrow>WHY WE'RE BUILDING ERA</Eyebrow><h1>Software ideas<br />should meet the<br /><span>real world sooner.</span></h1><p>ERA is for people with a useful idea and the urge to make it real. We are building a direct path from a prompt to an app you can inspect, run, and keep shaping.</p></div>
          <div className="era-about-mark" aria-label="ERA, from first thought to working software"><span className="era-about-mark-ring" /><span className="era-about-mark-word">MAKE<br />IT <em>REAL</em></span><span className="era-about-mark-caption">ERA / BUILD LOOP</span><span className="era-about-mark-plus">+</span></div>
          <div className="era-about-hero-index"><span>01</span><span>MISSION / METHOD / PRINCIPLES</span></div>
        </section>
        <section className="era-about-manifesto">
          <div className="era-about-manifesto-label"><span>THE SHORT VERSION</span><span>01 — 03</span></div>
          <p>AI can make a lot of code. The harder part is making the right thing, keeping the work legible, and giving it a place to run. <em>ERA is built around that whole loop.</em></p>
        </section>
        <section className="era-about-method">
          <div className="era-about-method-head"><Eyebrow>THE PRODUCT PRINCIPLES</Eyebrow><h2>Useful power.<br /><span>Under your control.</span></h2></div>
          <div className="era-principles">
            <article><span>01 / MODELS</span><h3>Route for the work.</h3><p>ERA routes work between Gemini Pro and Gemini Flash based on the task. The goal is to bring the right model capability to the step in front of you.</p><div className="era-principle-foot">GEMINI PRO <span>↔</span> FLASH</div></article>
            <article><span>02 / SOURCE</span><h3>Respect what is already there.</h3><p>File-preservation rules guide generation to keep existing project work in view rather than treating every iteration like a blank slate.</p><div className="era-principle-foot">PRESERVE · THEN CHANGE</div></article>
            <article><span>03 / SECURITY</span><h3>Build with a safer place to run.</h3><p>Full-stack execution happens in isolated sandboxes, and security analysis is part of the available build toolkit.</p><div className="era-principle-foot">ISOLATED BY DESIGN</div></article>
          </div>
        </section>
        <section className="era-about-quote"><div className="era-quote-mark">“</div><blockquote>It should feel less like asking an AI for code and more like working beside a product-minded builder.</blockquote><span>THE ERA POINT OF VIEW</span><div className="era-quote-lines"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></section>
        <section className="era-about-stack">
          <div><Eyebrow>THE BUILD LOOP, IN PRACTICE</Eyebrow><h2>Think clearly.<br />Build carefully.<br /><span>Keep moving.</span></h2></div>
          <div className="era-about-stack-steps"><div><span>01</span><strong>Prompt</strong><small>Describe the product and the people using it.</small></div><div><span>02</span><strong>Shape</strong><small>Plan the work and explore the interface.</small></div><div><span>03</span><strong>Generate</strong><small>Create and iterate on project source.</small></div><div><span>04</span><strong>Review</strong><small>Use QA, security, runtime status, and logs.</small></div></div>
        </section>
        <section className="era-about-bottom"><div><span>YOUR IDEA HAS BEEN WAITING.</span><h2>Give it a first version.</h2></div><CtaLink href={isSignedIn ? "/" : "/sign-up"} testId="link-about-start">{isSignedIn ? "Back to your workspace" : "Build with ERA"}</CtaLink></section>
      </PageFrame>
    </MarketingLayout>
  );
}

export default MarketingLanding;
