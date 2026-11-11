"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Plays a block's entrance once, the first time it scrolls into view. Children
// style themselves with `group-data-[play=armed]/play:` (hidden, waiting) and
// `group-data-[play=on]/play:` (playing) variants.
//
// The server renders the finished state with no data-play at all. It is only
// armed (hidden) after hydration, when motion is allowed and the block is still
// below the fold, so no-JS, reduced motion and a reload halfway down the page
// all see the finished state. The attribute is set on the node directly: no
// state, no re-render.
export function PlayOnView({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < innerHeight * 0.9) return;
    el.dataset.play = "armed";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.play = "on";
        io.disconnect();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`group/play ${className}`}>
      {children}
    </div>
  );
}
