// Captures process-book screenshots with a local Chrome (puppeteer-core) and runs basic
// interaction checks on the running site.
//
// Usage:
//   npm run build && npm run preview -- --port 4173     (in one terminal)
//   node scripts/screenshots.mjs [http://localhost:4173]  (in another)
// Set CHROME_PATH if Chrome is not in the default macOS location.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const url = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4173';
const out = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
const designs = fileURLToPath(new URL('../docs/designs/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: true
});
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
	const page = await browser.newPage();
	// Light mode reads best in a printed/PDF process book; pass --dark to capture dark mode.
	await page.emulateMediaFeatures([
		{ name: 'prefers-color-scheme', value: process.argv.includes('--dark') ? 'dark' : 'light' }
	]);
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

	// Design drafts at native size
	for (const f of ['dollar-bill-draft', 'brain-draft', 'flow-draft']) {
		await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 2 });
		await page.goto(`file://${designs}${f}.svg`);
		const el = await page.$('svg');
		await el.screenshot({ path: `${out}${f}.png` });
	}

	// Desktop page
	await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
	await page.goto(url, { waitUntil: 'networkidle0' });
	await page.waitForSelector('#cost .chart svg path', { timeout: 15000 });
	await page.waitForSelector('#earnings .chart svg g.row', { timeout: 15000 });
	const bars = await page.$$eval('#cost .chart svg g.bars path', (els) => els.length);
	check('histogram renders bars from schools.csv', bars > 20, `${bars} bar segments`);
	const rows = await page.$$eval('#earnings .chart svg g.row', (els) => els.length);
	check('earnings chart renders major rows from programs.csv', rows >= 20, `${rows} rows`);
	const readout = () => page.$eval('[data-testid="range-readout"]', (el) => el.textContent.replace(/\s+/g, ' ').trim());
	const before = await readout();

	await page.screenshot({ path: `${out}01-intro.png` });
	const shot = async (sel, name) => (await page.$(sel)).screenshot({ path: `${out}${name}.png` });
	await shot('#cost', '02-tuition-histogram-default');
	await shot('#earnings', '03-earnings-default');

	// Brush $20K-$35K on the histogram by dragging across the brush overlay (scrolled into view)
	await page.$eval('#cost .chart', (el) => el.scrollIntoView({ block: 'center' }));
	const box = await (await page.$('#cost .brush .overlay')).boundingBox();
	const xMax = await page.$eval('#cost', (el) => +el.dataset.xmax);
	const px = (v) => box.x + (v / xMax) * box.width;
	await page.mouse.move(px(20000), box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(px(35000), box.y + box.height / 2, { steps: 8 });
	await page.mouse.up();
	await new Promise((r) => setTimeout(r, 300));
	const after = await readout();
	check('brushing updates the selected range readout', after !== before && /schools/.test(after), after);
	const selMarks = await page.$$eval('#earnings .chart svg g.row circle', (els) =>
		els.filter((e) => e.getAttribute('fill') === 'var(--select)').length
	);
	check('brushing draws selected-range marks in the earnings chart', selMarks > 0, `${selMarks} selection medians`);
	await shot('#cost', '04-tuition-histogram-brushed');
	await shot('#earnings', '05-earnings-brushed');

	// Search a school
	await page.type('#school-search', 'Ohio State University-Main');
	await page.waitForSelector('#school-search-list li');
	await page.click('#school-search-list li');
	await new Promise((r) => setTimeout(r, 300));
	const marker = await page.$('#cost .school-mark');
	check('college search marks the school on the histogram', !!marker);
	await shot('#cost', '06-school-search');

	// Select a major via the dropdown and capture the detail scatter
	await page.select('#major-select', '1107');
	await new Promise((r) => setTimeout(r, 300));
	const dots = await page.$$eval('#major-detail svg circle', (els) => els.length);
	check('major detail scatter renders program dots', dots > 50, `${dots} dots`);
	await shot('#major-detail', '07-major-detail');

	// Reset
	await page.click('[data-testid="reset"]');
	await new Promise((r) => setTimeout(r, 300));
	const reset = await readout();
	check('reset restores the all-schools view', reset === before, reset);
	const selAfterReset = await page.$$eval('#earnings .chart svg g.row circle', (els) =>
		els.filter((e) => e.getAttribute('fill') === 'var(--select)').length
	);
	check('reset removes selected-range marks', selAfterReset === 0);

	// Empty selection via the typed range inputs
	await page.evaluate(() => {
		const set = (id, v) => {
			const el = document.getElementById(id);
			el.value = v;
			el.dispatchEvent(new Event('change', { bubbles: true }));
		};
		set('range-lo', '59600');
		set('range-hi', '59700');
	});
	await new Promise((r) => setTimeout(r, 300));
	const emptyMsg = await page.$eval('#earnings', (el) => el.textContent.includes('No schools'));
	check('empty tuition range shows an empty-state message', emptyMsg);
	await shot('#earnings', '08-empty-range');
	await page.click('[data-testid="reset"]');

	await shot('#meaning', '09-what-it-means');
	await shot('#explore', '10-explore-placeholders');
	await shot('#methods', '11-methods');

	// Narrow screen
	await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
	await page.reload({ waitUntil: 'networkidle0' });
	await page.waitForSelector('#earnings .chart svg g.row');
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	check('no horizontal scroll at 375px', overflow <= 0, `overflow ${overflow}px`);
	await page.screenshot({ path: `${out}12-mobile-top.png` });
	await shot('#cost', '13-mobile-histogram');
	await shot('#earnings', '14-mobile-earnings');

	// Loading and error states (data request held / blocked)
	const p2 = await browser.newPage();
	await p2.setViewport({ width: 1000, height: 700 });
	await p2.setRequestInterception(true);
	p2.on('request', (r) => (r.url().includes('/data/programs.csv') ? r.abort() : r.continue()));
	await p2.goto(url, { waitUntil: 'networkidle0' });
	const errState = await p2.$eval('body', (b) => b.textContent.includes('could not be loaded'));
	check('missing data file shows an error state with instructions', errState);
	await (await p2.$('#cost')).screenshot({ path: `${out}15-error-state.png` });

	const p3 = await browser.newPage();
	await p3.setViewport({ width: 1000, height: 700 });
	await p3.setRequestInterception(true);
	p3.on('request', (r) => (r.url().includes('/data/') ? setTimeout(() => r.continue(), 4000) : r.continue()));
	await p3.goto(url, { waitUntil: 'domcontentloaded' });
	await new Promise((r) => setTimeout(r, 800));
	const loading = await p3.$eval('body', (b) => b.textContent.includes('Loading'));
	check('loading state is shown while data downloads', loading);

	check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
	await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in docs/screenshots/`);
process.exit(failed ? 1 : 0);
