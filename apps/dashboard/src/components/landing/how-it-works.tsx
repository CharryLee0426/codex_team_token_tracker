import { getTranslations } from "next-intl/server";
import { CodeBlock } from "@/components/ui/code-block";
import { Reveal } from "@/components/ui/reveal";

const STEPS = ["1", "2", "3"] as const;

export async function HowItWorks() {
  const t = await getTranslations("landing");
  return (
    <section className="grid-lines border-y border-border">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <Reveal>
          <p className="eyebrow">{t("howEyebrow")}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg md:text-4xl">{t("howTitle")}</h2>
        </Reveal>
        <ol className="relative mt-12 grid gap-8 md:grid-cols-3 md:gap-6">
          <span aria-hidden className="absolute top-5 right-[16%] left-[16%] hidden h-px bg-border-strong md:block" />
          {STEPS.map((n, i) => (
            <Reveal key={n} delay={i * 100}>
              <li className="relative flex gap-4 md:flex-col md:items-center md:text-center">
                <span className="relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-strong bg-bg font-mono text-sm text-accent shadow-[0_0_0_6px_var(--bg)]">
                  {n}
                </span>
                <p className="max-w-xs pt-2 text-sm leading-relaxed text-fg-2 md:pt-4">{t(`how.${n}`)}</p>
              </li>
            </Reveal>
          ))}
        </ol>
        <Reveal className="mx-auto mt-14 max-w-2xl" delay={150}>
          <p className="eyebrow mb-2">{t("install")}</p>
          <CodeBlock code={"npx codex-token-tracker login --dashboard https://your-dashboard.vercel.app   # first time: sign in + approve\nnpx codex-token-tracker            # then: menu bar / tray app (nothing to install)\nnpx codex-token-tracker agent      # headless (WSL2, servers)"} />
          <p className="mt-3 text-xs text-muted">{t("installHint")}</p>
        </Reveal>
      </div>
    </section>
  );
}
