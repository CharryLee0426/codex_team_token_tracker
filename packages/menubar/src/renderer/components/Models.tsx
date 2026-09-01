import { CATEGORICAL_DARK, CATEGORICAL_LIGHT, OTHER_COLOR, formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared";
import type { ModelStat } from "../../core/snapshot";
import type { Language } from "../../i18n";
import { t } from "../../i18n";
import { useTooltip, Tooltip } from "./Tooltip";

const MAX_SERIES = 7;

/** Horizontal bar list: share of tokens per model, with cost and an "est." badge for inferred pricing. */
export function Models({ models, lang, dark }: { models: ModelStat[]; lang: Language; dark: boolean }) {
  const palette = dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT;
  const { tip, show, hide } = useTooltip();
  if (!models.length) return <div className="empty">{t(lang, "noData")}</div>;

  const rows: Array<ModelStat & { color: string }> = models.slice(0, MAX_SERIES).map((m, i) => ({ ...m, color: palette[i] }));
  if (models.length > MAX_SERIES) {
    const rest = models.slice(MAX_SERIES);
    const usage = { ...rest[0].usage };
    for (const k of Object.keys(usage) as Array<keyof typeof usage>) usage[k] = rest.reduce((a, m) => a + m.usage[k], 0);
    rows.push({
      model: t(lang, "other"),
      usage,
      cost: rest.reduce((a, m) => a + m.cost, 0),
      share: rest.reduce((a, m) => a + m.share, 0),
      estimated: rest.some((m) => m.estimated),
      priceKey: null,
      agents: [...new Set(rest.flatMap((m) => m.agents))].sort(),
      color: OTHER_COLOR,
    });
  }
  const max = Math.max(...rows.map((r) => r.share), 0.0001);

  return (
    <div>
      {rows.map((m) => (
        <div
          key={m.model}
          className="model-row"
          onMouseEnter={(e) =>
            show(
              e,
              <>
                <b>{m.model}</b>
                <br />
                {t(lang, "input")} {formatTokens(m.usage.input)} ({t(lang, "cached").toLowerCase()} {formatTokens(m.usage.cached)}) · {t(lang, "output")}{" "}
                {formatTokens(m.usage.output)}
                <br />
                {m.usage.requests} {t(lang, "requests").toLowerCase()} · {formatUSD(m.cost)}
                {m.estimated ? ` · ${t(lang, "estimatedPricingHint")}` : ""}
              </>,
            )
          }
          onMouseLeave={hide}
        >
          <span className="swatch" style={{ background: m.color }} />
          <span className="name" title={m.model}>
            {m.model}
            {m.estimated && <span className="est">{t(lang, "estimated")}</span>}
            {m.agents.filter((a) => a !== "codex").map((a) => (
              <span className="tag" key={a}>
                {a}
              </span>
            ))}
          </span>
          <span className="nums">
            <b>{formatPercent(m.share)}</b>
            <span>{formatTokens(m.usage.total)}</span>
            <span>{formatUSD(m.cost)}</span>
          </span>
          <div className="model-bar">
            <i style={{ width: `${(m.share / max) * 100}%`, background: m.color }} />
          </div>
        </div>
      ))}
      <Tooltip tip={tip} />
    </div>
  );
}
