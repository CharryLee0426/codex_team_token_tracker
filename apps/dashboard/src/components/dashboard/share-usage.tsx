"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, Download, Share2, X } from "lucide-react";
import type { Scope } from "@/hooks/use-hourly-range";
import { fmtDayKeyRange, fmtInstantIn } from "@/lib/format";
import type { UsageModel } from "@/lib/usage-model";
import { canvasToPngBlob, renderShareCard, shareFileName, type ShareCardFonts, type ShareCardStrings, type UsageShareSnapshot } from "@/lib/share-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Who the card is about: the signed-in person (personal) or the organization (team). */
export interface ShareIdentity {
  name: string | null;
  imageUrl: string | null;
  /** Sample data (the design preview): the card says so. */
  demo?: boolean;
}

interface Props {
  scope: Scope;
  model: UsageModel | null;
  identity: ShareIdentity;
  deviceCount?: number;
  stale: boolean;
  loading: boolean;
  className?: string;
}

type Status = "copied" | "downloaded" | "copyFailed" | "shareFailed" | "error" | null;

const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const MONO_FALLBACK = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** The page fonts as canvas font families: next/font publishes them through the CSS variables. */
function pageFonts(): ShareCardFonts {
  const style = getComputedStyle(document.documentElement);
  const sans = style.getPropertyValue("--font-geist").trim();
  const mono = style.getPropertyValue("--font-geist-mono").trim();
  return { sans: sans ? `${sans}, ${SANS_FALLBACK}` : SANS_FALLBACK, mono: mono ? `${mono}, ${MONO_FALLBACK}` : MONO_FALLBACK };
}

/** The footer names where the board lives: the host serving this page. */
function siteHost(): string {
  return window.location.host;
}

/**
 * "Share usage": renders the current figures into a PNG card — like the native viewers' share sheet —
 * and offers to copy it to the clipboard, download it, or hand it to the system share sheet where
 * the browser has one. Everything happens locally; the image only leaves the browser on those actions.
 */
export function ShareUsageButton({ scope, model, identity, deviceCount, stale, loading, className }: Props) {
  const t = useTranslations("share");
  const [open, setOpen] = useState(false);
  const restoreRef = useRef<HTMLElement | null>(null);
  const openDialog = () => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  };
  const close = useCallback(() => {
    setOpen(false);
    restoreRef.current?.focus?.({ preventScroll: true });
  }, []);
  return (
    <>
      <Button variant="secondary" size="md" onClick={openDialog} disabled={loading || !model} className={cn("h-10", className)} aria-haspopup="dialog" aria-expanded={open}>
        <Share2 size={15} aria-hidden />
        {t("open")}
      </Button>
      {open && model ? <ShareDialog scope={scope} model={model} identity={identity} deviceCount={deviceCount} stale={stale} onClose={close} /> : null}
    </>
  );
}

function ShareDialog({ scope, model, identity, deviceCount, stale, onClose }: { scope: Scope; model: UsageModel; identity: ShareIdentity; deviceCount?: number; stale: boolean; onClose: () => void }) {
  const t = useTranslations("share");
  const tk = useTranslations("kpi");
  const tn = useTranslations("nav");
  const tr = useTranslations("ranges");
  const tc = useTranslations("common");
  const locale = useLocale();
  const titleId = useId();
  const descId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [canShare, setCanShare] = useState(false);
  const [capturedAt] = useState(() => Date.now());

  const snapshot = useMemo<UsageShareSnapshot>(
    () => ({
      scope,
      summary: model.summary,
      bounds: model.bounds,
      dailyTotals: model.dailyTotals,
      name: identity.name,
      imageUrl: identity.imageUrl,
      count: scope === "team" ? model.summary.activeUsers : (deviceCount ?? null),
      capturedAt,
      site: siteHost(),
      demo: !!identity.demo,
      stale,
    }),
    [scope, model, identity, deviceCount, capturedAt, stale],
  );

  const strings = useMemo<ShareCardStrings>(() => {
    const b = model.bounds;
    const dates = fmtDayKeyRange(b.fromKey, b.toKey, locale);
    const range = b.key === "custom" ? dates : `${tr(b.key)} · ${dates}`;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      brand: tc("appName").toUpperCase(),
      scope: scope === "team" ? tn("team") : tn("personal"),
      range,
      totalTokens: tk("totalTokens"),
      cost: tk("cost"),
      requests: tk("requests"),
      cacheHit: tk("cacheHit"),
      inputOutput: t("card.inputOutput"),
      count: scope === "team" ? tk("activeMembers") : tk("devices"),
      models: t("card.models"),
      demo: t("card.demo"),
      stale: t("card.stale"),
      capturedAt: fmtInstantIn(capturedAt, zone, locale),
    };
  }, [model.bounds, locale, scope, capturedAt, t, tk, tn, tr, tc]);

  // Render (and re-render as live data arrives) into an offscreen canvas; the preview shows the PNG.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fonts = pageFonts();
        if (document.fonts?.load) {
          await Promise.all([document.fonts.load(`700 58px ${fonts.sans}`), document.fonts.load(`400 12px ${fonts.sans}`), document.fonts.load(`700 12px ${fonts.mono}`)]).catch(() => undefined);
        }
        const canvas = document.createElement("canvas");
        const dims = await renderShareCard(canvas, snapshot, strings, fonts);
        const png = await canvasToPngBlob(canvas);
        if (cancelled) return;
        setBlob(png);
        setSize(dims);
        setStatus((s) => (s === "error" ? null : s));
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot, strings]);

  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    const file = new File([blob], shareFileName(snapshot), { type: "image/png" });
    setCanShare(typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
    return () => URL.revokeObjectURL(next);
  }, [blob, snapshot]);

  // Modal behaviour: Escape closes, Tab stays inside, the page behind does not scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const body = document.body.style;
    const prevOverflow = body.overflow;
    body.overflow = "hidden";
    primaryRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      body.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    if (status !== "copied" && status !== "downloaded") return;
    const id = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(id);
  }, [status]);

  // Clipboard writes must start inside the click, so the PNG is taken from state rather than rendered here.
  const copy = () => {
    if (!blob) return;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("unsupported");
      navigator.clipboard
        .write([new ClipboardItem({ [blob.type]: blob })])
        .then(() => setStatus("copied"))
        .catch(() => setStatus("copyFailed"));
    } catch {
      setStatus("copyFailed");
    }
  };

  const download = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = shareFileName(snapshot);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus("downloaded");
  };

  const share = () => {
    if (!blob) return;
    const file = new File([blob], shareFileName(snapshot), { type: "image/png" });
    navigator.share({ files: [file], title: t("title") }).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("shareFailed");
    });
  };

  const ready = !!url && !!size;
  const message = status ? t(status) : null;
  const failed = status === "copyFailed" || status === "shareFailed" || status === "error";

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="fade-in absolute inset-0 bg-[var(--tour-dim)]" style={{ animationDuration: "0.25s" }} onClick={onClose} aria-hidden />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center sm:items-center sm:p-6">
        <section
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="pop-in pointer-events-auto flex max-h-[calc(100dvh-16px)] w-full max-w-[480px] flex-col rounded-t-2xl border border-border bg-bg-2 shadow-xl shadow-black/30 sm:max-h-[calc(100dvh-48px)] sm:rounded-2xl"
        >
          <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[15px] font-semibold tracking-tight text-fg">
                {t("title")}
              </h2>
              <p id={descId} className="mt-1 text-xs leading-relaxed text-muted">
                {t("description")}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("close")} className="-mt-1 -mr-2 shrink-0">
              <X size={16} aria-hidden />
            </Button>
          </header>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5">
            <div className="mx-auto w-full max-w-[400px]">
              {ready ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} width={size.width} height={size.height} alt={t("preview")} className="block h-auto w-full rounded-3xl shadow-lg shadow-black/10" data-testid="share-preview" />
              ) : (
                <div className="aspect-[4/5] w-full">
                  <Skeleton className="h-full w-full rounded-3xl" />
                  <span className="sr-only">{t("rendering")}</span>
                </div>
              )}
            </div>
          </div>

          <footer className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)] sm:pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <Button ref={primaryRef} variant="primary" size="md" onClick={copy} disabled={!ready} className="flex-1 sm:flex-none">
                {status === "copied" ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                {status === "copied" ? t("copied") : t("copy")}
              </Button>
              <Button variant="secondary" size="md" onClick={download} disabled={!ready} className="flex-1 sm:flex-none">
                <Download size={15} aria-hidden />
                {t("download")}
              </Button>
              {canShare ? (
                <Button variant="secondary" size="md" onClick={share} disabled={!ready} className="flex-1 sm:flex-none">
                  <Share2 size={15} aria-hidden />
                  {t("share")}
                </Button>
              ) : null}
            </div>
            <p role="status" aria-live="polite" className={cn("mt-2 min-h-4 text-xs", failed ? "text-danger" : "text-muted")}>
              {message}
            </p>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}
