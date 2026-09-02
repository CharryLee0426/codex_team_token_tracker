import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Providers } from "@/components/providers";
import { SceneCanvas } from "@/components/scene/scene-canvas";
import { SceneProvider } from "@/components/scene/scene-provider";
import { THEMES } from "@/lib/theme";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Codex Tracker", template: "%s · Codex Tracker" },
  description: "Realtime token telemetry for Codex teams: a menu bar app plus a live dashboard for tokens, cache hits, model mix and API-equivalent cost.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: THEMES.dark.bg },
    { media: "(prefers-color-scheme: light)", color: THEMES.light.bg },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-bg text-fg">
        {/* Rendered in a Server Component so locale, messages and timeZone are inherited from src/i18n/request.ts */}
        <NextIntlClientProvider>
          <Providers locale={locale}>
            <SceneProvider>
              <SceneCanvas />
              {children}
            </SceneProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
