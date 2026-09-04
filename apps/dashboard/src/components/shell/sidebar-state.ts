"use client";

import { useCallback, useEffect, useState } from "react";
import { SIDEBAR_COOKIE, type SidebarState } from "./sidebar-cookie";

/** Viewport at which `auto` shows labels. Mirrors the `xl` rule in `globals.css`. */
const AUTO_EXPANDED_QUERY = "(min-width: 1280px)";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Fold state for the desktop rail, mirroring `NavigationSplitView`'s sidebar toggle: a button, the
 * ⌃⌘S chord AppKit binds to it, and a preference that sticks. Layout itself is CSS — the state only
 * lands on the shell as `data-sidebar`, so the very first paint is already the right width.
 */
export function useSidebar(initial: SidebarState) {
  const [state, setState] = useState<SidebarState>(initial);
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [mac, setMac] = useState<boolean | null>(null);

  // `auto` resolves against the viewport, so the button knows which way it would fold.
  useEffect(() => {
    const mql = window.matchMedia(AUTO_EXPANDED_QUERY);
    const sync = () => setAutoExpanded(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  useEffect(() => setMac(/Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)), []);

  const expanded = state === "auto" ? autoExpanded : state === "expanded";

  const toggle = useCallback(() => {
    setState((prev) => {
      const next: SidebarState = (prev === "auto" ? autoExpanded : prev === "expanded") ? "collapsed" : "expanded";
      document.cookie = `${SIDEBAR_COOKIE}=${next};path=/;max-age=${ONE_YEAR};samesite=lax`;
      return next;
    });
  }, [autoExpanded]);

  // ⌃⌘S on macOS, Ctrl+Alt+S elsewhere. `code` so the chord survives non-QWERTY layouts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyS" || !e.ctrlKey || !(e.metaKey || e.altKey)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Empty until mounted: the platform is unknown while rendering on the server.
  const shortcut = mac === null ? "" : mac ? "⌃⌘S" : "Ctrl+Alt+S";

  return { state, expanded, toggle, shortcut };
}
