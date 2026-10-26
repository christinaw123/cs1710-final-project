# cs1710-final-project

## Does a more expensive college mean a bigger paycheck?

CS171 final project (Prototype V1): a SvelteKit + D3 site comparing published college tuition with
bachelor's graduates' earnings one year after graduation, major by major, using U.S. Department of
Education College Scorecard data.

### Run locally

Requirements: Node 20+ (tested with 22.17) and, to rebuild the data, Python 3.10+ with pandas and openpyxl.

```bash
npm install
npm run dev                # http://localhost:5173
```

The cleaned data in `static/data/` is already in the repo, so the site runs without the raw downloads.

Production build (static site in `build/`):

```bash
npm run build
npm run preview -- --port 4173
```

Restart `preview` after every rebuild: it indexes the build folder at startup.

### Rebuild the data from the official sources

```bash
pip install -r requirements.txt
npm run data:download      # ~560 MB from collegescorecard.ed.gov -> data/raw (git-ignored)
npm run data:build         # writes static/data/*.csv|json
npm run data:verify        # checks that page summaries match the pipeline
npm run designs            # regenerates docs/designs/*.svg from the cleaned data
```

### Checks

```bash
npm run check                                     # svelte-check
node scripts/screenshots.mjs http://localhost:4173  # 13 browser checks + process-book screenshots
```

### Layout

```
scripts/        download_data.sh, build_data.py (pipeline), verify_summaries.mjs,
                make_design_drafts.mjs, screenshots.mjs
src/lib/data/   load.js, summarize.js (shared summary math used by charts and verification)
src/lib/components/  TuitionHistogram, EarningsByMajor, MajorScatter, SchoolSearch
src/routes/+page.svelte  the narrative page
static/data/    cleaned outputs (schools.csv, programs.csv, majors.csv, findings.json, meta.json)
docs/           prototype-v1.md, data-pipeline.md, designs/, screenshots/
```

See `docs/prototype-v1.md` for the process-book write-up and `docs/data-pipeline.md` for sources,
cohort definitions and record counts.
