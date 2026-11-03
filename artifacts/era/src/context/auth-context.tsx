import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthMeResult } from "@workspace/api-client-react";

interface EraAuthValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  authProvider: "google" | null;
  userId: string | null;
  name: string;
  email: string;
  avatarUrl: string | null;
  signOut: () => Promise<void>;
}

const EraAuthContext = createContext<EraAuthValue | null>(null);
const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [isLoaded, setIsLoaded] = useState(false);
  const [profile, setProfile] = useState<AuthMeResult | null>(null);
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    void (async () => {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not check the ERA session.");
        const result = (await response.json()) as AuthMeResult;
        if (active) {
          setProfile(
            result.authenticated && result.authProvider === "google" && result.userId
              ? result
              : null,
          );
        }
      } catch {
        if (active) setProfile(null);
      } finally {
        window.clearTimeout(timeout);
        if (active) setIsLoaded(true);
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const authProvider = profile?.authProvider === "google" ? "google" : null;
  const isSignedIn = Boolean(profile?.authenticated && authProvider && profile.userId);
  const userId = isSignedIn ? profile?.userId ?? null : null;
  const name = profile?.displayName ?? "ERA User";
  const email = profile?.email ?? "";
  const avatarUrl = profile?.avatarUrl ?? null;

  useEffect(() => {
    if (!isLoaded) return;
    if (previousUserId.current !== null && previousUserId.current !== userId) {
      queryClient.clear();
    }
    previousUserId.current = userId;
  }, [isLoaded, queryClient, userId]);

  const signOut = useCallback(async () => {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Could not end the Google session.");
    setProfile(null);
    queryClient.clear();
    window.location.assign(APP_BASE_PATH || "/");
  }, [queryClient]);

  const value = useMemo<EraAuthValue>(
    () => ({
      isLoaded,
      isSignedIn,
      authProvider,
      userId,
      name,
      email,
      avatarUrl,
      signOut,
    }),
    [
      avatarUrl,
      authProvider,
      email,
      isLoaded,
      isSignedIn,
      name,
      signOut,
      userId,
    ],
  );

  return <EraAuthContext.Provider value={value}>{children}</EraAuthContext.Provider>;
}

export function useEraAuth(): EraAuthValue {
  const context = useContext(EraAuthContext);
  if (!context) throw new Error("useEraAuth must be used inside AuthProvider");
  return context;
}
