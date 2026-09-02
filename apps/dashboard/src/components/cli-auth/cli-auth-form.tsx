"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, Laptop, ShieldCheck } from "lucide-react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import { useMe } from "@/hooks/use-me";
import { useNow } from "@/hooks/use-now";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

function formatCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function CliAuthForm() {
  const params = useSearchParams();
  const initial = formatCode(params.get("code") ?? "");
  const t = useTranslations("cliAuth");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const locale = useLocale();
  const now = useNow(15_000);
  const { ready } = useMe();
  const [code, setCode] = useState(initial);
  const [lookup, setLookup] = useState(initial.length === 9 ? initial : "");
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approve = useMutation(api.deviceAuth.approve);
  const deny = useMutation(api.deviceAuth.deny);
  const req = useQuery(api.deviceAuth.getRequest, ready && lookup.length === 9 ? { code: lookup } : "skip");

  useEffect(() => {
    if (code.length === 9) setLookup(code);
  }, [code]);

  async function onApprove() {
    setBusy(true);
    setError(null);
    try {
      await approve({ code: lookup });
      setResult("approved");
    } catch (err) {
      setError(err instanceof ConvexError ? String((err.data as { message?: string })?.message ?? err.message) : String(err));
    } finally {
      setBusy(false);
    }
  }
  async function onDeny() {
    setBusy(true);
    try {
      await deny({ code: lookup });
      setResult("denied");
    } finally {
      setBusy(false);
    }
  }

  const status = result === "approved" ? "approved" : result === "denied" ? "denied" : req?.status;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageHeader eyebrow={tn("devices")} title={t("title")} subtitle={t("subtitle")} />

      <Card className="space-y-4 p-5">
        <label className="block">
          <span className="eyebrow">{t("codeLabel")}</span>
          <input
            value={code}
            onChange={(e) => setCode(formatCode(e.target.value))}
            placeholder={t("codePlaceholder")}
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
            className="mt-1.5 h-12 w-full rounded-xl border border-border bg-bg-2 px-3 font-mono text-lg tracking-[0.22em] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </label>

        {lookup.length !== 9 ? null : !ready || req === undefined ? (
          <Skeleton className="h-24" />
        ) : status === "approved" ? (
          <div className="rounded-xl border border-[rgba(12,163,12,0.4)] bg-[rgba(12,163,12,0.08)] p-4">
            <div className="flex items-center gap-2 font-medium text-fg">
              <CircleCheck size={18} className="text-success" /> {t("approvedTitle")}
            </div>
            <p className="mt-1 text-sm text-fg-2">{t("approvedBody")}</p>
            <Link href="/dashboard/devices" className={buttonClasses("secondary", "sm", "mt-3")}>
              {t("manageDevices")}
            </Link>
          </div>
        ) : req === null ? (
          <p className="text-sm text-danger">{t("notFound")}</p>
        ) : status === "expired" ? (
          <p className="text-sm text-danger">{t("expired")}</p>
        ) : status === "consumed" ? (
          <p className="text-sm text-fg-2">{t("consumed")}</p>
        ) : status === "denied" ? (
          <p className="text-sm text-fg-2">{t("denied")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-border bg-card-2 p-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bg-2 text-fg-2">
                <Laptop size={18} />
              </span>
              <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">{t("device")}</dt>
                <dd className="font-medium text-fg">{req.deviceName}</dd>
                <dt className="text-muted">{t("platform")}</dt>
                <dd>
                  <Badge variant="muted">{req.platform}</Badge>
                </dd>
                {req.hostname ? (
                  <>
                    <dt className="text-muted">{t("hostname")}</dt>
                    <dd className="text-fg-2">{req.hostname}</dd>
                  </>
                ) : null}
                <dt className="text-muted">{t("expires")}</dt>
                <dd className="text-fg-2" title={fmtDateTime(req.expiresAt, locale)}>
                  {fmtRelative(req.expiresAt, now, locale)}
                </dd>
              </dl>
              <Badge variant="warning">{t("pending")}</Badge>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-fg">
                <ShieldCheck size={16} className="text-accent" /> {t("accessTitle")}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-2">
                {(["1", "2", "3"] as const).map((n) => (
                  <li key={n}>{t(`access.${n}`)}</li>
                ))}
              </ul>
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={onApprove}>
                {t("approve")}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={onDeny}>
                {t("deny")}
              </Button>
              <span className="ml-auto text-xs text-muted">{tc("localTime")}</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
