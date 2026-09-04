"use client";

import { useTranslations } from "next-intl";
import { Check, Laptop, LayoutDashboard, Radio } from "lucide-react";
import { formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { LiveDot } from "@/components/ui/live-dot";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";
import type { TourArtKind } from "./steps";

interface ArtProps {
  kind: TourArtKind;
  loginCommand: string;
  runCommand: string;
  userName?: string | null;
  deviceCount?: number;
}

/** Illustration for a briefing step. Built from the board's own primitives so it reads as the product. */
export function TourArt({ kind, loginCommand, runCommand, userName, deviceCount }: ArtProps) {
  switch (kind) {
    case "flow":
      return <FlowArt />;
    case "terminal":
      return <TerminalArt command={loginCommand} userName={userName} />;
    case "tray":
      return <TrayArt command={runCommand} />;
    default:
      return <DoneArt deviceCount={deviceCount} />;
  }
}

/* ---------------------------------------------------------------- welcome: machine → sync → board */

function FlowArt() {
  const t = useTranslations("onboarding.art");
  const nodes = [
    { Icon: Laptop, title: t("machine"), sub: t("machineSub") },
    { Icon: Radio, title: t("sync"), sub: t("syncSub") },
    { Icon: LayoutDashboard, title: t("board"), sub: t("boardSub") },
  ];
  return (
    <div className="tour-art grid-lines relative overflow-hidden rounded-xl border border-border bg-bg-2/60 px-4 py-6 sm:px-6">
      <HudCorners />
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 sm:gap-3">
        {nodes.map((n, i) => (
          <NodeAndLink key={n.title} last={i === nodes.length - 1} delay={i * 140}>
            <div className="mx-auto mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong bg-card text-accent shadow-[0_0_0_4px_var(--accent-soft)]">
              <n.Icon size={16} />
            </div>
            <div className="text-[12px] font-semibold text-fg sm:text-[13px]">{n.title}</div>
            <div className="eyebrow mt-0.5 text-[9px] normal-case tracking-[0.08em] sm:text-[10px]">{n.sub}</div>
          </NodeAndLink>
        ))}
      </div>
      <p className="eyebrow mt-5 text-center text-[9.5px] text-accent">{t("flowCaption")}</p>
    </div>
  );
}

function NodeAndLink({ children, last, delay }: { children: React.ReactNode; last: boolean; delay: number }) {
  return (
    <>
      <div className="fade-up min-w-0 text-center" style={{ animationDelay: `${delay}ms` }}>
        {children}
      </div>
      {!last ? (
        <div className="tour-link w-7 self-center sm:w-14" aria-hidden />
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- connect: the login transcript */

function TerminalArt({ command, userName }: { command: string; userName?: string | null }) {
  const t = useTranslations("onboarding.art");
  const link = command.includes("--dashboard") ? command.split("--dashboard ")[1] : "https://codex.chenli.dev";
  const name = userName?.trim() || t("you");
  return (
    <div className="tour-art relative overflow-hidden rounded-xl border border-[rgba(148,163,196,0.18)] bg-[#070a12] text-[#d8e1f0]">
      <div className="flex items-center gap-1.5 border-b border-[rgba(148,163,196,0.12)] px-3 py-1.5" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-[rgba(148,163,196,0.35)]" />
        <span className="h-2 w-2 rounded-full bg-[rgba(148,163,196,0.25)]" />
        <span className="h-2 w-2 rounded-full bg-[rgba(148,163,196,0.15)]" />
        <span className="ml-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6f7a93]">{t("terminalTitle")}</span>
      </div>
      <pre className="stagger overflow-x-auto px-3.5 py-3 font-mono text-[11.5px] leading-[1.7] whitespace-pre scrollbar-thin sm:text-[12.5px]">
        <span className="block">
          <span className="text-[#6f7a93]">$ </span>
          <span className="text-white">{command}</span>
        </span>
        <span className="block text-[#8b97ad]">{t("connecting", { url: link })}</span>
        <span className="block">
          {"  "}
          {t("yourCode")} <span className="font-semibold text-[#5cc8ff]">RHF7-DWW8</span>
        </span>
        <span className="block text-[#8b97ad]">{t("openLink")}</span>
        <span className="block text-[#8b97ad]">{`  ${link}/cli-auth?code=RHF7-DWW8`}</span>
        <span className="block text-[#8b97ad]">{t("waiting")}</span>
        <span className="tour-cursor block text-[#4ade80]">{t("connected", { name })}</span>
      </pre>
    </div>
  );
}

/* ---------------------------------------------------------------- run: the tray + popover mock */

const TRAY_TREND = [22, 31, 28, 40, 36, 52, 47, 61, 58, 72, 66, 80];

function TrayArt({ command }: { command: string }) {
  const t = useTranslations("onboarding.art");
  const tc = useTranslations("common");
  return (
    <div className="tour-art grid-lines relative overflow-hidden rounded-xl border border-border bg-bg-2/60 p-4 sm:p-5">
      <HudCorners />
      {/* A menu bar strip: the tracker's title sits among the usual glyphs. */}
      <div className="fade-up mx-auto flex h-7 max-w-[420px] items-center justify-end gap-3 rounded-md border border-border-strong bg-card px-3 font-mono text-[11px] text-fg-2 shadow-[var(--shadow-card)]">
        <span className="text-muted">◔</span>
        <span className="text-muted">⌁</span>
        <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 font-semibold tabular text-accent ring-1 ring-accent/40">◉ 12.4k</span>
        <span className="text-muted">▮▮▮</span>
        <span className="text-muted">10:42</span>
      </div>
      {/* …and the popover that opens under it. */}
      <div className="fade-up mx-auto mt-3 w-full max-w-[300px] rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-card)]" style={{ animationDelay: "160ms" }}>
        <div className="flex items-center justify-between">
          <span className="eyebrow">{tc("today")}</span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[rgba(12,163,12,0.14)] px-1.5 py-0.5 font-mono text-[10px] text-[#0a7a0a] dark:text-[#4ade80]">
            <LiveDot size={6} /> 41.6 {t("tokPerSec")}
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <div className="text-[24px] leading-none font-semibold tracking-tight text-fg tabular">{formatTokens(12_400)}</div>
            <div className="mt-1 text-[11px] text-muted">
              {formatUSD(0.42)} · {tc("cacheHit").toLowerCase()} 61%
            </div>
          </div>
          <Sparkline values={TRAY_TREND} width={96} height={30} />
        </div>
      </div>
      <p className="mt-4 text-center font-mono text-[11px] text-fg-2">
        <span className="text-muted">$ </span>
        {command}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- done: systems check */

function DoneArt({ deviceCount }: { deviceCount?: number }) {
  const t = useTranslations("onboarding.art");
  const rows = [
    { label: t("checkTracker"), ok: (deviceCount ?? 0) > 0 },
    { label: t("checkLink"), ok: true },
    { label: t("checkBoard"), ok: true },
  ];
  return (
    <div className="tour-art grid-lines relative flex flex-col items-center gap-4 overflow-hidden rounded-xl border border-border bg-bg-2/60 px-4 py-6 sm:flex-row sm:justify-center sm:gap-8">
      <HudCorners />
      <div className="relative inline-flex h-24 w-24 items-center justify-center">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r="44" fill="none" strokeWidth="2" style={{ stroke: "var(--border-strong)" }} />
          <circle cx="50" cy="50" r="44" fill="none" strokeWidth="3" strokeLinecap="round" pathLength={1} className="tour-ring" style={{ stroke: "var(--accent)" }} />
        </svg>
        <span className="fade-up inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent" style={{ animationDelay: "500ms" }}>
          <Check size={24} strokeWidth={2.5} />
        </span>
      </div>
      <ul className="stagger w-full max-w-[260px] space-y-2 text-left">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-[12px] last:border-0">
            <span className="text-fg-2">{r.label}</span>
            <span className={cn("inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]", r.ok ? "text-success" : "text-warning")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", r.ok ? "bg-success" : "bg-warning")} />
              {r.ok ? t("ok") : t("pending")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * HUD corner brackets, as on the auth aperture. Inset by default; pass `radius` to sit flush on a
 * rounded card's edge, the bracket curving with the corner.
 */
export function HudCorners({ radius }: { radius?: number }) {
  const pos = radius === undefined ? 8 : -1;
  const corners = [
    { cls: "border-t border-l", style: { top: pos, left: pos, borderTopLeftRadius: radius } },
    { cls: "border-t border-r", style: { top: pos, right: pos, borderTopRightRadius: radius } },
    { cls: "border-b border-l", style: { bottom: pos, left: pos, borderBottomLeftRadius: radius } },
    { cls: "border-b border-r", style: { bottom: pos, right: pos, borderBottomRightRadius: radius } },
  ];
  return (
    <>
      {corners.map((c) => (
        <span key={c.cls} aria-hidden className={cn("hud-corner", c.cls)} style={c.style} />
      ))}
    </>
  );
}
