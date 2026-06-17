"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";

export interface TopLoadingBarProps {
  active: boolean;
  className?: string;
  delayMs?: number;
  label?: string;
  minVisibleMs?: number;
  testId?: string;
}

export function TopLoadingBar({
  active,
  className,
  delayMs = 140,
  label = "Loading page",
  minVisibleMs = 220,
  testId = "top-loading-bar",
}: TopLoadingBarProps) {
  const [visible, setVisible] = useState(() => active && delayMs <= 0);
  const visibleSinceRef = useRef<number | null>(active && delayMs <= 0 ? Date.now() : null);

  useEffect(() => {
    if (active) {
      if (visible) {
        return undefined;
      }
      const showTimer = window.setTimeout(() => {
        visibleSinceRef.current = Date.now();
        setVisible(true);
      }, Math.max(0, delayMs));
      return () => window.clearTimeout(showTimer);
    }

    if (!visible) {
      visibleSinceRef.current = null;
      return undefined;
    }

    const elapsed = visibleSinceRef.current ? Date.now() - visibleSinceRef.current : minVisibleMs;
    const hideTimer = window.setTimeout(() => {
      visibleSinceRef.current = null;
      setVisible(false);
    }, Math.max(0, minVisibleMs - elapsed));
    return () => window.clearTimeout(hideTimer);
  }, [active, delayMs, minVisibleMs, visible]);

  return (
    <div
      aria-hidden={visible ? undefined : true}
      aria-label={visible ? label : undefined}
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden opacity-0 transition-opacity duration-150",
        visible && "opacity-100",
        className,
      )}
      data-active={visible ? "true" : "false"}
      data-testid={testId}
      role={visible ? "progressbar" : undefined}
    >
      <div className="absolute inset-0 bg-primary/20" />
      <div className="workbench-top-loading-bar__indicator absolute inset-y-0 left-0 w-1/2 bg-primary" />
    </div>
  );
}
