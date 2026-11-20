# Draft: meal tracking in India

Status: first draft by the SEO lead (an AI agent), 2026-11-20. For Mayank to edit and publish under his byline at `/write`. Paste-ready copy: `/Users/mayanknarayan/Downloads/D-Human-blog-meal-tracking-india.html`. Publish it after post 1 (`/blog/preventive-health-checkup-india`), which it links to.

## Metadata

| Field | Value |
| --- | --- |
| Title (H1) | Meal tracking in India: who does it, and why it matters (55 characters) |
| Search title | Do Indians track their meals? What the data says (48 characters; the page adds " \| D-Human", making 58) |
| Slug | `meal-tracking-india` |
| Dek | We found no national count of Indians who track their meals. Here's what the data does show on diet, blood pressure and sugar, age by age. (138 characters) |
| Search description | No national survey counts Indians who track meals. What the data does show on diet, blood pressure and sugar by age, and an easier way to start. (144 characters) |
| Topic | `calories` (Calories and Indian food); pillar guide `/calorie-tracker` |
| Main query | meal tracking india |
| Secondary queries | how many indians track calories; indian diet carbs protein; high blood pressure by age india; blood sugar by age india |
| Internal links | `/calorie-tracker` (intro, first third), `/protein-tracker`, `/blog/preventive-health-checkup-india`, `/signin` |
| Try it | Fuel |
| Review | The second read is required for every post. No ranges, cut-offs or doses appear (the survey definitions of "high" are described in words, not numbers), so §4.10 doesn't require a doctor's review. The post is about blood pressure and blood sugar by age, so a doctor's or dietitian's read is worth having once one is on board. |

**Search intent.** Someone asking "do Indians track calories" or "is the Indian diet too heavy on carbs" wants the facts, not an app. This post answers with the data that exists, says plainly what doesn't, and then shows a tool. It doesn't target "calorie tracker app" or "calorie tracker in Hindi", which `/calorie-tracker` owns (`STRATEGY.md` §2, Pillar A). It links up to that guide in its first third.

**What the post claims about the product, and where that's true in code:** see rows 22 to 27 of "Numbers to check".

## After Import, in the editor

1. Replace the paragraph that starts "Try it in Fuel" with a **Try it** block (destination: Fuel). Its line fits the 90-character limit as written.
2. Turn the paragraph that starts "Worth showing a doctor:" into a **Worth showing a doctor** block. Drop the bold label, because the block has its own fixed title.
3. Move the Sources list into the editor's **Sources** panel, one entry each. Use the short names in the table under "Sources panel entries" below: each is under the panel's 200-character limit. Then delete the pasted "Sources" heading and list, or they'll show twice.
4. Internal links come in as full `https://www.d-human.fit/...` addresses, because a browser copy makes links absolute. They work as they are. Trimming them to paths (`/calorie-tracker`) makes them internal links.
5. Optional: make 1 or 2 numbers into **Key number** blocks with their source picked. Good ones: "1 in 4" (women aged 40–49 with high blood pressure, 25.0%, NFHS-5, source 3) and "62.3%" (share of the day's energy from carbohydrates, ICMR-INDIAB, source 2).
6. Optional: rebuild the age list ("What changes with age") as a **Table** block, with source 3 picked, or the editor will block it. Four columns fit: Age | High blood pressure, women | High blood pressure, men | High blood sugar, women / men. The rows are in "Numbers to check", row 10.
7. The page adds its own closing line ("General information, not medical advice..."). The short disclaimer at the end of the body can stay or go. The post doesn't describe report reads, so the AI-analysed line isn't needed.
8. Set the topic, slug, search title, description and dek from the table above.

### Sources panel entries

| # | Name (for the panel) | Link |
| --- | --- | --- |
| 1 | PwC India. Voice of the Consumer 2026: India perspective. Survey of 1,005 adults in Indian cities, Feb–Mar 2026. Report and press release, Mumbai, 17 Nov 2026. | https://www.pwc.in/industries/retail-and-consumer/voice-of-the-consumer-2026-india-perspective.html |
| 2 | Anjana RM, Sudha V, Abirami K, et al. Dietary profiles and associated metabolic risk factors in India from the ICMR–INDIAB survey-21. Nature Medicine 2025; 31: 3813–3824. | https://www.nature.com/articles/s41591-025-03949-4 |
| 3 | IIPS and ICF. National Family Health Survey (NFHS-5), 2019–21: India, Volume I. Mumbai: IIPS, 2021. Tables 10.25, 10.26, 12.2, 12.3 and 12.5. | https://dhsprogram.com/publications/publication-FR375-DHS-Final-Reports.cfm |
| 4 | IIPS. National Family Health Survey (NFHS-6), 2023–24: India and State/UT Fact Sheets (provisional). Mumbai: IIPS, May 2026. | https://www.pib.gov.in/PressReleasePage.aspx?PRID=2266600 |
| 5 | National Statistics Office, MoSPI. Health in India: NSS 75th round (July 2017–June 2018), Report No. 586, Table A54. | https://mospi.gov.in/sites/default/files/publication_reports/NSS%20Report%20no.%20586%20Health%20in%20India.pdf |
| 6 | NITI Aayog. Health Insurance for India's Missing Middle. New Delhi: NITI Aayog, October 2021. | https://www.niti.gov.in/sites/default/files/2021-10/HealthInsurance-forIndiasMissingMiddle_28-10-2021.pdf |
| 7 | National Health Systems Resource Centre. National Health Accounts Estimates for India 2023–24. New Delhi: Ministry of Health and Family Welfare, 2026. | https://nhsrcindia.org/sites/default/files/2026-11/NHA%20Report%202023-24.pdf |
| 8 | Burke LE, Wang J, Sevick MA. Self-monitoring in weight loss: a systematic review of the literature. J Am Diet Assoc 2011; 111(1): 92–102. | https://pubmed.ncbi.nlm.nih.gov/21185970/ |

## Cover brief (for the graphic designer)

The strongest cover is the age ladder: one verified figure per decade, from one survey, one method. Black and white, Archivo set wide, the numbers as the image. No photos of people, food or pills.

1. **Lead: "1 in 8 → 1 in 4 → nearly 1 in 2".** Women in India with high blood pressure: 12.9% at 30–39, 25.0% at 40–49, 48.7% at 60–69. Source line: "Women 30–39, 40–49, 60–69 with high blood pressure. NFHS-5, 2019–21." (Table 12.3.1.) NFHS's own text says "one in eight women ... age 30-39" and "about one-fourth of women and men age 40-49".
2. **Alternative ladder, both sexes:** high blood pressure at 20–24 vs 70 and over: women 4.7% to 56.3%, men 8.7% to 49.4% (Tables 12.3.1 and 12.3.2).
3. **The plate, one number:** "62.3%" of the day's energy from carbohydrates, protein 12% (ICMR-INDIAB, *Nature Medicine* 2025).

Don't put the PwC 49% on the cover. It's an urban consumer survey, and a cover strips the caveat. If a "no data" angle is wanted, the line is words, not a number: "Nobody counts who tracks their meals."

Colour, if any, follows house rules: only the blood colours, and only next to a glyph. A ladder of percentages isn't marker status, so plain black and white is the safer choice.

---

# Meal tracking in India: who does it, and why it matters

*Written with AI assistance and edited by Mayank Narayan.*

How many Indians keep track of what they eat? It sounds like a question with a ready answer. It isn't. We looked through India's big national health surveys and couldn't find one that asks it.

Those surveys do measure what surrounds it: how we eat, how blood pressure and blood sugar climb with age, how late many of us get checked, and who pays. Here are those numbers, each with its source, and how D-Human makes [counting calories and protein in Indian meals](https://www.d-human.fit/calorie-tracker) as simple as saying what you ate, in your own language.

## Nobody counts the counters

The closest thing to a number comes from a consumer survey, not a national one. PwC's Voice of the Consumer 2026 asked 1,005 adults in metros and tier-2 and tier-3 cities across 15 states and two union territories, in February and March 2026. 49% said they regularly track their calories and 53% their protein, against 33% and 35% across the 27 countries it surveyed.

That's a useful signal with two limits. It covers cities only, so it can't speak for rural India. And it records what people say they do, not what they write down. We found no public survey that breaks meal tracking down by age.

That gap is part of the story. A habit nobody measures is easy to ignore. So here is what is measured.

## How India eats

The best national picture of Indian diets comes from the ICMR-INDIAB study. Its diet analysis, published in *Nature Medicine* in 2025, covered 18,090 adults aged 20 and over from 30 states and union territories and Delhi. Of the day's energy:

- **Carbohydrates gave 62.3%,** mostly from refined cereals such as white rice (28.5%) and milled whole grains such as atta (16.2%).
- **Protein gave 12%,** below the 15% that India's national dietary guideline recommends. Most of it came from plant foods (8.9%), with dairy at 2% and eggs, fish and meat together at 1%.

Two findings matter for the plate. Swapping refined cereals such as white rice for whole wheat or millet flour, without eating less carbohydrate overall, wasn't linked to a lower risk of type 2 diabetes. But in the study's models, moving 5% of the day's energy from carbohydrate to protein from plants, dairy, eggs or fish was linked to lower odds of newly found diabetes and prediabetes. These are associations, not proof, but they point one way: more protein on a plate that's mostly rice or roti. Here's [how to track protein in Indian meals](https://www.d-human.fit/protein-tracker).

The National Family Health Survey (NFHS-5, 2019–21) adds the everyday view for adults aged 15 to 49. Only 12.5% of women and 12.2% of men ate fruit every day. About half ate dal or beans daily (49.6% of women, 48.1% of men), and 48.8% of both had milk or curd daily. How often people eat each kind of food barely shifts between their 20s and their 40s.

## What changes with age

How often people eat each kind of food barely changes from their 20s to their 40s. Their readings do. NFHS-5 measured blood pressure and blood sugar in women and men aged 15 and over. Here is the share in each age group with high blood pressure (high on the day, or on medicine for it) and with high blood sugar on a test taken at any time of day (or on medicine for it):

- **20–29:** high blood pressure in 4.7% (ages 20–24) and 6.7% (25–29) of women, and 8.7% and 12.4% of men. High blood sugar in 3.8% and 5.2% of women, and 4.5% and 6.6% of men.
- **30–39:** high blood pressure in 12.9% of women and 19.3% of men. High blood sugar in 8.9% and 11.3%.
- **40–49:** high blood pressure in 25.0% of women and 28.4% of men. High blood sugar in 16.1% and 18.5%.
- **50–59:** high blood pressure in 36.0% (ages 50–54) and 40.1% (55–59) of women, and 35.2% and 37.8% of men. High blood sugar in 24.1% and 26.4% of women, and 24.7% and 27.9% of men.
- **60–69:** high blood pressure in 48.7% of women and 43.2% of men. High blood sugar in 29.5% and 30.6%.
- **70 and over:** high blood pressure in 56.3% of women and 49.4% of men. High blood sugar in 30.0% and 32.2%.

Put plainly: about one woman in eight in her 30s has high blood pressure, one in four in her 40s, and nearly one in two in her 60s. For blood pressure, men's numbers run higher until about 50; after that, women's do.

The latest round points up. NFHS-6 (2023–24, provisional) found high blood sugar in 17.8% of women and 20.9% of men aged 15 and over, up from 13.5% and 15.6% in 2019–21. Its age tables aren't out yet.

These are survey readings, taken once. A single reading isn't a diagnosis.

## Many of us check late

You can't feel most of this, as our post on [preventive health checkups in India](https://www.d-human.fit/blog/preventive-health-checkup-india) explains. So it's found only when someone measures it, and many people never have been measured. In NFHS-5, 67.0% of women and 53.7% of men aged 15 and over said their blood pressure had ever been measured before the survey. That leaves about one woman in three, and nearly one man in two, who had never had it checked.

The national health survey of 2017–18 (NSS, 75th round) points the same way. It asked about illnesses in the 15 days before each interview. When people handled an illness without medical advice, the reason given for 73.5% of those illnesses was "ailment not considered serious enough".

## Who pays when it turns serious

In 2021, NITI Aayog estimated that at least 30% of Indians, about 40 crore people, had no financial protection for health. Cover has grown since. NFHS-6 found that 60.2% of households had at least one member covered by a health insurance or financing scheme in 2023–24, up from 41.0% in 2019–21. But one covered member isn't a covered family, and the main government scheme, Ayushman Bharat PM-JAY, provides hospitalisation cover.

A large share of the bill still lands at home. India's National Health Accounts found that households paid 42.7% of the country's total health spending out of their own pockets in 2023–24.

Food is the part you can act on every day, without a hospital visit. That starts with knowing what's on the plate.

## Why tracking feels hard here

Indian food rarely comes in labelled packets. A katori of dal, two rotis from home, sabzi with a spoon of ghee: each adds up differently in every kitchen. Tracking usually means typing in English and searching a food list for something close to what your mother made. It's easy to see why the habit stops there.

## How D-Human makes it easier

D-Human's Fuel is built for the plate you actually eat.

- **Say it, snap it or type it.** Log a meal by photo, voice or a few words, in English, Hinglish, Hindi and 9 more Indian languages: Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Punjabi and Urdu.
- **Hear back in your language.** Speak in any of them and the meal's name, and a short tip when there's one worth giving, come back in that language. Say "do roti, dal aur ek katori dahi" and the reply is in Hinglish. Pick Tamil, speak, and it answers in Tamil. You don't need to say it in English.
- **One ring for the day.** Fuel's ring fills toward your day's calories, with protein, carbs and fat against targets set from your height, weight, age, sex, training and goals, plus fibre and key vitamins and minerals against daily targets. The numbers are AI estimates, not lab results.
- **Small additions, not a new diet.** After three fully logged days, or once you've described your usual day, the Stack screen lists "What your food is short of", each with what to eat, in foods that fit your diet: curd, a ragi roti or milk for calcium (ragi, til or tofu if you're vegan); a handful of peanuts or pumpkin seeds for magnesium; amla, guava or lemon on your dal for vitamin C. Vitamin D, iron and folate say "Test first." until there's a blood result.
- **Something to look back on.** A Wrap turns a week, a month or a year of meals into a short story you tap through, built from your own log: your longest streak, your best protein day, your go-to foods and when you usually eat them, and which nutrients ran lowest.

Free to start. All you need is your email: [start with D-Human](https://www.d-human.fit/signin).

> [Editor: make this a "Try it" block, destination Fuel]

[Try it in Fuel: say your next meal in your own language.](https://www.d-human.fit/signin?next=%2Ffuel)

> [Editor: make this a "Worth showing a doctor" block]

**Worth showing a doctor:** a blood pressure or blood sugar reading that's high on more than one day, any result outside your lab's printed range, or any symptom that worries you. If you feel unwell, don't wait for a test.

## Questions

### How many Indians track their meals?

No national survey we found measures it. The closest figure is an urban consumer survey from 2026: 49% of 1,005 adults in Indian cities said they track their calories. Nothing we found breaks it down by age.

### Does tracking what you eat help?

Studies elsewhere suggest it can. A review of 22 self-monitoring studies, 15 of them on tracking food, found "a significant association between self-monitoring and weight loss", but rated the evidence weak, and in all but two of the studies the samples were mostly white and mostly women. Tracking's main job is simpler: it shows you patterns that memory misses.

*This is general information, not medical advice. If you feel unwell, see a doctor.*

## Sources

1. PwC India. Voice of the Consumer 2026: India perspective. Report and press release, Mumbai, 17 November 2026. Survey of 1,005 adults in Indian cities, February–March 2026. [pwc.in](https://www.pwc.in/industries/retail-and-consumer/voice-of-the-consumer-2026-india-perspective.html)
1. Anjana RM, Sudha V, Abirami K, et al. Dietary profiles and associated metabolic risk factors in India from the ICMR–INDIAB survey-21. *Nature Medicine* 2025; 31: 3813–3824. [nature.com](https://www.nature.com/articles/s41591-025-03949-4) (DOI 10.1038/s41591-025-03949-4)
1. International Institute for Population Sciences (IIPS) and ICF. National Family Health Survey (NFHS-5), 2019–21: India, Volume I. Mumbai: IIPS, 2021. Tables 10.25, 10.26.1, 10.26.2, 12.2, 12.3.1, 12.3.2, 12.5.1 and 12.5.2. [dhsprogram.com](https://dhsprogram.com/publications/publication-FR375-DHS-Final-Reports.cfm)
1. International Institute for Population Sciences (IIPS). National Family Health Survey (NFHS-6), 2023–24: India and State/UT Fact Sheets (provisional). Mumbai: IIPS, May 2026. Release: [PIB, 29 May 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2266600)
1. National Statistics Office, Ministry of Statistics and Programme Implementation. Health in India, NSS 75th round (July 2017–June 2018), Report No. 586. Table A54. [mospi.gov.in](https://mospi.gov.in/sites/default/files/publication_reports/NSS%20Report%20no.%20586%20Health%20in%20India.pdf)
1. NITI Aayog. Health Insurance for India's Missing Middle. New Delhi: NITI Aayog, October 2021. [niti.gov.in](https://www.niti.gov.in/sites/default/files/2021-10/HealthInsurance-forIndiasMissingMiddle_28-10-2021.pdf)
1. National Health Systems Resource Centre. National Health Accounts Estimates for India 2023–24. New Delhi: Ministry of Health and Family Welfare, 2026. [nhsrcindia.org](https://nhsrcindia.org/sites/default/files/2026-11/NHA%20Report%202023-24.pdf)
1. Burke LE, Wang J, Sevick MA. Self-monitoring in weight loss: a systematic review of the literature. *J Am Diet Assoc* 2011; 111(1): 92–102. [PubMed 21185970](https://pubmed.ncbi.nlm.nih.gov/21185970/) (DOI 10.1016/j.jada.2010.10.008)

---

## Numbers to check

Every number in the post, where it came from, and how it was checked on 2026-11-20. "Read" means the SEO lead opened the primary document and found the line or table cell. NFHS-5 page numbers are the printed ones in Volume I; the PDF page is 36 higher.

| # | Number in the post | Exact source sentence or table cell | Link and page | Year | How checked |
| --- | --- | --- | --- | --- | --- |
| 1 | PwC survey: 1,005 adults; metros and tier-2 and tier-3 cities; 15 states and two union territories; February and March 2026; 27 countries | Report page, methodology: "In February and March 2026, PwC surveyed 21,808 consumers across 27 countries and territories ... The respondents were at least 18 years old". "The survey of 1,005 demographically diverse Indian consumers, across 15 states and 2 union territories, spanned major metros and tier-2/tier-3 urban hubs, included different age groups, and represented working and non-working populations." The press release (17 November 2026) says the same. | https://www.pwc.in/industries/retail-and-consumer/voice-of-the-consumer-2026-india-perspective.html; press release https://www.pwc.in/press-releases/2026/97-of-indian-consumers-prioritise-long-term-wellbeing-signalling-opportunity-for-brands-pwc-survey.html | 2026 | Read. pwc.in refuses scripted requests (403), so both pages were opened in headless Chrome. |
| 2 | 49% track calories, 53% protein; 33% and 35% across the 27 countries | Report page, Finding 1: "53% regularly track their protein intake (35% globally), 50% track fibre (33%), and 49% track calories (33%)." The chart's question: "How often do you engage in the following health and nutrition related habits?", item "I monitor my calorie intake", answers Always, Often, Sometime, Rarely, Never. | as row 1 | 2026 | Read. **PwC doesn't say which answers make up 49%** (most likely Always plus Often). The post says "said they track", which matches PwC's own words. The report PDF (`/assets/pdfs/voice-of-the-consumer-2026-india-perspective.pdf`) couldn't be downloaded from here; worth a look. |
| 3 | "We found no public survey that breaks meal tracking down by age"; "couldn't find" a national survey that asks | A statement of absence. Checked: NFHS-5 asks how often people eat 10 food groups (Table 10.25), not whether they record meals. The NFHS-6 India fact sheet has no such indicator. The NSS 75th round health survey and the ICMR-INDIAB diet study (a food frequency questionnaire) don't ask it. The PwC report gives no age split. A YouGov piece (2022) gives 26% of urban Indians tracking diet, with no sample size or dates, so it's left out. | sources 1 to 5 | 2026 | Read and searched. The wording says "we found" and "we couldn't find", not "none exists". |
| 4 | ICMR-INDIAB diet study: 18,090 adults, aged 20 and over, 30 states and union territories and Delhi | Abstract: "Using data from the national Indian Council of Medical Research–India Diabetes survey (18,090 adults)". Methods: "a representative sample of individuals aged ≥20 years drawn from 30 states and union territories, and the NCT of Delhi." | https://www.nature.com/articles/s41591-025-03949-4 (open access, CC BY-NC-ND 4.0) | 2025 (published 30 Sept) | Read the full text |
| 5 | Carbohydrates 62.3% of energy; refined cereals 28.5%; milled whole grains 16.2%; protein 12%; guideline 15% | Results, "Macronutrient profiles": "Nationwide, carbohydrates contributed 62.3% of total daily energy intake, mainly from refined cereals (28.5%E) and milled whole grains (16.2%E). Total fat contributed 25.2%E, while protein intake was low at 12%E (Extended Data Table 2), below the National Dietary Guideline recommendation of 15%E." Methods define refined cereals as white rice, maida, refined millets and rava, and milled whole grains as "whole wheat, whole millets and whole grains milled into flour" (so "such as atta"). | as row 4 | 2025 | Read |
| 6 | Plant protein 8.9%, dairy 2%, eggs, fish and meat 1% | Discussion: "Total protein intake was low nationwide with plant protein contributing 8.9%E, dairy 2%E and animal protein 1%E." Fig. 4 note: "Animal protein (%E) includes red meat, poultry, egg and fish, and does not include dairy protein." | as row 4 | 2025 | Read |
| 7 | Swapping refined cereals for whole wheat or millet flour not linked to lower type 2 diabetes risk; moving 5% of energy from carbohydrate to protein from plants, dairy, eggs or fish linked to lower odds of newly found diabetes and prediabetes | Abstract: "Replacing refined cereals with whole wheat or millet flour without decreasing overall carbohydrate quantity was not associated with lower risk for T2D (OR = 0.94, 95% CI = 0.57, 1.56)". Discussion: "replacing 5%E from carbohydrates with 5%E from plant, dairy, egg or fish protein was associated with lower risk of newly diagnosed T2D and prediabetes". The paper notes these are modelled substitutions, "not actual replacements by participants". | as row 4 | 2025 | Read. The post says "in the study's models" and "associations, not proof". |
| 8 | NFHS-5, ages 15–49, eat daily: fruit 12.5% of women, 12.2% of men; pulses or beans 49.6% and 48.1%; milk or curd 48.8% of both | Table 10.25, "Daily" column. Women: fruits 12.5, pulses or beans 49.6, milk or curd 48.8. Men: fruits 12.2, pulses or beans 48.1, milk or curd 48.8. | https://dhsprogram.com/pubs/pdf/FR375/FR375.pdf, p. 437 | 2019–21 survey; report 2021 | Read the PDF |
| 9 | "Weekly habits barely shift between people in their 20s and people in their 40s" | Tables 10.26.1 and 10.26.2, at least once a week, ages 20–29, 30–39, 40–49. Women: fruits 51.9, 49.7, 48.4; milk or curd 72.6, 72.4, 73.3; pulses or beans 93.1, 93.3, 93.0. Men: fruits 57.0, 57.3, 55.7; milk or curd 79.7, 80.0, 79.0; pulses or beans 92.5, 94.0, 93.6. | as row 8, pp. 438–439 | 2019–21 | Read the PDF. Every pair is within 3.5 points. |
| 10 | The age list: high blood pressure and high blood sugar by age, women and men | Table 12.3.1 (women) and 12.3.2 (men), column "Prevalence of hypertension" (high on the day or taking medicine). Table 12.5.1 (women) and 12.5.2 (men), column "Percentage with >140 mg/dl blood glucose levels or taking medicine to lower their blood glucose level" (random test, no fasting). Values, women BP / men BP / women sugar / men sugar: 20–24: 4.7 / 8.7 / 3.8 / 4.5. 25–29: 6.7 / 12.4 / 5.2 / 6.6. 30–39: 12.9 / 19.3 / 8.9 / 11.3. 40–49: 25.0 / 28.4 / 16.1 / 18.5. 50–54: 36.0 / 35.2 / 24.1 / 24.7. 55–59: 40.1 / 37.8 / 26.4 / 27.9. 60–69: 48.7 / 43.2 / 29.5 / 30.6. 70 and over: 56.3 / 49.4 / 30.0 / 32.2. | as row 8, pp. 495, 498, 505, 507 | 2019–21 | Read the PDF. The survey's age groups are used as published: it splits 20–29 and 50–59 into five-year bands and has no single 60+ group, so the post shows 60–69 and 70 and over. The definitions' cut-offs (140/90 mmHg, 140 mg/dl) stay out of the post, per the no-thresholds rule. |
| 11 | "One woman in eight in her 30s ... one in four in her 40s, and nearly one in two in her 60s" | Arithmetic from row 10: 12.9%, 25.0%, 48.7%. NFHS-5's own text, p. 488: "About one-fourth of women and men age 40-49 have hypertension. Even at an earlier age, one in eight women and about one in five men age 30-39 have hypertension." | as row 8, p. 488 | 2019–21 | Read |
| 12 | "For blood pressure, men's numbers run higher until about 50; after that, women's do." | From row 10: men are higher at 20–24, 25–29, 30–39 and 40–49; women are higher at 50–54, 55–59, 60–69 and 70 and over. | as row 8 | 2019–21 | Read; comparison of the table cells |
| 13 | NFHS-6: high blood sugar in 17.8% of women and 20.9% of men aged 15+, up from 13.5% and 15.6%; provisional; no age tables yet | India fact sheet, Key Indicators, rows 80 (women) and 83 (men): "Blood sugar level - high or very high (>140 mg/dl) or taking medicine to control blood sugar level": NFHS-6 total 17.8 and 20.9; NFHS-5 total 13.5 and 15.6. Introduction: "The results presented in the NFHS-6 Fact Sheets are provisional." | https://rchiips.org/NFHS/nfhs6.shtml; fact sheet PDF p. 28 | Survey 2023–24; fact sheets May 2026 | Read a copy of IIPS's fact sheet PDF (its citation page names IIPS 2026 and it carries the Health Minister's release note), hosted at telugu.oneindia.com. IIPS's own site couldn't be opened from here: its certificate chain is incomplete, as in post 1. **Check rows 7, 80 and 83 against the copy on rchiips.org.** |
| 14 | NFHS-5: 67.0% of women and 53.7% of men aged 15+ had ever had blood pressure measured; "about one woman in three, and nearly one man in two" never had | Table 12.2: "Have ever had their blood pressure measured": women 67.0, men 53.7 (among women and men 15+ whose blood pressure was measured in NFHS-5). Text, p. 488: "Sixty-seven percent of women and 54 percent of men say that their blood pressure was ever measured prior to the survey". 100 − 67.0 = 33.0; 100 − 53.7 = 46.3. | as row 8, p. 494 | 2019–21 | Read; arithmetic |
| 15 | NSS 2017–18: 73.5% of illnesses handled without a doctor's advice, reason "ailment not considered serious enough"; 15 days | Table A54, all-India, Rural + Urban, row "all", distribution per 1,000 "treated spells of ailment not receiving medical advice" by reason: "ailment not considered serious enough" 735 (estimated 66,510 of 90,477 hundred spells). Rural 707, urban 814. The ailment questions cover "a 15 day reference period" (executive summary, p. 3). | https://mospi.gov.in/sites/default/files/publication_reports/NSS%20Report%20no.%20586%20Health%20in%20India.pdf, p. A-993 (PDF p. 1161); summary https://mospi.gov.in/sites/default/files/announcements/Summary%20Analysis_Report_586_Health.pdf | Survey July 2017–June 2018 | Read the PDF; the six reasons add to 1,000. Since 2014 the NSS counts self-medication as treatment, which is why the post says "without a doctor's advice", not "untreated". |
| 16 | NITI Aayog 2021: at least 30% of Indians, about 40 crore, no financial protection for health | Executive Summary, p. 1: "At least 30% of the population, or 40 crore individuals – called the missing middle in this report – are devoid of any financial protection for health (Table 1) (Figure 4)." | https://www.niti.gov.in/sites/default/files/2021-10/HealthInsurance-forIndiasMissingMiddle_28-10-2021.pdf, p. 1 (PDF p. 15) | October 2021 | Read the PDF |
| 17 | PM-JAY "provides hospitalisation cover" | Same paragraph: "The Ayushman Bharat – Pradhan Mantri Jan Arogya Yojana (AB-PMJAY) launched in September 2018, and State Government extension schemes, provide comprehensive hospitalization cover to the bottom 50% of the population – around 70 crore individuals." | as row 16 | 2021 | Read |
| 18 | NFHS-6: 60.2% of households had at least one member covered, up from 41.0% | India fact sheet, Key Indicators, row 7: "Households with any usual member covered under a health insurance/financing scheme (%)": urban 56.4, rural 62.0, total 60.2; NFHS-5 total 41.0. | as row 13, PDF p. 26 | 2023–24 | Read (same copy as row 13). "One covered member isn't a covered family" restates the indicator's own definition. |
| 19 | Households paid 42.7% of total health spending out of pocket, 2023–24 | PDF p. 11: "As a share of Total Health Expenditure, OOPE has reduced from 64.2% in 2013-14 to 42.7% in 2023-24." | https://nhsrcindia.org/sites/default/files/2026-11/NHA%20Report%202023-24.pdf, p. 11 | 2026 (data 2023–24) | Read the PDF again today (also row 15 of post 1) |
| 20 | Burke review: 22 studies; "a significant association between self-monitoring and weight loss"; evidence weak; all but two studies mostly white women | Abstract: "Of the 22 studies identified, 15 focused on dietary self-monitoring ..." "A significant association between self-monitoring and weight loss was consistently found; however, the level of evidence was weak because of methodologic limitations." "In all but two studies, the samples were predominantly white and women." | https://pubmed.ncbi.nlm.nih.gov/21185970/ | 2011 | Read the abstract (Europe PMC's API; PubMed's page needs cookies) |
| 21 | 12 languages, by name | Product fact: `SPOKEN` in `lib/domain/speech.ts:23`: English, Hinglish, Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Punjabi, Urdu. | repo | 2026 | Read the code |
| 22 | The meal's name and tip come back in the language used; "Pick Tamil, speak, and it answers in Tamil" | `lib/domain/speech.ts:4` ("Meal replies (title and tip) come back in the same language"), `settleReply` at line 149; `lib/ai/schemas.ts:110` (`reply_language`) and `:115` (`tip`, which can be null). Voice listens in the language picked under "Speaking in". | repo | 2026 | Read the code. Known gap (MEMORY open item): typed Marathi gets a Hindi reply, because both use Devanagari. The post's examples are spoken Tamil and Hinglish, which work. |
| 23 | The ring and targets | `Plate` in `components/platform/FuelLogger.tsx:109–112` (the ring is the day's energy target) and the protein, carbs, fat and fibre bars beside it (`:542–567`). Targets: `targetsFor` in `lib/domain/nutrition.ts` (as in post 1, row 19). | repo | 2026 | Read the code |
| 24 | "After three fully logged days, or once you've described your usual day" | `FULL_DAYS_FOR_STACK = 3` in `lib/domain/ask-app.ts:21`; `app/(platform)/(app)/stack/page.tsx:51` ("of 3 days logged"). | repo | 2026 | Read the code |
| 25 | "What your food is short of" and its food lines | Heading at `components/platform/Stack.tsx:515`. Lines from `NOTES` in `lib/domain/supplements.ts`: calcium (`:483`) "Curd, a ragi roti or milk daily closes it." and, for vegans, "A ragi roti, til or tofu daily closes it."; magnesium (`:487`) "A handful of peanuts or pumpkin seeds; whole grains over maida."; vitamin C (`:509`) "Raw works best: amla, guava, or lemon on your dal." | repo | 2026 | Read the code |
| 26 | Vitamin D, iron and folate say "Test first." until there's a blood result | `foodGaps`, `lib/domain/supplements.ts:547`: `if (notes.test && !m)` gives the "test" outcome; only vitamin D, iron and folate have a `test` note (`:466`, `:472`, `:478`). The screen tag is "Test first." (`components/platform/Stack.tsx:505`, `GAP_TAG`). | repo | 2026 | Read the code |
| 27 | Wraps: a week, a month or a year; a story you tap through; longest streak, best protein day, go-to foods and when, nutrients that ran lowest | `Period` in `lib/domain/periods.ts:2`; `wrapStatsFrom` in `lib/platform/wraps.ts:143–150` (`longestStreakDays`, `bestProteinDay`, `topFoods` with meal slot and usual time, `lowestMicros`); Previous and Next tap areas in `components/platform/Wraps.tsx:126–127`. | repo | 2026 | Read the code. Wraps are written in the app language (English, Hindi or Hinglish), so the post doesn't claim 12 languages for them. |

## What doesn't exist, and how the post handles it

- **How many Indians track their meals, nationally:** no government or academic national survey we could find asks it. The post says so in its first paragraph and makes that gap part of the story ("Nobody counts the counters").
- **Meal tracking by age (20–29, 30–39, 40–49, 50–59, 60+):** no public source we found. The PwC survey sampled "different age groups" but publishes no age split. The post says so plainly and doesn't estimate.
- **What the post uses for the age brackets instead:** NFHS-5's measured blood pressure and blood sugar, which do exist by age, for women and men from 15 to 70 and over. The bands are NFHS's own, shown as published.
- **Diet quality by age:** ICMR-INDIAB's diet paper reports by region, sex and urban or rural, not age. NFHS-5's food frequency tables have age bands only up to 49. So the post gives one national picture of the plate, and notes that weekly habits barely change from the 20s to the 40s.
- **"People seek care only when it's serious":** no source measures that directly. The post uses two sourced proxies, worded carefully: the share who'd never had their blood pressure measured (NFHS-5), and "ailment not considered serious enough" as the reason for 73.5% of illnesses handled without a doctor's advice (NSS 2017–18).

## Left out on purpose

- **Mayank's premise that "very, very few" Indians have health insurance:** the latest data doesn't support it. NFHS-6 found 60.2% of households with at least one member covered (2023–24), up from 41.0%. The post reports that honestly, then explains why it still isn't enough: a covered member isn't a covered family, PM-JAY is hospitalisation cover, and households still paid 42.7% of health spending.
- **Day-to-day energy claims** (meals "not fruitful even for day-to-day tasks"): no source links Indian meal patterns to daily energy or productivity, so the post doesn't claim it.
- **Longevity claims:** none are made. The post stays with measured risk markers.
- **Older figures:** NSS 2017–18 health cover (14% rural, 19% urban) predates PM-JAY; the NFHS-6 figure replaces it. NFHS-5 insurance by age (women and men 15–49) is out of date after NFHS-6's rise, so it isn't used.
- **The YouGov 2022 figure** (26% of urban Indians track their diet): no sample size or fieldwork dates, so it doesn't meet the bar for a commercial survey.
- **LASI** (adults 45 and over): its 2022 analysis found 55.7% of people with high blood pressure had been diagnosed. Left out to keep one source for the age list, and because post 1 already covers diagnosis rates (WHO 2025).
- No cut-offs, ranges, doses, prices, plan limits, or lab or supplement brands.
