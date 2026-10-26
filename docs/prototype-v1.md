# Prototype V1: process-book notes

Project: **Your college experience compared to US college students**
Guiding question: **If you pay more for college, will you earn more after graduation?**
Intended message (to test): *What you study can matter more than where you study for post-grad earnings.
Higher tuition and a major's popularity do not necessarily indicate higher earnings.*

## 1. What was actually implemented

| Piece | Status | Where |
|---|---|---|
| Reproducible data pipeline from official College Scorecard files | **Done** | `scripts/download_data.sh`, `scripts/build_data.py`, `docs/data-pipeline.md` |
| Cleaned data files for the site | **Done** (real data) | `static/data/` |
| SvelteKit website with the full narrative structure | **Done** | `src/routes/+page.svelte` |
| D3 chart 1: tuition histogram + brush + search | **Done** | `src/lib/components/TuitionHistogram.svelte` |
| D3 chart 2: earnings by major (dot + interval) | **Done** | `src/lib/components/EarningsByMajor.svelte` |
| Linked detail: programs in one major (tuition × earnings scatter) | **Done** (extra) | `src/lib/components/MajorScatter.svelte` |
| Narrative numbers computed from cleaned data | **Done** | `static/data/findings.json` → section 3 of the page |
| Dollar bill, brain, flow diagram | **Design drafts only** (static SVG from real data) | `docs/designs/`, "Explore further" section |
| Automated checks (data, browser) | **Done** | `scripts/verify_summaries.mjs`, `scripts/screenshots.mjs` |
| Deployment | Not done (static build works; nothing deployed) | |

Not implemented yet: the interactive dollar bill, brain and flow; earnings beyond one year; the family-
income / net-price-by-income view from Dashboard 1; a data table view of the earnings chart.

### Scope change you should note in the process book

The earlier dashboards said "2019–20 and 2020–21 graduates, earnings 1 year after graduating." The official
cohort map shows the file we used (`FieldOfStudyData1920_2021`) pairs **2019–21 degree counts with
earnings of the 2018–20 graduates**. The Scorecard labels files by the debt cohort. No file has
1-year earnings for the 2019–21 class. V1 therefore uses the **2020–21 + 2021–22 graduates** for both degree counts
(file `2021_2122`) and earnings (file `2122_2223`). Prices are published tuition averaged over **2017–18 to
2021–22**, the years those classes were enrolled. Details: `docs/data-pipeline.md` §2.

## 2. Pipeline and data scope (summary)

- **Schools:** 1,876 predominantly bachelor's-granting schools (546 public, 1,181 private nonprofit, 149
  private for-profit) with bachelor's completions and published tuition for ≥ 3 of the 5 years.
- **Programs:** 55,100 bachelor's programs (major × college, 4-digit CIP). 22,336 report earnings, and
  these hold 85% of the 4,120,193 degrees. 31,596 are privacy-suppressed.
- **Earnings:** median earnings one year after completion of graduates who received federal aid, worked,
  and were not enrolled (measured 2022 and 2023, in 2024 dollars).
- **Prices:** published tuition and fees (not net price, not total cost of attendance), nominal dollars.
- **Deduplication:** earnings that the Scorecard repeats across branch campuses are counted once (609
  groups). No cross-file sums.
- **Missing values:** `PS` / `NA` become missing, never zero.
- **Weighting:** tuition summaries count schools; degree shares count degrees; earnings summaries are
  quantiles of program medians, with each program counted once ("median program").

## 3. The two working D3 charts

### Chart 1: "What does college cost?" Tuition histogram

- **Purpose:** show the spread of published tuition and how much school type explains it, and let the
  reader pick a price range to carry into the earnings comparison.
- **Data:** `schools.csv` (1,876 schools).
- **Encodings:** x = average published tuition and fees per year (fixed $0–$62.5K axis, $2,500 bins);
  bar height = **number of schools** (each school counts once); stacked color = public / private nonprofit /
  private for-profit (validated categorical slots 1–3, with a legend). The y-axis is fixed at the tallest bin
  in either residency mode, so toggling never rescales the chart.
- **Interactions:**
  - In-state / out-of-state toggle (changes public schools and 10 private schools that publish a different price).
  - **Brush** a tuition range: bars outside fade, and the readout shows the range, the school count and
    the split by type. The summary table recomputes for the range.
  - "From $ / to $" inputs as a keyboard alternative, plus **Reset to all schools**.
  - **College search** (combobox over 1,876 names) draws a marker and label at the school's tuition, and
    shows a card with its published price, average net price and degrees.
  - Hover a bar for counts by type in that bin.

### Chart 2: "What do graduates earn?" Earnings by major

- **Purpose:** show variation in program earnings **across colleges within each major**, next to how
  popular the major is, and compare all schools with the brushed tuition range.
- **Data:** `programs.csv` + `majors.csv`, summarized in the browser by `summarizeMajors()`.
- **Encodings (per row = one major):**
  - Gray band = middle 50% (25th–75th percentile) of programs' median earnings, all schools.
  - Dot = median program, all schools.
  - When a range is brushed, all-schools marks turn light gray (with a hollow median) and a black band and
    dot show the selected range on the same row.
  - Left column bars = share of bachelor's degrees (weighted by degrees), all schools vs. range, with %.
  - The x-axis is fixed at $20K–$100K (2nd–98th percentile of all programs). Values beyond it clamp to the
    edge and get a › marker. The fixed axis means filtering can never stretch the scale.
  - Majors with < 5 reporting programs show individual open circles; with none, a text note.
  - A diamond marks the searched college's program.
- **Interactions:** order by degrees / highest / lowest (always by all-schools values, so rows don't jump);
  top 20 / top 40; a major dropdown (adds that major if it isn't already shown); hover or keyboard focus for a
  tooltip with both comparisons, the official national median for all graduates, and earnings coverage;
  click a row to open the linked detail.
- **Linked detail:** "Inside one major" scatter of every program (x = school tuition on the histogram's
  scale, y = earnings on the major chart's scale, color = type). Programs outside the range fade, and the
  range is shaded. The caption gives the live Spearman ρ and the median program in the range.

The two charts share one state (`range`, `residency`, `selectedSchool`, `selectedMajor`). A sticky bar
above chart 2 always says what is being compared, e.g. "all 1,876 schools vs. 440 schools charging
$20,000–$34,900", and an empty range shows an explicit message.

## 4. Narrative sequence

1. **Hook:** "Does a more expensive college mean a bigger paycheck?" The intro states the data years and
   shows that published price ≠ net price, using real medians.
2. **Rising insight 1 (cost):** published tuition varies tenfold, and type explains much of it. Readers find
   their school and brush a range.
3. **Rising insight 2 (earnings):** early earnings vary far more between majors than within them. The brushed range
   shows how pricier or cheaper schools compare in each major.
4. **Main message (checked against the data, section "What does this mean?"):**
   - Popularity ≠ pay: Business has 7.7% of degrees but its median program ranks 8th of the top 20. Across 127
     majors, the rank correlation between degrees and median program earnings is ρ = −0.03.
   - Between-major gap: $37,131 (English) to $80,271 (Nursing) = $43,140, versus a typical within-major
     middle-50% spread of $8,554.
   - **Price matters somewhat:** in all 20 top majors, programs at the highest-tuition quarter of schools
     report higher medians than the lowest quarter (typical gap $5,165; range $954–$17,057). Within-major ρ
     is positive but modest (median 0.25).
   - **Adjusted wording:** "What you study is associated with much larger differences in early earnings than
     how much your college charges. A major's popularity tells you almost nothing about its typical early
     pay." We **dropped** "higher tuition does not indicate higher earnings": the data show a modest positive
     association. We also say explicitly that these are descriptive, not causal.
5. **Takeaway:** compare specific programs and net price after aid, alongside interests and goals.
   Limits: early earnings, aided-graduates-only, suppression, observational data, sticker prices.

## 5. Known limitations and next steps

Limitations
- 1-year earnings only, covering federal aid recipients who worked and were not enrolled.
- Privacy suppression removes earnings for 57% of programs, which hold 14% of degrees (mostly small programs).
  Results lean toward larger programs.
- Prices are nominal and published (sticker); earnings are in 2024 dollars. The "pay more" axis is the sticker
  price, not what a student paid.
- Branch campuses share one earnings value. We count it once, on the largest campus.
- Major = 4-digit CIP. Different programs inside one CIP are not distinguished.
- The brush filters schools by price, and a school's programs inherit that price. This doesn't capture
  program-specific tuition.

Next steps
1. Implement the dollar bill, brain and flow views as linked D3 components (designs in `docs/designs/`).
2. Add a table view for chart 2 (accessibility, exact values) and a "change vs. all schools" annotation.
3. Consider adding net price by family income (Dashboard 1 idea) and 4-/5-year earnings (`EARN_MDN_4YR`
   from the same `2122_2223` file, covering a different cohort that would need its own labeling).
4. Usability test with classmates: do readers understand "median program" and the fixed axis?
5. Deploy the static build (e.g. GitHub Pages with `BASE_PATH=/repo-name npm run build`).

## 6. Screenshots

`node scripts/screenshots.mjs` (with `npm run preview -- --port 4173` running) regenerates these in
`docs/screenshots/` (light mode; add `--dark` for dark mode). It also runs 13 interaction checks.

| File | Use in the process book |
|---|---|
| `01-intro.png` | Hook, data years, sticker vs. net price callout |
| `02-tuition-histogram-default.png` | Chart 1, default |
| `04-tuition-histogram-brushed.png` | Chart 1 with a $20K–$35K brush |
| `03-earnings-default.png` | Chart 2, all schools |
| `05-earnings-brushed.png` | Chart 2 comparing all schools vs. the brushed range (shows linking) |
| `06-school-search.png` | College search marker |
| `07-major-detail.png` | Linked "inside one major" scatter (Computer Science) |
| `08-empty-range.png` | Empty-selection state |
| `09-what-it-means.png` | Data-checked main message |
| `10-explore-placeholders.png` | The three draft placeholders on the page |
| `11-methods.png` | Takeaway, limits, methods |
| `12-mobile-top.png`, `13-mobile-histogram.png`, `14-mobile-earnings.png` | Narrow-screen layout (375 px) |
| `15-error-state.png` | Missing-data error state |
| `dollar-bill-draft.png`, `brain-draft.png`, `flow-draft.png` | Updated design drafts |

To capture by hand: `npm run dev`, open the page, drag across the histogram, and use the browser's
"Capture node screenshot" on a section.

## 7. Team contributions

*(To be completed by the team. Not filled in by the assistant.)*

| Team member | Contributions to Prototype V1 |
|---|---|
| Owen | |
| Christina | |
| William | |

AI assistance: describe here how Claude was used (e.g. pipeline and prototype implementation, review of
outputs) and what the team verified or changed.
