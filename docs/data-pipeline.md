# Data pipeline

Everything on the site comes from official U.S. Department of Education College Scorecard
downloads, processed by `scripts/build_data.py`. No values are typed in by hand.

```bash
npm run data:download   # bash scripts/download_data.sh  -> data/raw/, data/docs/, data/raw/MANIFEST.tsv
npm run data:build      # python3 scripts/build_data.py   -> static/data/*.csv, *.json  (~10 s)
npm run data:verify     # node scripts/verify_summaries.mjs (page math == pipeline math)
npm run designs         # node scripts/make_design_drafts.mjs -> docs/designs/*.svg
```

Requirements: Python 3.10+ with `pandas` and `openpyxl` (`pip install -r requirements.txt`), and Node 20+.
The raw files (about 560 MB zipped) are git-ignored. `data/raw/MANIFEST.tsv` is committed.

## 1. Sources

| File | URL | Retrieved (UTC) | Server last-modified | SHA-256 (first 12) |
|---|---|---|---|---|
| `College_Scorecard_Raw_Data_10152026.zip` | https://ed-public-download.scorecard.network/downloads/College_Scorecard_Raw_Data_10152026.zip | 2026-10-26 02:29 | 2026-10-09 | `84058390d0f0` |
| `CollegeScorecardDataDictionary.xlsx` | https://collegescorecard.ed.gov/files/CollegeScorecardDataDictionary.xlsx | 2026-10-26 02:29 | 2026-10-22 | `8d258487f252` |
| `FieldOfStudyDataDocumentation.pdf` (version Oct 2026) | https://collegescorecard.ed.gov/files/FieldOfStudyDataDocumentation.pdf | 2026-10-26 02:29 | 2026-10-22 | `2afd04a36d88` |
| `InstitutionDataDocumentation.pdf` | https://collegescorecard.ed.gov/files/InstitutionDataDocumentation.pdf | 2026-10-26 02:29 | 2026-10-22 | `d4f69b6e7b72` |
| `CIPCode2020.csv` (NCES CIP 2020 titles) | https://nces.ed.gov/ipeds/cipcode/Files/CIPCode2020.csv | 2026-10-26 02:29 | 2021-07-16 | `6cf0882c1f5b` |

Landing page: https://collegescorecard.ed.gov/data/. The zip is the "All Data Files" download
(release stamp `10152026`). Full hashes are in `data/raw/MANIFEST.tsv` and `static/data/meta.json`.

Files read from inside the zip (they are never extracted to disk):

| Purpose | File(s) in zip |
|---|---|
| Degree counts | `FieldOfStudyData2021_2122_PP.csv` |
| Earnings | `FieldOfStudyData2122_2223_PP.csv` |
| School attributes (name, control, PREDDEG, …) | `MERGED2021_22_PP.csv` |
| Published prices | `MERGED2017_18_PP.csv` … `MERGED2021_22_PP.csv` |
| Average net price for the same academic years | `MERGED2018_19_PP.csv` … `MERGED2022_23_PP.csv` |

### Other copies we checked (not used)

`~/Downloads/archive (2)/` holds `Most-Recent-Cohorts-Institution.csv` (6,273 schools) and
`CollegeScorecardDataDictionary.xlsx`, both from the **June 10, 2026** release. Checked 2026-10-26; we
decided not to use it because:

- **It's institution-level only.** There is no field-of-study data, so it can't produce earnings by major
  across colleges.
- **Each "Most Recent" column describes a different cohort.** Per that file's own
  `Most_Recent_Inst_Cohort_Map`: tuition AY2024-25; net price AY2023-24; degree shares AY2024-25;
  `MD_EARN_WNE_1YR` = AY2018-19 + 2019-20 completers; `MD_EARN_WNE_P10` = AY2009-11 entrants.
- **It's superseded.** The October 15, 2026 release used here contains an updated version of the same
  file (tuition AY2025-26; 1-year earnings for the AY2020-21 + 2021-22 completers). Only 57.5% of the
  6,272 shared schools have identical `TUITIONFEE_IN` across the two copies.

## 2. Cohort definitions, and why the earlier scope changed

The earlier dashboard prototype described its data as "2019–20 and 2020–21 graduates, earnings 1 year
after graduating", taken from `FieldOfStudyData1920_2021`. The data dictionary's
**FieldOfStudy_Cohort_Map** sheet shows that this file mixes two different cohorts:

| File label | `IPEDSCOUNT1` / `IPEDSCOUNT2` (degrees) | `EARN_MDN_1YR` (1-year earnings) |
|---|---|---|
| `FieldOfStudyData1920_2021` | AY2019-20 / AY2020-21 | AY2018-19 + AY2019-20 completers, measured CY2020–21, 2022 $ |
| `FieldOfStudyData2021_2122` | AY2020-21 / AY2021-22 | **NA** (not published in this file) |
| `FieldOfStudyData2122_2223` | AY2021-22 / AY2022-23 | **AY2020-21 + AY2021-22** completers, measured CY2022–23, 2024 $ |

The Scorecard labels field-of-study files by the **debt** cohort (FoS documentation, "Data files
available"), not by the earnings cohort. **No file has 1-year earnings for the AY2019-20 + AY2020-21
cohort**, so the earlier combination cannot be reproduced as described.

**Scope we adopted (same graduating class for counts and earnings):**

- **Graduates:** bachelor's completers in award years **2020-21 and 2021-22**.
- **Degree counts:** `IPEDSCOUNT1 + IPEDSCOUNT2` from `FieldOfStudyData2021_2122`.
- **Earnings:** `EARN_MDN_1YR` from `FieldOfStudyData2122_2223`. This is the same pooled
  AY2020-21 + AY2021-22 cohort, measured in calendar years 2022 and 2023, in 2024 dollars.
- **Prices:** published tuition, fees and cost components for academic years **2017-18 through
  2021-22** (`MERGED2017_18` … `MERGED2021_22`). These are the years the two classes were enrolled,
  assuming roughly four years. The institution cohort map confirms `TUITIONFEE_*`, `ROOMBOARD_ON`,
  `BOOKSUPPLY` and `OTHEREXPENSE_ON` in `MERGEDyyyy_yy` describe that same academic year.
- **Net price** (`NPT4_PUB` / `NPT4_PRIV`) lags its file label by one year (in `MERGED2018_19` it
  describes AY2017-18), so we read `MERGED2018_19` … `MERGED2022_23` to cover the same AY2017-18 … 2021-22.

`build_data.py` re-checks 41 of these cohort-map entries against the dictionary on every run and stops
with an error if a future release changes them.

## 3. Variables

| Output column | Source variable(s) | Meaning |
|---|---|---|
| `schools.unitid` | `UNITID` | IPEDS institution ID (string; used for all joins) |
| `schools.name, city, state` | `INSTNM, CITY, STABBR` (MERGED2021_22) | |
| `schools.control` | `CONTROL` | 1 public, 2 private nonprofit, 3 private for-profit |
| `schools.tuition_in / tuition_out` | `TUITIONFEE_IN / TUITIONFEE_OUT` | **Published** in-state / out-of-state tuition and fees, mean of AY2017-18…2021-22 |
| `schools.tuition_years` | | Number of those 5 years with in-state tuition reported (3–5) |
| `schools.roomboard, books, other` | `ROOMBOARD_ON, BOOKSUPPLY, OTHEREXPENSE_ON` | Published on-campus cost components, same years (for the dollar-bill view) |
| `schools.net_price` | `NPT4_PUB` or `NPT4_PRIV` | **Average net price**: cost of attendance minus grant aid, for first-time full-time Title IV aid recipients. Not the same as tuition. |
| `schools.ugds` | `UGDS` | Undergraduate degree-seeking enrollment, fall 2021 (not used for weighting yet) |
| `schools.deg_bach` | sum of `programs.deg` | Bachelor's degrees awarded AY2020-21 + 2021-22 |
| `programs.cip` | `CIPCODE` | 4-digit CIP 2020 code, stored as a zero-padded string (e.g. `0901`) |
| `programs.deg` | `IPEDSCOUNT1 + IPEDSCOUNT2` | Bachelor's degrees (all majors, including second majors) in the two years. Missing if either year is missing. |
| `programs.earn` | `EARN_MDN_1YR` | Median annual earnings 1 yr after completion, 2024 $ |
| `programs.n_wne` | `EARN_COUNT_WNE_1YR` | Graduates who worked and were not enrolled (the earnings denominator) |
| `programs.note` | | `PS` privacy-suppressed · `DUP` repeated branch-campus value (counted at another campus) · blank = reported |
| `majors.title, cip2, family` | NCES CIP 2020 | 4-digit title and 2-digit family |
| `majors.earn_nat` | `EARN_MDN_1YR_NAT` | Official national median for all bachelor's graduates in the field (person-level, not an average of programs) |

**Total cost of attendance (`COSTT4_A`) is not used.** It lags its file label like net price, and the
dollar-bill view builds cost from its published components instead.

## 4. Inclusion and exclusion rules

| Step | Records |
|---|---|
| Institutions in MERGED2021_22 | 6,543 |
| Predominantly bachelor's-granting (`PREDDEG = 3`), control 1–3 | 2,004 |
| …with > 0 bachelor's degrees reported in AY2020-21 + 2021-22 | 1,973 (31 dropped) |
| …with published in-state tuition for ≥ 3 of the 5 years | **1,876** (97 dropped, 44,037 degrees) |
| FoS 2021_2122 rows / bachelor's (`CREDLEV = 3`) / with a UNITID | 225,205 / 72,113 / 69,948 |
| FoS 2122_2223 bachelor's rows with a UNITID / with reported earnings | 73,821 / 25,444 |
| Outer join on UNITID + CIP: both / counts only / earnings only | 68,742 / 1,206 / 5,079 |
| Programs at in-scope schools | 69,570 |
| Dropped: zero or missing degrees **and** no earnings | 14,470 |
| **Final programs** | **55,100**: 22,336 with earnings, 31,596 suppressed, 1,168 repeated branch values |
| Bachelor's degrees in final programs | 4,120,193 |
| Majors (4-digit CIP) | 363 |

The scope includes the 50 states, DC, Puerto Rico, Guam and the U.S. Virgin Islands. Foreign
institutions and rows without a UNITID (closed or unmatched OPEIDs) are excluded.

## 5. Joins, deduplication and weighting

- **Join keys.** UNITID (read as a string) + 4-digit `CIPCODE` (string, zero-padded to 4) at
  `CREDLEV = 3`. The script asserts both FoS files have unique UNITID × CIP keys at the bachelor's level.
- **Overlapping releases.** Each quantity comes from exactly one file (counts from 2021_2122, earnings
  from 2122_2223). Nothing is summed across yearly files, and the "Most Recent" file, which mixes
  cohorts, is not used.
- **Branch campuses.** The Scorecard computes earnings per 6-digit OPEID and repeats the same value on
  every branch UNITID offering the field (FoS documentation, "Defining field of study"). We found
  609 OPEID6 × CIP groups repeated across 1,777 in-scope rows. All values in a group were identical
  (the script asserts this). We keep each value once, on the campus with the most degrees in that field
  (ties: main campus, then lowest UNITID), and blank it on the others (`note = DUP`). Degree counts stay
  per campus because IPEDS reports them per UNITID.
- **Aggregate rows.** The FoS files contain no total or aggregate rows. National values arrive as
  separate `_NAT` columns, which we keep only as a per-major reference.
- **Weighting labels used on the site:**
  - Tuition summaries: **each school counts once** (school-weighted).
  - Degree shares: **weighted by degrees**.
  - Earnings by major: quantiles of **program medians, each program counts once**. The middle value
    is called the "median program", never "median earnings of graduates". No averages of medians are shown.
  - Tuition quartiles: quartiles of schools (school-weighted) by in-state tuition.

## 6. Missing and suppressed values

Every non-numeric code becomes missing (`NaN` / empty CSV cell), never zero. Codes seen in the inputs:

| Variable | Codes |
|---|---|
| `EARN_MDN_1YR`, `EARN_COUNT_WNE_1YR` | `PS` (privacy suppressed) |
| `IPEDSCOUNT1/2`, `TUITIONFEE_*`, `ROOMBOARD_ON`, `BOOKSUPPLY`, `OTHEREXPENSE_ON`, `NPT4_*`, `UGDS` | `NA` |

- A school's price is the mean of the years it reported. It is missing if fewer than 3 of 5 years were
  reported. 1,830 schools have all 5 years, 22 have 4, and 24 have 3.
- `deg` is missing when either year's IPEDS count is missing (452 final programs). These programs still
  contribute earnings but not degree shares.
- Earnings are reported for 41% of programs, which hold 85% of degrees: suppression mostly hits small programs.
  The site states this coverage and shows open circles when fewer than 5 programs report.

## 7. Outputs (`static/data/`)

| File | Rows | Size |
|---|---|---|
| `schools.csv` | 1,876 | 171 KB |
| `programs.csv` | 55,100 | 1.2 MB |
| `majors.csv` | 363 | 32 KB |
| `findings.json` | numbers quoted in the narrative, each with its weighting described | 12 KB |
| `meta.json` | sources, hashes, scope, cohort-map checks, record counts, codes | 11 KB |

## 8. Verification

`npm run data:verify` reloads the CSVs with the same `src/lib/data/summarize.js` the charts use and
compares 133 values with `findings.json`. These cover school counts, degree totals, tuition and net-price
medians by type, share and quartiles for the top 20 majors, within-major Spearman correlations, and a
brushed-range count. Last run: 133/133 passed.
