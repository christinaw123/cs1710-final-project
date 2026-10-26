// Browser checks for the Scrollama story steps, plus process-book screenshots of each step.
// Usage: node scripts/check_scrollytelling.mjs [http://localhost:5173]
// Set CHROME_PATH if Chrome is not in the default macOS location.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const url = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:5173';
const out = fileURLToPath(new URL('../docs/screenshots/scrolly/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: true
});
const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pause = (ms = 450) => new Promise((r) => setTimeout(r, ms));

const EXPECT = {
	cost: [null, ['var(--c-public)'], ['var(--c-nonprofit)'], null],
	earnings: [null, ['5202'], ['5138', '2301'], null]
};

async function openPage(width, height, { reducedMotion = false } = {}) {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	await page.emulateMediaFeatures([
		{ name: 'prefers-color-scheme', value: 'light' },
		{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }
	]);
	await page.setViewport({ width, height, deviceScaleFactor: 2 });
	await page.goto(url, { waitUntil: 'networkidle0' });
	await page.waitForSelector('#earnings g.row');
	await pause(800); // let Scrollama load and observe
	return { page, errors };
}

// Put a step's top just above the trigger line (offset 0.5 wide, 0.8 narrow), as a reader would.
async function scrollToStep(page, section, i) {
	await page.evaluate(
		(section, i) => {
			const el = document.querySelector(`#${section} [data-step="${i}"]`);
			const offset = window.matchMedia('(max-width: 899px)').matches ? 0.8 : 0.5;
			const top = el.getBoundingClientRect().top + window.scrollY;
			window.scrollTo(0, top - (offset - 0.12) * window.innerHeight);
		},
		section,
		i
	);
	await pause();
}

async function readState(page, section) {
	return page.evaluate((section) => {
		const active = [...document.querySelectorAll(`#${section} .story-step`)].findIndex((e) =>
			e.classList.contains('active')
		);
		if (section === 'cost') {
			const paths = [...document.querySelectorAll('#cost g.bars path')];
			const kept = [...new Set(paths.filter((p) => !p.classList.contains('dimmed')).map((p) => p.getAttribute('fill')))];
			const dimmed = paths.filter((p) => p.classList.contains('dimmed')).length;
			return { active, dimmed, kept: dimmed ? kept.sort() : null, total: paths.length };
		}
		const rows = [...document.querySelectorAll('#earnings g.row')];
		const emph = rows.filter((r) => r.classList.contains('emph')).map((r) => r.dataset.cip);
		const dimmed = rows.filter((r) => r.classList.contains('dimmed')).length;
		return { active, dimmed, kept: emph.length ? emph.sort() : null, total: rows.length };
	}, section);
}

async function walk(page, label, shots = false) {
	for (const section of ['cost', 'earnings']) {
		const order = [0, 1, 2, 3, 2, 1, 0]; // down, then back up
		for (let k = 0; k < order.length; k++) {
			const i = order[k];
			await scrollToStep(page, section, i);
			const st = await readState(page, section);
			const want = EXPECT[section][i];
			const ok = st.active === i && JSON.stringify(st.kept) === JSON.stringify(want ? [...want].sort() : null);
			const dir = k < 4 ? 'down' : 'up';
			check(
				`${label}: ${section} step ${i + 1} (${dir})`,
				ok,
				`active=${st.active + 1}, emphasized=${st.kept ? st.kept.join('+') : 'none'}, dimmed=${st.dimmed}/${st.total}`
			);
			if (shots && k < 4) await page.screenshot({ path: `${out}${label}-${section}-step${i + 1}.png` });
		}
	}
	// Above the first tuition step, nothing is emphasized.
	await page.evaluate(() => window.scrollTo(0, 0));
	await pause();
	const top = await readState(page, 'cost');
	check(`${label}: back at the top, no emphasis`, top.dimmed === 0, `dimmed=${top.dimmed}`);
}

try {
	// ---------------------------------------------------------------- desktop
	const { page, errors } = await openPage(1280, 900);
	await walk(page, 'desktop', true);

	// User selections survive scrolling: set range, college, residency and major, then walk the story.
	await page.evaluate(() => {
		const set = (id, v) => {
			const el = document.getElementById(id);
			el.value = v;
			el.dispatchEvent(new Event('change', { bubbles: true }));
		};
		set('range-lo', '20000');
		set('range-hi', '35000');
	});
	await page.type('#school-search', 'Ohio State University-Main');
	await page.waitForSelector('#school-search-list li');
	await page.click('#school-search-list li');
	await page.select('#major-select', '1107');
	await pause();
	const snapshot = () =>
		page.evaluate(() => ({
			readout: document.querySelector('[data-testid="range-readout"]').textContent.replace(/\s+/g, ' ').trim(),
			school: document.querySelector('#school-search').value,
			major: document.querySelector('#major-select').value,
			brush: getComputedStyle(document.querySelector('#cost .brush .selection')).display,
			marker: !!document.querySelector('#cost .school-mark'),
			selMarks: [...document.querySelectorAll('#earnings g.row circle')].filter(
				(c) => c.getAttribute('fill') === 'var(--select)'
			).length
		}));
	const before = await snapshot();
	await walk(page, 'desktop-with-selections');
	const after = await snapshot();
	check('selections survive scrolling down and up', JSON.stringify(before) === JSON.stringify(after), after.readout);
	check('selected range still drawn in both charts', after.brush !== 'none' && after.selMarks > 0, `${after.selMarks} range medians`);

	// Brushing and reset still work mid-story (sticky chart at the last tuition step).
	await page.click('[data-testid="reset"]');
	await scrollToStep(page, 'cost', 3);
	const box = await (await page.$('#cost .brush .overlay')).boundingBox();
	const xMax = await page.$eval('#cost', (el) => +el.dataset.xmax);
	const px = (v) => box.x + (v / xMax) * box.width;
	await page.mouse.move(px(30000), box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(px(45000), box.y + box.height / 2, { steps: 8 });
	await page.mouse.up();
	await pause();
	const brushed = await page.$eval('[data-testid="range-readout"]', (e) => e.textContent.replace(/\s+/g, ' ').trim());
	const lo = Number((brushed.match(/Selected: \$([\d,]+)/)?.[1] ?? 'NaN').replace(/,/g, ''));
	check('brushing in the sticky chart updates the range', Math.abs(lo - 30000) <= 500, brushed); // brush snaps to $100
	await page.screenshot({ path: `${out}desktop-brush-mid-story.png` });
	await page.click('.sel-line .link');
	await pause();
	const cleared = await page.$eval('[data-testid="range-readout"]', (e) => e.textContent.trim());
	check('reset inside the sticky graphic clears the range', cleared.startsWith('No range selected'));

	// Tooltip still works on the sticky earnings chart.
	await scrollToStep(page, 'earnings', 3);
	const hit = await (await page.$('#earnings g.row rect.hit')).boundingBox();
	await page.mouse.move(hit.x + hit.width * 0.7, hit.y + hit.height / 2);
	await pause(200);
	const tip = await page.evaluate(() => [...document.querySelectorAll('.tooltip')].some((t) => !t.hidden));
	check('earnings tooltip shows on hover during the story', tip);
	check('desktop: no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

	// ---------------------------------------------------------------- mobile
	const m = await openPage(390, 844);
	await walk(m.page, 'mobile', true);
	const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	check('mobile: no horizontal scroll', overflow <= 0, `overflow ${overflow}px`);
	for (const section of ['cost', 'earnings']) {
		for (const i of [0, 1, 2, 3]) {
			await scrollToStep(m.page, section, i);
			const r = await m.page.evaluate(
				(section, i) => {
					const s = document.querySelector(`#${section} .sticky`).getBoundingClientRect();
					const t = document.querySelector(`#${section} [data-step="${i}"]`).getBoundingClientRect();
					return { stickyBottom: Math.round(s.bottom), stepTop: Math.round(t.top), stepBottom: Math.round(t.bottom), vh: innerHeight };
				},
				section,
				i
			);
			check(
				`mobile: ${section} step ${i + 1} text sits below the graphic, fully on screen`,
				r.stepTop >= r.stickyBottom && r.stepBottom <= r.vh,
				`graphic ends ${r.stickyBottom}px, text ${r.stepTop}–${r.stepBottom}px of ${r.vh}`
			);
		}
	}
	// Emphasized rows are scrolled into view inside the (shorter) sticky earnings panel.
	await scrollToStep(m.page, 'earnings', 2);
	await pause(700);
	const visible = await m.page.evaluate(() => {
		const panel = document.querySelector('#earnings .sticky').getBoundingClientRect();
		return [...document.querySelectorAll('#earnings g.row.emph')].map((r) => {
			const b = r.getBoundingClientRect();
			return b.top >= panel.top && b.bottom <= panel.bottom;
		});
	});
	check('mobile: emphasized rows are visible inside the sticky panel', visible.length === 2 && visible.every(Boolean), JSON.stringify(visible));
	check('mobile: no console or page errors', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));

	// ---------------------------------------------------------------- reduced motion
	const rm = await openPage(1280, 900, { reducedMotion: true });
	const dur = await rm.page.$eval('#cost g.bars path', (p) => getComputedStyle(p).transitionDuration);
	check('prefers-reduced-motion disables chart transitions', dur === '0s', `transition-duration ${dur}`);

	// ---------------------------------------------------------------- Scrollama unavailable
	const fb = await browser.newPage();
	await fb.setViewport({ width: 1280, height: 900 });
	await fb.setRequestInterception(true);
	fb.on('request', (r) => (/scrollama/i.test(r.url()) ? r.abort() : r.continue()));
	await fb.goto(url, { waitUntil: 'networkidle0' });
	await fb.waitForSelector('#earnings g.row');
	await pause(600);
	const fallback = await fb.evaluate(() => ({
		steps: document.querySelectorAll('.story-step').length,
		faded: document.querySelectorAll('.story-step.inactive').length,
		dimmed: document.querySelectorAll('.dimmed').length,
		text: document.querySelector('#cost [data-step="1"]').textContent.replace(/\s+/g, ' ').trim().slice(0, 40)
	}));
	check(
		'without Scrollama, all story text is readable and charts are not dimmed',
		fallback.steps === 8 && fallback.faded === 0 && fallback.dimmed === 0,
		`${fallback.steps} steps, ${fallback.faded} faded, “${fallback.text}…”`
	);
} finally {
	await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in docs/screenshots/scrolly/`);
process.exit(failed ? 1 : 0);
