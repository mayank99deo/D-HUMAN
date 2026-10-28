import { LoopPhone } from "./LoopPhone";

export function Loop() {
  return (
    <section aria-labelledby="loop-title" className="paper py-24 sm:py-32">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <h2 id="loop-title" className="semiwide max-w-[18ch] text-title font-bold">
          Test first. Supplement second.
        </h2>
        <p className="mt-6 max-w-[46ch] text-smoke">
          Four steps, and then the loop starts again with your new numbers. Tap a step to see it on the
          phone.
        </p>

        <LoopPhone />
      </div>
    </section>
  );
}
