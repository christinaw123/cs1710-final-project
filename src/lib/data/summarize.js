// Pure summary functions shared by the charts and by scripts/verify_summaries.mjs.
// Keep these free of DOM code so the numbers on the page can be re-checked in Node.
import * as d3 from 'd3';

export const CONTROLS = [
	{ key: 1, label: 'Public', color: 'var(--c-public)' },
	{ key: 2, label: 'Private nonprofit', color: 'var(--c-nonprofit)' },
	{ key: 3, label: 'Private for-profit', color: 'var(--c-forprofit)' }
];
export const controlByKey = new Map(CONTROLS.map((c) => [c.key, c]));

/** Smallest number of reporting programs for which we draw a middle-50% interval. */
export const MIN_PROGRAMS_FOR_INTERVAL = 5;

const num = (v) => (v === '' || v == null ? null : +v);

export function parseSchool(d) {
	return {
		unitid: d.unitid,
		name: d.name,
		city: d.city,
		state: d.state,
		control: +d.control,
		tuition_in: num(d.tuition_in),
		tuition_out: num(d.tuition_out),
		tuition_years: num(d.tuition_years),
		roomboard: num(d.roomboard),
		books: num(d.books),
		other: num(d.other),
		net_price: num(d.net_price),
		ugds: num(d.ugds),
		deg_bach: num(d.deg_bach)
	};
}

export function parseProgram(d) {
	return { unitid: d.unitid, cip: d.cip, deg: num(d.deg), earn: num(d.earn), n_wne: num(d.n_wne), note: d.note };
}

export function parseMajor(d) {
	return { cip: d.cip, title: d.title, cip2: d.cip2, family: d.family, earn_nat: num(d.earn_nat) };
}

/**
 * Published tuition shown for a school. The in-state/out-of-state switch mainly matters for public
 * schools; nearly all private schools report the same price for both, and the few that differ
 * show their reported out-of-state price.
 */
export function tuitionOf(school, residency) {
	return residency === 'out' ? school.tuition_out : school.tuition_in;
}

/** Set of UNITIDs whose displayed tuition falls inside [lo, hi]; null range = every school. */
export function schoolsInRange(schools, residency, range) {
	const ids = new Set();
	for (const s of schools) {
		const t = tuitionOf(s, residency);
		if (t == null) continue;
		if (!range || (t >= range[0] && t <= range[1])) ids.add(s.unitid);
	}
	return ids;
}

/**
 * Per-major summaries for the programs at a set of schools.
 *  - deg / share: bachelor's degrees awarded (weighted by degrees)
 *  - p25 / p50 / p75: quantiles of programs' reported median earnings, each program counts once
 *    (so p50 is the "median program", not the median graduate)
 */
export function summarizeMajors(programs, schoolIds) {
	const byCip = new Map();
	let totalDeg = 0;
	for (const p of programs) {
		if (schoolIds && !schoolIds.has(p.unitid)) continue;
		let m = byCip.get(p.cip);
		if (!m) byCip.set(p.cip, (m = { cip: p.cip, deg: 0, degEarn: 0, programs: 0, earn: [] }));
		m.programs += 1;
		if (p.deg != null) {
			m.deg += p.deg;
			totalDeg += p.deg;
			if (p.earn != null) m.degEarn += p.deg;
		}
		if (p.earn != null) m.earn.push(p.earn);
	}
	for (const m of byCip.values()) {
		m.earn.sort(d3.ascending);
		m.n = m.earn.length;
		m.share = totalDeg ? m.deg / totalDeg : null;
		m.coverage = m.deg ? m.degEarn / m.deg : null;
		m.p25 = m.n ? d3.quantileSorted(m.earn, 0.25) : null;
		m.p50 = m.n ? d3.quantileSorted(m.earn, 0.5) : null;
		m.p75 = m.n ? d3.quantileSorted(m.earn, 0.75) : null;
	}
	return { byCip, totalDeg };
}

/** Spearman rank correlation (average ranks for ties), matching pandas' rank().corr(). */
export function spearman(xs, ys) {
	const rank = (arr) => {
		const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
		const r = new Array(arr.length);
		for (let i = 0; i < idx.length; ) {
			let j = i;
			while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
			const avg = (i + j) / 2 + 1;
			for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
			i = j + 1;
		}
		return r;
	};
	const rx = rank(xs);
	const ry = rank(ys);
	const mx = d3.mean(rx);
	const my = d3.mean(ry);
	let num = 0;
	let dx = 0;
	let dy = 0;
	for (let i = 0; i < rx.length; i++) {
		num += (rx[i] - mx) * (ry[i] - my);
		dx += (rx[i] - mx) ** 2;
		dy += (ry[i] - my) ** 2;
	}
	return num / Math.sqrt(dx * dy);
}

// ---- Flow chart: tuition fifth → field → earnings band, weighted by bachelor's degrees ----

/** Short names for 2-digit CIP families (same as the design drafts); `compact` is for phones. */
export const FIELD_NAMES = {
	52: ['Business', 'Business'],
	51: ['Health', 'Health'],
	45: ['Social sciences', 'Social sci.'],
	26: ['Biology', 'Biology'],
	42: ['Psychology', 'Psychology'],
	14: ['Engineering', 'Engineering'],
	11: ['Computer science', 'Computer sci.'],
	50: ['Visual & performing arts', 'Arts'],
	13: ['Education', 'Education'],
	'09': ['Communication', 'Communication'],
	other: ['Other fields', 'Other']
};
export const FLOW_FIELDS = 8; // largest families by degrees get their own node; the rest are "Other fields"
const FIFTH_NAMES = ['Cheapest fifth', '2nd fifth', 'Middle fifth', '4th fifth', 'Priciest fifth'];

/**
 * Builds the flow chart's groups and one row per program with degrees.
 *  - brackets: fifths of schools by published tuition (each school counts once), for the given residency
 *  - fields: the FLOW_FIELDS largest CIP families by degrees, plus "other"
 *  - bands: degree-weighted quartiles of programs' median earnings, plus "not reported" (suppressed)
 * Pure, so scripts can recompute the numbers quoted on the page.
 */
export function flowData(programs, schoolById, majorByCip, residency) {
	const prices = [...schoolById.values()].map((s) => tuitionOf(s, residency)).filter((v) => v != null).sort(d3.ascending);
	const edges = [0.2, 0.4, 0.6, 0.8].map((q) => d3.quantileSorted(prices, q));
	const bracketOf = (t) => edges.filter((e) => t >= e).length;

	const withDeg = programs.filter((p) => p.deg > 0 && tuitionOf(schoolById.get(p.unitid), residency) != null);
	const famDeg = d3.rollups(withDeg, (v) => d3.sum(v, (p) => p.deg), (p) => majorByCip.get(p.cip).cip2).sort((a, b) => b[1] - a[1]);
	const top = famDeg.slice(0, FLOW_FIELDS).map((d) => d[0]);

	// Degree-weighted quartile cuts of program medians (programs that report earnings)
	const earnRows = withDeg.filter((p) => p.earn != null).sort((a, b) => a.earn - b.earn);
	const total = d3.sum(earnRows, (p) => p.deg);
	const cuts = [];
	let acc = 0;
	for (const p of earnRows) {
		acc += p.deg;
		while (cuts.length < 3 && acc >= ((cuts.length + 1) * total) / 4) cuts.push(p.earn);
	}
	const bandOf = (e) => (e == null ? 4 : cuts.filter((c) => e >= c).length);

	const rows = withDeg.map((p) => {
		const cip2 = majorByCip.get(p.cip).cip2;
		return {
			unitid: p.unitid,
			cip: p.cip,
			deg: p.deg,
			b: bracketOf(tuitionOf(schoolById.get(p.unitid), residency)),
			f: top.includes(cip2) ? cip2 : 'other',
			e: bandOf(p.earn)
		};
	});

	const schoolsPer = d3.rollup(
		[...schoolById.values()].filter((s) => tuitionOf(s, residency) != null),
		(v) => v.length,
		(s) => bracketOf(tuitionOf(s, residency))
	);
	const k = (v) => fmtUSDk(v);
	const brackets = FIFTH_NAMES.map((name, i) => ({
		key: i,
		name,
		range: i === 0 ? `under ${k(edges[0])}` : i === 4 ? `${k(edges[3])} or more` : `${k(edges[i - 1])}–${k(edges[i])}`,
		lo: i === 0 ? null : edges[i - 1],
		hi: i === 4 ? null : edges[i],
		schools: schoolsPer.get(i) ?? 0
	}));
	const fields = [...top, 'other'].map((key) => {
		const [name, compact] = FIELD_NAMES[key] ?? [majorByCip.get(withDeg.find((p) => majorByCip.get(p.cip).cip2 === key).cip).family, key];
		return { key, name, compact };
	});
	const bands = [
		{ key: 0, name: `Under ${k(cuts[0])}` },
		{ key: 1, name: `${k(cuts[0])}–${k(cuts[1])}` },
		{ key: 2, name: `${k(cuts[1])}–${k(cuts[2])}` },
		{ key: 3, name: `${k(cuts[2])} or more` },
		{ key: 4, name: 'Not reported' }
	];
	return { rows, brackets, fields, bands, edges, cuts };
}

/** Degrees per bracket→field and field→band link for the rows passing `keep` (all rows if null). */
export function flowLinks(rows, keep = null) {
	const m = new Map();
	const add = (id, v) => m.set(id, (m.get(id) ?? 0) + v);
	for (const r of rows) {
		if (keep && !keep(r)) continue;
		add(`b${r.b}|f${r.f}`, r.deg);
		add(`f${r.f}|e${r.e}`, r.deg);
	}
	return m;
}

/** Share of the kept rows' degrees in each earnings band: bands 0–3 out of reported degrees, band 4 out of all. */
export function bandShares(rows, keep) {
	const deg = [0, 0, 0, 0, 0];
	for (const r of rows) if (keep(r)) deg[r.e] += r.deg;
	const reported = deg[0] + deg[1] + deg[2] + deg[3];
	const all = reported + deg[4];
	return deg.map((d, i) => (i < 4 ? (reported ? d / reported : null) : all ? d / all : null));
}

export const fmtUSD = (v) => (v == null || Number.isNaN(v) ? '—' : d3.format('$,.0f')(v));
export const fmtUSDk = (v) => (v == null || Number.isNaN(v) ? '—' : d3.format('$.3~s')(v).replace('k', 'K'));
export const fmtPct = (v, digits = 1) => (v == null || Number.isNaN(v) ? '—' : d3.format(`.${digits}%`)(v));
export const fmtInt = (v) => (v == null || Number.isNaN(v) ? '—' : d3.format(',')(v));
