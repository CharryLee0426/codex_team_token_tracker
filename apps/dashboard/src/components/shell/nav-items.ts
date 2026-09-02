import { Contact, Gauge, MonitorSmartphone, Settings, Users, type LucideIcon } from "lucide-react";

export type NavSegment = "personal" | "team" | "members" | "devices" | "settings";

export interface NavItem {
  segment: NavSegment;
  /** Translation key under `nav`. */
  key: NavSegment;
  Icon: LucideIcon;
}

export const PRIMARY_NAV: NavItem[] = [
  { segment: "personal", key: "personal", Icon: Gauge },
  { segment: "team", key: "team", Icon: Users },
  { segment: "members", key: "members", Icon: Contact },
  { segment: "devices", key: "devices", Icon: MonitorSmartphone },
];

export const SETTINGS_NAV: NavItem = { segment: "settings", key: "settings", Icon: Settings };

/** Default route for each segment; the design-preview harness swaps this for `/preview/*`. */
export function defaultHrefFor(segment: NavSegment): string {
  return segment === "settings" ? "/settings" : `/dashboard/${segment}`;
}

export function isSegmentActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + "/");
}
