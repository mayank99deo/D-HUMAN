// How naturally romanize() writes Hinglish heard in hi-IN: every case in
// tests/fixtures/hinglish-transcripts.ts, graded word by word against what a Hinglish texter
// would write. Offline and free.
//
//   node scripts/romanize-eval.mts [path/to/romanize.ts]
//
// Pass another copy of romanize.ts (an older commit's, say) to compare.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { HELD_OUT, readsNaturally, TRANSCRIPTS, type Transcript } from "../tests/fixtures/hinglish-transcripts.ts";

const file = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dirname, "../lib/domain/romanize.ts");
const { romanize } = (await import(pathToFileURL(file).href)) as { romanize: (t: string) => string };

function score(name: string, set: Transcript[]) {
  const rows = set.map((t) => ({ t, out: romanize(t.hi), ...readsNaturally(romanize(t.hi), t.want) }));
  const count = (kind: Transcript["kind"]) => {
    const mine = rows.filter((r) => r.t.kind === kind);
    return `${kind} ${mine.filter((r) => r.ok).length} of ${mine.length}`;
  };
  console.log(`${name}: ${rows.filter((r) => r.ok).length} of ${rows.length} read naturally (${count("meal")}, ${count("ask")})`);
  for (const r of rows.filter((x) => !x.ok)) console.log(`  ${r.t.id}: ${r.t.hi}  →  ${r.out}   (${r.why})`);
}

score("corpus", TRANSCRIPTS);
score("held out", HELD_OUT);
