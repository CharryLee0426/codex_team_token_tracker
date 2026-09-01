"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function CodeBlock({ code, className }: { code: string; className?: string }) {
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
    <div className={cn("group relative rounded-lg border border-border bg-card-2 font-mono text-[12.5px] text-fg", className)}>
      <pre className="overflow-x-auto px-3 py-2.5 pr-10 whitespace-pre scrollbar-thin">{code}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label={t("copy")}
        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-card hover:text-fg"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
