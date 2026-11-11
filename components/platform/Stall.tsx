"use client";

import { useEffect, useState } from "react";

// Shown inside a loading screen: after a few seconds it says so plainly and
// offers a reload, so a slow or stuck load never looks like a blank page.
export function Stall({ after = 6000 }: { after?: number }) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    const a = setTimeout(() => setStage(1), after);
    const b = setTimeout(() => setStage(2), after * 2.5);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [after]);
  if (!stage) return null;
  return (
    <div role="status" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-graphite">
      <span>{stage === 1 ? "This is taking longer than usual." : "Still loading. Check your connection, then reload."}</span>
      <button type="button" onClick={() => window.location.reload()} className="link-quiet min-h-11 text-paper">
        Reload
      </button>
    </div>
  );
}
