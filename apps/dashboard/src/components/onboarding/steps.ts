/**
 * The guided tour, stage by stage. Briefing steps (no `target`) are centered cards with an
 * illustration; the rest spotlight a `[data-tour]` element in the real UI (rail / tab-bar links,
 * the range picker) and dock a compact card next to it.
 */
export type TourPhase = "briefing" | "connect" | "run" | "board" | "go";

export type TourStepId = "welcome" | "connect" | "run" | "personal" | "team" | "members" | "devices" | "range" | "settings" | "done";

export type TourArtKind = "flow" | "terminal" | "tray" | "done";

export interface TourStep {
  id: TourStepId;
  phase: TourPhase;
  /** `data-tour` value to spotlight. Missing on the page (or hidden at this viewport) → centered card. */
  target?: string;
  /** Side of the target the card prefers on desktop; phones always dock it at the bottom. */
  placement?: "right" | "bottom" | "left" | "top";
  art?: TourArtKind;
}

export const TOUR_PHASES: readonly TourPhase[] = ["briefing", "connect", "run", "board", "go"];

export const TOUR_STEPS: readonly TourStep[] = [
  { id: "welcome", phase: "briefing", art: "flow" },
  { id: "connect", phase: "connect", art: "terminal" },
  { id: "run", phase: "run", art: "tray" },
  { id: "personal", phase: "board", target: "nav-personal", placement: "right" },
  { id: "team", phase: "board", target: "nav-team", placement: "right" },
  { id: "members", phase: "board", target: "nav-members", placement: "right" },
  { id: "devices", phase: "board", target: "nav-devices", placement: "right" },
  { id: "range", phase: "board", target: "range", placement: "bottom" },
  { id: "settings", phase: "board", target: "nav-settings", placement: "right" },
  { id: "done", phase: "go", art: "done" },
];
