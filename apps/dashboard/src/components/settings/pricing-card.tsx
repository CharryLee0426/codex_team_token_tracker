"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import type { PricingEntry, PricingEntrySource } from "@codex-tracker/shared/openai-pricing-page";
import type { PricingTableResponse } from "@codex-tracker/shared/wire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useNow } from "@/hooks/use-now";

const COLLAPSED_ROWS = 8;

const sourceVariant: Record<PricingEntrySource, "accent" | "default" | "muted" | "warning"> = {
  openai: "accent",
  alias: "default",
  builtin: "muted",
  override: "warning",
};

function rate(n: number | undefined): string {
  if (n === undefined) return "—";
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(n < 1 ? 3 : 2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** Pure view: the table the backend bills with, and where each rate came from. */
export function PricingCardView({ pricing, now }: { pricing: PricingTableResponse | undefined; now: number }) {
  const t = useTranslations("settings.pricing");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }), [locale]);
  const rtf = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }), [locale]);

  const ago = (ts: number) => {
    const min = Math.round((ts - now) / 60_000);
    if (Math.abs(min) < 60) return rtf.format(min, "minute");
    const h = Math.round(min / 60);
    if (Math.abs(h) < 48) return rtf.format(h, "hour");
    return rtf.format(Math.round(h / 24), "day");
  };

  const entries = useMemo(() => {
    if (!pricing) return [];
    // Page rows and overrides first (most relevant), then aliases, then the bundled leftovers.
    const rank: Record<PricingEntrySource, number> = { override: 0, openai: 1, alias: 2, builtin: 3 };
    return [...pricing.entries].sort((a, b) => rank[a.source] - rank[b.source] || a.model.localeCompare(b.model));
  }, [pricing]);
  const counts = useMemo(() => {
    const c: Record<PricingEntrySource, number> = { openai: 0, alias: 0, builtin: 0, override: 0 };
    for (const e of entries) c[e.source]++;
    return c;
  }, [entries]);
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_ROWS);

  return (
    <Card>
      <CardHeader
        title={t("title")}
        hint={
          pricing
            ? pricing.fetchedAt
              ? t("hintLive", { fetched: fmt.format(new Date(pricing.fetchedAt)) })
              : t("hintSeed")
            : t("hintLoading")
        }
        action={
          pricing ? (
            <a href={pricing.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
              {t("source")}
            </a>
          ) : null
        }
      />
      <CardBody className="space-y-3">
        {!pricing ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
              <div>
                <dt className="eyebrow">{t("checked")}</dt>
                <dd className="mt-0.5 text-fg" title={pricing.checkedAt ? fmt.format(new Date(pricing.checkedAt)) : undefined}>
                  {pricing.checkedAt ? ago(pricing.checkedAt) : t("never")}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">{t("models")}</dt>
                <dd className="mt-0.5 text-fg tabular">{entries.length}</dd>
              </div>
              <div>
                <dt className="eyebrow">{t("fromPage")}</dt>
                <dd className="mt-0.5 text-fg tabular">{counts.openai + counts.alias}</dd>
              </div>
              <div>
                <dt className="eyebrow">{t("overrides")}</dt>
                <dd className="mt-0.5 text-fg tabular">{counts.override}</dd>
              </div>
            </dl>
            {pricing.lastError ? (
              <p role="status" className="rounded-md border border-border bg-card-2 px-3 py-2 text-xs text-fg-2">
                {t("lastError", { error: pricing.lastError })}
              </p>
            ) : null}
            <p className="text-xs text-muted">{t("explainer")}</p>
            <TableWrap className="-mx-4 sm:-mx-5">
              <Table responsive={false} className="text-xs">
                <thead>
                  <tr>
                    <Th>{t("colModel")}</Th>
                    <Th right>{t("colInput")}</Th>
                    <Th right>{t("colCached")}</Th>
                    <Th right>{t("colCacheWrite")}</Th>
                    <Th right>{t("colOutput")}</Th>
                    <Th right>{t("colLong")}</Th>
                    <Th>{t("colSource")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e: PricingEntry) => (
                    <tr key={e.model}>
                      <Td mono className="font-mono whitespace-nowrap">{e.model}</Td>
                      <Td right mono>{rate(e.input)}</Td>
                      <Td right mono>{rate(e.cachedInput)}</Td>
                      <Td right mono>{rate(e.cacheWrite)}</Td>
                      <Td right mono>{rate(e.output)}</Td>
                      <Td right mono title={e.long ? `${rate(e.long.input)} / ${rate(e.long.cachedInput)} / ${rate(e.long.output)}` : undefined}>
                        {e.long ? t("longAbove", { k: Math.round(e.long.threshold / 1000) }) : "—"}
                      </Td>
                      <Td>
                        <Badge variant={sourceVariant[e.source]}>{t(`sources.${e.source}`)}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            {entries.length > COLLAPSED_ROWS ? (
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? t("showFewer") : t("showAll", { count: entries.length })}
              </Button>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Live from Convex. */
export function PricingCard() {
  const now = useNow(60_000);
  const pricing = useQuery(api.pricing.current, {});
  return <PricingCardView pricing={pricing} now={now} />;
}
