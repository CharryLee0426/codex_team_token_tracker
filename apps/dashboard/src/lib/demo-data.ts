import { computeCost, resolvePrice } from "@codex-tracker/shared/pricing";
import { DAY, HOUR, hourStartOf, localParts } from "@codex-tracker/shared/time";
import type { PublicUser } from "@/hooks/use-hourly-range";
import type { UsageRow } from "./analytics";
import type { SessionItem } from "@/components/dashboard/recent-sessions";
import type { DeviceItem } from "@/components/dashboard/devices-list";
import type { MemberItem } from "@/components/dashboard/members-table";

/**
 * Deterministic sample data for the landing-page product preview and the design-preview harness.
 * Costs use the real pricing table so the numbers are internally consistent with production.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_ORG_NAME = "Orbital Labs";

export const DEMO_USERS: PublicUser[] = [
  { id: "u_mira", name: "Mira Chen", email: "mira@orbital.dev", imageUrl: null },
  { id: "u_jonas", name: "Jonas Weber", email: "jonas@orbital.dev", imageUrl: null },
  { id: "u_priya", name: "Priya Nair", email: "priya@orbital.dev", imageUrl: null },
  { id: "u_sam", name: "Sam Okafor", email: "sam@orbital.dev", imageUrl: null },
];

export const DEMO_ME_ID = DEMO_USERS[0].id;

const MODELS = ["gpt-5.5-codex", "gpt-5.4-codex", "gpt-5.1-codex-mini"] as const;
const PROFILES: Record<string, { intensity: number; models: number[]; agentPi: number }> = {
  u_mira: { intensity: 1.35, models: [0.6, 0.3, 0.1], agentPi: 0.15 },
  u_jonas: { intensity: 1.0, models: [0.35, 0.5, 0.15], agentPi: 0 },
  u_priya: { intensity: 0.8, models: [0.5, 0.2, 0.3], agentPi: 0.05 },
  u_sam: { intensity: 0.55, models: [0.2, 0.6, 0.2], agentPi: 0 },
};

function pick(weights: number[], r: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1;
}

/** Work-week shape: quiet nights, busy afternoons, lighter weekends. */
function activity(weekday: number, hour: number): number {
  const weekend = weekday === 0 || weekday === 6;
  const day = hour >= 9 && hour <= 19 ? 1 : hour >= 20 && hour <= 23 ? 0.35 : hour >= 7 && hour <= 8 ? 0.4 : 0.03;
  const peak = 1 + 0.6 * Math.exp(-((hour - 15) ** 2) / 12);
  return day * peak * (weekend ? 0.3 : 1);
}

export function demoRows(nowMs: number, days = 190, users: PublicUser[] = DEMO_USERS): UsageRow[] {
  const rows: UsageRow[] = [];
  const end = hourStartOf(nowMs);
  const start = end - days * DAY;
  users.forEach((u, ui) => {
    const rand = mulberry32(1000 + ui * 97);
    const profile = PROFILES[u.id] ?? PROFILES.u_sam;
    const deviceId = `d_${u.id}`;
    for (let h = start; h <= end; h += HOUR) {
      const p = localParts(h);
      const a = activity(p.weekday, p.hour) * profile.intensity;
      if (rand() > a * 0.85) continue;
      const nModels = rand() < 0.25 ? 2 : 1;
      for (let m = 0; m < nModels; m++) {
        const model = MODELS[pick(profile.models, rand())];
        const scale = a * (0.4 + rand() * 1.4) * 60_000;
        const input = Math.round(scale * (0.7 + rand() * 0.6));
        const cached = Math.round(input * (0.45 + rand() * 0.35));
        const output = Math.round(scale * (0.08 + rand() * 0.12));
        const reasoning = Math.round(output * (0.2 + rand() * 0.4));
        const usage = { input, cached, cacheWrite: 0, output, reasoning, total: input + output, requests: 4 + Math.round(rand() * 20) };
        rows.push({
          hourStart: h,
          model,
          agent: rand() < profile.agentPi ? "pi" : "codex",
          userId: u.id,
          deviceId,
          usage,
          cost: computeCost(usage, resolvePrice(model).price),
        });
      }
    }
  });
  return rows;
}

export function demoSessions(nowMs: number): SessionItem[] {
  const projects = ["api-gateway", "mobile-app", "infra", "billing-service", "web-dashboard", "ml-eval"];
  const rand = mulberry32(42);
  return Array.from({ length: 8 }, (_, i) => {
    const user = DEMO_USERS[i % DEMO_USERS.length];
    const model = MODELS[pick([0.5, 0.35, 0.15], rand())];
    const input = Math.round(80_000 + rand() * 900_000);
    const cached = Math.round(input * (0.5 + rand() * 0.3));
    const output = Math.round(input * 0.12);
    const usage = { input, cached, cacheWrite: 0, output, reasoning: Math.round(output * 0.3), total: input + output, requests: 20 + Math.round(rand() * 120) };
    const lastActivityAt = nowMs - i * 47 * 60_000 - Math.round(rand() * 20 * 60_000);
    return {
      id: `s_${i}`,
      user,
      sessionId: `0193f${i}a2-demo-session-${i}`,
      agent: i === 3 ? "pi" : "codex",
      model,
      projectName: projects[i % projects.length],
      startedAt: lastActivityAt - Math.round((25 + rand() * 90) * 60_000),
      lastActivityAt,
      ...usage,
      cost: computeCost(usage, resolvePrice(model).price),
      source: null,
    };
  });
}

export function demoDevices(nowMs: number): DeviceItem[] {
  return [
    {
      id: "d_u_mira",
      name: "Mira's MacBook Pro",
      platform: "darwin-arm64",
      hostname: "mira-mbp",
      appVersion: "0.2.1",
      timezone: "America/Los_Angeles",
      createdAt: nowMs - 41 * DAY,
      lastSeenAt: nowMs - 12_000,
      live: { sessionId: "0193f0a2-demo-session-0", model: "gpt-5.5-codex", tokensPerSecond: 41.6, lastEventAt: nowMs - 4_000, todayTotal: 1_842_000, todayCost: 4.12, updatedAt: nowMs - 12_000 },
    },
    {
      id: "d_u_mira_wsl",
      name: "dev-box (WSL2)",
      platform: "wsl",
      hostname: "dev-box",
      appVersion: "0.2.1",
      timezone: "America/Los_Angeles",
      createdAt: nowMs - 12 * DAY,
      lastSeenAt: nowMs - 3 * HOUR,
      live: null,
    },
  ];
}

export function demoMembers(nowMs: number): MemberItem[] {
  return DEMO_USERS.map((u, i) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    imageUrl: u.imageUrl,
    role: i === 0 ? "org:admin" : "org:member",
    joinedAt: nowMs - (60 - i * 9) * DAY,
    deviceCount: i === 0 ? 2 : 1,
    lastSeenAt: nowMs - [12_000, 35 * 60_000, 4 * HOUR, 2 * DAY][i],
    live: i === 0 ? { sessionId: "0193f0a2-demo-session-0", model: "gpt-5.5-codex", tokensPerSecond: 41.6, lastEventAt: nowMs - 4_000, todayTotal: 1_842_000, todayCost: 4.12, updatedAt: nowMs - 12_000 } : null,
  }));
}

/** Members currently reporting a heartbeat. */
export const DEMO_LIVE_USER_IDS = new Set([DEMO_USERS[0].id]);
