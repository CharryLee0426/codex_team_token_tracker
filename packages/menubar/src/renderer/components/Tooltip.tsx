import { useCallback, useState, type ReactNode } from "react";

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Lightweight fixed-position hover tooltip shared by the heatmap and model bars. */
export function useTooltip() {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => {
    setTip({ x: e.clientX, y: e.clientY, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function Tooltip({ tip }: { tip: TooltipState | null }) {
  if (!tip) return null;
  const width = 200;
  const left = Math.min(Math.max(8, tip.x - width / 2), window.innerWidth - width - 8);
  const top = tip.y > 90 ? tip.y - 58 : tip.y + 16;
  return (
    <div className="tooltip" style={{ left, top, minWidth: 0 }}>
      {tip.content}
    </div>
  );
}
