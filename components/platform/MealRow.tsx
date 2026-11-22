"use client";

import type { MealView } from "@/lib/domain/meals";
import { langTag, scriptLanguage } from "@/lib/domain/speech";

const SOURCE: Record<string, string> = { photo: "photo", voice: "voice", text: "text" };

// One logged meal in a list (Today on Fuel, a day in Past meals), with its Delete.
export function MealRow({ meal: l, deleting, disabled, onDelete }: { meal: MealView; deleting: boolean; disabled: boolean; onDelete: () => void }) {
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-line py-4">
      <div className="min-w-0">
        <p className="text-sm text-graphite">
          {l.meal[0].toUpperCase() + l.meal.slice(1)}
          {l.time ? ` at ${l.time}` : ""}, by {SOURCE[l.source] ?? "text"}
          {l.confidence === "low" ? ", rough estimate" : ""}
        </p>
        {/* Titles in an Indian script get their language; the rest inherit the page's. */}
        <p lang={langTag(scriptLanguage(l.title), l.title)} className="font-semibold">
          {l.title}
        </p>
        <p className="truncate text-sm text-graphite">{l.items.join("; ")}</p>
      </div>
      <div className="text-right">
        <p className="font-bold">{Math.round(l.kcal).toLocaleString("en-IN")} kcal</p>
        <p className="text-sm text-graphite">{Math.round(l.proteinG)} g protein</p>
        <button type="button" className="link-quiet min-h-11 min-w-11 text-right text-sm" onClick={onDelete} disabled={disabled} aria-label={`Delete ${l.title}`}>
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </li>
  );
}
