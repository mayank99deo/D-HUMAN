# Nue Health biomarker catalogue

**Target:** https://www.nuehealth.in/biomarkers and /compare, plus the logged-out app bundle at https://app.nuehealth.in
**Captured:** 11 Nov 2026, logged out. Public pages and publicly served static files only; no sign-up, form, phone number or API call.
**Why:** D-Human is building its own biomarker catalogue; this records which markers a leading Indian competitor puts in each plan.
**Companion:** `docs/research/nuehealth-teardown.md` (design teardown, 9 Nov). Machine-readable copy: `biomarkers.json` in the session scratchpad (path at the end).

Marker names, groupings and plan membership below are Nue's, as published. Nue's per-marker explanations are not copied.

**Labels:**
- **[O] Observed:** read directly from a shipped file, the rendered page or an image.
- **[I] Inferred:** my reading of the evidence; it may be wrong.

## Bottom line

- [O] **95 distinct blood biomarkers** across 10 systems. **Core 77, Advanced (male) 93, Advanced (female) 93.** These match the published 77 and 93 exactly.
- [O] Every Core marker is also in both Advanced plans. Advanced adds 14 markers for both sexes, plus 2 male-only (PSA total and free) and 2 female-only (progesterone, AMH): 77 + 14 + 2 = 93 per sex, and 77 + 14 + 2 + 2 = 95 overall.
- [O] Per system: Metabolic 6, Heart 14, Immune 15, Thyroid 6, Reproductive 13, Brain 2, Musculoskeletal 3, Blood 16, Liver 11, Kidney 9.
- [O] `/compare` lists all 95 Nue markers (in 98 rows: free testosterone, LH and FSH appear once in a male block and once in a female block) plus 38 rows Nue does not test, credited to Function Health or Orange Labs. Its counts recompute to the same 77 / 93 / 93, and to 108 / 106 for Function Health and 79 / 79 for Orange Labs (Nue's claims about competitors, not checked).
- [O] **No reference ranges** for any marker appear on a public page or in shipped JS. **Units** appear for 20 of the 95, none of them in the catalogue itself (see "Units and ranges").
- [I] The "Clinical · 95 biomarkers" results screenshot that the teardown flagged as not matching 77 or 93 is simply the full union of all three plans (95).

## Sources, and how they agree

| # | Source | What it gives | Status |
|---|---|---|---|
| S1 | `https://www.nuehealth.in/assets/biomarkers-DPDiDLiS.js` (9,958 bytes) | The catalogue data module: 10 systems, each marker's name, system and plan list (`core`, `m`, `f`), and the counts the page prints | [O] Byte-identical to the copy saved on 9 Nov; content-hashed, so the data has not changed |
| S2 | Pre-rendered `/biomarkers` HTML (237,924 bytes) | One `<details>` row per marker with screen-reader text "Core: Included / Not included" per plan; header "Core: 77 … Advanced (M): 93 … Advanced (F): 93" | [O] Same 95 rows and same plan flags as S1 |
| S3 | JSON-LD `ItemList` "Nue Health biomarker catalogue" in the same HTML | `numberOfItems: 95`, one item per marker with "Category … Included in …" | [O] Same 95 names as S1 |
| S4 | `https://www.nuehealth.in/assets/Compare-DCWiJ0rU.js` (`/compare` is client-rendered; its HTML is a 4 KB shell) | Marker-by-marker table in 13 panels (including separate Male-Only and Female-Only blocks) with Nue Core / Nue Advanced / Function Health / Orange Labs flags | [O] Same code as the 9 Nov copy apart from import hashes. 0 disagreements with S1 on plan membership |
| S5 | App bundle, current build `index-BovBP5Nz.js` (redeployed since 9 Nov; 253 chunk files fetched) | No catalogue. Units for 25 "Estimated labs" keys in `ResultsView-Cb3sPQEp.js`; the range editor in `Biomarkers-C9JQwRTd.js` | [O] See "Only in the app code" |
| S6 | Marketing images: `assets/step-3.png`, `assets/app/intro-3-organ-systems-CMsGHq5r.png` (saved 9 Nov) | Example values with units: Apo A1 170 mg/dL, ApoB 72 mg/dL, HDL 34 mg/dL | [O] Illustrative values only, no ranges |

## The catalogue

Rows follow the page's order: by system, Core markers first within each system. ✓ = included, · = not included.

Legend:
- **Abbr.** Plain = written by Nue (in the marker's name, a /biomarkers hero card, the /compare row or the app's labels). **†** = the conventional abbreviation, added by me [I]. "—" = none in common use.
- **Unit.** ¹ = observed in a Nue marketing image of the app [O]. ² = in the marker's own name [O]. ³ = from the app's "Estimated labs" unit map (S5) [O], applied to the measured marker by me [I]. "—" = not stated anywhere public.
- **Range:** not stated for any marker, so there is no range column.
- **/compare panel:** the panel the marker sits under on /compare, which often differs from its /biomarkers system.

| # | Marker (Nue's name) | Abbr. | System | Core | Adv (M) | Adv (F) | Unit | /compare panel |
|---|---|---|---|:-:|:-:|:-:|---|---|
| 1 | Fasting Glucose | FBG † | Metabolic | ✓ | ✓ | ✓ | mg/dL ³ | Metabolic & Other |
| 2 | Hemoglobin A1c (HbA1c) | HbA1c | Metabolic | ✓ | ✓ | ✓ | % ³ | Metabolic & Other |
| 3 | Magnesium | Mg † | Metabolic | ✓ | ✓ | ✓ | — | Nutrients |
| 4 | Uric Acid | UA † | Metabolic | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 5 | Fasting Insulin | — | Metabolic | · | ✓ | ✓ | — | Metabolic & Other |
| 6 | HOMA-IR | HOMA-IR | Metabolic | · | ✓ | ✓ | — | Metabolic & Other |
| 7 | Apolipoprotein B (Apo B) | Apo B | Heart | ✓ | ✓ | ✓ | mg/dL ¹ | Lipid Panel |
| 8 | HDL Cholesterol | HDL | Heart | ✓ | ✓ | ✓ | mg/dL ¹ | Lipid Panel |
| 9 | Homocysteine | Hcy † | Heart | ✓ | ✓ | ✓ | — | Nutrients |
| 10 | LDL / HDL Ratio | LDL/HDL | Heart | ✓ | ✓ | ✓ | — | Lipid Panel |
| 11 | LDL Cholesterol | LDL | Heart | ✓ | ✓ | ✓ | — | Lipid Panel |
| 12 | Non-HDL Cholesterol | Non-HDL | Heart | ✓ | ✓ | ✓ | — | Lipid Panel |
| 13 | Total Cholesterol | TC † | Heart | ✓ | ✓ | ✓ | — | Lipid Panel |
| 14 | Total Cholesterol / HDL Ratio | TC/HDL † | Heart | ✓ | ✓ | ✓ | — | Lipid Panel |
| 15 | Triglyceride / HDL Ratio | TG/HDL † | Heart | ✓ | ✓ | ✓ | — | Lipid Panel |
| 16 | Triglycerides | TG † | Heart | ✓ | ✓ | ✓ | mg/dL ³ | Lipid Panel |
| 17 | VLDL Cholesterol | VLDL | Heart | ✓ | ✓ | ✓ | — | Lipid Panel |
| 18 | Apo B / Apo A1 ratio | ApoB/ApoA1 | Heart | · | ✓ | ✓ | (unitless) ³ | Lipid Panel |
| 19 | Apolipoprotein A1 | Apo A1 | Heart | · | ✓ | ✓ | mg/dL ¹ | Lipid Panel |
| 20 | Lipoprotein (a) | Lp(a) † | Heart | · | ✓ | ✓ | — | Lipid Panel |
| 21 | Basophils | BASO# † | Immune | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 22 | Basophils % | BASO% † | Immune | ✓ | ✓ | ✓ | % ² | Complete Blood Count |
| 23 | Eosinophils | EOS# † | Immune | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 24 | Eosinophils % | EOS% † | Immune | ✓ | ✓ | ✓ | % ² | Complete Blood Count |
| 25 | High-Sensitivity C-Reactive Protein (hs-CRP) | hs-CRP | Immune | ✓ | ✓ | ✓ | mg/L ³ | Metabolic & Other |
| 26 | Lymphocytes | LYMPH# † | Immune | ✓ | ✓ | ✓ | K/µL ³ | Complete Blood Count |
| 27 | Lymphocytes % | LYMPH% † | Immune | ✓ | ✓ | ✓ | % ² | Complete Blood Count |
| 28 | Monocytes | MONO# † | Immune | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 29 | Monocytes % | MONO% † | Immune | ✓ | ✓ | ✓ | % ² | Complete Blood Count |
| 30 | Neutrophil / Lymphocyte Ratio | NLR † | Immune | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 31 | Neutrophils | NEUT# † | Immune | ✓ | ✓ | ✓ | K/µL ³ | Complete Blood Count |
| 32 | Neutrophils % | NEUT% † | Immune | ✓ | ✓ | ✓ | % ² | Complete Blood Count |
| 33 | White Blood Cell (WBC) count | WBC | Immune | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 34 | Erythrocyte Sedimentation Rate (ESR) | ESR | Immune | · | ✓ | ✓ | — | Metabolic & Other |
| 35 | Zinc | Zn † | Immune | · | ✓ | ✓ | — | Nutrients |
| 36 | Thyroid-stimulating Hormone (TSH) | TSH | Thyroid | ✓ | ✓ | ✓ | — | Thyroid Function Test |
| 37 | Thyroxine (T4) Free | FT4 † | Thyroid | ✓ | ✓ | ✓ | — | Thyroid Function Test |
| 38 | Thyroxine (T4) Total | T4 | Thyroid | ✓ | ✓ | ✓ | — | Thyroid Function Test |
| 39 | Triiodothyronine (T3) Free | FT3 † | Thyroid | ✓ | ✓ | ✓ | — | Thyroid Function Test |
| 40 | Triiodothyronine (T3) Total | T3 | Thyroid | ✓ | ✓ | ✓ | — | Thyroid Function Test |
| 41 | Free T3 / Free T4 Ratio | FT3/FT4 † | Thyroid | ✓ | ✓ | ✓ | — | Thyroid Function Test |
| 42 | Testosterone, Total | TT † | Reproductive | ✓ | ✓ | ✓ | — | Metabolic & Other |
| 43 | Free Androgen Index | FAI † | Reproductive | ✓ | ✓ | ✓ | — | Metabolic & Other |
| 44 | Sex Hormone-Binding Globulin (SHBG) | SHBG | Reproductive | ✓ | ✓ | ✓ | — | Metabolic & Other |
| 45 | Estradiol | E2 † | Reproductive | ✓ | ✓ | ✓ | — | Metabolic & Other |
| 46 | DHEA Sulfate (DHEA-S) | DHEA-S | Reproductive | ✓ | ✓ | ✓ | — | Metabolic & Other |
| 47 | Testosterone, Free | FT † | Reproductive | · | ✓ | ✓ | — | Female-Only, Male-Only |
| 48 | Luteinizing Hormone (LH) | LH | Reproductive | · | ✓ | ✓ | — | Female-Only, Male-Only |
| 49 | Follicle Stimulating Hormone (FSH) | FSH | Reproductive | · | ✓ | ✓ | — | Female-Only, Male-Only |
| 50 | Prolactin | PRL † | Reproductive | · | ✓ | ✓ | — | Metabolic & Other |
| 51 | Progesterone | P4 † | Reproductive | · | · | ✓ | — | Female-Only |
| 52 | Anti-Mullerian Hormone (AMH) | AMH | Reproductive | · | · | ✓ | — | Female-Only |
| 53 | Prostate Specific Antigen (PSA), Total | tPSA † | Reproductive | · | ✓ | · | — | Male-Only |
| 54 | Prostate Specific Antigen (PSA), Free | fPSA † | Reproductive | · | ✓ | · | — | Male-Only |
| 55 | Cortisol | — | Brain | ✓ | ✓ | ✓ | — | Metabolic & Other |
| 56 | Vitamin B12 | B12 | Brain | ✓ | ✓ | ✓ | — | Nutrients |
| 57 | Vitamin D 25-OH | Vit D | Musculoskeletal | ✓ | ✓ | ✓ | — | Nutrients |
| 58 | Calcium | Ca † | Musculoskeletal | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 59 | Creatine Kinase | CK † | Musculoskeletal | · | ✓ | ✓ | — | Metabolic & Other |
| 60 | Hemoglobin | Hb † | Blood | ✓ | ✓ | ✓ | g/dL ³ | Complete Blood Count |
| 61 | Hematocrit | Hct † | Blood | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 62 | Red Blood Cell (RBC) Count | RBC | Blood | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 63 | Mean Corpuscular Volume (MCV) | MCV | Blood | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 64 | Mean Corpuscular Hemoglobin (MCH) | MCH | Blood | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 65 | Mean Corpuscular Hemoglobin Concentration (MCHC) | MCHC | Blood | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 66 | Red Cell Distribution Width (RDW) | RDW | Blood | ✓ | ✓ | ✓ | % ³ | Complete Blood Count |
| 67 | Platelet Count | PLT † | Blood | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 68 | Mean Platelet Volume (MPV) | MPV | Blood | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 69 | Platelet Distribution Width (PDW) | PDW | Blood | ✓ | ✓ | ✓ | — | Complete Blood Count |
| 70 | Ferritin | — | Blood | ✓ | ✓ | ✓ | — | Iron Profile |
| 71 | Iron, Total | Fe † | Blood | ✓ | ✓ | ✓ | — | Iron Profile |
| 72 | Total Iron Binding Capacity (TIBC) | TIBC | Blood | ✓ | ✓ | ✓ | — | Iron Profile |
| 73 | Unsaturated Iron Binding Capacity (UIBC) | UIBC | Blood | ✓ | ✓ | ✓ | — | Iron Profile |
| 74 | Transferrin Saturation | TSAT † | Blood | ✓ | ✓ | ✓ | — | Iron Profile |
| 75 | Vitamin B9 | Folate | Blood | · | ✓ | ✓ | — | Nutrients |
| 76 | Alanine Aminotransferase (ALT) | ALT | Liver | ✓ | ✓ | ✓ | U/L ³ | Liver Function Test |
| 77 | Albumin | — | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 78 | Albumin / Globulin ratio | A/G † | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 79 | Alkaline Phosphatase (ALP) | ALP | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 80 | Aspartate Aminotransferase (AST) | AST | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 81 | Bilirubin, Direct | D-Bil † | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 82 | Bilirubin, Indirect | I-Bil † | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 83 | Bilirubin, Total | T-Bil † | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 84 | Gamma Glutamyl Transferase | GGT | Liver | ✓ | ✓ | ✓ | U/L ³ | Liver Function Test |
| 85 | Globulin | — | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 86 | Total Protein | TP † | Liver | ✓ | ✓ | ✓ | — | Liver Function Test |
| 87 | Creatinine | Cr † | Kidney | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 88 | Estimated Glomerular Filtration Rate (eGFR) | eGFR | Kidney | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 89 | Blood Urea Nitrogen (BUN) | BUN | Kidney | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 90 | Blood Urea | Urea † | Kidney | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 91 | BUN / Creatinine ratio | BUN/Cr † | Kidney | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 92 | Sodium | Na † | Kidney | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 93 | Potassium | K † | Kidney | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 94 | Chloride | Cl † | Kidney | ✓ | ✓ | ✓ | — | Kidney Function Test |
| 95 | Cystatin C | Cys C † | Kidney | · | ✓ | ✓ | mg/L ³ | Kidney Function Test |

## In Advanced but not in Core

[O] 18 markers. The onboarding plan card tags Advanced as "Fertility, heart & hormones".

| Marker | System | Adv (M) | Adv (F) |
|---|---|:-:|:-:|
| Fasting Insulin | Metabolic | ✓ | ✓ |
| HOMA-IR | Metabolic | ✓ | ✓ |
| Apo B / Apo A1 ratio | Heart | ✓ | ✓ |
| Apolipoprotein A1 | Heart | ✓ | ✓ |
| Lipoprotein (a) | Heart | ✓ | ✓ |
| Erythrocyte Sedimentation Rate (ESR) | Immune | ✓ | ✓ |
| Zinc | Immune | ✓ | ✓ |
| Testosterone, Free | Reproductive | ✓ | ✓ |
| Luteinizing Hormone (LH) | Reproductive | ✓ | ✓ |
| Follicle Stimulating Hormone (FSH) | Reproductive | ✓ | ✓ |
| Prolactin | Reproductive | ✓ | ✓ |
| Creatine Kinase | Musculoskeletal | ✓ | ✓ |
| Vitamin B9 (folate) | Blood | ✓ | ✓ |
| Cystatin C | Kidney | ✓ | ✓ |
| Prostate Specific Antigen (PSA), Total | Reproductive | ✓ | · |
| Prostate Specific Antigen (PSA), Free | Reproductive | ✓ | · |
| Progesterone | Reproductive | · | ✓ |
| Anti-Mullerian Hormone (AMH) | Reproductive | · | ✓ |

[O] Core already includes hs-CRP, ApoB, HbA1c, homocysteine, vitamin D, B12, magnesium, cortisol, total testosterone, SHBG, free androgen index, estradiol and DHEA-S. So the step up is mostly fertility and pituitary hormones, insulin resistance, Lp(a) and the ApoA1 side of the lipid picture, plus zinc, folate, CK, ESR and cystatin C.

## Only on /compare (Nue does not test these)

[O] 38 rows, all shown greyed with crosses in both Nue columns. FH = Function Health, OL = Orange Labs, as credited by Nue.

| /compare panel | Markers (credited to) |
|---|---|
| Lipid Panel | LDL P, Small LDL P, HDL Large, LDL Medium, LDL Pattern, LDL Peak Size (FH); ApoA1 / ApoB Ratio (OL; the inverse of Nue's Apo B / Apo A1 ratio) |
| Thyroid Function Test | Thyroglobulin Antibodies (TgAb), Thyroid Peroxidase Antibodies (TPO) (FH) |
| Complete Blood Count | ABO Group and Rhesus (Rh) Factor (FH) |
| Heavy Metals | Lead, Mercury (FH) |
| Autoimmunity | ANA Screen, ANA Pattern, ANA Titer, Rheumatoid Factor (FH) |
| Pancreas | Amylase, Lipase (FH and OL) |
| Nutrients | Omega-3 Index, Methylmalonic Acid (MMA), Omega-3 Total, DHA, DPA, EPA, Omega-6 Total, Arachidonic Acid, Linoleic Acid, Omega-6 / Omega-3 Ratio, Arachidonic Acid / EPA Ratio (FH) |
| Metabolic & Other | Carbon Dioxide (CO₂) (FH and OL); IGF-1, Leptin, "Biological Age" (FH); LDH, Troponin-I, HBsAg (Hepatitis B), Total IgE (OL) |
| Male-Only | PSA % Free (FH) |

- [O] **Correction to the brief:** the Omega-3 Index on /compare is a Function Health row. Nue tests no fatty acids at all.
- [O] No marker appears on /compare as a Nue marker without also being in the /biomarkers catalogue, and no catalogue marker is missing from /compare.
- [O] "Biological Age" is listed as a marker row for Function Health only, though Nue itself reports a biological age (see Inferred).

## Only in the app code

[O] The app (`app.nuehealth.in`, current build) does **not** ship a biomarker dictionary. Markers, units and ranges come from the logged-in API: `/health-scores/all/biomarkers/detailed`, `/systems/labs`, and for staff `/admin/biomarkers`, `/admin/science/metrics` and `/admin/science/thresholds`. The admin editor (`Biomarkers-C9JQwRTd.js`) edits each metric's `field_name` and `units` and a list of thresholds, each with a rating (OPTIMAL / IN_RANGE / OUT_OF_RANGE), numeric min and max or a string value, sex, age band and menstrual phase or pregnancy trimester.

[O] The one hard-coded marker list is an **"Estimated labs"** unit map in `ResultsView-Cb3sPQEp.js`: 25 keys, each with a US unit and a converter named `from_ukb` (glucose ×18.016, triglycerides ×88.57, HDL ×38.67, ApoB ×100, HbA1c by 0.0915x + 2.15, haemoglobin ×0.1, IGF-1 ×7.649, waist cm to inches). The view shows a value with a "likely" interval and throws if the reference band's unit differs from the map's unit.

| Key | Label in the code | Unit | In Nue's catalogue? |
|---|---|---|---|
| glucose | Fasting glucose | mg/dL | Yes |
| triglycerides | Triglycerides | mg/dL | Yes |
| hdl | HDL cholesterol | mg/dL | Yes |
| apob | ApoB | mg/dL | Yes |
| apob_apoa1 | ApoB / ApoA1 ratio | (none) | Yes (Advanced) |
| hba1c | HbA1c (3-month blood sugar) | % | Yes |
| haemoglobin | Haemoglobin | g/dL | Yes |
| lymphocytes | Lymphocytes | K/µL | Yes |
| neutrophils | Neutrophils | K/µL | Yes |
| crp | CRP (inflammation) | mg/L | [I] As hs-CRP |
| cystatin_c | Cystatin C (kidney filtration) | mg/L | Yes (Advanced) |
| alt | ALT (liver enzyme) | U/L | Yes |
| ggt | GGT (liver enzyme) | U/L | Yes |
| rdw | Red cell width (RDW) | % | Yes |
| **glyca** | GlycA (inflammation) | µmol/L | **No** |
| **bcaa** | Branched-chain amino acids | µmol/L | **No** |
| **ketones** | Ketones | mmol/L | **No** |
| **mufa_pct** | Monounsaturated fat share | % | **No** |
| **omega_6_pct** | Omega-6 fat share | % | **No** |
| **omega_3_pct** | Omega-3 fat share | % | **No** |
| **saturated_fat_pct** | Saturated fat share | % | **No** |
| **igf_1** | IGF-1 | ng/mL | **No** (a Function Health row on /compare) |
| waist, bmi, body_fat_percentage | Waist size, BMI, Body fat | in, kg/m², % | Not blood markers |

- [I] These are **estimates, not measurements**: `from_ukb` and the factors convert UK Biobank units (mmol/L, g/L, mmol/mol, nmol/L) to US units. GlycA, BCAA, ketones and the fatty-acid shares are NMR metabolomics measures that UK Biobank holds. This looks like the sister brand Sedona's proteomics product predicting clinical labs from proteins. Whether Nue members ever see this view is not knowable from the code.
- [O] Other markers in app code belong to Sedona's proteomics marketing, not Nue's blood panel: an IL-17 card in pg/mL and the "1,000+ protein biomarkers" claim (`BetaSurvey-6lD3HREI.js`).
- [O] The app's organ-system list (`app-DjgUIPL1.js`) has 12 keys (immune, brain, heart, lungs, liver, kidney, pancreas, gut, blood, metabolic, hormonal, musculoskeletal), not the marketing site's 10. [I] Probably the proteomics organ set.
- [O] The admin editor capitalises these tokens when it formats `field_name`s: apo, b12, crp, egfr, ggt, hdl, homa, hs, igf, ldl, mch, mchc, mcv, rdw, t3, t4, tsh, vldl. [I] So server field names look like `hs_crp`, `homa_ir`, `vitamin_b12`. Only `igf` has no counterpart in Nue's catalogue.

## Units and ranges: what is actually stated

- **Ranges [O]:** none, for any marker. The rating bands live on the server, per sex, age band and cycle phase. The only numbers with a status are illustrative marketing values: ApoB 72 mg/dL "Optimal", HDL 34 mg/dL "Out of range", Apo A1 170 mg/dL "Optimal". They are points, not ranges, so I did not derive ranges from them.
- **Units, observed directly (3):** Apo A1, ApoB and HDL in mg/dL, from the marketing images.
- **Units, observed in the code and applied by inference (12 more):** fasting glucose, triglycerides (mg/dL), HbA1c (%), haemoglobin (g/dL), lymphocytes and neutrophils (K/µL), hs-CRP and cystatin C (mg/L), ALT and GGT (U/L), RDW (%), and the ApoB/ApoA1 ratio (no unit). These come from the Estimated-labs map. Because the code refuses a reference band in any other unit, Nue's stored bands for these labs are in these units [I].
- **Units in the name (5):** the five white-cell percentages.
- [I] The pattern is US conventional units (mg/dL, K/µL), not the SI units of the Sedona sample PDF (mmol/L, µmol/L). For D-Human's Indian lab reports that is the right default, since Indian labs mostly report in conventional units.

## Inferred readings

- [I] **About 15 of the 77 Core markers are calculated from others, not separately measured:** Non-HDL, VLDL (usually TG/5), LDL/HDL, Total Cholesterol/HDL and Triglyceride/HDL ratios, neutrophil/lymphocyte ratio, Free T3/Free T4 ratio, free androgen index, globulin, indirect bilirubin, A/G ratio, BUN (from urea), BUN/creatinine ratio, eGFR and transferrin saturation. Advanced adds two more (HOMA-IR, ApoB/ApoA1). The five white-cell types also count twice, as absolute and %. Measured analytes in Core come to roughly 62.
- [I] **Core reads as a set of standard Indian lab panels:** lipid profile + ApoB, HbA1c + fasting glucose, hs-CRP, thyroid profile (total and free T3/T4, TSH), CBC with differential, iron studies + ferritin, LFT, KFT with electrolytes, uric acid and calcium, plus magnesium, vitamin D, B12, homocysteine, cortisol and a basic sex-hormone set (total testosterone, SHBG, estradiol, DHEA-S).
- [I] **Biological age:** the FAQ says nine blood biomarkers with the Levine method. Levine's PhenoAge uses albumin, creatinine, glucose, CRP, lymphocyte %, MCV, RDW, alkaline phosphatase and white cell count, and all nine are in Core.
- [O] **Systems are functional, not anatomical:** the white-cell differential sits under Immune, while red cells, platelets and iron sit under Blood. Magnesium and uric acid are Metabolic, homocysteine is Heart, zinc is Immune, B12 and cortisol are Brain, calcium is Musculoskeletal, folate is Blood, and the electrolytes are Kidney. The internal system keys are `metabolic`, `cardiovascular`, `inflammation`, `thyroid`, `sex-hormones`, `brain`, `musculoskeletal`, `hematology`, `liver` and `renal`.

## Blockers and limits

- No reference ranges or units are public for the catalogue as a whole. They sit behind the logged-in API, which I did not call; a logged-in account would be needed to see them.
- The app was redeployed between 9 and 11 Nov (`index-1PGI1RhM.js` → `index-BovBP5Nz.js`). I re-fetched it; the marketing data module is unchanged.
- Competitor counts and ticks on /compare are Nue's claims and were not checked against Function Health or Orange Labs.

## Files

Under `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/`:
- `biomarkers.json`: 95 records, `{ name, abbreviation, system, core, advancedMale, advancedFemale, unit, range, source }`. Here `range` is always null, and `source` is an object recording the catalogue source, system key, /compare rows, unit source and whether the abbreviation was observed or inferred.
- `fresh/`: the 11 Nov fetches (`biomarkers.html`, `biomarkers-DPDiDLiS.js`, `Compare-DCWiJ0rU.js`, `app/chunks/`) and `parsed.json`, which holds all four marketing-site sources parsed side by side.
- `scripts2/parse.py` and `scripts2/build.py` re-derive everything: `python3 -I scripts2/parse.py fresh fresh && python3 -I scripts2/build.py fresh/parsed.json biomarkers.json fresh/table.md`.
