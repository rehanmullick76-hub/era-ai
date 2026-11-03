import { useEffect, type ComponentType, type ReactNode } from "react";
import { Redirect, Switch, Route, Router as WouterRouter, Link, useLocation, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { applyRouteRobotsPolicy } from "@/lib/seo";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AppProvider } from "@/context/app-context";
import { AuthProvider, useEraAuth } from "@/context/auth-context";
import { Sidebar } from "@/components/sidebar";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Builder from "@/pages/builder";
import {
  MarketingAbout,
  MarketingDatabase,
  MarketingDocs,
  MarketingLanding,
  MarketingPricing,
} from "@/pages/marketing";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function GoogleSignInButton({ label = "Continue with Google" }: { label?: string }) {
  const next = new URLSearchParams(window.location.search).get("next");
  const returnTo = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <button
      type="button"
      onClick={() => {
        window.location.assign(
          `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`,
        );
      }}
      className="group flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/80 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-white hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
    >
      <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
        <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
        <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
        <path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.3H5.8a20 20 0 0 0 0 17.8l6.8-5.3Z" />
        <path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.3C14.2 15.6 18.7 12 24 12Z" />
      </svg>
      {label}
    </button>
  );
}

function GoogleAuthMessage() {
  const error = new URLSearchParams(window.location.search).get("error");
  if (!error) return null;
  const messages: Record<string, string> = {
    google_not_configured: "Google sign-in is not configured yet.",
    google_setup_error: "Google sign-in could not start. Check the OAuth setup.",
    google_cancelled: "Google sign-in was cancelled.",
    google_invalid_response: "Google returned an invalid sign-in response.",
    google_state_expired: "This sign-in link expired. Please try again.",
    google_token_missing: "Google did not return a sign-in token.",
    google_identity_invalid: "Google account verification failed.",
    google_callback_failed: "Google sign-in failed. Please try again.",
  };
  return (
    <p role="alert" className="mb-4 w-full max-w-[440px] rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
      {messages[error] ?? "Google sign-in failed. Please try again."}
    </p>
  );
}

function AuthPageCard({ mode }: { mode: "signin" | "signup" }) {
  const isSignup = mode === "signup";

  return (
    <main className="relative isolate flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#080c09] px-4 py-8 text-zinc-50 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-22rem] h-[38rem] w-[58rem] -translate-x-1/2 rounded-full bg-emerald-500/[0.12] blur-[110px]" />
        <div className="absolute bottom-[-22rem] right-[-14rem] h-[38rem] w-[38rem] rounded-full bg-lime-400/[0.06] blur-[100px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
      </div>

      <section className="relative w-full max-w-[448px] overflow-hidden rounded-[28px] border border-white/[0.09] bg-zinc-900/85 p-6 shadow-[0_28px_100px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:p-9">
        <div aria-hidden="true" className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />

        <header className="mb-9 flex items-center justify-between gap-3">
          <img src={`${basePath}/logo.svg`} alt="ERA" className="h-10 w-[120px]" />
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[0.07] px-3 py-1.5 text-[11px] font-medium tracking-wide text-emerald-200">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]" />
            GOOGLE SECURE SIGN-IN
          </span>
        </header>

        <div className="mb-7">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/80">
            {isSignup ? "Start creating" : "Welcome back"}
          </p>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em] text-white sm:text-[32px]">
            {isSignup ? "Create your ERA account" : "Build something great."}
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-400">
            {isSignup
              ? "Sign up with Google to start building and previewing your projects."
              : "Sign in with Google to continue building your projects."}
          </p>
        </div>

        <GoogleAuthMessage />
        <GoogleSignInButton
          label={isSignup ? "Create account with Google" : "Continue with Google"}
        />

        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 text-emerald-300/80" fill="none">
            <path d="M8 1.75 13 3.6v3.75c0 3.05-2.08 5.7-5 6.9-2.92-1.2-5-3.85-5-6.9V3.6l5-1.85Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
            <path d="m5.8 8 1.45 1.45L10.4 6.3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Your Google password is never shared with ERA
        </div>

        <div className="my-7 h-px bg-white/[0.07]" />

        <p className="text-center text-sm text-zinc-400">
          {isSignup ? "Already have an ERA account?" : "New to ERA?"}{" "}
          <Link
            href={isSignup ? "/sign-in" : "/sign-up"}
            className="font-medium text-emerald-300 underline-offset-4 transition hover:text-emerald-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {isSignup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </section>

      <Link
        href="/"
        className="relative mt-6 rounded-md px-4 py-2 text-sm text-zinc-500 underline-offset-4 transition hover:text-zinc-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        ← Back to ERA
      </Link>
    </main>
  );
}

function SignInPage() {
  const { isLoaded, isSignedIn } = useEraAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation("/");
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || isSignedIn) return null;
  return <AuthPageCard mode="signin" />;
}

function SignUpPage() {
  const { isLoaded, isSignedIn } = useEraAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation("/");
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || isSignedIn) return null;
  return <AuthPageCard mode="signup" />;
}

function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <TooltipProvider>
        <div className="flex h-[100dvh] w-screen overflow-hidden bg-background text-foreground">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {children}
          </div>
        </div>
      </TooltipProvider>
    </AppProvider>
  );
}

function HomeRoute() {
  const { isLoaded, isSignedIn } = useEraAuth();
  return isLoaded && isSignedIn
    ? <AppShell><Home /></AppShell>
    : <MarketingLanding isSignedIn={false} />;
}

function ProjectRoute() {
  const { isLoaded, isSignedIn } = useEraAuth();
  const params = useParams<{ id: string }>();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <AppShell><Builder key={params.id} /></AppShell>;
}

function PublicPageRoute({ page: Page }: { page: ComponentType<{ isSignedIn: boolean }> }) {
  const { isLoaded, isSignedIn } = useEraAuth();
  return <Page isSignedIn={Boolean(isLoaded && isSignedIn)} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/pricing"><PublicPageRoute page={MarketingPricing} /></Route>
      <Route path="/docs"><PublicPageRoute page={MarketingDocs} /></Route>
      <Route path="/database"><PublicPageRoute page={MarketingDatabase} /></Route>
      <Route path="/about"><PublicPageRoute page={MarketingAbout} /></Route>
      <Route path="/projects/:id" component={ProjectRoute} />
      <Route path="/" component={HomeRoute} />
      <Route component={NotFound} />
    </Switch>
  );
}

function RouteIndexingPolicy() {
  const [location] = useLocation();

  useEffect(() => {
    applyRouteRobotsPolicy(location);
  }, [location]);

  return null;
}

function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouteIndexingPolicy />
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function App() {
  useEffect(() => {
    try {
      const guestUserId = window.localStorage.getItem("era_guest_user_id");
      if (guestUserId) {
        window.localStorage.removeItem(`era_credits:user:${guestUserId}`);
      }
      for (const key of ["era_guest_id", "era_guest_user_id", "era_user", "era_credits"]) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }, []);

  return (
    <ThemeProvider defaultTheme="dark">
      <WouterRouter base={basePath}>
        <AppRoutes />
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
