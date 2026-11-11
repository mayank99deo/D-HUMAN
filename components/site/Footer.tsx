import { Wordmark } from "@/components/brand/Logo";
import { isWaitlist } from "@/lib/site-mode";

export function Footer() {
  return (
    <footer className="border-t border-paper/15 py-14">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-4">
          <Wordmark className="h-4 w-auto" />
          <p className="mt-4 text-sm text-graphite">Test first. Supplement second.</p>
        </div>
        <p className="max-w-[60ch] text-sm text-graphite lg:col-span-6 lg:col-start-7">
          {/* One string per mode, so each renders as a single text node. Open mode runs no tests of
              its own: it estimates meals and reads the reports people bring. */}
          {isWaitlist
            ? "D-Human offers wellness guidance and screening. It does not diagnose or treat any condition. Imaging and clinical tests are run by licensed partner centres."
            : "D-Human offers wellness guidance and screening. It does not diagnose or treat any condition. Meal numbers are estimates, and report reads are AI-analysed."}
          <span className="mt-4 block">© 2026 D-Human</span>
        </p>
      </div>
    </footer>
  );
}
