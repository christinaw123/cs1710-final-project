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

export const fmtUSD = (v) => (v == null || Number.isNaN(v) ? '—' : d3.format('$,.0f')(v));
export const fmtUSDk = (v) => (v == null || Number.isNaN(v) ? '—' : d3.format('$.3~s')(v).replace('k', 'K'));
export const fmtPct = (v, digits = 1) => (v == null || Number.isNaN(v) ? '—' : d3.format(`.${digits}%`)(v));
export const fmtInt = (v) => (v == null || Number.isNaN(v) ? '—' : d3.format(',')(v));
