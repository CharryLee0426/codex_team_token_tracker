import { useEffect, useState } from "react";
import { formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared";
import type { Snapshot } from "../core/snapshot";
import { durationShort, localeTag, relativeTime, t as tr, windowLabel, type Language, type MessageKey } from "../i18n";
import { Heatmap } from "./components/Heatmap";
import { Models } from "./components/Models";

const bridge = () => window.codexTracker;

function useDark(): boolean {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = useState(mq.matches);
  useEffect(() => {
    const l = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", l);
    return () => mq.removeEventListener("change", l);
  }, [mq]);
  return dark;
}

function Logo() {
  return (
    <span className="logo" aria-hidden>
      <svg viewBox="0 0 12 12" fill="#fff">
        <rect x="0.5" y="6" width="3" height="6" rx="0.8" />
        <rect x="4.5" y="3" width="3" height="9" rx="0.8" />
        <rect x="8.5" y="0" width="3" height="12" rx="0.8" />
      </svg>
    </span>
  );
}

function levelClass(pct: number): string {
  return pct >= 85 ? "critical" : pct >= 60 ? "warning" : "";
}

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [, setClock] = useState(0);
  const [modelPeriod, setModelPeriod] = useState<"today" | "month">("today");
  const dark = useDark();

  useEffect(() => {
    let off = () => {};
    bridge()
      .getSnapshot()
      .then((s) => {
        if (s) setSnap(s);
      })
      .catch(() => {});
    off = bridge().onSnapshot(setSnap);
    const clock = setInterval(() => setClock((c) => c + 1), 1000);
    return () => {
      off();
      clearInterval(clock);
    };
  }, []);

  if (!snap) return <div className="app" />;
  const L: Language = snap.language;
  const t = (key: MessageKey, params?: Record<string, string | number>) => tr(L, key, params);
  const tag = localeTag(L);
  const now = Date.now();
  const live = snap.live;
  const models = modelPeriod === "today" ? snap.modelsToday : snap.modelsMonth;
  const agentsPeriod: "today" | "month" = snap.byAgentToday.length ? "today" : "month";
  const agents = agentsPeriod === "today" ? snap.byAgentToday : snap.byAgentMonth;
  const auth = snap.auth;
  const rl = snap.rateLimits;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <Logo />
          {t("appName")}
        </div>
        <div className="spacer" />
        {live ? (
          <span className="pill live" title={live.projectName ?? ""}>
            {live.tokensPerSecond.toFixed(1)} {t("tokensPerSec")}
          </span>
        ) : null}
        <div className="seg" role="group" aria-label={t("language")}>
          <button className={L === "en" ? "active" : ""} onClick={() => void bridge().setLanguage("en")}>
            EN
          </button>
          <button className={L === "zh" ? "active" : ""} onClick={() => void bridge().setLanguage("zh")}>
            中文
          </button>
        </div>
      </header>

      <div className="scroll">
        {/* Today */}
        <section className="card">
          <div className="card-title">
            <span>{t("today")}</span>
            <span className="hint">{new Intl.DateTimeFormat(tag, { dateStyle: "medium" }).format(new Date())}</span>
          </div>
          <div className="hero">
            <span className="value">{formatTokens(snap.today.usage.total)}</span>
            <span className="unit">{t("tokens").toLowerCase()}</span>
          </div>
          <div className="kpis">
            <div className="kpi">
              <div className="label">{t("cost")}</div>
              <div className="value">{formatUSD(snap.today.cost)}</div>
            </div>
            <div className="kpi">
              <div className="label">{t("cacheHit")}</div>
              <div className="value">{formatPercent(snap.today.cacheHitRate)}</div>
            </div>
            <div className="kpi">
              <div className="label">{t("requests")}</div>
              <div className="value">{snap.today.usage.requests}</div>
            </div>
          </div>
          <div className="breakdown">
            <span>
              {t("input")} <b>{formatTokens(snap.today.usage.input)}</b>
            </span>
            <span>
              {t("cached")} <b>{formatTokens(snap.today.usage.cached)}</b>
            </span>
            <span>
              {t("output")} <b>{formatTokens(snap.today.usage.output)}</b>
            </span>
            <span>
              {t("reasoning")} <b>{formatTokens(snap.today.usage.reasoning)}</b>
            </span>
          </div>
          {agents.length && (agents.length > 1 || agents[0].agent !== "codex") ? (
            <div className="chips" title={t("sources")}>
              <span className="chips-label">{t("sources")}{agentsPeriod === "month" ? ` · ${t("thisMonth")}` : ""}</span>
              {agents.map((a) => (
                <span className="chip" key={a.agent} title={`${formatTokens(a.usage.total)} · ${formatUSD(a.cost)} · ${a.sessions} ${t("sessions", { n: "" }).trim()}`}>
                  {a.agent} <b>{formatPercent(a.share)}</b>
                </span>
              ))}
            </div>
          ) : null}
          {snap.today.remoteUsage && snap.today.remoteUsage.total > 0 ? (
            <div className="remote-row">
              <span>{t("allDevicesToday")}</span>
              <span>
                <b>{formatTokens(snap.today.usage.total + snap.today.remoteUsage.total)}</b> · {formatUSD(snap.today.cost + (snap.today.remoteCost ?? 0))}
              </span>
            </div>
          ) : null}
        </section>

        {/* Live */}
        <section className="card">
          <div className="card-title">
            <span>{t("liveSession")}</span>
            {live ? <span className="hint">{relativeTime(L, live.lastEventAt, now)}</span> : null}
          </div>
          {live ? (
            <>
              <div className="live-head">
                <span className="project" title={live.projectName ?? live.sessionId}>
                  {live.projectName ?? live.sessionId.slice(0, 8)}
                </span>
                <span className="model">{live.model}</span>
                {live.agent !== "codex" ? <span className="tag">{t("via", { agent: live.agent })}</span> : null}
              </div>
              <div className="tps">
                <span className="value">{live.tokensPerSecond.toFixed(1)}</span>
                <span className="unit">{t("tokensPerSec")}</span>
                <span className="burst">
                  {t("burst10s")} {live.tokensPerSecond10s.toFixed(0)}
                </span>
              </div>
              {live.contextWindow ? (
                <div className="meter">
                  <div className="row">
                    <span>{t("context")}</span>
                    <b>
                      {t("contextUsage", {
                        used: formatTokens(live.contextUsed),
                        window: formatTokens(live.contextWindow),
                        percent: formatPercent(live.contextUsed / live.contextWindow),
                      })}
                    </b>
                  </div>
                  <div className="track">
                    <i className={`fill ${levelClass((live.contextUsed / live.contextWindow) * 100)}`} style={{ width: `${Math.min(100, (live.contextUsed / live.contextWindow) * 100)}%`, display: "block" }} />
                  </div>
                </div>
              ) : null}
              <div className="breakdown">
                <span>
                  {t("tokens")} <b>{formatTokens(live.sessionUsage.total)}</b>
                </span>
                <span>
                  {t("cost")} <b>{formatUSD(live.sessionCost)}</b>
                </span>
                <span>
                  {t("requests")} <b>{live.sessionUsage.requests}</b>
                </span>
              </div>
            </>
          ) : (
            <div className="empty">
              {t("noLiveSession")}
              {snap.lastActivityAt ? ` · ${t("lastActivity", { time: relativeTime(L, snap.lastActivityAt, now) })}` : ""}
            </div>
          )}
        </section>

        {/* Rate limits */}
        {rl && (rl.primary || rl.secondary || rl.additional.length) ? (
          <section className="card">
            <div className="card-title">
              <span>
                {t("rateLimits")}
                {rl.limitReached ? <span className="badge-err">{t("limitReached")}</span> : null}
              </span>
              {rl.planType ? (
                <span className="hint">
                  {t("plan")}: {rl.planType}
                  {rl.credits?.hasCredits ? ` · ${t("credits")}: ${rl.credits.unlimited ? "∞" : rl.credits.balance ?? ""}` : ""}
                </span>
              ) : null}
            </div>
            {[rl.primary, rl.secondary].map((w, i) =>
              w ? (
                <div className="meter" key={i} style={{ marginTop: i ? 8 : 0 }}>
                  <div className="row">
                    <span>
                      {t("windowLabel", { window: windowLabel(L, w.windowMinutes) })}
                      {w.resetsAt ? ` · ${t("resetsIn", { time: durationShort(L, w.resetsAt - now) })}` : ""}
                    </span>
                    <b>{w.usedPercent.toFixed(0)}%</b>
                  </div>
                  <div className="track">
                    <i className={`fill ${levelClass(w.usedPercent)}`} style={{ width: `${Math.min(100, w.usedPercent)}%`, display: "block" }} />
                  </div>
                </div>
              ) : null,
            )}
            {rl.additional.length ? (
              <div className="limits-extra">
                <div className="chips-label">{t("additionalLimits")}</div>
                {rl.additional.map((a) => (
                  <div className="row" key={a.name}>
                    <span title={a.name}>{a.name}</span>
                    <b>
                      {[a.primary, a.secondary]
                        .filter(Boolean)
                        .map((w) => `${windowLabel(L, w!.windowMinutes)} ${w!.usedPercent.toFixed(0)}%`)
                        .join(" · ")}
                    </b>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={`source-line ${rl.source === "live" ? "live" : "stale"}`}>
              <i className="dot" />
              <span>
                {rl.source === "live"
                  ? `${t("liveTag")} · ${t("updatedAgo", { time: relativeTime(L, snap.rateLimitsUpdatedAt, now) })}`
                  : `${t("fromLogs")} · ${t("asOf", { time: snap.rateLimitsUpdatedAt ? new Intl.DateTimeFormat(tag, { dateStyle: "short", timeStyle: "short" }).format(new Date(snap.rateLimitsUpdatedAt)) : "?" })}`}
              </span>
              {snap.rateLimitsError ? (
                <span className="err-hint" title={snap.rateLimitsError}>
                  {t("liveLimitsError", { message: snap.rateLimitsError })}
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Heatmap */}
        <section className="card">
          <div className="card-title">
            <span>{t("activity")}</span>
            <span className="hint">
              {t("lastWeeks", { n: snap.heatmapWeeks })}
              {snap.heatmapIncludesRemote ? ` · ${t("local")} + ${t("remote").toLowerCase()}` : ""}
            </span>
          </div>
          <Heatmap grid={snap.heatmap} lang={L} dark={dark} />
        </section>

        {/* Models */}
        <section className="card">
          <div className="card-title">
            <span>{t("models")}</span>
            <div className="seg">
              <button className={modelPeriod === "today" ? "active" : ""} onClick={() => setModelPeriod("today")}>
                {t("today")}
              </button>
              <button className={modelPeriod === "month" ? "active" : ""} onClick={() => setModelPeriod("month")}>
                {t("thisMonth")}
              </button>
            </div>
          </div>
          <Models models={models} lang={L} dark={dark} />
        </section>

        {/* Account */}
        <section className="card">
          <div className="card-title">
            <span>{t("cliStatusAccount")}</span>
            <span className="hint">{auth.deviceName}</span>
          </div>
          {auth.status === "signedIn" ? (
            <div className="row">
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t("signedInAs", { name: auth.user?.name || auth.user?.email || "?" })}
              </span>
              <button className="ghost" onClick={() => void bridge().logout()}>
                {t("signOut")}
              </button>
            </div>
          ) : auth.status === "pending" ? (
            <div className="auth-box">
              {auth.pendingCode ? (
                <>
                  <div className="code">{auth.pendingCode}</div>
                  <div className="empty">{t("pendingCode", { code: auth.pendingCode })}</div>
                  <div className="row">
                    {auth.verifyUrl ? (
                      <button onClick={() => void bridge().openExternal(auth.verifyUrl!)}>{t("openDashboard")}</button>
                    ) : null}
                    <button className="ghost" onClick={() => void bridge().cancelLogin()}>
                      {t("cancel")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty">…</div>
              )}
            </div>
          ) : (
            <div className="row">
              <span className="empty" style={{ flex: 1 }}>
                {t("signedOut")}
              </span>
              <button className="primary" onClick={() => void bridge().login()}>
                {t("signIn")}
              </button>
            </div>
          )}
          {auth.error ? <div className="error">{auth.error}</div> : null}
        </section>
      </div>

      <footer className="footer">
        <span className={`status ${snap.upload.lastError ? "err" : ""}`} title={snap.upload.lastError ?? ""}>
          {snap.upload.lastError
            ? t("uploadError", { message: snap.upload.lastError })
            : snap.upload.lastUploadAt
              ? t("lastUpload", { time: relativeTime(L, snap.upload.lastUploadAt, now) })
              : t("neverUploaded")}
        </span>
        <span className="spacer" />
        <span>{t("sessions", { n: snap.counts.sessions })}</span>
        <button className="ghost" onClick={() => void bridge().openDashboard()} title={auth.dashboardUrl}>
          {t("openDashboard")}
        </button>
        <span>{t("version", { version: snap.version })}</span>
      </footer>
    </div>
  );
}
