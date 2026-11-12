import { LoopPhone } from "./LoopPhone";

// `slide`: open mode's phone slide, on white, about one screen tall, with the
// headline beside the phone on wide screens. Without it, the section waitlist
// mode has always had.
export function Loop({ slide = false }: { slide?: boolean }) {
  if (slide) {
    return (
      <section
        id="loop"
        aria-labelledby="loop-title"
        className="paper flex min-h-[calc(100svh-5rem)] snap-start flex-col justify-center py-16 lg:py-10"
      >
        <div className="mx-auto w-full max-w-[1280px] px-5 sm:px-8">
          <LoopPhone
            intro={
              <>
                {/* Beside the phone, the column stops growing at 1280 px while the title size
                    keeps growing with the window: from 1024 px it follows the column instead, so
                    "Supplement" never runs under the phone. */}
                <h2 id="loop-title" className="semiwide max-w-[18ch] text-title font-bold lg:text-[length:min(var(--text-title),15cqi)] lg:leading-none">
                  Test first. Supplement second.
                </h2>
                <p className="mt-4 max-w-[46ch] text-smoke">
                  Four steps, then the loop starts again with your new numbers. Tap a step to see it on the phone.
                </p>
              </>
            }
          />
        </div>
      </section>
    );
  }

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
