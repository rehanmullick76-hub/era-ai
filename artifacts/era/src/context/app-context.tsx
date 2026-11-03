import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useEraAuth } from "@/context/auth-context";

export interface OpenTab {
  id: string;
  name: string;
}

export interface EraUser {
  name: string;
  email: string;
  avatarLetter: string;
  avatarColor: string;
}

const CREDIT_KEY = "era_credits";
const INITIAL_CREDITS = 100;

const DEFAULT_USER: EraUser = {
  name: "ERA User",
  email: "",
  avatarLetter: "E",
  avatarColor: "#7c3aed",
};

function getCreditStorageKey(userId: string | null): string {
  return userId ? `${CREDIT_KEY}:user:${userId}` : CREDIT_KEY;
}

function loadCredits(storageKey: string): number {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    localStorage.setItem(storageKey, String(INITIAL_CREDITS));
    return INITIAL_CREDITS;
  } catch {
    return INITIAL_CREDITS;
  }
}

/** Store the initial prompt across navigation using sessionStorage */
export const PENDING_PROMPT_KEY = "era_pending_prompt";
export const PENDING_PROMPT_CONTEXT_KEY = "era_pending_prompt_context";
export const PENDING_PROMPT_ATTACHMENTS_KEY = "era_pending_prompt_attachments";
export const PENDING_PROMPT_PROJECT_KEY = "era_pending_prompt_project";
export const PENDING_VIEW_KEY = "era_pending_view";

interface AppContextValue {
  openTabs: OpenTab[];
  activeTabId: "home" | string;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  credits: number;
  user: EraUser;
  isAuthenticated: boolean;
  openTab: (id: string, name: string) => void;
  closeTab: (id: string) => void;
  resetOpenTabs: () => void;
  setActiveTabId: (id: "home" | string) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setMobileSidebarOpen: (v: boolean) => void;
  deductCredits: (amount: number) => void;
  addCredits: (amount: number) => void;
  setCreditsFromServer: (balance: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const {
    isLoaded: authLoaded,
    isSignedIn,
    userId,
    name: authName,
    email: authEmail,
  } = useEraAuth();
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<"home" | string>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [creditState, setCreditState] = useState<{ storageKey: string; value: number }>(() => ({
    storageKey: getCreditStorageKey(userId ?? null),
    value: loadCredits(getCreditStorageKey(userId ?? null)),
  }));
  const activeUserId = isSignedIn ? userId ?? null : null;
  const creditStorageKey = getCreditStorageKey(activeUserId);
  const credits = creditState.storageKey === creditStorageKey
    ? creditState.value
    : loadCredits(creditStorageKey);
  const user: EraUser = isSignedIn
    ? {
        name: authName || "ERA User",
        email: authEmail,
        avatarLetter: (authName || "E").charAt(0).toUpperCase(),
        avatarColor: "#2563eb",
      }
    : DEFAULT_USER;

  useEffect(() => {
    const handleCreditsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ credits?: unknown; userId?: unknown }>).detail;
      const next = detail?.credits;
      if (
        detail?.userId === activeUserId &&
        typeof next === "number" &&
        Number.isFinite(next) &&
        next >= 0
      ) {
        setCreditState({ storageKey: creditStorageKey, value: next });
      }
    };
    window.addEventListener("era:credits-updated", handleCreditsUpdated);
    return () => window.removeEventListener("era:credits-updated", handleCreditsUpdated);
  }, [activeUserId, creditStorageKey]);

  useEffect(() => {
    if (!authLoaded) return;

    setOpenTabs([]);
    setActiveTabId("home");
    setMobileSidebarOpen(false);
    setCreditState({
      storageKey: creditStorageKey,
      value: loadCredits(creditStorageKey),
    });

    if (!isSignedIn || !userId) return;
    const controller = new AbortController();
    void fetch("/api/auth/me", {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ userId?: string; credits?: number }>;
      })
      .then((data) => {
        if (
          data &&
          data.userId === activeUserId &&
          typeof data.credits === "number" &&
          Number.isFinite(data.credits) &&
          data.credits >= 0
        ) {
          setCreditState({ storageKey: creditStorageKey, value: data.credits });
          try { localStorage.setItem(creditStorageKey, String(data.credits)); } catch {}
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [authLoaded, isSignedIn, userId, activeUserId, creditStorageKey]);

  const openTab = useCallback((id: string, name: string) => {
    setOpenTabs((prev) => {
      if (prev.find((t) => t.id === id)) return prev;
      return [...prev, { id, name }];
    });
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setOpenTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveTabId((prev) => (prev === id ? "home" : prev));
  }, []);

  const resetOpenTabs = useCallback(() => setOpenTabs([]), []);

  const deductCredits = useCallback((amount: number) => {
    setCreditState((prev) => {
      const current = prev.storageKey === creditStorageKey
        ? prev.value
        : loadCredits(creditStorageKey);
      const next = Math.max(0, current - amount);
      try { localStorage.setItem(creditStorageKey, String(next)); } catch {}
      return { storageKey: creditStorageKey, value: next };
    });
  }, [creditStorageKey]);

  const addCredits = useCallback((amount: number) => {
    setCreditState((prev) => {
      const current = prev.storageKey === creditStorageKey
        ? prev.value
        : loadCredits(creditStorageKey);
      const next = current + amount;
      try { localStorage.setItem(creditStorageKey, String(next)); } catch {}
      return { storageKey: creditStorageKey, value: next };
    });
  }, [creditStorageKey]);

  const setCreditsFromServer = useCallback((balance: number) => {
    if (!Number.isFinite(balance) || balance < 0) return;
    setCreditState({ storageKey: creditStorageKey, value: balance });
    try { localStorage.setItem(creditStorageKey, String(balance)); } catch {}
  }, [creditStorageKey]);

  return (
    <AppContext.Provider value={{
      openTabs, activeTabId, sidebarCollapsed, mobileSidebarOpen,
      credits, user, isAuthenticated: Boolean(isSignedIn),
      openTab, closeTab, resetOpenTabs, setActiveTabId, setSidebarCollapsed, setMobileSidebarOpen,
      deductCredits, addCredits, setCreditsFromServer,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
