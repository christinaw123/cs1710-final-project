// Recomputes the summaries the website displays (using the same src/lib/data/summarize.js the
// charts use) and compares them with static/data/findings.json produced by build_data.py.
// Usage: node scripts/verify_summaries.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as d3 from 'd3';
import {
	parseProgram,
	parseSchool,
	schoolsInRange,
	spearman,
	summarizeMajors,
	tuitionOf
} from '../src/lib/data/summarize.js';

const dir = fileURLToPath(new URL('../static/data/', import.meta.url));
const read = (f) => readFileSync(dir + f, 'utf8');
const schools = d3.csvParse(read('schools.csv'), parseSchool);
const programs = d3.csvParse(read('programs.csv'), parseProgram);
const findings = JSON.parse(read('findings.json'));

let failures = 0;
let checks = 0;
function check(label, actual, expected, tol = 0.5) {
	checks++;
	const ok = Math.abs(actual - expected) <= tol;
	if (!ok) {
		failures++;
		console.log(`FAIL ${label}: page=${actual} pipeline=${expected}`);
	}
}

// Scope
const all = schoolsInRange(schools, 'in', null);
const { byCip, totalDeg } = summarizeMajors(programs, all);
check('schools', all.size, findings.scope.schools);
check('degrees', totalDeg, findings.scope.degrees);
check('programs with earnings', programs.filter((p) => p.earn != null).length, findings.scope.programs_with_earnings);

// Tuition medians by control (each school counts once)
const labels = { 1: 'Public', 2: 'Private nonprofit', 3: 'Private for-profit' };
for (const [k, label] of Object.entries(labels)) {
	const s = schools.filter((d) => d.control === +k);
	const f = findings.tuition_by_control.values[label];
	check(`${label} median in-state tuition`, d3.median(s, (d) => d.tuition_in), f.tuition_in_median);
	check(`${label} median out-of-state tuition`, d3.median(s, (d) => tuitionOf(d, 'out')), f.tuition_out_median);
	check(`${label} median net price`, d3.median(s, (d) => d.net_price), f.net_price_median);
}

// Top-20 majors: share, quantiles of program medians
for (const r of findings.top20_majors.values) {
	const m = byCip.get(r.cip);
	check(`${r.title} share`, m.share, r.share, 1e-9);
	check(`${r.title} programs reporting`, m.n, r.programs_earn);
	check(`${r.title} p25`, m.p25, r.p25);
	check(`${r.title} p50`, m.p50, r.p50);
	check(`${r.title} p75`, m.p75, r.p75);
}

// Within-major Spearman (tuition vs earnings), same as the detail scatter caption
const byId = new Map(schools.map((s) => [s.unitid, s]));
for (const r of findings.tuition_vs_earnings_within_major.values) {
	const ps = programs.filter((p) => p.cip === r.cip && p.earn != null);
	const rho = spearman(
		ps.map((p) => byId.get(p.unitid).tuition_in),
		ps.map((p) => p.earn)
	);
	check(`${r.title} spearman`, rho, r.spearman, 1e-9);
}

// A brushed range: the page filter must give the same counts as a direct filter
const range = [20000, 35000];
const ids = schoolsInRange(schools, 'in', range);
check(
	'schools in $20K-$35K',
	ids.size,
	schools.filter((s) => s.tuition_in >= range[0] && s.tuition_in <= range[1]).length
);

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
