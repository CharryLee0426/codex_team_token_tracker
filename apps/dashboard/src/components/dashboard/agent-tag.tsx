"use client";

import { clsx } from "clsx";

/** Human labels for agent ids sent by the menubar/agent uploader. */
export const AGENT_LABELS: Record<string, string> = {
  codex: "Codex",
  pi: "pi",
  hermes: "Hermes",
  opencode: "OpenCode",
  cline: "Cline",
  roo: "Roo Code",
  kilo: "Kilo Code",
};

export function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

/** Small monospace chip identifying which tool produced the usage. */
export function AgentTag({ agent, className }: { agent: string; className?: string }) {
  const isCodex = agent === "codex";
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md border px-1.5 py-[1px] font-mono text-[10px] leading-4",
        isCodex ? "border-border text-muted" : "border-primary/40 bg-primary/10 text-primary",
        className,
      )}
      title={agent}
    >
      {agentLabel(agent)}
    </span>
  );
}
