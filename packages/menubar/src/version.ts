declare const __APP_VERSION__: string | undefined;
declare const __APP_CHANNEL__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

/**
 * Which build this is. `scripts/build.mjs` stamps "prod" only for `--release`, which is what
 * `prepack` runs — so every published tarball is "prod" and every local `pnpm build` is "dev".
 *
 * A dev build talks to the local dashboard (and therefore the dev Convex deployment), keeps its
 * state in a separate config directory, and never offers to self-update. See src/core/config.ts.
 */
export type AppChannel = "dev" | "prod";
export const APP_CHANNEL: AppChannel = typeof __APP_CHANNEL__ !== "undefined" && __APP_CHANNEL__ === "prod" ? "prod" : "dev";
export const IS_DEV_BUILD = APP_CHANNEL === "dev";

/** Distinct name so a dev build gets its own Electron userData dir and can run beside a released one. */
export const APP_NAME = IS_DEV_BUILD ? "Codex Tracker (dev)" : "Codex Tracker";
