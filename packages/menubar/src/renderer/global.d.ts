import type { TrackerBridge } from "../core/snapshot";

declare global {
  interface Window {
    codexTracker: TrackerBridge;
  }
}

export {};
