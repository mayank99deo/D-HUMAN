import { Wordmark } from "@/components/brand/Logo";
import type { Archetype } from "@/lib/domain/persona";
import { Emote } from "./Emote";

export type Tone = "go" | "go_with_tweaks" | "build" | "doctor_first" | null;

// A whisper of the verdict's colour in the bib's top corner. Paper stays paper.
const WASH: Record<Exclude<Tone, null>, string> = {
  go: "radial-gradient(120% 90% at 100% 0%, rgb(181 210 192 / 0.55), transparent 55%)",
  go_with_tweaks: "radial-gradient(120% 90% at 100% 0%, rgb(226 211 162 / 0.6), transparent 55%)",
  build: "radial-gradient(120% 90% at 100% 0%, rgb(226 211 162 / 0.45), transparent 55%)",
  doctor_first: "radial-gradient(120% 90% at 100% 0%, rgb(227 165 162 / 0.55), transparent 55%)",
};

// The race bib: your age is the number, your sport is the figure. Pin holes in
// the corners, a perforated tear-off strip that carries what's next.
export function Bib({
  number,
  name,
  label,
  archetype,
  next,
  nextDetail,
  tone = null,
  className = "",
}: {
  number: string;
  name: string;
  label: string;
  archetype: Archetype;
  next: string;
  nextDetail?: string | null;
  tone?: Tone;
  className?: string;
}) {
  // Sized to the card, not the screen, so the number and the figure never collide.
  const big = number.length > 2 ? "text-[24cqw]" : "text-[31cqw]";
  return (
    <figure
      className={`paper @container relative isolate overflow-hidden [--cut:22px] ${className}`}
      style={{
        clipPath: "polygon(var(--cut) 0, 100% 0, 100% 100%, 0 100%, 0 var(--cut))",
        backgroundImage: tone ? WASH[tone] : undefined,
      }}
      aria-label={`${name}, ${label}, bib number ${number}`}
    >
      {[
        "left-[18px] top-3",
        "right-[18px] top-3",
        "left-[18px] bottom-3",
        "right-[18px] bottom-3",
      ].map((pos) => (
        <span key={pos} aria-hidden className={`absolute h-2.5 w-2.5 rounded-full bg-ink ${pos}`} />
      ))}

      <div className="flex items-start justify-between gap-4 px-[8cqw] pt-8">
        <Wordmark className="h-3 w-auto" />
        <span className="text-right text-sm font-semibold leading-tight semiwide">{label}</span>
      </div>

      <div className="flex items-end justify-between gap-2 px-[7cqw] pb-6 pt-2">
        <div className="min-w-0 flex-1">
          <p className={`display-num ${big}`} aria-hidden>
            {number}
          </p>
          <figcaption className="mt-1 truncate text-[clamp(1.375rem,7cqw,2rem)] font-bold wide">{name}</figcaption>
        </div>
        <Emote archetype={archetype} className="-mb-2 h-[33cqw] w-[33cqw] shrink-0" label={label} />
      </div>

      <div className="relative border-t-2 border-dashed border-ink/35 px-10 py-4">
        <p className="text-[0.9375rem] font-semibold leading-snug">{next}</p>
        {nextDetail && <p className="text-sm text-smoke">{nextDetail}</p>}
      </div>
    </figure>
  );
}
