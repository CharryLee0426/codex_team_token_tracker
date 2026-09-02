"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { zhCN } from "@clerk/localizations";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ThemeProvider, useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
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
      <ConvexProviderWithClerk client={getConvex()} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
