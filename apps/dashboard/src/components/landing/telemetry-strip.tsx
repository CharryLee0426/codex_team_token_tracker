"use client";

import { useTranslations } from "next-intl";
import { formatInt, formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { useAnimatedNumber } from "@/hooks/use-animated-number";
import { useInView } from "@/hooks/use-in-view";
import { Reveal } from "@/components/ui/reveal";

const STATS = [
  { key: "tokens", value: 12_400_000, format: formatTokens },
  { key: "cacheHit", value: 0.61, format: (n: number) => formatPercent(n) },
  { key: "cost", value: 18.2, format: formatUSD },
  { key: "requests", value: 1284, format: formatInt },
] as const;

function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [ref, inView] = useInView<HTMLSpanElement>({ threshold: 0.4 });
  const shown = useAnimatedNumber(inView ? value : 0, { duration: 1400 });
  return <span ref={ref}>{format(shown)}</span>;
}

/** Sample 30-day figures that count up as they scroll into view. */
export function TelemetryStrip() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  return (
    <section id="telemetry" className="mx-auto max-w-6xl px-4 sm:px-6">
      <Reveal>
        <div className="surface grid grid-cols-2 divide-border md:grid-cols-4 md:divide-x">
          {STATS.map((s, i) => (
            <div key={s.key} className="px-5 py-5 md:px-6">
              <p className="eyebrow">{tc(s.key)}</p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-fg md:text-[34px]">
                <CountUp value={s.value} format={s.format} />
              </p>
              {i === 0 ? <p className="mt-1 text-xs text-muted">{t("sampleHint")}</p> : null}
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
