"use client";

import { useTranslations } from "next-intl";
import { formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { cacheHitRate } from "@codex-tracker/shared/usage";
import type { AgentStat } from "@/lib/analytics";
import { AgentTag } from "@/components/dashboard/agent-tag";

/**
 * "Sources" row: how much of the usage came from Codex CLI/Desktop vs. other agents signed in with
 * the Codex subscription (pi, hermes, opencode, cline, …). Hidden when only Codex is present.
 */
export function SourcesBreakdown({ stats }: { stats: AgentStat[] }) {
  const t = useTranslations("sources");
  const tc = useTranslations("common");
  if (stats.length <= 1 && (stats[0]?.agent ?? "codex") === "codex") return null;
  return (
    <div className="surface px-4 py-3 sm:px-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="eyebrow">{t("title")}</span>
        <span className="hidden text-[11px] text-muted sm:inline">{t("subtitle")}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {stats.map((s) => (
          <li key={s.agent} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-border bg-card-2/60 px-2.5 py-1.5 text-xs">
            <AgentTag agent={s.agent} />
            <span className="tabular font-medium text-fg">{formatPercent(s.share)}</span>
            <span className="tabular text-fg-2">
              {formatTokens(s.usage.total)} {tc("tokens")}
            </span>
            <span className="tabular text-fg-2">{formatUSD(s.cost)}</span>
            <span className="tabular text-muted" title={tc("cacheHit")}>
              {formatPercent(cacheHitRate(s.usage))} {tc("cacheHit")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
