<script>
	import * as d3 from 'd3';
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { loadData } from '$lib/data/load.js';
	import {
		CONTROLS,
		MIN_PROGRAMS_FOR_INTERVAL,
		bandShares,
		flowData,
		fmtInt,
		fmtPct,
		fmtUSD,
		fmtUSDk,
		schoolsInRange,
		spearman,
		summarizeMajors,
		tuitionOf
	} from '$lib/data/summarize.js';
	import TuitionHistogram from '$lib/components/TuitionHistogram.svelte';
	import EarningsByMajor from '$lib/components/EarningsByMajor.svelte';
	import MajorScatter from '$lib/components/MajorScatter.svelte';
	import SchoolSearch from '$lib/components/SchoolSearch.svelte';
	import FlowSankey from '$lib/components/FlowSankey.svelte';
	import Scrolly from '$lib/components/Scrolly.svelte';

	let data = $state(null);
	let loadError = $state(null);

	// Shared view state: the tuition range links the histogram, the earnings chart, and the detail.
	let residency = $state('in');
	let range = $state(null);
	let selectedSchool = $state(null);
	let selectedMajor = $state(null);
	let sortBy = $state('deg');
	let topN = $state(20);
	// With a college searched, the earnings chart can list only the majors that college offers.
	let onlyOffered = $state(true);

	// Scroll-story state: one authoritative step index per section, written only by Scrollama.
	// It drives *emphasis* (what is dimmed for narration) and never touches the user selections above.
	let tuitionStep = $state(null);
	let earningsStep = $state(null);
	let vw = $state(1200);
	let vh = $state(900);
	let tuitionStickyH = $state(0);
	let earningsStickyH = $state(0);
	let earningsPanel = $state(null);

	// Opening hook: two electrical engineers, one Ivy League and one state school.
	// Net worths are Forbes World's Billionaires list values (as of March 18, 2020 and March 1, 2026);
	// tuition comes from our own College Scorecard data (see Appendix D on the page).
	let hookStep = $state(null);
	let hookPanelH = $state(0);
	const HOOK_PEOPLE = [
		{ key: 'bezos', name: 'Jeff Bezos', short: 'Bezos', school: 'Princeton', type: 'private nonprofit (Ivy League)', unitid: '186131', color: 'var(--c-nonprofit)', inState: false },
		{ key: 'huang', name: 'Jensen Huang', short: 'Huang', school: 'Oregon State', type: 'public', unitid: '209542', color: 'var(--c-public)', inState: true }
	];
	const HOOK_MAX = 224; // largest net worth shown, in $ billions, so both bars share one scale
	const HOOK_STEPS = [
		{
			label: 'College',
			bezos: { when: '1986', text: 'Graduates from Princeton in electrical engineering and computer science.', cap: 'new graduate' },
			huang: { when: '1984', text: 'Graduates from Oregon State in electrical engineering.', cap: 'new graduate' }
		},
		{
			label: 'At 30, a start-up',
			bezos: { when: '1994', text: 'Quits a Wall Street job and starts Amazon in his garage.', cap: 'not yet a billionaire' },
			huang: {
				when: '1993',
				text: 'Co-founds Nvidia with two friends, planning it at a Denny’s. He had finished a Stanford master’s the year before while working full time.',
				cap: 'not yet a billionaire'
			}
		},
		{
			label: '2020',
			bezos: { when: '2020', text: 'The richest person in the world, worth $113 billion.', worth: 113, source: 'Forbes' },
			huang: { when: '2020', text: 'Worth $4.7 billion, about 1/24 of Bezos’s fortune.', worth: 4.7, source: 'Forbes' }
		},
		{
			label: '2026',
			bezos: { when: '2026', text: 'No. 4 in the world, worth $224 billion.', worth: 224, source: 'Forbes' },
			huang: { when: '2026', text: 'No. 8 in the world, worth $154 billion, as Nvidia’s chips power the AI boom.', worth: 154, source: 'Forbes' }
		}
	];

	onMount(async () => {
		try {
			data = await loadData(base);
			const nat = summarizeMajors(data.programs, null);
			selectedMajor = d3.greatest(nat.byCip.values(), (d) => d.deg).cip;
		} catch (e) {
			loadError = e;
		}
	});

	const majorByCip = $derived(data ? new Map(data.majors.map((m) => [m.cip, m])) : new Map());
	const schoolById = $derived(data ? new Map(data.schools.map((s) => [s.unitid, s])) : new Map());
	const national = $derived(data ? summarizeMajors(data.programs, null) : null);
	const selIds = $derived(data && range ? schoolsInRange(data.schools, residency, range) : null);
	const selection = $derived(selIds ? summarizeMajors(data.programs, selIds) : null);
	const f = $derived(data?.findings);

	// Fixed scales shared across views (never rescaled by filtering).
	const xMaxTuition = $derived(
		data ? Math.ceil(d3.max(data.schools, (s) => Math.max(s.tuition_in ?? 0, s.tuition_out ?? 0)) / 2500) * 2500 : 0
	);
	const earnDomain = $derived.by(() => {
		if (!data) return [0, 1];
		const e = data.programs.map((p) => p.earn).filter((v) => v != null).sort(d3.ascending);
		return [Math.floor(d3.quantileSorted(e, 0.02) / 10000) * 10000, Math.ceil(d3.quantileSorted(e, 0.98) / 10000) * 10000];
	});

	const ranked = $derived(national ? [...national.byCip.values()].sort((a, b) => b.deg - a.deg) : []);
	const shareMax = $derived(ranked.length ? Math.ceil(ranked[0].share * 1.3 * 100) / 100 : 0.1);
	const emptyStat = { n: 0, deg: 0, share: 0, earn: [], coverage: null };

	// Majors the searched college offers: any program it lists, even if its earnings are suppressed.
	const schoolPrograms = $derived(
		selectedSchool && data ? data.programs.filter((p) => p.unitid === selectedSchool.unitid) : null
	);
	const offeredCips = $derived(schoolPrograms ? new Set(schoolPrograms.map((p) => p.cip)) : null);
	const offeredFilter = $derived(offeredCips && onlyOffered ? offeredCips : null);
	// Story steps 1 and 2 narrate Business, Nursing and English, so they always show every major.
	const storyNeedsAll = $derived(earningsStep === 1 || earningsStep === 2);
	const rowFilter = $derived(storyNeedsAll ? null : offeredFilter);

	// Keep the selected major among the college's majors when the chart is limited to them.
	function keepMajorOffered() {
		if (!onlyOffered || !schoolPrograms?.length || offeredCips.has(selectedMajor)) return;
		const reported = schoolPrograms.filter((p) => p.earn != null);
		selectedMajor = d3.greatest(reported.length ? reported : schoolPrograms, (p) => p.deg ?? 0).cip;
	}
	function chooseSchool(s) {
		selectedSchool = s;
		keepMajorOffered();
	}
	function setOnlyOffered(v) {
		onlyOffered = v;
		keepMajorOffered();
	}

	const rows = $derived.by(() => {
		if (!national) return [];
		const pool = rowFilter ? ranked.filter((d) => rowFilter.has(d.cip)) : ranked;
		const cips = pool.slice(0, topN).map((d) => d.cip);
		if (selectedMajor && !cips.includes(selectedMajor) && (!rowFilter || rowFilter.has(selectedMajor))) cips.push(selectedMajor);
		const nat = (c) => national.byCip.get(c);
		const key =
			sortBy === 'deg' ? (c) => -nat(c).deg : sortBy === 'high' ? (c) => -(nat(c).p50 ?? -Infinity) : (c) => nat(c).p50 ?? Infinity;
		return cips
			.sort((a, b) => key(a) - key(b))
			.map((cip) => ({
				cip,
				title: majorByCip.get(cip)?.title ?? cip,
				earn_nat: majorByCip.get(cip)?.earn_nat,
				nat: nat(cip),
				sel: selection ? (selection.byCip.get(cip) ?? emptyStat) : null
			}));
	});
	const majorOptions = $derived(
		national
			? [...national.byCip.values()]
					.filter((d) => d.n > 0 && (!offeredFilter || offeredFilter.has(d.cip)))
					.map((d) => ({ cip: d.cip, title: majorByCip.get(d.cip)?.title ?? d.cip }))
					.sort((a, b) => d3.ascending(a.title, b.title))
			: []
	);

	// Selection readouts
	const inScope = $derived(data ? (selIds ? data.schools.filter((s) => selIds.has(s.unitid)) : data.schools) : []);
	const byControl = $derived(
		CONTROLS.map((c) => {
			const s = inScope.filter((d) => d.control === c.key);
			const t = s.map((d) => tuitionOf(d, residency)).filter((v) => v != null).sort(d3.ascending);
			const np = s.map((d) => d.net_price).filter((v) => v != null).sort(d3.ascending);
			return {
				...c,
				n: s.length,
				med: t.length ? d3.quantileSorted(t, 0.5) : null,
				p25: t.length ? d3.quantileSorted(t, 0.25) : null,
				p75: t.length ? d3.quantileSorted(t, 0.75) : null,
				net: np.length ? d3.quantileSorted(np, 0.5) : null,
				netN: np.length
			};
		})
	);

	const schoolEarn = $derived(schoolPrograms ? new Map(schoolPrograms.map((p) => [p.cip, p])) : null);
	const schoolTuition = $derived(selectedSchool ? tuitionOf(selectedSchool, residency) : null);

	// Detail scatter for the selected major
	const detailPoints = $derived(
		data && selectedMajor
			? data.programs
					.filter((p) => p.cip === selectedMajor && p.earn != null)
					.map((p) => ({ ...p, school: schoolById.get(p.unitid) }))
			: []
	);
	const detailRho = $derived(
		detailPoints.length >= 10
			? spearman(
					detailPoints.map((p) => tuitionOf(p.school, residency)),
					detailPoints.map((p) => p.earn)
				)
			: null
	);
	const detailInRange = $derived(
		range ? detailPoints.filter((p) => selIds.has(p.unitid)) : null
	);

	// Range inputs (keyboard alternative to brushing)
	function setRangeFromInputs(lo, hi) {
		const a = Number(lo);
		const b = Number(hi);
		if (lo === '' && hi === '') return (range = null);
		if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
		range = [Math.max(0, a), Math.min(xMaxTuition, b)];
	}

	// Story emphasis derived from the step index (null = no emphasis, all groups at full strength).
	const STORY_CIP = { business: '5202', nursing: '5138', english: '2301' };
	const tuitionEmphasis = $derived(tuitionStep === 1 ? [1] : tuitionStep === 2 ? [2] : null);
	const earningsEmphasis = $derived(
		earningsStep === 1 ? [STORY_CIP.business] : earningsStep === 2 ? [STORY_CIP.nursing, STORY_CIP.english] : null
	);
	const emphasisLabel = $derived(
		earningsStep === 1 ? 'Business' : earningsStep === 2 ? 'Nursing and English' : null
	);

	// Numbers quoted in the story steps, computed from the cleaned data (all schools, in-state prices).
	const story = $derived.by(() => {
		if (!data || !national) return null;
		const sorted = (rows) => rows.map((s) => s.tuition_in).filter((v) => v != null).sort(d3.ascending);
		const all = sorted(data.schools);
		const pub = sorted(data.schools.filter((s) => s.control === 1));
		const np = sorted(data.schools.filter((s) => s.control === 2));
		const top20 = ranked.slice(0, 20);
		const byEarnings = [...top20].sort((a, b) => b.p50 - a.p50);
		const m = (cip) => national.byCip.get(cip);
		const nur = m(STORY_CIP.nursing);
		const eng = m(STORY_CIP.english);
		return {
			tMin: all[0],
			tMax: all.at(-1),
			t05: d3.quantileSorted(all, 0.05),
			t95: d3.quantileSorted(all, 0.95),
			pubN: pub.length,
			pubMed: d3.quantileSorted(pub, 0.5),
			pubUnder15: pub.filter((v) => v < 15000).length / pub.length,
			npN: np.length,
			npMed: d3.quantileSorted(np, 0.5),
			npMin: np[0],
			npMax: np.at(-1),
			npOver20: np.filter((v) => v >= 20000).length / np.length,
			bus: m(STORY_CIP.business),
			busRank: byEarnings.findIndex((d) => d.cip === STORY_CIP.business) + 1,
			nur,
			eng,
			gap: nur.p50 - eng.p50,
			withinIqr: d3.median(top20, (d) => d.p75 - d.p25)
		};
	});
	const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
	const stepState = (step, i) => (step === null ? '' : step === i ? 'active' : 'inactive');

	// Earnings rows shrink (within limits) so the chart fits its sticky slot on wide screens.
	// 310px covers the controls, compare bar, legend and axes above and below the rows; a searched
	// college adds one note line.
	const earningsRowHeight = $derived(Math.floor((vh - 310 - (selectedSchool ? 28 : 0)) / Math.max(rows.length, 1)));

	// When the sticky earnings panel is shorter than the chart (small screens), bring the emphasized
	// rows into view inside the panel. This scrolls the panel only, never the page.
	$effect(() => {
		const cips = earningsEmphasis;
		const step = earningsStep;
		const panel = earningsPanel;
		if (!panel || panel.scrollHeight <= panel.clientHeight + 1) return;
		const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
		if (!cips) {
			if (step === 0) panel.scrollTo({ top: 0, behavior });
			return;
		}
		const els = cips.map((c) => panel.querySelector(`g.row[data-cip="${c}"]`)).filter(Boolean);
		if (!els.length) return;
		const top = panel.getBoundingClientRect().top - panel.scrollTop;
		const lo = Math.min(...els.map((e) => e.getBoundingClientRect().top - top));
		const hi = Math.max(...els.map((e) => e.getBoundingClientRect().bottom - top));
		panel.scrollTo({ top: Math.max(0, (lo + hi) / 2 - panel.clientHeight / 2), behavior });
	});

	// ---- Flow chart (between the cost and earnings sections) ----
	// Brackets are fifths of colleges by published in-state tuition, the price most of their graduates paid.
	let flowStep = $state(null);
	let flowStickyH = $state(0);
	let flowPick = $state(null); // node id the reader clicked: 'b0'…'b4' price fifth, 'f14' field, 'e3' pay band
	const flow = $derived(data ? flowData(data.programs, schoolById, majorByCip, 'in') : null);
	const STORY_FLOW = { 1: ['b0'], 2: ['b4'], 3: ['f14', 'f42'] }; // cheapest fifth, priciest fifth, engineering + psychology
	const keepNode = (id) => {
		const k = id.slice(1);
		return id[0] === 'b' ? (r) => r.b === +k : id[0] === 'f' ? (r) => r.f === k : (r) => r.e === +k;
	};
	const flowNodeName = (id) => {
		const k = id.slice(1);
		if (id[0] === 'b') {
			const b = flow.brackets[+k];
			return `the ${b.name.toLowerCase()} of colleges (${b.range})`;
		}
		if (id[0] === 'f') return flow.fields.find((f) => f.key === k)?.name.toLowerCase() ?? k;
		const band = flow.bands[+k].name;
		return +k === 4 ? 'degrees whose pay is not reported' : `degrees paying ${band[0].toLowerCase()}${band.slice(1)}`;
	};
	// Steps 1–2 narrate a price group, so they always win; afterwards the reader's click, then the story's
	// fields, then a tuition range brushed above.
	const flowHighlight = $derived.by(() => {
		if (!flow) return null;
		const story = STORY_FLOW[flowStep] ?? null;
		const ids = flowStep === 1 || flowStep === 2 ? story : flowPick ? [flowPick] : story;
		// One color group per highlighted node (the chart colors them --hl-1, --hl-2)
		if (ids) {
			return {
				groups: ids.map((id) => ({ node: id, keep: keepNode(id), label: flowNodeName(id) })),
				fromPick: ids[0] === flowPick && !(flowStep === 1 || flowStep === 2)
			};
		}
		if (selIds) {
			const label = `colleges in your range, ${fmtUSD(range[0])}–${fmtUSD(range[1])} (${residency === 'out' ? 'out-of-state' : 'in-state'})`;
			return { groups: [{ node: null, keep: (r) => selIds.has(r.unitid), label }] };
		}
		return null;
	});
	function pickFlow(id) {
		flowPick = flowPick === id ? null : id;
		// A clicked field also selects its most common major in the earnings chart below.
		if (flowPick?.[0] === 'f' && flowPick !== 'fother') {
			const fam = flowPick.slice(1);
			const pool = ranked.filter((d) => majorByCip.get(d.cip)?.cip2 === fam && (!offeredFilter || offeredFilter.has(d.cip)));
			if (pool.length) selectedMajor = pool[0].cip;
		}
	}
	// Numbers quoted in the flow story, computed from the same rows the chart draws.
	const flowStory = $derived.by(() => {
		if (!flow) return null;
		const sh = (keep) => bandShares(flow.rows, keep);
		const degIn = (b) => d3.sum(flow.rows, (r) => (r.b === b ? r.deg : 0));
		const total = d3.sum(flow.rows, (r) => r.deg);
		const cheap = sh((r) => r.b === 0);
		const pricey = sh((r) => r.b === 4);
		return {
			perFifth: Math.round(d3.mean(flow.brackets, (b) => b.schools)),
			cheapTwoShare: (degIn(0) + degIn(1)) / total,
			top: flow.bands[3].name,
			bottom: flow.bands[0].name,
			cheap,
			pricey,
			engCheap: sh((r) => r.f === '14' && r.b === 0)[3],
			engPricey: sh((r) => r.f === '14' && r.b === 4)[3],
			psyMaxTop: d3.max([0, 1, 2, 3, 4], (b) => sh((r) => r.f === '42' && r.b === b)[3]),
			psyBottom: sh((r) => r.f === '42')[0]
		};
	});

	// Narrative helpers (every number comes from findings.json)
	const gapRows = $derived(f ? [...f.tuition_quartile_gap_within_major.values].sort((a, b) => a.gap - b.gap) : []);
	const tuitionMed = (label) => f.tuition_by_control.values[label];
	const short = (t) => t.split(',')[0];

	// Closing call to action: return to the end of the tuition story (all groups shown) and focus the search.
	function lookUpCollege(event) {
		const step = document.querySelector('#cost [data-step="3"]');
		const input = document.getElementById('school-search');
		if (!step || !input) return;
		event.preventDefault();
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		step.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
		input.focus({ preventScroll: true });
	}
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<svelte:head>
	<title>Does a more expensive college mean a bigger paycheck?</title>
</svelte:head>

<header class="hero">
	<div class="wrap">
		<p class="kicker">CS1710 final project</p>
		<h1>Does a more expensive college mean a bigger paycheck?</h1>
		<p class="dek">Let us first look at the story of two engineers who ended up becoming billionares. One went to an Ivy League school, the other to a state school.</p>
	</div>
</header>

<main>
	{#if loadError}
		<section class="wrap" id="cost">
			<div class="state error ui" role="alert">
				<strong>The cleaned data could not be loaded.</strong>
				<p>
					The page expects <code>static/data/schools.csv</code>, <code>programs.csv</code>, <code>majors.csv</code>,
					<code>findings.json</code> and <code>meta.json</code>. Create them with <code>npm run data:download</code>
					and <code>npm run data:build</code>, then reload. ({loadError.message})
				</p>
			</div>
		</section>
	{:else if !data}
		<section class="wrap" id="cost">
			<div class="state ui" aria-live="polite">Loading College Scorecard data…</div>
		</section>
	{:else}
		<!-- 1. HOOK: two billionaires, same major, very different colleges -->
		<section class="wrap" id="hook">
			<Scrolly bind:step={hookStep} class="hook-scrolly" style="--hook-h: {hookPanelH}px">
				<div class="hook-graphic">
					<div class="hook-panel" bind:clientHeight={hookPanelH}>
						{#each HOOK_PEOPLE as p (p.key)}
							{@const s = HOOK_STEPS[hookStep ?? 0][p.key]}
							{@const school = schoolById.get(p.unitid)}
							<div class="person" style="--person-color: {p.color}">
								<p class="who">{p.name}</p>
								<p class="school ui">
									<span class="swatch" style:background={p.color}></span>{p.school} · {p.type}<br />
									Tuition & fees {fmtUSD(school?.tuition_in)}/yr{p.inState ? ' in-state' : ''}
								</p>
								<p class="worth" data-testid="hook-worth-{p.key}">{s.worth ? `$${s.worth}B` : '—'}</p>
								<p class="worth-cap ui">{s.when} · {s.worth ? `net worth (${s.source})` : s.cap}</p>
								<div class="worth-bar" aria-hidden="true">
									<span style:width="{s.worth ? Math.max(0.6, (s.worth / HOOK_MAX) * 100) : 0}%"></span>
								</div>
							</div>
						{/each}
					</div>
				</div>
				<ol class="hook-steps" aria-label="Two billionaires">
					{#each HOOK_STEPS as st, i (st.label)}
						<li class="hook-step {stepState(hookStep, i)}" data-step={i}>
							<p class="hook-label ui">{st.label}</p>
							<div class="hook-cols">
								{#each HOOK_PEOPLE as p (p.key)}
									<p><strong>{p.short}, {st[p.key].when}.</strong> {st[p.key].text}</p>
								{/each}
							</div>
						</li>
					{/each}
				</ol>
			</Scrolly>

			<div class="hook-end">
				<p class="hook-sum">Different people. Different companies. Very different colleges. Both are now among the ten richest people on Earth.</p>
				<p class="hook-q">So does the college you go to matter?</p>
			</div>

			<div class="bridge">
				<p class="prose">
					Most families treat college as an investment: pay tuition now for a
					bigger paycheck later. So we followed typical graduates, the bachelor’s graduates of
					{fmtInt(data.schools.length)} colleges, in two steps.
				</p>
			</div>
		</section>

		<!-- 2. COST -->
		<section class="wrap" id="cost" data-xmax={xMaxTuition}>
			<p class="step ui">1 · What does college cost?</p>
			<h2>Published tuition ranges widely, and the type of school explains much of it</h2>

			<Scrolly bind:step={tuitionStep} class="scrolly" style="--sticky-h: {tuitionStickyH}px">
				<div class="graphic">
					<div class="sticky" bind:clientHeight={tuitionStickyH}>
						<div class="controls compact chart-controls ui">
							<div class="control search-control">
								<SchoolSearch schools={data.schools} selected={selectedSchool} onselect={chooseSchool} />
							</div>
							<div class="control res-control">
								<span class="label" id="res-label">Public schools’ price</span>
								<div class="segmented" role="group" aria-labelledby="res-label">
									<button aria-pressed={residency === 'in'} onclick={() => (residency = 'in')}>In-state</button>
									<button aria-pressed={residency === 'out'} onclick={() => (residency = 'out')}>Out-of-state</button>
								</div>
							</div>
						</div>
						<figure class="figure">
							<TuitionHistogram
								schools={data.schools}
								xMax={xMaxTuition}
								height={vw < 600 ? 240 : 300}
								{residency}
								{range}
								{selectedSchool}
								emphasis={tuitionEmphasis}
								onrange={(r) => (range = r)}
							/>
							<div class="sel-line ui">
								<p data-testid="range-readout" aria-live="polite">
									{#if range}
										<strong>Selected: {fmtUSD(range[0])} – {fmtUSD(range[1])}</strong> · {fmtInt(selIds.size)}
										{selIds.size === 1 ? 'school' : 'schools'}
									{:else}
										<strong>No range selected.</strong>
										<span class="hint-long">Drag across the chart, or type a range:</span><span class="hint-short">Drag on the chart or type:</span>
									{/if}
								</p>
								<div class="range-inputs">
									<label>From $<input id="range-lo" type="number" min="0" step="500" value={range ? range[0] : ''}
											onchange={(e) => setRangeFromInputs(e.currentTarget.value, range ? range[1] : xMaxTuition)} /></label>
									<label>to $<input id="range-hi" type="number" min="0" step="500" value={range ? range[1] : ''}
											onchange={(e) => setRangeFromInputs(range ? range[0] : 0, e.currentTarget.value)} /></label>
									<button class="btn" data-testid="reset" onclick={() => (range = null)} disabled={!range}>Reset</button>
								</div>
							</div>
						</figure>
					</div>
				</div>
				<ol class="steps" aria-label="Tuition story">
					<li class="story-step {stepState(tuitionStep, 0)}" data-step="0">
						<strong>Prices vary widely.</strong> Across these {fmtInt(data.schools.length)} colleges, average published
						in-state tuition and fees ran from {fmtUSD(story.tMin)} to {fmtUSD(story.tMax)} a year. The middle 90% of
						schools charged between {fmtUSD(story.t05)} and {fmtUSD(story.t95)}. Each bar counts schools in a $2,500
						band.
					</li>
					<li class="story-step {stepState(tuitionStep, 1)}" data-step="1">
						<strong><span class="swatch" style:background="var(--c-public)"></span>Public colleges cluster at the low
							end.</strong>
						{fmtPct(story.pubUnder15, 0)} of the {fmtInt(story.pubN)} public colleges published in-state tuition under
						$15,000; the median was {fmtUSD(story.pubMed)}. Other schools are grayed for emphasis, not removed.
					</li>
					<li class="story-step {stepState(tuitionStep, 2)}" data-step="2">
						<strong><span class="swatch" style:background="var(--c-nonprofit)"></span>Private nonprofits spread across
							the whole range.</strong>
						Their median was {fmtUSD(story.npMed)}, and {fmtPct(story.npOver20, 0)} of the {fmtInt(story.npN)} charged
						$20,000 or more, but their prices ran from {fmtUSD(story.npMin)} to {fmtUSD(story.npMax)}.
					</li>
					<li class="story-step {stepState(tuitionStep, 3)}" data-step="3">
						<strong>Now find your place.</strong> All three groups are back. Search for a college, switch public schools
						to out-of-state prices, or drag across the chart to choose a tuition range. Your range carries into the
						earnings comparison below.
					</li>
				</ol>
			</Scrolly>

			<p class="notes-link ui">How to read this chart, sources and a summary table by school type: <a href="#appendix-b">Appendix B</a></p>

			{#if selectedSchool}
				<div class="school-card ui">
					<p>
						<strong>{selectedSchool.name}</strong> · {selectedSchool.city}, {selectedSchool.state} ·
						{CONTROLS.find((c) => c.key === selectedSchool.control).label}
					</p>
					<p>
						Published tuition & fees: {fmtUSD(selectedSchool.tuition_in)} in-state{#if selectedSchool.tuition_out !== selectedSchool.tuition_in},
							{fmtUSD(selectedSchool.tuition_out)} out-of-state{/if} · average net price {fmtUSD(selectedSchool.net_price)} ·
						{fmtInt(selectedSchool.deg_bach)} bachelor’s degrees in 2020–22
						{#if range && schoolTuition != null && (schoolTuition < range[0] || schoolTuition > range[1])}
							· <em>outside the selected range</em>
						{/if}
					</p>
				</div>
			{/if}

		</section>

		<!-- 2→3. FLOW: bridge from what college costs to what graduates earn -->
		<section class="wrap" id="flow">
			<p class="step ui">1 → 2 · From price to paycheck</p>
			<h2>Where do graduates of cheap and pricey colleges end up?</h2>

			<Scrolly bind:step={flowStep} class="scrolly" style="--sticky-h: {flowStickyH}px">
				<div class="graphic">
					<div class="sticky" bind:clientHeight={flowStickyH}>
						<p class="flow-note ui" data-testid="flow-note" aria-live="polite">
							{#if flowHighlight}
								<span>
									Highlighting
									{#each flowHighlight.groups as g, i (g.label)}{#if i > 0}{' and '}{/if}<span class="key-hl" style:background="var(--hl-{i + 1})"></span>{g.label}{/each}.
								</span>
								{#if flowHighlight.fromPick}<button class="chip" onclick={() => (flowPick = null)}>Clear</button>{/if}
							{:else}
								<span class="hint">
									<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M5 1.5v8.2l-1.6-1.5a1.2 1.2 0 0 0-1.7 1.7L5.4 14h6.1l1.4-5.6a1.3 1.3 0 0 0-1-1.6L8 6.2V1.5a1.5 1.5 0 0 0-3 0z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>
									Click a price group, field or pay band to follow its graduates.
								</span>
							{/if}
						</p>
						<figure class="figure">
							<FlowSankey
								{flow}
								highlight={flowHighlight}
								picked={flowPick}
								height={vw < 600 ? 330 : Math.max(380, Math.min(480, vh - 230))}
								onpick={pickFlow}
							/>
						</figure>
					</div>
				</div>
				<ol class="steps" aria-label="Flow story">
					<li class="story-step {stepState(flowStep, 0)}" data-step="0">
						<strong>Follow the degrees.</strong> Each band is bachelor’s degrees, flowing from the college’s price, to
						the field studied, to what that program’s graduates typically earned a year later. Each price group has about
						{fmtInt(flowStory.perFifth)} colleges, but the cheapest two award {fmtPct(flowStory.cheapTwoShare, 0)} of the
						degrees.
					</li>
					<li class="story-step {stepState(flowStep, 1)}" data-step="1">
						<strong>The cheapest fifth of colleges.</strong> {fmtPct(flowStory.cheap[3], 0)} of their graduates’ degrees
						with reported pay landed in the top band ({flowStory.top}), and {fmtPct(flowStory.cheap[0], 0)} in the bottom
						band.
					</li>
					<li class="story-step {stepState(flowStep, 2)}" data-step="2">
						<strong>The priciest fifth.</strong> {fmtPct(flowStory.pricey[3], 0)} reached the top band, compared with
						{fmtPct(flowStory.cheap[3], 0)} at the cheapest fifth. Price shows up.
					</li>
					<li class="story-step {stepState(flowStep, 3)}" data-step="3">
						<strong>But the field matters more.</strong> {fmtPct(flowStory.engCheap, 0)} of engineering degrees reached
						the top band at the cheapest colleges, and {fmtPct(flowStory.engPricey, 0)} at the priciest. Psychology
						degrees almost never did, {flowStory.psyMaxTop < 0.01 ? 'under 1%' : `at most ${fmtPct(flowStory.psyMaxTop, 0)}`}
						at any price. So next, we look at pay major by major.
					</li>
				</ol>
			</Scrolly>

			<p class="notes-link ui">How the groups and pay bands are defined: <a href="#appendix-e">Appendix E</a></p>
		</section>

		<!-- 3. EARNINGS -->
		<section class="wrap" id="earnings">
			<p class="step ui">2 · What do graduates earn?</p>
			<h2>Early earnings depend heavily on the major</h2>
			<p class="prose">
				A <em>program</em> is one major at one college. Each one reports what its graduates typically earned a year after
				finishing.
			</p>

			<Scrolly bind:step={earningsStep} class="scrolly" style="--sticky-h: {earningsStickyH}px">
				<div class="graphic">
					<div class="sticky scrollable" bind:this={earningsPanel} bind:clientHeight={earningsStickyH}>
						<div class="controls compact chart-controls panel-head ui">
							<div class="control">
								<span class="label" id="sort-label">Order majors by</span>
								<div class="segmented" role="group" aria-labelledby="sort-label">
									<button aria-pressed={sortBy === 'deg'} onclick={() => (sortBy = 'deg')}>Most degrees</button>
									<button aria-pressed={sortBy === 'high'} onclick={() => (sortBy = 'high')}>Highest pay</button>
									<button aria-pressed={sortBy === 'low'} onclick={() => (sortBy = 'low')}>Lowest pay</button>
								</div>
							</div>
							<div class="control">
								<span class="label" id="n-label">Show</span>
								<div class="segmented" role="group" aria-labelledby="n-label">
									<button aria-pressed={topN === 20} onclick={() => (topN = 20)}>Top 20</button>
									<button aria-pressed={topN === 40} onclick={() => (topN = 40)}>Top 40</button>
								</div>
							</div>
							<div class="control grow">
								<label class="label" for="major-select">Major</label>
								<select id="major-select" bind:value={selectedMajor}>
									{#each majorOptions as m (m.cip)}
										<option value={m.cip}>{m.title}</option>
									{/each}
								</select>
							</div>
						</div>
						<div class="compare-bar ui" class:active={range}>
							{#if range}
								Comparing <span class="key-band"></span> <strong>all {fmtInt(data.schools.length)} schools</strong> with
								<span class="key-sel"></span> <strong>{fmtInt(selIds.size)} schools charging {fmtUSD(range[0])}–{fmtUSD(range[1])}</strong>
								({residency === 'out' ? 'out-of-state' : 'in-state'} price).
								<button class="link" onclick={() => (range = null)}>Reset</button>
							{:else}
								Showing <strong>all {fmtInt(data.schools.length)} schools</strong>. Select a tuition range above to compare.
							{/if}
						</div>
						{#if range && selIds.size === 0}
							<p class="state empty ui" role="status">
								No schools fall in the selected tuition range. Widen the range or reset to compare with all schools.
							</p>
						{/if}
						<div class="legend ui" aria-hidden="true">
							<span class="key"><span class="lg-band" class:faded={range}></span>All schools: middle 50% of programs</span>
							<span class="key"><span class="lg-dot" class:faded={range}></span>All schools: median program</span>
							{#if range}
								<span class="key"><span class="lg-sel"></span>Selected tuition range: middle 50% and median</span>
							{/if}
							{#if selectedSchool}
								<span class="key"><span class="lg-diamond"></span>{selectedSchool.name}</span>
							{/if}
						</div>
						{#if emphasisLabel}
							<p class="emphasis-note ui" aria-live="polite">
								<span class="dim-row"></span>Highlighting {emphasisLabel}. Other majors are dimmed for emphasis, not removed.
							</p>
						{/if}
						{#if selectedSchool}
							<!-- Searching a college limits the rows to its majors; the toggle sits beside the note it explains. -->
							<p class="emphasis-note offered-note ui" data-testid="offered-note">
								<span aria-live="polite">
									{#if !onlyOffered}
										Showing all majors, including ones {selectedSchool.name} doesn’t offer.
									{:else if storyNeedsAll}
										Showing every major for this step of the story.
									{:else}
										Showing {rows.length === offeredCips.size ? 'all' : `${fmtInt(rows.length)} of the`}
										{fmtInt(offeredCips.size)} majors {selectedSchool.name} offers.
									{/if}
								</span>
								<button class="chip" data-testid="offered-toggle" aria-pressed={onlyOffered} onclick={() => setOnlyOffered(!onlyOffered)}>
									{onlyOffered ? 'Show all majors' : 'Only this college’s majors'}
								</button>
							</p>
						{/if}
						<figure class="figure">
							<EarningsByMajor
								{rows}
								hasRange={!!range}
								xDomain={earnDomain}
								{shareMax}
								rowHeight={earningsRowHeight}
								emphasis={earningsEmphasis}
								{selectedMajor}
								{schoolEarn}
								schoolName={selectedSchool?.name}
								onselect={(cip) => (selectedMajor = cip)}
							/>
						</figure>
					</div>
				</div>
				<ol class="steps" aria-label="Earnings story">
					<li class="story-step {stepState(earningsStep, 0)}" data-step="0">
						<strong>How to read this chart.</strong> Each row is a major, ordered by degrees awarded. The dot is the
						<em>median program</em>: the middle of colleges’ reported medians one year after graduation. The bar spans
						the middle 50% of programs, so a wide bar means earnings vary a lot by college.
					</li>
					<li class="story-step {stepState(earningsStep, 1)}" data-step="1">
						<strong>The most popular major is not the best paid.</strong> Business administration accounts for
						{fmtPct(story.bus.share)} of bachelor’s degrees, more than any other major. Its median program,
						{fmtUSD(story.bus.p50)}, ranks {ordinal(story.busRank)} of the 20 most common majors. Other majors are dimmed
						for emphasis, not removed.
					</li>
					<li class="story-step {stepState(earningsStep, 2)}" data-step="2">
						<strong>Majors differ by tens of thousands.</strong> Nursing’s median program reported
						{fmtUSD(story.nur.p50)}; English’s reported {fmtUSD(story.eng.p50)}, a gap of {fmtUSD(story.gap)}. Within one
						of the 20 most common majors, the middle half of programs typically spans about {fmtUSD(story.withinIqr)}.
					</li>
					<li class="story-step {stepState(earningsStep, 3)}" data-step="3">
						<strong>Now compare for yourself.</strong> All majors are back. Click a row, or use the major menu above the
						chart, to see every college’s program. Select a tuition range above to compare those schools with all
						schools.
					</li>
				</ol>
			</Scrolly>

			<p class="notes-link ui">How to read this chart and where the earnings come from: <a href="#appendix-c">Appendix C</a></p>

			{#if selectedMajor}
				<div class="detail" id="major-detail">
					<h3>Inside one major: {majorByCip.get(selectedMajor)?.title}</h3>
					<p class="prose small">
						Each dot is one college’s program, placed by the school’s published tuition and the program’s median
						earnings. {fmtInt(detailPoints.length)} programs report earnings.
						{#if detailRho != null}
							The rank correlation between tuition and earnings here is ρ = {detailRho.toFixed(2)}
							({Math.abs(detailRho) < 0.2 ? 'weak' : Math.abs(detailRho) < 0.4 ? 'modest' : 'moderate'}{detailRho > 0
								? ', positive'
								: detailRho < 0
									? ', negative'
									: ''}): {detailRho > 0 ? 'pricier schools tend to report somewhat higher earnings, with wide overlap' : 'price does not line up with higher earnings here'}.
						{/if}
						{#if detailInRange}
							{#if detailInRange.length}
								In the selected range, {fmtInt(detailInRange.length)} programs report a median program value of
								{fmtUSD(d3.median(detailInRange, (p) => p.earn))}.
							{:else}
								No program in this major reports earnings in the selected range.
							{/if}
						{/if}
					</p>
					<div class="legend ui" aria-hidden="true">
						{#each CONTROLS as c (c.key)}
							<span class="key"><span class="lg-pt" style:background={c.color}></span>{c.label}</span>
						{/each}
						{#if range}<span class="key"><span class="lg-wash"></span>Selected tuition range</span>{/if}
					</div>
					{#if detailPoints.length}
						<MajorScatter
							points={detailPoints}
							{residency}
							{range}
							xMax={xMaxTuition}
							yDomain={earnDomain}
							nationalP50={national.byCip.get(selectedMajor)?.p50}
							{selectedSchool}
						/>
					{:else}
						<p class="state empty ui">No program in this major reports earnings (all values are suppressed for privacy).</p>
					{/if}
				</div>
			{/if}
		</section>

		<!-- 4. TAKEAWAY: answers the hook's question with the data, then hands the reader the tools -->
		<section class="wrap" id="takeaway">
			<p class="step ui">3 · So does the college you go to matter?</p>
			<h2>Less than what you study</h2>
			<p class="prose">For a typical graduate, a different major changes early pay far more than a pricier college does.</p>

			<figure class="gaps ui" data-testid="takeaway-gaps">
				<figcaption>Gap in the median program’s earnings one year after graduating</figcaption>
				<div class="gap-row">
					<p class="gap-label"><strong>Switch majors</strong>{short(f.between_vs_within.lowest_major)} → {short(f.between_vs_within.highest_major)}</p>
					<div class="gap-track" aria-hidden="true"><span class="gap-bar" style:width="100%"></span></div>
					<p class="gap-val">{fmtUSD(f.between_vs_within.between_gap)}</p>
				</div>
				<div class="gap-row">
					<p class="gap-label"><strong>Pay more, same major</strong>Cheapest → priciest quarter of colleges</p>
					<div class="gap-track" aria-hidden="true">
						<span class="gap-range" style:width="{(gapRows.at(-1).gap / f.between_vs_within.between_gap) * 100}%"></span>
						<span class="gap-bar" style:width="{(f.tuition_quartile_gap_within_major.median_gap / f.between_vs_within.between_gap) * 100}%"></span>
					</div>
					<p class="gap-val">
						{fmtUSD(f.tuition_quartile_gap_within_major.median_gap)}<span>typical, up to {fmtUSD(gapRows.at(-1).gap)}</span>
					</p>
				</div>
			</figure>

			<ul class="takeaways">
				<li>
					<strong>Your major moves pay the most.</strong> A typical {short(f.between_vs_within.highest_major)} program
					reported {(f.between_vs_within.highest_p50 / f.between_vs_within.lowest_p50).toFixed(1)} times what a typical
					{short(f.between_vs_within.lowest_major)} program did.
				</li>
				<li>
					<strong>Price still shows up, a little.</strong> In all {f.tuition_quartile_gap_within_major.majors} of those
					majors, the priciest quarter of colleges reported more than the cheapest quarter, but cheap and expensive
					programs overlap widely.
				</li>
				<li>
					<strong>Popular isn’t the same as well paid.</strong> {short(f.popularity_vs_earnings.most_popular)} is the most
					common major but ranks {ordinal(f.popularity_vs_earnings.most_popular_rank_by_p50_in_top20)} of 20 on early pay.
				</li>
			</ul>

			<p class="callback">
				Bezos and Huang didn’t need the same kind of college to reach the top. For typical graduates the data point the
				same way: what you study matters more than what you pay.
			</p>
			<p class="small caveat">
				These are comparisons, not causes. Students at pricier colleges differ in family income, preparation and
				networks, and the earnings cover aided graduates working one year out (<a href="#appendix-a">Appendix A</a>).
			</p>
			<a class="cta ui" href="#cost" onclick={lookUpCollege}>Look up your own college ↑</a>
		</section>

		<!-- 5. APPENDIX: data notes moved out of the story so the charts stay uncluttered -->
		<section class="wrap appendix" id="appendix">
			<p class="step ui">Appendix</p>
			<h2>Data notes and sources</h2>

			<article id="appendix-a">
				<h3>A · About the data</h3>
				<p class="small">
					We compared the published prices of four-year colleges with what their bachelor’s graduates reported earning
					one year after finishing, major by major, using the U.S. Department of Education’s College Scorecard.
				</p>
				<dl class="scope ui">
					<div>
						<dt>Graduates</dt>
						<dd>Bachelor’s degrees awarded in 2020–21 and 2021–22</dd>
					</div>
					<div>
						<dt>Earnings</dt>
						<dd>1 year after graduating (measured in 2022 and 2023), in 2024 dollars</dd>
					</div>
					<div>
						<dt>Prices</dt>
						<dd>Published tuition and fees, averaged over 2017–18 to 2021–22, the years these classes were enrolled</dd>
					</div>
					<div>
						<dt>Colleges</dt>
						<dd>{fmtInt(f.scope.schools)} predominantly bachelor’s-granting public and private schools</dd>
					</div>
				</dl>
				<aside class="callout">
					<strong>The published price is not the same as what students pay.</strong>
					At the median private nonprofit school here, published tuition and fees averaged
					{fmtUSD(tuitionMed('Private nonprofit').tuition_in_median)} a year, but the average net price (the full cost of
					attendance, including housing, food and books, minus grants, for first-time full-time students who received aid)
					was {fmtUSD(tuitionMed('Private nonprofit').net_price_median)}. At public schools it runs the other way: in-state
					tuition was {fmtUSD(tuitionMed('Public').tuition_in_median)} but net price was
					{fmtUSD(tuitionMed('Public').net_price_median)}, because net price includes living costs. The charts use
					published tuition, so they compare sticker prices.
				</aside>
			</article>

			<article id="appendix-b">
				<h3>B · Tuition chart</h3>
				<p class="source ui">
					Each bar counts <strong>schools</strong> (each school counts once, regardless of size) whose average published
					{residency === 'out' ? 'out-of-state' : 'in-state'} tuition and fees from 2017–18 to 2021–22 fall in a $2,500
					band. The in-state/out-of-state switch mostly changes public schools; nearly all private schools publish one
					price. Nominal dollars. Source: College Scorecard.
				</p>
				<div class="table-scroll">
					<table class="summary ui">
						<caption>
							{range ? 'Selected range' : 'All schools'}: published {residency === 'out' ? 'out-of-state' : 'in-state'}
							tuition by type (each school counts once)
						</caption>
						<thead>
							<tr><th scope="col">Type</th><th scope="col">Schools</th><th scope="col">Median tuition</th><th scope="col">Middle 50%</th><th scope="col">Median net price</th></tr>
						</thead>
						<tbody>
							{#each byControl as c (c.key)}
								<tr>
									<th scope="row"><span class="swatch" style:background={c.color}></span>{c.label}</th>
									<td>{fmtInt(c.n)}</td>
									<td>{fmtUSD(c.med)}</td>
									<td>{c.n ? `${fmtUSDk(c.p25)}–${fmtUSDk(c.p75)}` : '—'}</td>
									<td>{fmtUSD(c.net)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="back ui"><a href="#cost">↑ Back to the tuition chart</a></p>
			</article>

			<article id="appendix-c">
				<h3>C · Earnings chart</h3>
				<p class="source ui">
					For each program (one major at one college), the Scorecard reports the median earnings, one year after
					graduation, of graduates who received federal financial aid, worked that year, and were not enrolled in school.
					Small programs are suppressed for privacy, so the reported programs cover
					{fmtPct(f.scope.degree_share_in_programs_with_earnings, 0)} of the degrees in our data.
				</p>
				<p class="source ui">
					Rows are majors (4-digit CIP codes), ranked by bachelor’s degrees awarded at all schools. Sorting always uses the
					all-schools values, so rows do not jump when you filter, and the earnings axis is fixed at
					{fmtUSDk(earnDomain[0])}–{fmtUSDk(earnDomain[1])} (values beyond it are drawn at the edge and marked ›). The
					<strong>median program</strong> is the middle value of programs’ reported medians: each program counts once
					regardless of size, so it is not the median graduate. The <strong>middle 50%</strong> runs from the 25th to the
					75th percentile of programs. Majors with fewer than {MIN_PROGRAMS_FOR_INTERVAL} reporting programs show
					individual programs as open circles. Share of degrees is weighted by degrees awarded in 2020–21 and 2021–22.
					Dimmed rows during the story are de-emphasized, never filtered out. Source: College Scorecard.
				</p>
				<p class="back ui"><a href="#earnings">↑ Back to the earnings chart</a></p>
			</article>

			<article id="appendix-d">
				<h3>D · The two billionaires</h3>
				<p class="source ui">
					Net worths come from Forbes’ annual World’s Billionaires lists, which use stock prices from March 18, 2020 and
					March 1, 2026. Tuition is the published 2017–18 to
					2021–22 average from College Scorecard, the same figures as the tuition chart; Oregon State’s is the in-state
					price. Two people are anecdotes, not evidence. They set up the question that the rest of the page answers with
					data.
				</p>
				<p class="back ui"><a href="#hook">↑ Back to the top</a></p>
			</article>

			<article id="appendix-e">
				<h3>E · Flow chart</h3>
				<p class="source ui">
					Band width is bachelor’s degrees awarded in 2020–21 and 2021–22. Price groups are fifths of the
					{fmtInt(f.scope.schools)} colleges by published in-state tuition and fees (each college counts once), cut at
					{flow.edges.map((e) => fmtUSD(e)).join(', ')}; in-state is used because most graduates of public colleges paid
					it. Fields are the {flow.fields.length - 1} largest 2-digit CIP families by degrees, with every other family under
					“Other fields.” Pay bands are quarters of programs’ median earnings one year after graduating, weighted by
					degrees, cut at {flow.cuts.map((c) => fmtUSD(c)).join(', ')}. “Not reported” holds programs whose earnings
					are suppressed for privacy. Percentages next to the pay bands are shares of the highlighted degrees with
					reported pay (for “Not reported,” of all highlighted degrees). Flows show where graduates ended up, not what
					caused it. Source: College Scorecard.
				</p>
				<p class="back ui"><a href="#flow">↑ Back to the flow chart</a></p>
			</article>
		</section>
	{/if}
</main>

<footer class="wrap ui">
	<p>CS171 final project prototype. Data: U.S. Department of Education, College Scorecard; NCES CIP 2020.</p>
</footer>

<style>
	.wrap {
		max-width: var(--wide);
		margin: 0 auto;
		padding: 0 24px;
	}
	@media (max-width: 600px) {
		.wrap {
			padding: 0 16px;
		}
	}
	.hero {
		padding: 72px 0 40px;
		border-bottom: 1px solid var(--border);
	}
	.kicker {
		font-size: 13px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);
		margin: 0 0 12px;
	}
	h1 {
		font-size: clamp(34px, 6vw, 56px);
		max-width: 20ch;
		margin: 0 0 20px;
	}
	.dek {
		font-size: 21px;
		max-width: var(--measure);
		color: var(--ink-2);
		margin: 0 0 32px;
	}
	.scope {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 16px 24px;
		margin: 0 0 28px;
		font-size: 14px;
	}
	.scope dt {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.scope dd {
		margin: 4px 0 0;
		line-height: 1.45;
	}
	.callout {
		max-width: var(--measure);
		font-size: 17px;
		padding: 16px 20px;
		border-left: 3px solid var(--ink);
		background: var(--surface);
	}

	/* section.wrap (not section) so .wrap's `padding: 0 24px` doesn't cancel the top spacing */
	section.wrap {
		padding-top: clamp(140px, 24vh, 240px);
	}
	.step {
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
		margin: 0 0 8px;
	}
	h2 {
		font-size: clamp(26px, 4vw, 36px);
		max-width: 26ch;
		margin: 0 0 16px;
	}
	h3 {
		font-size: 22px;
		margin: 40px 0 8px;
	}
	.prose {
		max-width: var(--measure);
	}
	.small {
		font-size: 16px;
		color: var(--ink-2);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 16px 24px;
		margin: 24px 0 16px;
	}
	.control {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.control.grow {
		flex: 1 1 260px;
		max-width: 420px;
	}
	.label {
		font-size: 12px;
		color: var(--ink-2);
	}
	.control select {
		width: 100%;
	}

	.figure {
		margin: 0;
		padding: 20px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	@media (max-width: 600px) {
		.figure {
			padding: 12px;
		}
	}
	.source {
		margin: 12px 0 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--ink-2);
		max-width: 760px;
	}
	.range-inputs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.range-inputs input {
		width: 92px;
		margin-left: 4px;
	}
	/* Chart controls sit at the top of each sticky graphic so they read as belonging to that chart. */
	.chart-controls .search-control {
		flex: 1 1 320px;
	}
	/* The earnings panel can scroll internally (Top 40, short windows, phones); keep its controls pinned. */
	.panel-head {
		position: sticky;
		top: 0;
		z-index: 3;
		padding-bottom: 10px;
		background: var(--page);
	}
	.panel-head .control.grow {
		flex-basis: 200px;
	}
	.school-card {
		margin-top: 16px;
		padding: 12px 16px;
		border: 1px solid var(--border);
		border-left: 3px solid var(--ink);
		border-radius: 8px;
		background: var(--surface);
		font-size: 14px;
	}
	.school-card p {
		margin: 0;
	}

	.summary {
		width: 100%;
		max-width: 760px;
		border-collapse: collapse;
		margin-top: 24px;
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}
	.summary caption {
		text-align: left;
		font-size: 13px;
		color: var(--ink-2);
		padding-bottom: 6px;
	}
	.summary th,
	.summary td {
		text-align: right;
		padding: 6px 8px;
		border-bottom: 1px solid var(--grid);
		white-space: nowrap;
	}
	.summary th:first-child {
		text-align: left;
		font-weight: 500;
	}
	.summary thead th {
		font-weight: 500;
		color: var(--ink-2);
		font-size: 12px;
	}
	.table-scroll {
		max-width: 100%;
		overflow-x: auto;
	}
	@media (max-width: 600px) {
		.summary {
			font-size: 13px;
		}
		.summary th,
		.summary td {
			padding: 6px 4px;
			white-space: normal;
		}
		.summary th:nth-child(4),
		.summary td:nth-child(4) {
			display: none;
		}
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 8px;
	}

	.compare-bar {
		margin: 0 0 10px;
		padding: 8px 12px;
		font-size: 13.5px;
		background: var(--page);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.compare-bar.active {
		background: var(--surface);
	}

	/* ---- Scrollytelling: sticky graphic beside (wide) or above (narrow) the story steps ---- */
	/* .scrolly is the Scrolly component's root element, so it needs :global */
	.wrap :global(.scrolly) {
		margin-top: 24px;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.story-step {
		position: relative;
		padding: 16px 18px;
		font-size: 17px;
		line-height: 1.55;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.story-step strong {
		display: block;
		margin-bottom: 4px;
	}
	.story-step.active {
		border-color: var(--ink-2);
	}
	/* Inactive steps fade only once Scrollama is running (step state is never set otherwise). */
	.story-step.inactive {
		opacity: 0.45;
	}
	@media (prefers-reduced-motion: no-preference) {
		.story-step {
			transition:
				opacity 250ms ease,
				border-color 250ms ease;
		}
	}
	.story-step .swatch {
		margin-right: 6px;
	}
	.sticky .controls.compact {
		margin: 0 0 10px;
		gap: 10px 16px;
	}
	.sticky .figure {
		padding: 14px 16px;
	}
	.sel-line {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 6px 16px;
		margin: 10px 0 0;
		padding-top: 10px;
		border-top: 1px solid var(--grid);
		font-size: 13px;
		color: var(--ink-2);
	}
	.sel-line p {
		margin: 0;
	}
	.sel-line strong {
		color: var(--ink);
	}
	.sel-line .range-inputs input {
		width: 84px;
		padding: 4px 8px;
	}
	.sel-line .btn {
		padding: 4px 10px;
	}
	.sel-line .range-inputs label {
		white-space: nowrap;
	}
	.hint-short {
		display: none;
	}
	.emphasis-note {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 6px;
		font-size: 12.5px;
		color: var(--ink-2);
	}
	.flow-note {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		min-height: 24px;
		margin: 0 0 8px;
		font-size: 13px;
		line-height: 1.3;
		color: var(--ink-2);
	}
	.flow-note .hint {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink);
		font-weight: 600;
	}
	.key-hl {
		display: inline-block;
		width: 18px;
		height: 8px;
		margin: 0 5px 0 2px;
		border-radius: 2px;
		vertical-align: middle;
	}
	.offered-note {
		flex-wrap: wrap;
		gap: 4px 10px;
		line-height: 1.3;
	}
	.chip {
		padding: 1px 9px;
		font: inherit;
		font-weight: 600;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--axis);
		border-radius: 999px;
		cursor: pointer;
	}
	.chip:hover {
		border-color: var(--ink-2);
	}
	.chip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.dim-row {
		width: 22px;
		height: 8px;
		border-radius: 3px;
		background: var(--ink-2);
		opacity: 0.2;
	}

	@media (min-width: 900px) {
		.wrap :global(.scrolly) {
			display: grid;
			grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
			column-gap: 36px;
		}
		.steps {
			grid-column: 1;
			grid-row: 1;
			padding: 25vh 0 30vh;
		}
		.story-step + .story-step {
			margin-top: 70vh;
		}
		.graphic {
			grid-column: 2;
			grid-row: 1;
			min-width: 0;
		}
		.sticky {
			position: sticky;
			top: max(16px, calc(50vh - var(--sticky-h, 0px) / 2));
		}
		.sticky.scrollable {
			max-height: calc(100vh - 32px);
			overflow-y: auto;
		}
	}

	@media (max-width: 899px) {
		/* Graphic and steps share one grid cell: the opaque sticky graphic stays on top and the
		   steps scroll up into the space below it, sliding underneath instead of overlapping text. */
		.wrap :global(.scrolly) {
			display: grid;
		}
		.graphic,
		.steps {
			grid-area: 1 / 1;
			min-width: 0;
		}
		.graphic {
			z-index: 2;
			pointer-events: none;
		}
		.sticky {
			position: sticky;
			top: 0;
			pointer-events: auto;
			background: var(--page);
			padding: 8px 0;
			border-bottom: 1px solid var(--border);
		}
		.sticky.scrollable {
			max-height: 62svh;
			overflow-y: auto;
		}
		.steps {
			position: relative;
			z-index: 1;
			padding: calc(var(--sticky-h, 0px) + 24px) 0 25svh;
		}
		.story-step {
			font-size: 16px;
		}
		.story-step + .story-step {
			margin-top: 45svh;
		}
	}
	.link {
		border: 0;
		background: none;
		text-decoration: underline;
		cursor: pointer;
		padding: 0 4px;
	}
	.key-band,
	.key-sel {
		display: inline-block;
		width: 18px;
		height: 8px;
		border-radius: 2px;
		vertical-align: middle;
		background: var(--band-national);
	}
	.key-sel {
		height: 4px;
		background: var(--select);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		font-size: 13px;
		color: var(--ink-2);
		margin: 0 0 8px;
	}
	.key {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.lg-band {
		width: 22px;
		height: 10px;
		border-radius: 3px;
		background: var(--ink-2);
		opacity: 0.32;
	}
	.lg-band.faded {
		background: var(--band-national);
		opacity: 1;
	}
	.lg-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--ink);
	}
	.lg-dot.faded {
		background: var(--surface);
		border: 2px solid var(--band-national-ink);
	}
	.lg-sel {
		width: 22px;
		height: 4px;
		background: var(--select);
		border-radius: 2px;
		position: relative;
	}
	.lg-sel::after {
		content: '';
		position: absolute;
		left: 6px;
		top: -3px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--select);
	}
	.lg-diamond {
		width: 9px;
		height: 9px;
		border: 2px solid var(--ink);
		transform: rotate(45deg);
	}
	.lg-pt {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.lg-wash {
		width: 18px;
		height: 12px;
		background: var(--select-wash);
		border: 1px solid var(--border);
	}

	.state {
		padding: 24px;
		border: 1px dashed var(--axis);
		border-radius: 12px;
		color: var(--ink-2);
		font-size: 15px;
		margin-top: 24px;
	}
	.state.error {
		border-style: solid;
		border-color: #d03b3b;
	}
	.state.empty {
		padding: 12px 16px;
		margin: 12px 0 0;
	}

	.detail {
		margin-top: 32px;
		padding: 20px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.detail h3 {
		margin-top: 0;
	}
	@media (max-width: 600px) {
		.detail {
			padding: 12px;
		}
	}

	/* ---- Takeaway: two gaps on one dollar scale, three one-line findings, then back to the tools ---- */
	.gaps {
		max-width: 760px;
		margin: 28px 0 32px;
		padding: 18px 20px 20px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.gaps figcaption {
		margin: 0 0 14px;
		font-size: 13px;
		color: var(--ink-2);
	}
	.gap-row {
		display: grid;
		/* Fixed label and value columns so both tracks are the same width, i.e. one shared dollar scale. */
		grid-template-columns: 200px minmax(0, 1fr) 140px;
		align-items: center;
		gap: 6px 16px;
	}
	.gap-row + .gap-row {
		margin-top: 16px;
	}
	.gap-row p {
		margin: 0;
	}
	.gap-label {
		font-size: 13px;
		line-height: 1.35;
		color: var(--ink-2);
	}
	.gap-label strong {
		display: block;
		font-size: 15px;
		color: var(--ink);
	}
	.gap-track {
		position: relative;
		height: 18px;
		border-radius: 4px;
		background: var(--wash);
	}
	.gap-bar,
	.gap-range {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		border-radius: 4px;
		background: var(--ink);
	}
	/* The lighter extension runs to the largest within-major price gap; the solid bar is the typical one. */
	.gap-range {
		background: var(--band-national);
	}
	.gap-val {
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.15;
	}
	.gap-val span {
		display: block;
		font-size: 12px;
		font-weight: 400;
		color: var(--ink-2);
	}
	@media (max-width: 600px) {
		.gaps {
			padding: 14px;
		}
		.gap-row {
			grid-template-columns: minmax(0, 1fr) 118px;
		}
		.gap-label {
			grid-column: 1 / -1;
		}
	}
	.takeaways {
		max-width: var(--measure);
		margin: 0 0 28px;
		padding: 0;
		list-style: none;
	}
	.takeaways li {
		padding: 12px 0;
		border-top: 1px solid var(--grid);
		font-size: 17px;
	}
	.takeaways li:last-child {
		border-bottom: 1px solid var(--grid);
	}
	.callback {
		max-width: var(--measure);
		margin: 0 0 12px;
		font-size: 21px;
		line-height: 1.45;
	}
	.caveat {
		max-width: var(--measure);
		margin: 0 0 24px;
	}
	.cta {
		display: inline-block;
		padding: 10px 18px;
		font-size: 15px;
		font-weight: 600;
		text-decoration: none;
		color: var(--page);
		background: var(--ink);
		border-radius: 999px;
	}
	.cta:hover {
		opacity: 0.85;
	}
	.cta:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	/* ---- Hook: a sticky two-person panel on top, two-column story cards scrolling underneath ---- */
	#hook {
		padding-top: 32px;
	}
	.wrap :global(.hook-scrolly) {
		display: grid;
		max-width: 820px;
		margin: 0 auto;
	}
	.hook-graphic,
	.hook-steps {
		grid-area: 1 / 1;
		min-width: 0;
	}
	.hook-graphic {
		z-index: 2;
		pointer-events: none;
	}
	.hook-panel {
		position: sticky;
		top: 0;
		pointer-events: auto;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
		padding: 16px 0 14px;
		background: var(--page);
		border-bottom: 1px solid var(--border);
	}
	.person p {
		margin: 0;
	}
	.person .who {
		font-size: 22px;
		font-weight: 700;
	}
	.person .school {
		margin: 4px 0 10px;
		font-size: 13px;
		line-height: 1.4;
		color: var(--ink-2);
	}
	.person .school .swatch {
		margin-right: 6px;
	}
	.person .worth {
		font-family: var(--sans);
		font-size: clamp(30px, 5vw, 44px);
		font-weight: 700;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.person .worth-cap {
		margin: 2px 0 8px;
		font-size: 12.5px;
		color: var(--ink-2);
	}
	.worth-bar {
		height: 10px;
		border-radius: 5px;
		background: var(--wash);
		overflow: hidden;
	}
	.worth-bar span {
		display: block;
		height: 100%;
		border-radius: 5px;
		background: var(--person-color);
	}
	.hook-steps {
		position: relative;
		z-index: 1;
		list-style: none;
		margin: 0;
		padding: calc(var(--hook-h, 0px) + 32px) 0 20vh;
	}
	.hook-step {
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.hook-step + .hook-step {
		margin-top: 45vh;
	}
	.hook-step.active {
		border-color: var(--ink-2);
	}
	.hook-step.inactive {
		opacity: 0.45;
	}
	@media (prefers-reduced-motion: no-preference) {
		.worth-bar span {
			transition: width 600ms ease;
		}
		.hook-step {
			transition:
				opacity 250ms ease,
				border-color 250ms ease;
		}
	}
	.hook-label {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
	}
	.hook-cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
	}
	.hook-cols p {
		margin: 0;
		font-size: 17px;
		line-height: 1.5;
	}
	.hook-end,
	.bridge {
		max-width: 820px;
		margin: 0 auto;
	}
	.hook-end {
		padding-top: 6vh;
	}
	.hook-sum {
		margin: 0 0 8px;
		font-size: 20px;
		color: var(--ink-2);
	}
	.hook-q {
		margin: 0;
		font-size: clamp(30px, 5vw, 44px);
		font-weight: 700;
		line-height: 1.15;
	}
	.bridge {
		margin-top: 64px;
	}
	.bridge .prose {
		margin: 0;
	}
	.notes-link {
		margin: 12px 0 0;
		font-size: 13px;
		color: var(--ink-2);
	}

	/* ---- Appendix ---- */
	section.appendix {
		margin-top: 72px;
		border-top: 1px solid var(--border);
	}
	.appendix article {
		margin-top: 32px;
		scroll-margin-top: 24px;
	}
	.appendix h3 {
		margin: 0 0 8px;
		font-size: 19px;
	}
	.appendix .summary {
		margin-top: 12px;
	}
	.back {
		margin: 10px 0 0;
		font-size: 13px;
	}

	code {
		font-size: 0.85em;
		background: var(--wash);
		padding: 1px 4px;
		border-radius: 4px;
		overflow-wrap: anywhere;
	}
	footer {
		padding: 64px 24px 48px;
		font-size: 13px;
		color: var(--muted);
	}

	/* Phones: the pinned panels share the screen with the story text, so their controls get compact.
	   Kept last so these rules override the base rules above. */
	@media (max-width: 600px) {
		.res-control {
			flex-direction: row;
			align-items: center;
			gap: 8px;
		}
		.sel-line {
			gap: 6px;
		}
		.hint-long {
			display: none;
		}
		.hint-short {
			display: inline;
		}
		.sel-line .range-inputs {
			flex-wrap: nowrap;
			gap: 6px;
		}
		.sel-line .range-inputs input {
			width: 68px;
			margin-left: 2px;
		}
		/* top/padding offset the pinned panel's own 8px top padding so rows can't peek out above the controls */
		.panel-head {
			top: -8px;
			padding-top: 8px;
			gap: 8px;
			border-bottom: 1px solid var(--border);
			margin-bottom: 8px;
		}
		/* Visually hidden but still read by screen readers */
		.panel-head .label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
		}
		.panel-head .segmented button {
			font-size: 13px;
			padding: 6px 8px;
		}
		.panel-head .control.grow {
			flex: 1 1 140px;
		}
		.hook-panel,
		.hook-cols {
			gap: 16px;
		}
		.person .who {
			font-size: 18px;
		}
		.person .school {
			font-size: 12px;
		}
		.hook-cols p {
			font-size: 15px;
		}
		.hook-step {
			padding: 14px;
		}
	}
</style>
