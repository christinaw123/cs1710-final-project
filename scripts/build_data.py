#!/usr/bin/env python3
"""
Build the cleaned data files for the website from official College Scorecard downloads.

Usage:
    bash scripts/download_data.sh      # once, fetches the source files into data/raw and data/docs
    python3 scripts/build_data.py      # writes static/data/*.csv|json

Scope (verified against the "FieldOfStudy_Cohort_Map" and "Institution_Cohort_Map" sheets of
CollegeScorecardDataDictionary.xlsx; the script re-checks these labels every run):

  * Graduates:  bachelor's completers (CREDLEV 3) in award years 2020-21 and 2021-22.
  * Degrees:    IPEDSCOUNT1 (AY2020-21) + IPEDSCOUNT2 (AY2021-22) from FieldOfStudyData2021_2122_PP.csv.
  * Earnings:   EARN_MDN_1YR from FieldOfStudyData2122_2223_PP.csv = median earnings of the
                AY2020-21 + AY2021-22 pooled completer cohort, measured in CY2022 and CY2023,
                inflation-adjusted to 2024 dollars.  (The file *labeled* 2021_2122 has no 1-year
                earnings, and the file labeled 1920_2021 holds the AY2018-19 + AY2019-20 cohort,
                so file labels alone do not identify the earnings cohort.)
  * Costs:      published tuition & fees and cost components averaged over academic years
                2017-18 .. 2021-22 (MERGED2017_18 .. MERGED2021_22), the years these graduates
                were enrolled.  Average net price for the same academic years comes from
                MERGED2018_19 .. MERGED2022_23 because NPT4 lags its file label by one year.

All dollar figures for costs are nominal (not inflation adjusted); earnings are 2024 dollars.
"""

from __future__ import annotations

import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DOCS = ROOT / "data" / "docs"
OUT = ROOT / "static" / "data"

RELEASE = "10152026"
ZIP_PATH = RAW / f"College_Scorecard_Raw_Data_{RELEASE}.zip"
CIP_PATH = RAW / "CIPCode2020.csv"
DICT_PATH = DOCS / "CollegeScorecardDataDictionary.xlsx"

COUNTS_FILE = "FieldOfStudyData2021_2122_PP.csv"
EARN_FILE = "FieldOfStudyData2122_2223_PP.csv"
ATTR_FILE = "MERGED2021_22_PP.csv"
COST_YEARS = ["2017-18", "2018-19", "2019-20", "2020-21", "2021-22"]
# Published price variables: file label == academic year.
COST_FILES = {y: f"MERGED{y[:4]}_{y[5:]}_PP.csv" for y in COST_YEARS}
# NPT4 in MERGED{Y+1} describes academic year Y (see Institution_Cohort_Map).
NETPRICE_FILES = {y: f"MERGED{int(y[:4]) + 1}_{int(y[5:]) + 1:02d}_PP.csv" for y in COST_YEARS}

MIN_COST_YEARS = 3  # a school-level average needs at least 3 of the 5 years reported
CONTROL_LABELS = {1: "Public", 2: "Private nonprofit", 3: "Private for-profit"}

# Expected cohort-map text (substring match) -> fail loudly if a future release changes it.
EXPECTED_COHORTS = [
    ("FieldOfStudy_Cohort_Map", "IPEDSCOUNT1", "FieldOfStudyData2021_2122 datafile", "AY2020-21"),
    ("FieldOfStudy_Cohort_Map", "IPEDSCOUNT2", "FieldOfStudyData2021_2122 datafile", "AY2021-22"),
    ("FieldOfStudy_Cohort_Map", "EARN_MDN_1YR", "FieldOfStudyData2122_2223 datafile", "AY2020-21, AY2021-22 pooled"),
    ("FieldOfStudy_Cohort_Map", "EARN_MDN_1YR", "FieldOfStudyData2122_2223 datafile", "2024 dollars"),
    ("FieldOfStudy_Cohort_Map", "EARN_MDN_1YR_NAT", "FieldOfStudyData2122_2223 datafile", "AY2020-21, AY2021-22 pooled"),
    ("FieldOfStudy_Cohort_Map", "EARN_MDN_1YR", "FieldOfStudyData2021_2122 datafile", "NA"),
    *[("Institution_Cohort_Map", v, f"Merged{y[:4]}_{y[5:]}", f"AcadYr {y}")
      for y in COST_YEARS for v in ["TUITIONFEE_IN", "TUITIONFEE_OUT", "ROOMBOARD_ON", "BOOKSUPPLY", "OTHEREXPENSE_ON"]],
    *[("Institution_Cohort_Map", v, NETPRICE_FILES[y].replace("MERGED", "Merged").replace("_PP.csv", ""), f"AcadYr {y}")
      for y in COST_YEARS for v in ["NPT4_PUB", "NPT4_PRIV"]],
]

report: dict = {"steps": [], "nonnumeric_codes": {}}


def log(step: str, **counts) -> None:
    report["steps"].append({"step": step, **counts})
    print(f"  - {step}: " + ", ".join(f"{k}={v:,}" if isinstance(v, (int, np.integer)) else f"{k}={v}" for k, v in counts.items()))


def to_num(series: pd.Series, name: str) -> pd.Series:
    """Convert to float; every non-numeric code (PS, NA, NULL, PrivacySuppressed, '') becomes NaN, never 0."""
    s = series.astype(str).str.strip()
    num = pd.to_numeric(s, errors="coerce")
    codes = s[num.isna()].value_counts()
    if len(codes):
        prev = report["nonnumeric_codes"].setdefault(name, {})
        for k, v in codes.items():
            prev[k] = prev.get(k, 0) + int(v)
    return num


def read_zip_csv(z: zipfile.ZipFile, name: str, cols: list[str]) -> pd.DataFrame:
    with z.open(name) as fh:
        header = pd.read_csv(fh, nrows=0).columns
    missing = [c for c in cols if c not in header]
    if missing:
        sys.exit(f"ERROR: {name} is missing expected columns {missing}")
    with z.open(name) as fh:
        return pd.read_csv(fh, usecols=cols, dtype=str, keep_default_na=False)


def check_cohort_map() -> list[dict]:
    if not DICT_PATH.exists():
        print("  ! data dictionary not found; skipping cohort-map verification")
        return []
    import openpyxl

    wb = openpyxl.load_workbook(DICT_PATH, read_only=True)
    sheets: dict = {}
    checked = []
    for sheet, var, col, expected in EXPECTED_COHORTS:
        if sheet not in sheets:
            rows = list(wb[sheet].iter_rows(values_only=True))
            hdr = [str(h).replace(" datafile", "") if h else "" for h in rows[0]]
            sheets[sheet] = (hdr, {r[0]: r for r in rows[1:] if r[0]})
        hdr, by_var = sheets[sheet]
        idx = hdr.index(col.replace(" datafile", ""))
        actual = str(by_var[var][idx])
        ok = (actual == "NA") if expected == "NA" else (expected in actual)
        if not ok:
            sys.exit(f"ERROR: cohort map mismatch for {var} in {col}: expected '{expected}', found '{actual}'")
        checked.append({"variable": var, "file": col, "cohort_map": actual})
    print(f"  - verified {len(checked)} cohort-map entries against the data dictionary")
    return checked


def avg_years(frames: dict[str, pd.DataFrame], var: str) -> tuple[pd.Series, pd.Series]:
    """Mean of a variable across the available years for each UNITID (NaN if fewer than MIN_COST_YEARS)."""
    wide = pd.concat({y: f.set_index("UNITID")[var] for y, f in frames.items()}, axis=1)
    n = wide.notna().sum(axis=1)
    mean = wide.mean(axis=1, skipna=True).where(n >= MIN_COST_YEARS)
    return mean, n


def spearman(x: pd.Series, y: pd.Series) -> float:
    return float(pd.Series(x).rank().corr(pd.Series(y).rank()))


def q(values, p):
    # numpy "linear" == R type 7 == d3.quantile, so the website reproduces these numbers.
    return float(np.quantile(np.asarray(values, dtype=float), p))


def main() -> None:
    if not ZIP_PATH.exists():
        sys.exit(f"ERROR: {ZIP_PATH} not found. Run `bash scripts/download_data.sh` first.")
    OUT.mkdir(parents=True, exist_ok=True)
    print("Verifying cohort definitions")
    cohort_checks = check_cohort_map()
    z = zipfile.ZipFile(ZIP_PATH)

    # ---------------------------------------------------------------- institutions
    print("Institutions")
    attr = read_zip_csv(z, ATTR_FILE, ["UNITID", "OPEID6", "INSTNM", "CITY", "STABBR", "CONTROL", "PREDDEG", "MAIN", "UGDS"])
    log("institutions in MERGED2021_22", rows=len(attr))
    attr["CONTROL"] = to_num(attr["CONTROL"], "CONTROL")
    attr["PREDDEG"] = to_num(attr["PREDDEG"], "PREDDEG")
    attr["UGDS"] = to_num(attr["UGDS"], "UGDS")
    cand = attr[(attr.PREDDEG == 3) & attr.CONTROL.isin([1, 2, 3])].copy()
    log("predominantly bachelor's-granting (PREDDEG=3), public/private", rows=len(cand))

    cost_vars = ["TUITIONFEE_IN", "TUITIONFEE_OUT", "ROOMBOARD_ON", "BOOKSUPPLY", "OTHEREXPENSE_ON"]
    cost_frames = {}
    for y, f in COST_FILES.items():
        d = read_zip_csv(z, f, ["UNITID", *cost_vars])
        for v in cost_vars:
            d[v] = to_num(d[v], v)
        cost_frames[y] = d
    np_frames = {}
    for y, f in NETPRICE_FILES.items():
        d = read_zip_csv(z, f, ["UNITID", "NPT4_PUB", "NPT4_PRIV"])
        d["NPT4"] = to_num(d["NPT4_PUB"], "NPT4_PUB").combine_first(to_num(d["NPT4_PRIV"], "NPT4_PRIV"))
        np_frames[y] = d

    costs = pd.DataFrame(index=pd.Index(cand.UNITID, name="UNITID"))
    for v, out in [("TUITIONFEE_IN", "tuition_in"), ("TUITIONFEE_OUT", "tuition_out"), ("ROOMBOARD_ON", "roomboard"),
                   ("BOOKSUPPLY", "books"), ("OTHEREXPENSE_ON", "other")]:
        mean, n = avg_years(cost_frames, v)
        costs[out] = mean
        if v == "TUITIONFEE_IN":
            costs["tuition_years"] = n
    costs["net_price"], _ = avg_years(np_frames, "NPT4")
    cand = cand.merge(costs.reset_index(), on="UNITID", how="left")

    # ---------------------------------------------------------------- field of study
    print("Field of study")
    fos_cols = ["UNITID", "OPEID6", "MAIN", "CIPCODE", "CIPDESC", "CREDLEV", "IPEDSCOUNT1", "IPEDSCOUNT2"]
    counts = read_zip_csv(z, COUNTS_FILE, fos_cols)
    log(f"{COUNTS_FILE} rows", rows=len(counts))
    counts = counts[counts.CREDLEV == "3"]
    log("bachelor's rows (CREDLEV=3)", rows=len(counts))
    counts = counts[counts.UNITID != "NA"]
    log("bachelor's rows with a UNITID (drops foreign/unmatched rows)", rows=len(counts))
    counts["CIPCODE"] = counts.CIPCODE.str.zfill(4)
    assert not counts.duplicated(["UNITID", "CIPCODE"]).any(), "duplicate UNITID x CIP in counts file"
    c1 = to_num(counts.IPEDSCOUNT1, "IPEDSCOUNT1")
    c2 = to_num(counts.IPEDSCOUNT2, "IPEDSCOUNT2")
    counts["deg"] = (c1 + c2).where(c1.notna() & c2.notna())  # missing if either year is not reported
    log("bachelor's rows with one year of IPEDS counts missing (deg set to missing)", rows=int((c1.isna() ^ c2.isna()).sum()))

    earn = read_zip_csv(z, EARN_FILE, [*fos_cols[:6], "CREDLEV", "EARN_MDN_1YR", "EARN_COUNT_WNE_1YR", "EARN_MDN_1YR_NAT"])
    log(f"{EARN_FILE} rows", rows=len(earn))
    earn = earn[(earn.CREDLEV == "3") & (earn.UNITID != "NA")].copy()
    earn["CIPCODE"] = earn.CIPCODE.str.zfill(4)
    assert not earn.duplicated(["UNITID", "CIPCODE"]).any(), "duplicate UNITID x CIP in earnings file"
    earn["earn_raw"] = earn.EARN_MDN_1YR
    earn["earn"] = to_num(earn.EARN_MDN_1YR, "EARN_MDN_1YR")
    earn["n_wne"] = to_num(earn.EARN_COUNT_WNE_1YR, "EARN_COUNT_WNE_1YR")
    earn["earn_nat"] = to_num(earn.EARN_MDN_1YR_NAT, "EARN_MDN_1YR_NAT")
    log("bachelor's rows with a UNITID in earnings file", rows=len(earn), with_earnings=int(earn.earn.notna().sum()))

    # Official national median per CIP (one value per CIP; verify consistency).
    nat = earn.dropna(subset=["earn_nat"]).groupby("CIPCODE").earn_nat.agg(["min", "max"])
    assert (nat["min"] == nat["max"]).all(), "EARN_MDN_1YR_NAT varies within a CIP"
    nat = nat["min"].rename("earn_nat")

    prog = counts[["UNITID", "OPEID6", "MAIN", "CIPCODE", "CIPDESC", "deg"]].merge(
        earn[["UNITID", "CIPCODE", "OPEID6", "MAIN", "CIPDESC", "earn_raw", "earn", "n_wne"]],
        on=["UNITID", "CIPCODE"], how="outer", suffixes=("", "_e"), indicator=True)
    log("joined programs (outer join on UNITID + 4-digit CIP)", rows=len(prog),
        both=int((prog._merge == "both").sum()), counts_only=int((prog._merge == "left_only").sum()),
        earnings_only=int((prog._merge == "right_only").sum()))
    for c in ["OPEID6", "MAIN", "CIPDESC"]:
        prog[c] = prog[c].fillna(prog[c + "_e"])
    prog = prog.drop(columns=["OPEID6_e", "MAIN_e", "CIPDESC_e", "_merge"])

    # ---------------------------------------------------------------- scope
    school_deg = prog.groupby("UNITID").deg.sum(min_count=1)
    cand["deg_bach"] = cand.UNITID.map(school_deg)
    n0 = len(cand)
    cand = cand[cand.deg_bach > 0]
    log("schools with >0 bachelor's degrees reported in AY2020-21 + AY2021-22", rows=len(cand), dropped=n0 - len(cand))
    n0 = len(cand)
    no_tuition = cand[cand.tuition_in.isna()]
    schools = cand[cand.tuition_in.notna()].copy()
    log(f"schools with published in-state tuition for >= {MIN_COST_YEARS} of 5 years", rows=len(schools),
        dropped=n0 - len(schools), dropped_degrees=int(no_tuition.deg_bach.sum()))

    prog = prog[prog.UNITID.isin(schools.UNITID)].copy()
    log("programs at in-scope schools", rows=len(prog))
    keep = (prog.deg > 0) | prog.earn.notna()
    log("programs dropped: zero/missing degrees and no reported earnings", rows=int((~keep).sum()))
    prog = prog[keep].copy()

    # Earnings are computed per 6-digit OPEID and repeated across branch campuses. Count each value once:
    # keep it on the campus with the most degrees in that field (ties: main campus, then lowest UNITID).
    prog["note"] = np.where(prog.earn.notna(), "", np.where(prog.earn_raw == "PS", "PS", "NR"))
    has = prog[prog.earn.notna()].copy()
    has["is_main"] = (has.MAIN == "1").astype(int)
    has = has.sort_values(["OPEID6", "CIPCODE", "deg", "is_main", "UNITID"], ascending=[True, True, False, False, True])
    grp = has.groupby(["OPEID6", "CIPCODE"])
    assert (grp.earn.nunique() == 1).all(), "branch campuses with different earnings in the same OPEID6 x CIP"
    dup_idx = has.index[grp.cumcount() > 0]
    prog.loc[dup_idx, ["earn", "n_wne"]] = np.nan
    prog.loc[dup_idx, "note"] = "DUP"
    log("earnings values repeated across branch campuses (counted once)",
        groups=int((grp.size() > 1).sum()), rows_blanked=len(dup_idx))
    log("final programs", rows=len(prog), with_earnings=int(prog.earn.notna().sum()),
        suppressed=int((prog.note == "PS").sum()), not_reported=int((prog.note == "NR").sum()),
        degrees=int(prog.deg.sum()))

    # ---------------------------------------------------------------- majors (CIP lookup)
    cip = pd.read_csv(CIP_PATH, dtype=str)
    cip["code"] = cip.CIPCode.str.replace(r'[="]', "", regex=True)
    fam = cip[cip.code.str.len() == 2].set_index("code").CIPTitle.str.rstrip(".")
    four = cip[cip.code.str.len() == 5].assign(c4=lambda d: d.code.str.replace(".", "", regex=False)).set_index("c4").CIPTitle
    majors = (prog.groupby("CIPCODE")
              .agg(desc=("CIPDESC", "first"), deg=("deg", "sum"), programs=("UNITID", "size"),
                   programs_earn=("earn", "count"))
              .reset_index())
    majors["title"] = majors.CIPCODE.map(four).fillna(majors.desc).str.rstrip(".")
    majors["cip2"] = majors.CIPCODE.str[:2]
    majors["family"] = majors.cip2.map(fam).str.title()
    majors["earn_nat"] = majors.CIPCODE.map(nat)
    missing_titles = int(majors.CIPCODE.map(four).isna().sum())
    log("majors (4-digit CIP)", rows=len(majors), titles_not_in_CIP2020=missing_titles)

    # ---------------------------------------------------------------- exports
    schools_out = pd.DataFrame({
        "unitid": schools.UNITID, "name": schools.INSTNM, "city": schools.CITY, "state": schools.STABBR,
        "control": schools.CONTROL.astype(int), "tuition_in": schools.tuition_in.round(),
        "tuition_out": schools.tuition_out.round(), "tuition_years": schools.tuition_years.astype(int),
        "roomboard": schools.roomboard.round(), "books": schools.books.round(), "other": schools.other.round(),
        "net_price": schools.net_price.round(), "ugds": schools.UGDS, "deg_bach": schools.deg_bach.astype(int),
    }).sort_values("name")
    programs_out = pd.DataFrame({
        "unitid": prog.UNITID, "cip": prog.CIPCODE, "deg": prog.deg, "earn": prog.earn, "n_wne": prog.n_wne,
        "note": prog.note,
    }).sort_values(["unitid", "cip"])
    majors_out = pd.DataFrame({
        "cip": majors.CIPCODE, "title": majors.title, "cip2": majors.cip2, "family": majors.family,
        "earn_nat": majors.earn_nat,
    }).sort_values("cip")

    def write_csv(df, name):
        df.to_csv(OUT / name, index=False, float_format="%.0f")

    write_csv(schools_out, "schools.csv")
    write_csv(programs_out, "programs.csv")
    write_csv(majors_out, "majors.csv")

    findings = compute_findings(schools_out, programs_out, majors_out)
    (OUT / "findings.json").write_text(json.dumps(findings, indent=1))

    manifest = []
    mpath = RAW / "MANIFEST.tsv"
    if mpath.exists():
        manifest = pd.read_csv(mpath, sep="\t", dtype=str).fillna("").to_dict("records")
    meta = {
        "built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "release": RELEASE,
        "sources": manifest,
        "source_files_in_zip": {"degree_counts": COUNTS_FILE, "earnings": EARN_FILE, "attributes": ATTR_FILE,
                                "costs": COST_FILES, "net_price": NETPRICE_FILES},
        "scope": {
            "graduates": "Bachelor's degree completers, award years 2020-21 and 2021-22",
            "earnings": "Median annual earnings 1 year after completion (measured CY2022 & CY2023), 2024 dollars; "
                        "federal financial aid recipients who worked and were not enrolled",
            "costs": "Average published price, academic years 2017-18 to 2021-22, nominal dollars",
            "schools": "Predominantly bachelor's-granting (PREDDEG=3) public and private institutions with "
                       f"bachelor's completions and published tuition for at least {MIN_COST_YEARS} of the 5 years",
        },
        "cohort_map_checks": cohort_checks,
        "counts": report["steps"],
        "nonnumeric_codes_treated_as_missing": report["nonnumeric_codes"],
        "outputs": {n: int(len(d)) for n, d in
                    [("schools.csv", schools_out), ("programs.csv", programs_out), ("majors.csv", majors_out)]},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"Wrote {len(schools_out):,} schools, {len(programs_out):,} programs, {len(majors_out):,} majors to {OUT}")


def compute_findings(schools: pd.DataFrame, programs: pd.DataFrame, majors: pd.DataFrame) -> dict:
    """Numbers quoted in the page narrative. Every figure is labeled with how it is weighted."""
    p = programs.merge(schools[["unitid", "control", "tuition_in"]], on="unitid")
    pe = p[p.earn.notna()]
    f: dict = {}

    f["scope"] = {
        "schools": int(len(schools)),
        "schools_by_control": {CONTROL_LABELS[k]: int(v) for k, v in schools.control.value_counts().sort_index().items()},
        "degrees": int(p.deg.sum()),
        "programs": int(len(p)),
        "programs_with_earnings": int(len(pe)),
        "degree_share_in_programs_with_earnings": float(p.loc[p.earn.notna(), "deg"].sum() / p.deg.sum()),
        "degree_share_in_dup_programs": float(p.loc[p.note == "DUP", "deg"].sum() / p.deg.sum()),
    }

    tuition = {}
    for k, label in CONTROL_LABELS.items():
        s = schools[schools.control == k]
        tuition[label] = {
            "schools": int(len(s)),
            "tuition_in_median": q(s.tuition_in, 0.5), "tuition_in_p25": q(s.tuition_in, 0.25),
            "tuition_in_p75": q(s.tuition_in, 0.75),
            "tuition_out_median": q(s.tuition_out.dropna(), 0.5),
            "net_price_median": q(s.net_price.dropna(), 0.5), "net_price_schools": int(s.net_price.notna().sum()),
        }
    f["tuition_by_control"] = {"weighting": "each school counts once", "values": tuition}

    # Majors: distribution of program medians across colleges (each program counts once).
    rows = []
    total_deg = p.deg.sum()
    for cip_code, g in p.groupby("cip"):
        e = g.earn.dropna()
        rows.append({"cip": cip_code, "deg": float(g.deg.sum()), "share": float(g.deg.sum() / total_deg),
                     "programs_earn": int(len(e)),
                     "p25": q(e, 0.25) if len(e) else None, "p50": q(e, 0.5) if len(e) else None,
                     "p75": q(e, 0.75) if len(e) else None})
    m = pd.DataFrame(rows).merge(majors[["cip", "title"]], on="cip").sort_values("deg", ascending=False)
    top = m.head(20).copy()
    top["iqr"] = top.p75 - top.p25
    f["top20_majors"] = {
        "weighting": "share = degrees (weighted by degrees); p25/p50/p75 = quantiles of program medians, each program counts once",
        "values": top.to_dict("records"),
    }
    hi, lo = top.loc[top.p50.idxmax()], top.loc[top.p50.idxmin()]
    f["between_vs_within"] = {
        "description": "Among the 20 most-awarded majors: gap between the highest and lowest 'median program' vs. "
                       "the typical (median) within-major interquartile range of program medians",
        "highest_major": hi.title, "highest_p50": hi.p50, "lowest_major": lo.title, "lowest_p50": lo.p50,
        "between_gap": float(hi.p50 - lo.p50),
        "median_within_iqr": float(top.iqr.median()),
        "min_within_iqr": float(top.iqr.min()), "max_within_iqr": float(top.iqr.max()),
    }
    pop = top.sort_values("deg", ascending=False).reset_index(drop=True)
    eligible = m[m.programs_earn >= 30]
    f["popularity_vs_earnings"] = {
        "description": "Spearman rank correlation across majors with >= 30 programs reporting earnings, between "
                       "degrees awarded and the median program's earnings",
        "majors": int(len(eligible)),
        "spearman": spearman(eligible.deg, eligible.p50),
        "most_popular": pop.loc[0, "title"], "most_popular_share": float(pop.loc[0, "share"]),
        "most_popular_p50": float(pop.loc[0, "p50"]),
        # top is sorted by degrees, so its first row is the most popular major
        "most_popular_rank_by_p50_in_top20": int(top.p50.rank(ascending=False).iloc[0]),
    }

    # Tuition vs earnings within the same major.
    within = []
    for cip_code in top.cip:
        g = pe[pe.cip == cip_code]
        within.append({"cip": cip_code, "programs": int(len(g)), "spearman": spearman(g.tuition_in, g.earn)})
    w = pd.DataFrame(within).merge(majors[["cip", "title"]], on="cip")
    f["tuition_vs_earnings_within_major"] = {
        "description": "Spearman rank correlation between a school's average published in-state tuition and the "
                       "program's median earnings, computed separately within each of the 20 most-awarded majors "
                       "(each program counts once)",
        "median_spearman": float(w.spearman.median()), "min_spearman": float(w.spearman.min()),
        "max_spearman": float(w.spearman.max()), "values": w.to_dict("records"),
    }

    # Tuition quartiles of schools (each school counts once), then program earnings within each quartile.
    edges = [q(schools.tuition_in, x) for x in (0.25, 0.5, 0.75)]
    pe = pe.assign(tq=np.searchsorted(edges, pe.tuition_in, side="right") + 1)
    f["tuition_quartiles"] = {
        "description": "Schools split into quartiles by average published in-state tuition (each school counts once); "
                       "median of program medians within each quartile (each program counts once)",
        "edges": edges,
        "all_programs_p50": {int(k): q(v, 0.5) for k, v in pe.groupby("tq").earn},
        "programs": {int(k): int(len(v)) for k, v in pe.groupby("tq").earn},
    }

    # Same major, different price: highest vs lowest tuition quartile within each top-20 major.
    gaps = []
    for cip_code in top.cip:
        g = pe[pe.cip == cip_code]
        q1, q4 = g[g.tq == 1].earn, g[g.tq == 4].earn
        if len(q1) >= 10 and len(q4) >= 10:
            gaps.append({"cip": cip_code, "q1_programs": int(len(q1)), "q4_programs": int(len(q4)),
                         "q1_p50": q(q1, 0.5), "q4_p50": q(q4, 0.5), "gap": q(q4, 0.5) - q(q1, 0.5)})
    gp = pd.DataFrame(gaps).merge(majors[["cip", "title"]], on="cip")
    f["tuition_quartile_gap_within_major"] = {
        "description": "Within each of the 20 most-awarded majors (>= 10 reporting programs in both quartiles): "
                       "median program earnings at schools in the highest in-state tuition quartile minus the "
                       "lowest quartile (each program counts once)",
        "majors": int(len(gp)), "median_gap": float(gp.gap.median()), "min_gap": float(gp.gap.min()),
        "max_gap": float(gp.gap.max()), "negative_gaps": int((gp.gap < 0).sum()), "values": gp.to_dict("records"),
    }
    return f


if __name__ == "__main__":
    main()
