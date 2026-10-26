// Generates the three "Explore further" design drafts in docs/designs/ from the cleaned data,
// so every number shown in a sketch is real. These are static design drafts, not the final
// interactive charts.
// Usage: node scripts/make_design_drafts.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import seedrandom from 'seedrandom';
import { parseMajor, parseProgram, parseSchool } from '../src/lib/data/summarize.js';

const require = createRequire(import.meta.url);
const { voronoiTreemap } = require('d3-voronoi-treemap');

const dataDir = fileURLToPath(new URL('../static/data/', import.meta.url));
const outDir = fileURLToPath(new URL('../docs/designs/', import.meta.url));
const read = (f) => readFileSync(dataDir + f, 'utf8');
const schools = d3.csvParse(read('schools.csv'), parseSchool);
const programs = d3.csvParse(read('programs.csv'), parseProgram);
const majors = d3.csvParse(read('majors.csv'), parseMajor);
const findings = JSON.parse(read('findings.json'));
const majorByCip = new Map(majors.map((m) => [m.cip, m]));
const schoolById = new Map(schools.map((s) => [s.unitid, s]));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = d3.format('$,.0f');
const usdK = (v) => d3.format('$.3~s')(v).replace('k', 'K');
const pct = d3.format('.0%');
const FONT = "font-family='system-ui, -apple-system, Segoe UI, sans-serif'";
const PAPER = '#fffdf8';
const INK = '#1d1c1a';
const INK2 = '#52514e';
const MUTED = '#898781';
const DRAFT = '#9a6b00';

// Short display names for 2-digit CIP families (presentation only; titles come from NCES CIP 2020).
const SHORT = {
	'01': 'Agriculture', '03': 'Natural resources', '04': 'Architecture', '05': 'Area & ethnic studies',
	'09': 'Communication', 11: 'Computer science', 13: 'Education', 14: 'Engineering', 15: 'Engineering tech',
	16: 'Languages', 19: 'Family & consumer sci.', 22: 'Law', 23: 'English', 24: 'Liberal arts', 26: 'Biology',
	27: 'Math & statistics', 30: 'Interdisciplinary', 31: 'Recreation & kinesiology', 38: 'Philosophy & religion',
	39: 'Theology', 40: 'Physical sciences', 42: 'Psychology', 43: 'Criminal justice', 44: 'Public admin & social work',
	45: 'Social sciences', 50: 'Visual & performing arts', 51: 'Health', 52: 'Business', 54: 'History'
};

function header(w, h, title, subtitle) {
	return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' width='${w}' height='${h}' ${FONT}>
<rect width='${w}' height='${h}' fill='${PAPER}'/>
<rect x='8' y='8' width='${w - 16}' height='${h - 16}' fill='none' stroke='${DRAFT}' stroke-width='1.5' stroke-dasharray='6 5' rx='10'/>
<text x='32' y='44' font-size='12' font-weight='700' fill='${DRAFT}' letter-spacing='0.08em'>DESIGN DRAFT · NOT YET INTERACTIVE</text>
<text x='32' y='74' font-size='24' font-weight='700' fill='${INK}'>${esc(title)}</text>
<text x='32' y='98' font-size='14' fill='${INK2}'>${esc(subtitle)}</text>`;
}

function note(x, y, lines, opts = {}) {
	const { size = 12.5, color = INK2, weight = 400, lh = 17 } = opts;
	return lines
		.map((l, i) => `<text x='${x}' y='${y + i * lh}' font-size='${size}' font-weight='${weight}' fill='${color}'>${esc(l)}</text>`)
		.join('\n');
}

// ------------------------------------------------------------------ 1. Dollar bill
function dollarBill() {
	const W = 1000;
	const H = 600;
	const parts = [
		{ key: 'tuition', label: 'Tuition & fees', color: '#6250d6' },
		{ key: 'roomboard', label: 'Room & board (on campus)', color: '#e87ba4' },
		{ key: 'books', label: 'Books & supplies', color: '#eda100' },
		{ key: 'other', label: 'Other expenses (on campus)', color: '#008300' }
	];
	const complete = schools.filter((s) => s.tuition_in != null && s.roomboard != null && s.books != null && s.other != null);
	const q4 = findings.tuition_quartiles.edges[2];
	const groups = [
		{ label: `All schools in scope (${complete.length.toLocaleString()} with all four items)`, rows: complete },
		{
			label: `Example selection: highest tuition quartile (≥ ${usd(q4)} in-state)`,
			rows: complete.filter((s) => s.tuition_in >= q4)
		}
	].map((g) => {
		const vals = parts.map((p) => ({
			...p,
			value: d3.mean(g.rows, (s) => (p.key === 'tuition' ? s.tuition_in : s[p.key]))
		}));
		return { ...g, n: g.rows.length, vals, total: d3.sum(vals, (v) => v.value) };
	});
	const maxTotal = d3.max(groups, (g) => g.total);
	const x = d3.scaleLinear().domain([0, maxTotal]).range([0, 640]);
	let svg = header(W, H, 'Where does a year of college cost go?', 'Average published yearly cost, 2017–18 to 2021–22 (nominal $, each school counts once)');
	groups.forEach((g, gi) => {
		const y0 = 150 + gi * 170;
		svg += `\n<text x='32' y='${y0 - 12}' font-size='14' font-weight='600' fill='${INK}'>${esc(g.label)}</text>`;
		const bw = x(g.total);
		const bh = 104;
		svg += `\n<rect x='32' y='${y0}' width='${bw}' height='${bh}' rx='10' fill='#eef3e6' stroke='#5b7a3a' stroke-width='2'/>`;
		svg += `\n<rect x='40' y='${y0 + 8}' width='${bw - 16}' height='${bh - 16}' rx='6' fill='none' stroke='#5b7a3a' stroke-width='1' stroke-dasharray='2 3'/>`;
		let cx = 48;
		const innerScale = (bw - 32) / g.total;
		g.vals.forEach((v) => {
			const w = v.value * innerScale;
			svg += `\n<rect x='${cx}' y='${y0 + 16}' width='${Math.max(0, w - 2)}' height='${bh - 32}' rx='3' fill='${v.color}' fill-opacity='0.9'/>`;
			if (w > 70) {
				svg += `\n<text x='${cx + 8}' y='${y0 + bh / 2 + 5}' font-size='13' font-weight='700' fill='${v.key === 'books' ? INK : '#ffffff'}'>${usdK(v.value)}</text>`;
			}
			cx += w;
		});
		svg += `\n<text x='${32 + bw + 14}' y='${y0 + bh / 2 - 4}' font-size='22' font-weight='700' fill='${INK}'>${usd(g.total)}</text>`;
		svg += `\n<text x='${32 + bw + 14}' y='${y0 + bh / 2 + 16}' font-size='12' fill='${INK2}'>per year · ${g.n.toLocaleString()} schools</text>`;
		const small = g.vals.filter((v) => v.value * innerScale <= 70);
		svg += `\n<text x='32' y='${y0 + bh + 20}' font-size='12' fill='${INK2}'>${esc(small.map((v) => `${v.label}: ${usd(v.value)}`).join('   ·   '))}</text>`;
	});
	// Legend
	parts.forEach((p, i) => {
		const lx = 32 + i * 230;
		svg += `\n<rect x='${lx}' y='${H - 112}' width='12' height='12' rx='3' fill='${p.color}'/>`;
		svg += `\n<text x='${lx + 18}' y='${H - 101}' font-size='12.5' fill='${INK}'>${esc(p.label)}</text>`;
	});
	svg += '\n' + note(32, H - 72, [
		'Encoding: bill length = total published yearly cost (one $ scale for every bill); segment length = each cost item.',
		'Interaction: brushing the tuition histogram rebuilds the lower "selection" bill; hover a segment for its amount and school count.',
		'Caveat to show on the page: published prices, not net price after grants; off-campus students face different housing costs.'
	]);
	return svg + '\n</svg>\n';
}

// ------------------------------------------------------------------ 2. Brain
function brain() {
	const W = 1000;
	const H = 800;
	const fam = d3
		.rollups(
			programs,
			(v) => ({
				deg: d3.sum(v, (p) => p.deg ?? 0),
				earn: v.map((p) => p.earn).filter((e) => e != null)
			}),
			(p) => majorByCip.get(p.cip).cip2
		)
		.map(([cip2, v]) => ({ cip2, deg: v.deg, n: v.earn.length, p50: v.earn.length ? d3.median(v.earn) : null }));
	const total = d3.sum(fam, (f) => f.deg);
	fam.sort((a, b) => b.deg - a.deg);
	const TOP = 12;
	const top = fam.slice(0, TOP);
	const rest = fam.slice(TOP);
	const restEarn = programs
		.filter((p) => rest.some((r) => r.cip2 === majorByCip.get(p.cip).cip2) && p.earn != null)
		.map((p) => p.earn);
	const regions = [
		...top.map((f) => ({ ...f, name: SHORT[f.cip2] ?? majorByCip.get(programs.find((p) => majorByCip.get(p.cip).cip2 === f.cip2).cip).family })),
		{ cip2: 'other', name: `Other (${rest.length} fields)`, deg: d3.sum(rest, (r) => r.deg), n: restEarn.length, p50: d3.median(restEarn) }
	].map((r) => ({ ...r, share: r.deg / total }));

	// Convex brain-like outline (cerebrum); the treemap requires a convex clip polygon.
	const cx = 420;
	const cy = 360;
	const outline = d3.range(0, 2 * Math.PI, Math.PI / 60).map((t) => {
		const c = Math.cos(t);
		const s = Math.sin(t);
		const e = 2 / 2.6;
		const px = cx + 330 * Math.sign(c) * Math.abs(c) ** e;
		const py = cy + (s < 0 ? 215 : 165) * Math.sign(s) * Math.abs(s) ** e;
		return [px, py];
	});
	const hier = d3.hierarchy({ children: regions }).sum((d) => d.share ?? 0);
	voronoiTreemap().clip(outline).prng(seedrandom('cs171-brain')).maxIterationCount(400).convergenceRatio(0.001)(hier);

	const steps = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
	const earnExtent = d3.extent(regions, (r) => r.p50);
	const color = d3
		.scaleQuantize()
		.domain([Math.floor(earnExtent[0] / 5000) * 5000, Math.ceil(earnExtent[1] / 5000) * 5000])
		.range(steps);

	let svg = header(W, H, 'The brain of majors (proposed novel view)', 'Bachelor’s degrees awarded 2020–21 + 2021–22 at the schools in scope · earnings 1 year after graduating');
	// Decorative cerebellum + brain stem, drawn behind the cerebrum
	svg += `\n<path d='M${cx + 110},${cy + 150} q-8,80 -4,150 h64 q-4,-70 6,-150 z' fill='#f1efe8' stroke='${INK2}' stroke-width='2'/>`;
	svg += `\n<ellipse cx='${cx + 210}' cy='${cy + 172}' rx='110' ry='56' fill='#f1efe8' stroke='${INK2}' stroke-width='2'/>`;
	for (const leaf of hier.leaves()) {
		const poly = leaf.polygon;
		const d = leaf.data;
		const fill = d.p50 == null ? '#d6d5ce' : color(d.p50);
		svg += `\n<path d='M${poly.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')}Z' fill='${fill}' stroke='${PAPER}' stroke-width='3' stroke-linejoin='round'/>`;
	}
	svg += `\n<path d='M${outline.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')}Z' fill='none' stroke='${INK2}' stroke-width='2.5'/>`;
	for (const leaf of hier.leaves()) {
		const d = leaf.data;
		const [lx, ly] = d3.polygonCentroid(leaf.polygon);
		const area = Math.abs(d3.polygonArea(leaf.polygon));
		const fill = d.p50 == null ? '#d6d5ce' : color(d.p50);
		const dark = steps.indexOf(fill) >= 3;
		const ink = dark ? '#ffffff' : INK;
		const big = area > 14000;
		const size = big ? 14 : 11;
		// Wrap long names onto two lines in smaller regions so neighbouring labels don't collide.
		const words = d.name.split(' ');
		const lines = !big && d.name.length > 12 && words.length > 1
			? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
			: [d.name];
		const y0 = ly - (lines.length - 1) * size * 0.6;
		lines.forEach((line, i) => {
			svg += `\n<text x='${lx.toFixed(1)}' y='${(y0 + i * size * 1.15).toFixed(1)}' text-anchor='middle' font-size='${size}' font-weight='700' fill='${ink}'>${esc(line)}</text>`;
		});
		svg += `\n<text x='${lx.toFixed(1)}' y='${(y0 + lines.length * size * 1.15 + 1).toFixed(1)}' text-anchor='middle' font-size='${big ? 13 : 10.5}' fill='${ink}'>${pct(d.share)}</text>`;
	}
	// Legend
	const lx = 790;
	svg += '\n' + note(lx, 160, ['Color = median program’s', 'earnings, 1 yr after (2024 $)'], { size: 12.5, color: INK, weight: 600 });
	const sw = 26;
	steps.forEach((c, i) => {
		svg += `\n<rect x='${lx + i * sw}' y='196' width='${sw - 2}' height='14' fill='${c}'/>`;
	});
	svg += `\n<text x='${lx}' y='226' font-size='11' fill='${INK2}'>${usdK(color.domain()[0])}</text>`;
	svg += `\n<text x='${lx + steps.length * sw - 2}' y='226' text-anchor='end' font-size='11' fill='${INK2}'>${usdK(color.domain()[1])}</text>`;
	svg += `\n<rect x='${lx}' y='238' width='14' height='14' fill='#d6d5ce'/><text x='${lx + 20}' y='249' font-size='11.5' fill='${INK2}'>Not reported</text>`;
	svg += '\n' + note(lx, 286, ['Area = share of bachelor’s', 'degrees awarded (weighted', 'by degrees).', '', 'Each program counts once', 'in the color median.'], { size: 12, color: INK2 });
	svg += '\n' + note(32, H - 70, [
		'Interaction: hover a region for degrees, share, and the middle 50% of program earnings; click to select that field in the earnings chart;',
		'brushing tuition recomputes areas for the selected schools (the outline and color scale stay fixed so changes are comparable).',
		'Design risk: irregular areas are hard to compare precisely, so every region is labeled with its % and the final view will add a sorted bar list beside it.'
	]);
	return svg + '\n</svg>\n';
}

// ------------------------------------------------------------------ 3. Flow diagram
function flow() {
	const W = 1000;
	const H = 680;
	const edges = findings.tuition_quartiles.edges;
	const tq = (t) => (t < edges[0] ? 0 : t < edges[1] ? 1 : t < edges[2] ? 2 : 3);
	const tqLabels = [
		`Lowest 25% tuition (< ${usdK(edges[0])})`,
		`Second 25% (${usdK(edges[0])}–${usdK(edges[1])})`,
		`Third 25% (${usdK(edges[1])}–${usdK(edges[2])})`,
		`Highest 25% (≥ ${usdK(edges[2])})`
	];
	const withDeg = programs.filter((p) => p.deg != null && p.deg > 0);
	const famDeg = d3.rollups(withDeg, (v) => d3.sum(v, (p) => p.deg), (p) => majorByCip.get(p.cip).cip2).sort((a, b) => b[1] - a[1]);
	const topFam = famDeg.slice(0, 8).map((d) => d[0]);
	const famOf = (p) => {
		const c = majorByCip.get(p.cip).cip2;
		return topFam.includes(c) ? c : 'other';
	};
	// Earnings bands: degree-weighted quartiles of program medians (programs with earnings)
	const earnRows = withDeg.filter((p) => p.earn != null).sort((a, b) => a.earn - b.earn);
	const totalE = d3.sum(earnRows, (p) => p.deg);
	const cuts = [];
	let acc = 0;
	let k = 1;
	for (const p of earnRows) {
		acc += p.deg;
		while (k <= 3 && acc >= (k * totalE) / 4) {
			cuts.push(p.earn);
			k++;
		}
	}
	const band = (p) => (p.earn == null ? 4 : p.earn < cuts[0] ? 0 : p.earn < cuts[1] ? 1 : p.earn < cuts[2] ? 2 : 3);
	const bandLabels = [`Under ${usdK(cuts[0])}`, `${usdK(cuts[0])}–${usdK(cuts[1])}`, `${usdK(cuts[1])}–${usdK(cuts[2])}`, `${usdK(cuts[2])} or more`, 'Earnings not reported'];

	const nodes = [
		...tqLabels.map((l, i) => ({ id: `t${i}`, label: l, col: 0 })),
		...[...topFam, 'other'].map((c) => ({ id: `f${c}`, label: c === 'other' ? 'Other fields' : (SHORT[c] ?? c), col: 1 })),
		...bandLabels.map((l, i) => ({ id: `e${i}`, label: l, col: 2 }))
	];
	const linkMap = new Map();
	const add = (s, t, v, hi) => {
		const key = `${s}|${t}|${hi}`;
		const l = linkMap.get(key) ?? { source: s, target: t, value: 0, hi };
		l.value += v;
		linkMap.set(key, l);
	};
	for (const p of withDeg) {
		const q = tq(schoolById.get(p.unitid).tuition_in);
		add(`t${q}`, `f${famOf(p)}`, p.deg, q === 3);
		add(`f${famOf(p)}`, `e${band(p)}`, p.deg, q === 3);
	}
	const graph = sankey()
		.nodeId((d) => d.id)
		.nodeWidth(14)
		.nodePadding(12)
		.nodeSort(null)
		.extent([
			[250, 130],
			[W - 210, H - 110]
		])({ nodes: nodes.map((d) => ({ ...d })), links: [...linkMap.values()].map((d) => ({ ...d })) });

	let svg = header(W, H, 'Where do graduates of different-priced schools end up?', 'Degrees awarded 2020–21 + 2021–22 → field → earnings band (1 yr after); link width = degrees');
	const path = sankeyLinkHorizontal();
	for (const l of graph.links.filter((l) => !l.hi)) {
		svg += `\n<path d='${path(l)}' fill='none' stroke='#bdbbb3' stroke-opacity='0.45' stroke-width='${Math.max(1, l.width).toFixed(1)}'/>`;
	}
	for (const l of graph.links.filter((l) => l.hi)) {
		svg += `\n<path d='${path(l)}' fill='none' stroke='${INK}' stroke-opacity='0.55' stroke-width='${Math.max(1, l.width).toFixed(1)}'/>`;
	}
	for (const n of graph.nodes) {
		svg += `\n<rect x='${n.x0}' y='${n.y0}' width='${n.x1 - n.x0}' height='${Math.max(1, n.y1 - n.y0)}' rx='2' fill='${INK2}'/>`;
		const left = n.col === 0;
		const tx = left ? n.x0 - 8 : n.x1 + 8;
		svg += `\n<text x='${tx}' y='${(n.y0 + n.y1) / 2 + 4}' text-anchor='${left ? 'end' : 'start'}' font-size='12' fill='${INK}'>${esc(n.label)}</text>`;
	}
	svg += `\n<text x='250' y='122' text-anchor='end' font-size='12' font-weight='700' fill='${INK2}'>TUITION GROUP (schools)</text>`;
	svg += `\n<text x='${(W - 210 + 250) / 2}' y='122' text-anchor='middle' font-size='12' font-weight='700' fill='${INK2}'>FIELD</text>`;
	svg += `\n<text x='${W - 196}' y='122' font-size='12' font-weight='700' fill='${INK2}'>EARNINGS BAND</text>`;
	svg += '\n' + note(32, H - 74, [
		'Shown highlighted: degrees from the highest-tuition quartile (what a brush on the histogram would highlight; the national flows stay visible in gray).',
		'Tuition groups = quartiles of schools by published in-state tuition; earnings bands = degree-weighted quartiles of program medians.',
		'Interaction: brush the histogram to highlight; hover a link for degrees and share; click a field to select it in the earnings chart.'
	]);
	return svg + '\n</svg>\n';
}

writeFileSync(outDir + 'dollar-bill-draft.svg', dollarBill());
writeFileSync(outDir + 'brain-draft.svg', brain());
writeFileSync(outDir + 'flow-draft.svg', flow());
console.log('Wrote docs/designs/{dollar-bill,brain,flow}-draft.svg');
