# Kickoff review: AI cost, context and latency

AI efficiency lead (AI agent), 2026-11-11. From code and the 2026-11-09 measurements; no live calls.

## Cost per active user

| Job | Unit (measured) | Per month | $/month |
| --- | --- | --- | --- |
| Report | $0.026 | 0.33 | 0.009 |
| Meals | $0.0005 | 60 | 0.030 |
| Stack | $0.16 | 0.33 | 0.053 |
| Events | $0.13 | 0.33 | 0.043 |
| Wraps | ~$0.0007 (estimate) | 4 | 0.003 |
| **Total** | | | **~$0.14** |

Assumes each report triggers one unshared event refresh (see 2). Month one is ~$0.35. Search jobs are 70% of spend; reads 6%. The sample has 24 markers; real full-body reports have 60–90, so extraction will slow. After fixes 1 and 2: **~$0.06**.

## Findings, by impact

**1. Brand searches are personal; brands aren't.** `lib/ai/stack.ts:18,44`. Every stack searches "vitamin D3 India" afresh. *Fix:* a shared brand table per nutrient, form and diet, searched on a miss, refreshed monthly. The stack then needs no search and can use structured outputs. *Saves:* ~$0.16 → ~$0.03 a stack, 42 s → ~15–20 s, ~$0.04/user/month. Ends leaked search notes in cautions. *Risk:* low; one list Mayank can review. **M**

**2. Event searches rarely share.** `lib/platform/events.ts:17,24`. The key holds free-text city and event name, so "Navi Mumbai" or any typed event buys a new $0.13 search. *Fix:* group cities into metros; look named events up in the table first (`findEventByName`, line 140), searching once only on a miss; refresh monthly. *Saves:* ~$0.04/user/month plus $0.13 per signup. *Risk:* low. **S–M**

**3. Retest reads wait 8 s for nothing.** `lib/platform/analyze.ts:48,113`. When the search is over 7 days old, the read waits up to 8 s for a refresh, though stored events exist. Most quarterly retests hit this. *Fix:* wait only when none are stored. *Saves:* up to 8 s (a ~34 s read becomes ~26 s). *Risk:* none. **S**

**4. No real cap on stack spend.** `app/api/stack/route.ts:13`. 5 an hour per instance, in memory: ~$19 a day per account. *Fix:* count `stacks` rows over 24 h; reuse the last stack when report and diet haven't changed. **S**

**5. One missing key wastes a paid search.** `lib/ai/schemas.ts:128-163`, `lib/ai/events.ts:35`, `lib/ai/stack.ts:45`. Free-text JSON meets all-required schemas: one omitted `ends_on` fails a $0.13 call, then events wait 6 h. *Fix:* `.nullish()` fields; drop bad items, not the batch. **S**

**6. Haiku refusals get the wrong advice.** `lib/ai/client.ts:33`, `analyze.ts:186`. Extraction has no fallback, so a refusal says "try a clearer photo". *Fix:* retry once on Sonnet with fallback. **S**

**7. Output nobody sees.** `ref_text` is shown only when a range has no numbers (`components/platform/Markers.tsx:66-74`) but is written for every marker; `for_you` (`schemas.ts:54`) is never shown. *Fix:* ask for `ref_text` only for non-numeric ranges; drop `for_you`; stream the verdict to the orbit as it arrives. *Saves:* ~2 s on the sample, more on big reports. **S**

**8. Caching isn't a lever yet.** Food, wrap and event prompts are under the 512-token minimum; the rest arrive minutes apart. Fix `logUsage`, which prices cache tokens as full input (`client.ts:50-52`). `pause_turn` resends (`client.ts:114-131`) likely reset `max_uses` and don't cache. **S**

Leave reads, meals and wraps alone; Sonnet earns its place on the read.

## Verified vs inferred

Verified in code: 3–7 and the log bug in 8. Inferred: savings in 1–2, wrap cost, token splits, the `max_uses` reset. Next, with a key: run the sample and a 70-marker report; log usage per job.

**Mayank decides:** shared brand lists (1); monthly event refresh (2).
