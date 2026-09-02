"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useScene } from "@/components/scene/scene-provider";

/** A link that warps the starfield before navigating. Modified clicks (new tab, etc.) behave normally. */
export function LaunchLink({ href, onClick, children, ...rest }: ComponentProps<typeof Link>) {
  const { launch, launching } = useScene();
  const target = typeof href === "string" ? href : (href.pathname ?? "/");

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    launch(target);
  }

  return (
    <Link href={href} onClick={handleClick} aria-busy={launching || undefined} {...rest}>
      {children}
    </Link>
  );
}
