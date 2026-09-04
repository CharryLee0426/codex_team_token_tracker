/** Persisted rail fold preference. Server-safe so layouts can read it before the first paint. */
export const SIDEBAR_COOKIE = "sidebar";

/** `auto` means nothing is stored yet: icons from `md`, labels from `xl`, as the rail behaved before. */
export type SidebarState = "auto" | "expanded" | "collapsed";

export function toSidebarState(value: string | undefined): SidebarState {
  return value === "expanded" || value === "collapsed" ? value : "auto";
}
