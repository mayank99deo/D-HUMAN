import { Stall } from "@/components/platform/Stall";

// What a tab shows the moment it's tapped, while its data streams in: the page's own
// title where the page puts it, a quiet loading line, and a reload offer if it drags on.
// It used to be an empty black page, which on a phone connection looked as if the tap
// had done nothing. `main` carries the page's own width and top padding, so nothing
// moves when the page arrives. (Home has its own skeleton, in home/page.tsx.)
export function PageLoading({ title, main = "max-w-3xl lg:pt-12" }: { title: string; main?: string }) {
  return (
    <main className={`mx-auto min-h-[60dvh] px-4 pb-20 pt-8 sm:px-6 ${main}`}>
      <h1 className="verdict-type text-[clamp(2.25rem,6.5vw,3.5rem)]">{title}</h1>
      <p className="mt-4 text-sm text-graphite" role="status" aria-live="polite">
        Loading…
      </p>
      <Stall />
    </main>
  );
}
