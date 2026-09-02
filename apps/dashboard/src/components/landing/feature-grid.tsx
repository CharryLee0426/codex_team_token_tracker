"use client";

import { useTranslations } from "next-intl";
import { Activity, DollarSign, MonitorSmartphone, Users } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { TiltCard } from "./tilt-card";

const FEATURES = [
  { key: "menubar", Icon: MonitorSmartphone },
  { key: "team", Icon: Users },
  { key: "realtime", Icon: Activity },
  { key: "cost", Icon: DollarSign },
] as const;

export function FeatureGrid() {
  const t = useTranslations("landing");
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <Reveal>
        <p className="eyebrow">{t("featuresEyebrow")}</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-fg md:text-4xl">{t("featuresTitle")}</h2>
      </Reveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ key, Icon }, i) => (
          <Reveal key={key} delay={i * 80} className="h-full">
            <TiltCard className="h-full p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card-2 text-accent">
                <Icon size={18} />
              </span>
              <h3 className="mt-5 text-[15px] font-semibold text-fg">{t(`features.${key}.title`)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-2">{t(`features.${key}.body`)}</p>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
