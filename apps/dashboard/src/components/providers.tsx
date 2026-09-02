"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { zhCN } from "@clerk/localizations";
import { ConvexProviderWithAuth, ConvexReactClient, useConvexAuth } from "convex/react";
import { ThemeProvider, useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { STATUS } from "@codex-tracker/shared/palette";
import { useMounted } from "@/hooks/use-mounted";
import { THEMES } from "@/lib/theme";
import { sceneModeForPath } from "@/components/scene/scene-canvas";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "https://placeholder-000.convex.cloud";
let convexClient: ConvexReactClient | null = null;
function getConvex(): ConvexReactClient {
  if (!convexClient) convexClient = new ConvexReactClient(convexUrl);
  return convexClient;
}

export function Providers({ locale, children }: { locale: string; children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ThemedClerk locale={locale}>{children}</ThemedClerk>
    </ThemeProvider>
  );
}

function ThemedClerk({ locale, children }: { locale: string; children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const pathname = usePathname();
  // Landing and auth pages are always dark; inside the app Clerk follows the user's theme.
  const dark = sceneModeForPath(pathname) !== "app" || (mounted && resolvedTheme === "dark");
  const appearance = useMemo(() => {
    const c = THEMES[dark ? "dark" : "light"];
    return {
      variables: {
        colorPrimary: c.accent,
        colorBackground: c.card,
        colorText: c.fg,
        colorTextSecondary: c.fg2,
        colorInputBackground: c.bg2,
        colorInputText: c.fg,
        colorNeutral: c.fg,
        colorDanger: STATUS.critical,
        colorSuccess: STATUS.good,
        colorWarning: STATUS.warning,
        borderRadius: "12px",
        fontFamily: "var(--font-geist), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      },
      elements: {
        card: "shadow-none border border-border",
        cardBox: "shadow-none",
        formButtonPrimary: "text-sm",
        organizationSwitcherPopoverCard: "border border-border shadow-2xl",
        userButtonPopoverCard: "border border-border shadow-2xl",
      },
    };
  }, [dark]);
  return (
    <ClerkProvider appearance={appearance} localization={locale === "zh" ? zhCN : undefined}>
      <ConvexProviderWithAuth client={getConvex()} useAuth={useClerkAuthForConvex}>
        <AuthWatchdog />
        {children}
      </ConvexProviderWithAuth>
    </ClerkProvider>
  );
}

/*
 * Keeping the realtime link alive.
 *
 * Convex subscriptions are live for as long as the client is authenticated. The client refreshes its
 * Clerk JWT before it expires, but if that single fetch fails — the laptop woke from sleep, the network
 * blinked, a background tab was throttled past the token's lifetime — Convex reports "not
 * authenticated" and *stops trying*. Clerk still says signed in, so nothing in the stock
 * `ConvexProviderWithClerk` ever calls `setAuth` again: the WebSocket stays green, every authenticated
 * query is dropped, and the dashboard silently freezes until the page is reloaded.
 *
 * Two fixes: token fetches retry with backoff before giving up, and a watchdog re-arms authentication
 * whenever Convex is unauthenticated while Clerk is signed in (and again when the tab becomes visible
 * or the browser comes back online). Re-arming works by giving the provider a new `fetchAccessToken`
 * identity, which is exactly what it watches to call `setAuth` again.
 */

const TOKEN_ATTEMPTS = 4;
const TOKEN_RETRY_MS = 400;
/** First re-arm after this long, then doubling, capped. */
const REARM_BASE_MS = 2_000;
const REARM_MAX_MS = 60_000;

let authGeneration = 0;
const generationListeners = new Set<() => void>();
function bumpAuthGeneration() {
  authGeneration++;
  for (const l of generationListeners) l();
}
function subscribeGeneration(l: () => void) {
  generationListeners.add(l);
  return () => {
    generationListeners.delete(l);
  };
}
function useAuthGeneration(): number {
  return useSyncExternalStore(
    subscribeGeneration,
    () => authGeneration,
    () => 0,
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Clerk → Convex auth bridge with retrying token fetches; a generation counter forces a fresh `setAuth`. */
function useClerkAuthForConvex() {
  const { isLoaded, isSignedIn, getToken, orgId, orgRole, sessionId, sessionClaims } = useAuth();
  const generation = useAuthGeneration();
  const useSessionToken = sessionClaims?.aud === "convex";
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt++) {
        try {
          const skipCache = forceRefreshToken || attempt > 0;
          const token = useSessionToken ? await getToken({ skipCache }) : await getToken({ template: "convex", skipCache });
          if (token) return token;
        } catch {
          /* transient — retry below */
        }
        if (attempt < TOKEN_ATTEMPTS - 1) await sleep(TOKEN_RETRY_MS * 2 ** attempt);
      }
      return null;
    },
    // getToken is not memoized by Clerk; the session fields (and our generation) are what should re-trigger setAuth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, orgRole, sessionId, useSessionToken, generation],
  );
  return useMemo(() => ({ isLoading: !isLoaded, isAuthenticated: isSignedIn ?? false, fetchAccessToken }), [isLoaded, isSignedIn, fetchAccessToken]);
}

/** True while Clerk has a session but Convex has none — the state the stock provider never recovers from. */
export function useAuthStuck(): boolean {
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  return isLoaded && !!isSignedIn && !isLoading && !isAuthenticated;
}

function AuthWatchdog() {
  const stuck = useAuthStuck();
  const { isAuthenticated } = useConvexAuth();
  const stuckRef = useRef(stuck);
  stuckRef.current = stuck;
  const attempts = useRef(0);

  // The backoff counter only resets once auth is actually back — not during the brief "loading"
  // window each re-arm goes through, or an offline laptop would retry every few seconds forever.
  useEffect(() => {
    if (isAuthenticated) attempts.current = 0;
  }, [isAuthenticated]);

  // Re-arm with backoff while stuck.
  useEffect(() => {
    if (!stuck) return;
    const delay = Math.min(REARM_MAX_MS, REARM_BASE_MS * 2 ** attempts.current);
    const id = window.setTimeout(() => {
      attempts.current++;
      bumpAuthGeneration();
    }, delay);
    return () => window.clearTimeout(id);
  }, [stuck]);

  // Waking up is the moment a dead link is most likely — and the moment the user is looking.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === "visible" && stuckRef.current) {
        attempts.current = 0;
        bumpAuthGeneration();
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);

  return null;
}
