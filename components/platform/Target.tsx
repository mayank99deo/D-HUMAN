// Progress against a daily target. Reaching the target and going past it must
// read differently: past it, the fill runs on beyond a tick at the target, in
// a lighter tint, and the label says how much over. Neutral words, no red.

export const overBy = (value: number, target: number) => (target > 0 && value > target * 1.05 ? Math.round(value - target) : 0);

export function TargetBar({ value, target, opacity = 1, className = "mt-1.5" }: { value: number; target: number; opacity?: number; className?: string }) {
  const over = target > 0 && value > target;
  const scale = over ? value : target || 1;
  const met = (Math.min(value, target || value) / scale) * 100;
  return (
    <div className={`relative h-1 bg-line ${className}`} aria-hidden>
      <div className="absolute inset-y-0 left-0 bg-paper" style={{ width: `${Math.max(0, met)}%`, opacity }} />
      {over && (
        <>
          <div className="absolute inset-y-0 right-0 bg-paper" style={{ left: `calc(${met}% + 3px)`, opacity: opacity * 0.45 }} />
          <span className="absolute -top-1 h-3 w-0.5 bg-paper" style={{ left: `calc(${met}% + 0.5px)` }} />
        </>
      )}
    </div>
  );
}
