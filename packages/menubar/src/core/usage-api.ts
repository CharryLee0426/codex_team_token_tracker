import fs from "node:fs";
import path from "node:path";
import { CODEX_USAGE_URL, parseCodexUsageResponse, type LiveRateLimits } from "@codex-tracker/shared";
import { codexHome } from "./sources";

export interface UsageFetchResult {
  limits: LiveRateLimits | null;
  error: string | null;
  fetchedAt: number;
}

interface CodexAuth {
  accessToken: string;
  accountId: string | null;
}

/**
 * Read the Codex CLI login (`~/.codex/auth.json`) fresh on every call – Codex rotates tokens itself.
 * The file is never written and no refresh is attempted here; an expired token simply yields an error.
 */
function readCodexAuth(): CodexAuth | { error: string } {
  const file = path.join(codexHome(), "auth.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { error: `Codex login not found (${file})` };
  }
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: "auth.json is not valid JSON" };
  }
  const tokens = json?.tokens;
  const accessToken = typeof tokens?.access_token === "string" ? tokens.access_token : null;
  if (!accessToken) {
    if (typeof json?.OPENAI_API_KEY === "string" && json.OPENAI_API_KEY) return { error: "Codex is using an API key; rate limits need a ChatGPT login" };
    return { error: "Codex is not logged in (run `codex login`)" };
  }
  return { accessToken, accountId: typeof tokens?.account_id === "string" ? tokens.account_id : null };
}

/** GET the account's live usage / rate limits from the same endpoint the official Codex client uses. */
export async function fetchLiveRateLimits(appVersion: string, timeoutMs = 10_000): Promise<UsageFetchResult> {
  const fetchedAt = Date.now();
  const auth = readCodexAuth();
  if ("error" in auth) return { limits: null, error: auth.error, fetchedAt };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      authorization: `Bearer ${auth.accessToken}`,
      accept: "application/json",
      "user-agent": `codex-token-tracker/${appVersion}`,
    };
    if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;
    const res = await fetch(CODEX_USAGE_URL, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? " (token expired? run Codex once to refresh it)" : "";
      return { limits: null, error: `HTTP ${res.status}${hint}`, fetchedAt };
    }
    const json = await res.json();
    const limits = parseCodexUsageResponse(json, fetchedAt);
    if (!limits) return { limits: null, error: "unrecognized usage response", fetchedAt };
    return { limits, error: null, fetchedAt };
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : String(err);
    return { limits: null, error: msg, fetchedAt };
  } finally {
    clearTimeout(timer);
  }
}
