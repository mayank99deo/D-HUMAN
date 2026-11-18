// The drawn cover for a post with no photo: contour lines in the hero's language, seeded by
// the post's address, so each post gets its own drawing and it never changes. Static SVG,
// drawn on the server; coordinates are rounded so server and browser always agree. It
// fills whatever box it's in (slice), so one drawing serves the 3:2 cover, the 2:1 laptop
// cover and the square thumbnail. Decorative: the title beside it carries the meaning.

const W = 300;
const H = 200;
const RINGS = 7;
const POINTS = 36;

/** FNV-1a: a stable 32-bit number from the slug. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded random number generator. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** One closed ring as a smooth path through midpoints. */
function ring(cx: number, cy: number, radius: number, wobble: number[], phase: number[]): string {
  const pts = Array.from({ length: POINTS }, (_, i) => {
    const a = (i / POINTS) * Math.PI * 2;
    const k = 1 + wobble[0] * Math.sin(2 * a + phase[0]) + wobble[1] * Math.sin(3 * a + phase[1]) + wobble[2] * Math.sin(5 * a + phase[2]);
    return [cx + radius * k * Math.cos(a), cy + radius * k * Math.sin(a) * 0.8];
  });
  const mid = (i: number) => {
    const [x1, y1] = pts[i % POINTS];
    const [x2, y2] = pts[(i + 1) % POINTS];
    return `${r1((x1 + x2) / 2)} ${r1((y1 + y2) / 2)}`;
  };
  let d = `M${mid(0)}`;
  for (let i = 1; i <= POINTS; i++) {
    const [x, y] = pts[i % POINTS];
    d += `Q${r1(x)} ${r1(y)} ${mid(i)}`;
  }
  return `${d}Z`;
}

/** The drawing's path data for a slug. Exported for tests: same slug, same drawing. */
export function contourPaths(slug: string): string[] {
  const rand = seeded(hash(slug));
  const centres = [
    [W * (0.2 + rand() * 0.3), H * (0.25 + rand() * 0.5)],
    [W * (0.55 + rand() * 0.3), H * (0.25 + rand() * 0.5)],
  ];
  const paths: string[] = [];
  for (const [cx, cy] of centres) {
    const phase = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
    const base = 10 + rand() * 10;
    for (let k = 0; k < RINGS; k++) {
      const grow = k / RINGS;
      paths.push(ring(cx, cy, base + k * 15, [0.06 + 0.1 * grow, 0.04 + 0.06 * grow, 0.02 + 0.03 * grow], phase));
    }
  }
  return paths;
}

export function ContourCover({ slug, label, className = "" }: { slug: string; label?: string; className?: string }) {
  return (
    <div aria-hidden="true" className={`relative h-full w-full overflow-hidden bg-lift text-paper ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        {contourPaths(slug).map((d, i) => (
          <path key={i} d={d} fill="none" stroke="currentColor" strokeOpacity={0.32} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {label && <span className="wide absolute bottom-4 left-4 text-sm font-extrabold sm:bottom-5 sm:left-5 sm:text-base">{label}</span>}
    </div>
  );
}
