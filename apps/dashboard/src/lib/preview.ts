/** Views of the design-preview harness (`/preview/<view>`). */
export const PREVIEW_VIEWS = ["personal", "team", "members", "devices", "settings"] as const;
export type PreviewView = (typeof PREVIEW_VIEWS)[number];

export function isPreviewView(v: string): v is PreviewView {
  return (PREVIEW_VIEWS as readonly string[]).includes(v);
}

/** The harness is on in development and off in production unless opted in explicitly. */
export function isPreviewEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DESIGN_PREVIEW === "1";
}
