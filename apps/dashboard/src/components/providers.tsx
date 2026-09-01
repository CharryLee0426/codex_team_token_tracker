"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { zhCN } from "@clerk/localizations";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ThemeProvider, useTheme } from "next-themes";
import { useMemo } from "react";
import { useMounted } from "@/hooks/use-mounted";

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
  const dark = mounted && resolvedTheme === "dark";
  const appearance = useMemo(
    () => ({
      variables: {
        colorPrimary: dark ? "#818cf8" : "#6366f1",
        colorBackground: dark ? "#141416" : "#ffffff",
        colorText: dark ? "#fafafa" : "#0a0a0a",
        colorTextSecondary: dark ? "#a1a1aa" : "#52525b",
        colorInputBackground: dark ? "#1b1b1f" : "#ffffff",
        colorInputText: dark ? "#fafafa" : "#0a0a0a",
        colorNeutral: dark ? "#fafafa" : "#0a0a0a",
        colorDanger: "#d03b3b",
        colorSuccess: "#0ca30c",
        colorWarning: "#fab219",
        borderRadius: "10px",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      },
      elements: {
        card: "shadow-none border border-border",
        cardBox: "shadow-none",
        formButtonPrimary: "text-sm",
      },
    }),
    [dark],
  );
  return (
    <ClerkProvider appearance={appearance} localization={locale === "zh" ? zhCN : undefined}>
      <ConvexProviderWithClerk client={getConvex()} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
