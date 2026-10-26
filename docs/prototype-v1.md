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
| Scrollama scrollytelling for the tuition and earnings sections | **Done** | `src/lib/components/Scrolly.svelte`, `src/routes/+page.svelte` (see §3b) |
| Dollar bill, brain, flow diagram | **Design drafts only** (static SVG from real data, in `docs/designs/`) | Parts 4 and 5 of the page are currently empty placeholders |
| Automated checks (data, browser) | **Done** | `scripts/verify_summaries.mjs`, `scripts/screenshots.mjs`, `scripts/check_scrollytelling.mjs` |
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

## 3b. Scrollytelling (Scrollama)

Both chart sections now use a sticky graphic with a column of short story steps. Scrolling changes only
what is **emphasized**. It never filters data, changes axes, or touches the reader's own selections.

### Steps as implemented

Every number in a step is computed in the browser from the cleaned data (all 1,876 schools, in-state
prices). The values that also appear in `findings.json` match it: the medians by type, Business's share,
median and rank, Nursing's and English's medians and gap, and the within-major spread. The tuition range,
the 5th/95th percentiles, and the shares under $15,000 or at least $20,000 are new and computed only on the page.

| Section | Step | Visual change | Text (numbers shown) |
|---|---|---|---|
| Tuition | 1 | Full distribution, all groups in color | Prices ran from $480 to $60,725; the middle 90% between $6,234 and $52,698 |
| Tuition | 2 | Public bars stay blue; other groups turn gray | 96% of 546 public colleges under $15,000 in-state; median $8,804 |
| Tuition | 3 | Private nonprofit bars stay orange; others gray | Median $30,531; 71% of 1,181 charge ≥ $20,000; range $3,008–$60,725 |
| Tuition | 4 | All groups restored | Invitation to search a college, switch residency, or brush a range |
| Earnings | 1 | All majors at full strength | How to read the dot (median program) and bar (middle 50% of programs) |
| Earnings | 2 | Business row emphasized and labeled; other rows dimmed | 7.7% of degrees; median program $51,317 ranks 8th of the 20 most common majors |
| Earnings | 3 | Nursing and English emphasized and labeled | $80,271 vs. $37,131, a $43,140 gap; typical within-major middle-half spread $8,554 |
| Earnings | 4 | All majors restored | Invitation to click a major or compare a tuition range |

The section headline was changed from "Published tuition varies tenfold" to "Published tuition ranges widely".
The middle 90% of prices span about 8.5×, and the full range far more, so "tenfold" was not accurate.

### "Dimmed for emphasis" vs. "filtered out"

- **Dimmed for emphasis (story):** histogram bars switch to a flat gray at full height, and earnings rows
  drop to 20% opacity. Nothing is removed, counts and axes are unchanged, and dimmed rows still show
  tooltips. A note in the chart says so ("Gray bars are dimmed for emphasis; every school is still counted"
  / "Other majors are dimmed for emphasis, not removed"), and so does the step text.
- **Filtered out (reader's tuition brush):** bars outside the selected range fade to 22% opacity in their
  own color, with the note "Faded bars fall outside your selected tuition range". The earnings chart keeps
  the all-schools comparison and overlays the selected range in black.

### State model

- `tuitionStep` and `earningsStep` in `+page.svelte` are the single source of truth for each section. Only
  the Scrollama callbacks in `Scrolly.svelte` write them (`onStepEnter` sets the index; leaving the first
  step upward sets `null`).
- Emphasis is *derived* from the step (`tuitionEmphasis`, `earningsEmphasis`) and passed to the charts as
  a separate `emphasis` prop. The charts apply it by toggling CSS classes on existing marks in their own
  effect, so a step change never redraws a chart or moves the brush.
- User state (`range`, `residency`, `selectedSchool`, `selectedMajor`, sort, top N) is separate and never
  written by scroll code. Because emphasis is a pure function of the current step, scrolling up restores
  the previous step's view exactly.

### Layout

- **Wide screens (≥ 900 px):** steps column on the left (240–300 px), sticky graphic on the right,
  vertically centered. The tuition graphic includes the residency toggle and college search. The earnings
  rows shrink (28–38 px) to fit the viewport height; if the window is still too short, the sticky panel
  scrolls internally.
- **Narrow screens:** the graphic sticks to the top of the screen with an opaque background, and the steps
  scroll up into the space below it, sliding underneath instead of overlapping. The histogram is 240 px
  tall. The earnings chart switches to compact one-line rows inside a panel capped at 62% of the screen.
  When a step emphasizes rows, that panel (not the page) scrolls them into view.
- Story controls stay usable throughout. The full selection readout, range inputs, captions, summary table,
  major controls and the "inside one major" scatter follow each story block.

### Motion, robustness and cleanup

- Transitions are 250 ms on fill/opacity only, wrapped in `prefers-reduced-motion: no-preference`. The
  page is never scrolled programmatically.
- Scrollama is imported dynamically inside `onMount`, so it only runs in the browser. Window resizes
  call `scroller.resize()`, and crossing the 900 px breakpoint switches the trigger line (0.5 → 0.8 of the
  viewport). Observers and listeners are removed when the component is destroyed.
- If Scrollama fails to load, the step state stays `null`: all step text is shown at full strength and the
  charts are fully colored and interactive. (Tested by blocking the module.)

### Verification (`node scripts/check_scrollytelling.mjs http://localhost:5173`, 64/64 passed)

- Each step on desktop (1280×900) and mobile (390×844) shows the expected emphasis, scrolling down and back up.
- A range, college, and major chosen before scrolling are unchanged after scrolling through every step and back.
- Brushing and Reset work on the sticky histogram mid-story; earnings tooltips still appear.
- On mobile, every active step's text sits fully below the sticky graphic, there is no horizontal scroll,
  and emphasized rows are visible inside the earnings panel.
- Reduced motion turns chart transitions off; a blocked Scrollama falls back to readable text.
- No console or page errors on desktop or mobile.

## 4. Narrative sequence

1. **Hook:** "Does a more expensive college mean a bigger paycheck?" The intro states the data years and
   shows that published price ≠ net price, using real medians.
2. **Rising insight 1 (cost):** published tuition ranges widely, and type explains much of it. Story steps
   highlight public, then private nonprofit colleges; then readers find their school and brush a range.
3. **Rising insight 2 (earnings):** early earnings vary far more between majors than within them. Story steps
   explain the encoding, highlight Business (popular, mid-paying), then Nursing vs. English. The brushed range
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

Screenshots `01`–`15` show the page **before scrollytelling**. With the story layout, whole-section
captures become very tall, so use the step captures below for the current design.

### Scrollytelling screenshots (`docs/screenshots/scrolly/`)

`node scripts/check_scrollytelling.mjs http://localhost:5173` (with `npm run dev` running) regenerates these
and runs 64 checks.

| File | Use in the process book |
|---|---|
| `desktop-cost-step1.png` … `step4.png` | Tuition story: full distribution → public → nonprofit → all restored |
| `desktop-earnings-step1.png` … `step4.png` | Earnings story: encoding → Business → Nursing vs. English → all restored |
| `desktop-brush-mid-story.png` | Brushing the sticky histogram during the story (selections are independent of scrolling) |
| `mobile-cost-step1.png` … `step4.png`, `mobile-earnings-step1.png` … `step4.png` | Narrow layout: graphic on top, text below, no overlap |

To capture by hand: `npm run dev`, open the page, scroll to a step, and take a window screenshot.

## 7. Team contributions

*(To be completed by the team. Not filled in by the assistant.)*

| Team member | Contributions to Prototype V1 |
|---|---|
| Owen | |
| Christina | |
| William | |

AI assistance: describe here how Claude was used (e.g. pipeline and prototype implementation, review of
outputs) and what the team verified or changed.
