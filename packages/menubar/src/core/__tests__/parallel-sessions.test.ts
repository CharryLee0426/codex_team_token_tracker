import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionText, startOfLocalDay } from "@codex-tracker/shared";
import { SessionStore } from "../store";
import { computeStats } from "../stats";
import type { SessionRoot } from "../sources/types";

const PARENT_ID = "01a06afd-ec91-7133-b419-17f062efb670";
const CHILD_ID = "01a06aff-ba4a-7fd1-80cb-fb136eca0377";
const DAY_START = startOfLocalDay(Date.UTC(2026, 8, 3, 12));
const BASE_TIME = DAY_START + 12 * 60 * 60 * 1000;
const STATS_TIME = BASE_TIME + 60 * 60 * 1000;

const root: SessionRoot = {
  dir: "/virtual/codex/sessions",
  source: "codex",
  agent: "codex",
  format: "codex",
  kind: "sessions",
  origin: "local",
  exts: [".jsonl"],
  maxDepth: 6,
  text: true,
};

function sessionMeta(id: string, offsetMs: number, parentThreadId: string | null = null): string {
  const timestamp = new Date(BASE_TIME + offsetMs).toISOString();
  return JSON.stringify({
    timestamp,
    type: "session_meta",
    payload: {
      id,
      parent_thread_id: parentThreadId,
      timestamp,
      cwd: "/work/project",
      model: "gpt-5.6-sol",
      source: "vscode",
    },
  });
}

function tokenCount(total: number, offsetMs: number): string {
  return JSON.stringify({
    timestamp: new Date(BASE_TIME + offsetMs).toISOString(),
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: total,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: total,
        },
      },
    },
  });
}

function parentRollout(totals: Array<{ total: number; offsetMs: number }>): string {
  return [sessionMeta(PARENT_ID, 0), ...totals.map(({ total, offsetMs }) => tokenCount(total, offsetMs))].join("\n");
}

function childRollout(totals: Array<{ total: number; offsetMs: number }>): string {
  return [
    sessionMeta(CHILD_ID, 10_000, PARENT_ID),
    // Codex subagent rollouts replay the parent's metadata immediately after the child's own metadata.
    sessionMeta(PARENT_ID, 10_000),
    ...totals.map(({ total, offsetMs }) => tokenCount(total, offsetMs)),
  ].join("\n");
}

function localSnapshot(parentText: string, childText: string): { sessionIds: string[]; todayTotal: number } {
  const parent = parseSessionText(parentText, PARENT_ID);
  const child = parseSessionText(childText, CHILD_ID);
  assert.ok(parent);
  assert.ok(child);
  for (const parsed of [parent, child]) {
    parsed.provider = "openai-codex";
    parsed.events = parsed.events.map((usageEvent) => ({ ...usageEvent, provider: "openai-codex" }));
  }

  const store = new SessionStore(() => {
    throw new Error("in-memory store should not discover transcript roots");
  });
  store.files.set("/virtual/parent.jsonl", {
    path: "/virtual/parent.jsonl",
    size: parentText.length,
    mtimeMs: parent.lastActivityAt,
    root,
    session: parent,
  });
  store.files.set("/virtual/child.jsonl", {
    path: "/virtual/child.jsonl",
    size: childText.length,
    mtimeMs: child.lastActivityAt,
    root,
    session: child,
  });

  const sessions = store.sessions();
  const stats = computeStats({ sessions, now: STATS_TIME });
  return {
    sessionIds: sessions.map((session) => session.sessionId).sort(),
    todayTotal: stats.today.usage.total,
  };
}

test("parallel parent and subagent rollouts remain distinct and cumulative across alternating updates", () => {
  const initial = localSnapshot(
    parentRollout([{ total: 100, offsetMs: 20_000 }]),
    childRollout([{ total: 200, offsetMs: 30_000 }]),
  );
  const parentAdvanced = localSnapshot(
    parentRollout([
      { total: 100, offsetMs: 20_000 },
      { total: 300, offsetMs: 40_000 },
    ]),
    childRollout([{ total: 200, offsetMs: 30_000 }]),
  );
  const childAdvanced = localSnapshot(
    parentRollout([
      { total: 100, offsetMs: 20_000 },
      { total: 300, offsetMs: 40_000 },
    ]),
    childRollout([
      { total: 200, offsetMs: 30_000 },
      { total: 250, offsetMs: 50_000 },
    ]),
  );

  assert.deepEqual(initial.sessionIds, [CHILD_ID, PARENT_ID].sort());
  assert.deepEqual(parentAdvanced.sessionIds, [CHILD_ID, PARENT_ID].sort());
  assert.deepEqual(childAdvanced.sessionIds, [CHILD_ID, PARENT_ID].sort());
  assert.deepEqual(
    [initial.todayTotal, parentAdvanced.todayTotal, childAdvanced.todayTotal],
    [300, 500, 550],
  );
});
