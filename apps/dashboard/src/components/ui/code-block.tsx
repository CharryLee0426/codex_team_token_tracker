"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Terminal-styled snippet (always dark, on both themes) with a copy button. */
export function CodeBlock({ code, title = "bash", className }: { code: string; title?: string; className?: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className={cn("group relative overflow-hidden rounded-xl border border-[rgba(148,163,196,0.18)] bg-[#070a12] text-[#d8e1f0]", className)}>
      <div className="flex items-center justify-between border-b border-[rgba(148,163,196,0.12)] px-3 py-1.5">
        <span className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-[rgba(148,163,196,0.35)]" />
          <span className="h-2 w-2 rounded-full bg-[rgba(148,163,196,0.25)]" />
          <span className="h-2 w-2 rounded-full bg-[rgba(148,163,196,0.15)]" />
          <span className="ml-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6f7a93]">{title}</span>
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? t("copied") : t("copy")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8b97ad] transition-colors hover:bg-[rgba(148,163,196,0.12)] hover:text-white"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre scrollbar-thin">{code}</pre>
      <span className="sr-only" aria-live="polite">
        {copied ? t("copied") : ""}
      </span>
    </div>
  );
}
