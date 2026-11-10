// Browser checks for the flow chart (price fifth → field → pay band), plus process-book screenshots.
// The numbers in the story steps are recomputed here in Node from the same cleaned files and compared
// with what the page shows.
// Usage: node scripts/check_flow.mjs [http://localhost:5173]
// Set CHROME_PATH if Chrome is not in the default macOS location.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as d3 from 'd3';
import puppeteer from 'puppeteer-core';
import { bandShares, flowData, fmtPct, parseMajor, parseProgram, parseSchool } from '../src/lib/data/summarize.js';

const url = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:5173';
const out = fileURLToPath(new URL('../docs/screenshots/flow/', import.meta.url));
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pause = (ms = 600) => new Promise((r) => setTimeout(r, ms));

// Expected story numbers, from the cleaned data
const read = (f, parse) => d3.csvParse(readFileSync(new URL(`../static/data/${f}`, import.meta.url), 'utf8'), parse);
const schools = read('schools.csv', parseSchool);
const programs = read('programs.csv', parseProgram);
const majors = read('majors.csv', parseMajor);
const flow = flowData(programs, new Map(schools.map((s) => [s.unitid, s])), new Map(majors.map((m) => [m.cip, m])), 'in');
const sh = (keep) => bandShares(flow.rows, keep);
const expected = {
	cheapTop: fmtPct(sh((r) => r.b === 0)[3], 0),
	priceyTop: fmtPct(sh((r) => r.b === 4)[3], 0),
	engCheap: fmtPct(sh((r) => r.f === '14' && r.b === 0)[3], 0),
	engPricey: fmtPct(sh((r) => r.f === '14' && r.b === 4)[3], 0)
};
const familyOf = new Map(majors.map((m) => [m.cip, m.cip2]));

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: true
});

async function openPage(width, height) {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
	await page.setViewport({ width, height, deviceScaleFactor: 2 });
	await page.goto(url, { waitUntil: 'networkidle0' });
	await page.waitForSelector('#flow g.node');
	await pause(800); // let Scrollama load and observe
	return { page, errors };
}

// Put a step just above the trigger line (0.5 wide, 0.8 narrow), as a reader would.
async function scrollToStep(page, i) {
	await page.evaluate((i) => {
		const el = document.querySelector(`#flow [data-step="${i}"]`);
		const offset = window.matchMedia('(max-width: 899px)').matches ? 0.8 : 0.5;
		window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (offset - 0.12) * window.innerHeight);
	}, i);
	await pause();
}
const state = (page) =>
	page.evaluate(() => ({
		on: [...document.querySelectorAll('#flow g.node.on')].map((g) => g.dataset.node).sort(),
		note: document.querySelector('[data-testid="flow-note"]').textContent.replace(/\s+/g, ' ').trim()
	}));
const stepText = (page, i) =>
	page.$eval(`#flow [data-step="${i}"]`, (el) => el.textContent.replace(/\s+/g, ' ').trim());

try {
	// ---- Desktop ----
	const { page, errors } = await openPage(1280, 900);
	const counts = await page.evaluate(() => ({
		nodes: document.querySelectorAll('#flow g.node').length,
		links: document.querySelectorAll('#flow g.base path').length
	}));
	check('flow chart draws 5 price groups + 9 fields + 5 pay bands', counts.nodes === 19, `${counts.nodes} nodes`);
	check('flow chart draws every price→field and field→pay link', counts.links === 90, `${counts.links} links`);

	await scrollToStep(page, 0);
	let s = await state(page);
	check('step 1: nothing highlighted, click hint shown', s.on.length === 0 && /Click a price group/.test(s.note), s.note);
	await page.screenshot({ path: `${out}desktop-step1.png` });

	await scrollToStep(page, 1);
	s = await state(page);
	check('step 2: cheapest fifth highlighted', s.on.join() === 'b0', s.on.join());
	const t1 = await stepText(page, 1);
	check('step 2 quotes the cheapest fifth’s top-band share', t1.includes(`${expected.cheapTop} of their graduates`), expected.cheapTop);
	await page.screenshot({ path: `${out}desktop-step2.png` });

	await scrollToStep(page, 2);
	s = await state(page);
	check('step 3: priciest fifth highlighted', s.on.join() === 'b4', s.on.join());
	const t2 = await stepText(page, 2);
	check('step 3 quotes the priciest fifth’s top-band share', t2.includes(`${expected.priceyTop} reached the top band`), expected.priceyTop);
	await page.screenshot({ path: `${out}desktop-step3.png` });

	await scrollToStep(page, 3);
	s = await state(page);
	check('step 4: engineering and psychology highlighted', s.on.join() === 'f14,f42', s.on.join());
	const t3 = await stepText(page, 3);
	check('step 4 quotes engineering at the cheapest and priciest fifths', t3.includes(`${expected.engCheap} of engineering`) && t3.includes(`${expected.engPricey} at the priciest`), `${expected.engCheap} / ${expected.engPricey}`);
	const shares = await page.$$eval('#flow tspan.share', (els) => els.map((e) => e.textContent).join(''));
	check('blended shares are hidden when two fields are highlighted', shares === '');
	await page.screenshot({ path: `${out}desktop-step4.png` });

	// Clicking a field highlights it and selects its most common major below
	await page.click('#flow g.node[data-node="f11"] .bar');
	await pause(400);
	s = await state(page);
	const major = await page.$eval('#major-select', (el) => el.value);
	check('clicking a field highlights it', s.on.join() === 'f11' && /computer science/.test(s.note), s.note);
	check('clicking a field selects one of its majors in the earnings chart', familyOf.get(major) === '11', major);
	const fieldShares = await page.$$eval('#flow tspan.share', (els) => els.filter((e) => e.textContent).length);
	check('pay bands show the highlighted field’s shares', fieldShares === 5, `${fieldShares} labels`);
	await page.screenshot({ path: `${out}desktop-clicked-field.png` });
	await page.click('[data-testid="flow-note"] .chip');
	await pause(300);
	s = await state(page);
	check('Clear returns to the story highlight', s.on.join() === 'f14,f42', s.on.join());

	// A tuition range typed above highlights its colleges' degrees (when no story step or click applies)
	await page.evaluate(() => {
		const set = (id, v) => {
			const el = document.getElementById(id);
			el.value = v;
			el.dispatchEvent(new Event('change', { bubbles: true }));
		};
		set('range-lo', '40000');
		set('range-hi', '60000');
	});
	await scrollToStep(page, 0);
	s = await state(page);
	check('a brushed tuition range highlights its colleges', /your range, \$40,000–\$60,000/.test(s.note), s.note);
	const inkPaths = await page.$$eval('#flow g.ink path', (els) => els.length);
	check('the range highlight draws ink flows', inkPaths > 10, `${inkPaths} ink flows`);
	check('desktop: no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
	await page.close();

	// ---- Phone ----
	const m = await openPage(390, 844);
	await scrollToStep(m.page, 1);
	const layout = await m.page.evaluate(() => {
		const nodes = [...document.querySelectorAll('#flow g.node')];
		const rightBars = Math.min(...nodes.filter((g) => g.dataset.node[0] === 'e').map((g) => g.querySelector('.bar').getBoundingClientRect().left));
		const fieldLabels = Math.max(...nodes.filter((g) => g.dataset.node[0] === 'f').map((g) => g.querySelector('.label').getBoundingClientRect().right));
		const graphic = document.querySelector('#flow .sticky').getBoundingClientRect();
		const text = document.querySelector('#flow [data-step="1"]').getBoundingClientRect();
		return {
			overflow: document.documentElement.scrollWidth - window.innerWidth,
			gap: rightBars - fieldLabels,
			graphicBottom: Math.round(graphic.bottom),
			textTop: Math.round(text.top),
			textBottom: Math.round(text.bottom),
			vh: window.innerHeight
		};
	});
	check('phone: no horizontal scroll', layout.overflow <= 0, `overflow ${layout.overflow}px`);
	check('phone: field labels clear the pay-band column', layout.gap >= 0, `${Math.round(layout.gap)}px gap`);
	check(
		'phone: step text sits below the pinned chart, fully on screen',
		layout.textTop >= layout.graphicBottom && layout.textBottom <= layout.vh,
		`chart ends ${layout.graphicBottom}px, text ${layout.textTop}–${layout.textBottom}px of ${layout.vh}`
	);
	await m.page.screenshot({ path: `${out}mobile-step2.png` });
	check('phone: no console or page errors', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));
} finally {
	await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in docs/screenshots/flow/`);
process.exit(failed ? 1 : 0);
