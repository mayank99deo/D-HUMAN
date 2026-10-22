import { Wordmark } from "@/components/brand/Logo";

export function Footer() {
  return (
    <footer className="border-t border-paper/15 py-14">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-4">
          <Wordmark className="h-4 w-auto" />
          <p className="mt-4 text-sm text-graphite">Test first. Supplement second.</p>
        </div>
        <p className="max-w-[60ch] text-sm text-graphite lg:col-span-6 lg:col-start-7">
          D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.
          Imaging and clinical tests are run by licensed partner centres and reviewed by a doctor.
          <span className="mt-4 block">© 2026 D-Human</span>
        </p>
      </div>
    </footer>
  );
}
