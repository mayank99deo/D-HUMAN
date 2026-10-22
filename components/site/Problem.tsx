import { VitaminDChart } from "./VitaminDChart";

export function Problem() {
  return (
    <section aria-labelledby="problem-title" className="border-t border-paper/15 py-24 sm:py-32">
      <div className="mx-auto grid max-w-[1280px] gap-14 px-5 sm:px-8 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-6">
          <h2 id="problem-title" className="semiwide max-w-[16ch] text-title font-bold">
            Most people buy supplements blind.
          </h2>
          <p className="mt-8 max-w-[46ch]">
            When Tata 1mg Labs tested 2.2 lakh people across 27 Indian cities, 76% were deficient in
            vitamin D. Yet most supplements in India are chosen from ads and influencers, by people who
            have never seen their own number.
          </p>
          <p className="mt-5 max-w-[46ch] text-graphite">
            The result is the wrong product, the wrong dose, and no way to tell whether any of it worked.
            D-Human starts with the number.
          </p>
        </div>

        <VitaminDChart />
      </div>
    </section>
  );
}
