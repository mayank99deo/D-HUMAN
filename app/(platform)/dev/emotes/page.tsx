import { notFound } from "next/navigation";
import { Emote } from "@/components/platform/Emote";
import { ACTIVITIES } from "@/lib/domain/options";

// Dev-only contact sheet of the persona emotes: each sport at six points in its cycle.
const PHASES = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];

export default function EmotesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="p-2">
      {ACTIVITIES.map((a) => (
        <div key={a.id} className="flex items-center gap-1 border-b border-line">
          <p className="w-28 text-xs text-graphite">{a.label}</p>
          {PHASES.map((p) => (
            <Emote key={p} archetype={a.id} phase={p} className="h-24 w-24" />
          ))}
          <div className="paper ml-2"><Emote archetype={a.id} className="h-24 w-24" /></div>
        </div>
      ))}
    </main>
  );
}
