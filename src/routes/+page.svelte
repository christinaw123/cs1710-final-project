<script>
	import * as d3 from 'd3';
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { loadData } from '$lib/data/load.js';
	import {
		CONTROLS,
		MIN_PROGRAMS_FOR_INTERVAL,
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

	// Scroll-story state: one authoritative step index per section, written only by Scrollama.
	// It drives *emphasis* (what is dimmed for narration) and never touches the user selections above.
	let tuitionStep = $state(null);
	let earningsStep = $state(null);
	let vw = $state(1200);
	let vh = $state(900);
	let tuitionStickyH = $state(0);
	let earningsStickyH = $state(0);
	let earningsPanel = $state(null);

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
	const rows = $derived.by(() => {
		if (!national) return [];
		const cips = ranked.slice(0, topN).map((d) => d.cip);
		if (selectedMajor && !cips.includes(selectedMajor)) cips.push(selectedMajor);
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
					.filter((d) => d.n > 0)
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

	const schoolEarn = $derived(
		selectedSchool && data
			? new Map(data.programs.filter((p) => p.unitid === selectedSchool.unitid).map((p) => [p.cip, p]))
			: null
	);
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
	const earningsRowHeight = $derived(Math.floor((vh - 250) / Math.max(rows.length, 1)));

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

	// Narrative helpers (every number comes from findings.json)
	const topMajors = $derived(f ? f.top20_majors.values : []);
	const gapRows = $derived(f ? [...f.tuition_quartile_gap_within_major.values].sort((a, b) => a.gap - b.gap) : []);
	const tuitionMed = (label) => f.tuition_by_control.values[label];
	const short = (t) => t.split(',')[0];
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<svelte:head>
	<title>Does a more expensive college mean a bigger paycheck?</title>
</svelte:head>

<header class="hero">
	<div class="wrap">
		<p class="kicker">CS171 final project · Prototype V1</p>
		<h1>Does a more expensive college mean a bigger paycheck?</h1>
		<p class="dek">
			Every year, families weigh college prices against what a degree might pay. We compared the published prices of
			four-year colleges with what their bachelor’s graduates reported earning one year after finishing, major by
			major, using the U.S. Department of Education’s College Scorecard.
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
				<dd>
					{#if f}{fmtInt(f.scope.schools)} predominantly bachelor’s-granting public and private schools{:else}Loading…{/if}
				</dd>
			</div>
		</dl>
		{#if f}
			<aside class="callout">
				<strong>The published price is not the same as what students pay.</strong>
				At the median private nonprofit school here, published tuition and fees averaged
				{fmtUSD(tuitionMed('Private nonprofit').tuition_in_median)} a year, but the average net price (the full cost of
				attendance, including housing, food and books, minus grants, for first-time full-time students who received aid)
				was {fmtUSD(tuitionMed('Private nonprofit').net_price_median)}. At public schools it runs the other way: in-state
				tuition was {fmtUSD(tuitionMed('Public').tuition_in_median)} but net price was
				{fmtUSD(tuitionMed('Public').net_price_median)}, because net price includes living costs. The charts below use
				published tuition, so they compare sticker prices.
			</aside>
		{/if}
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
		<!-- 2. COST -->
		<section class="wrap" id="cost" data-xmax={xMaxTuition}>
			<p class="step ui">1 · What does college cost?</p>
			<h2>Published tuition ranges widely, and the type of school explains much of it</h2>
			<p class="prose">
				Scroll to step through the chart. Every control works at any point, and the full readout, source notes and
				summary table follow the story.
			</p>

			<Scrolly bind:step={tuitionStep} class="scrolly" style="--sticky-h: {tuitionStickyH}px">
				<div class="graphic">
					<div class="sticky" bind:clientHeight={tuitionStickyH}>
						<div class="controls compact ui">
							<div class="control">
								<span class="label" id="res-label">Public schools’ price</span>
								<div class="segmented" role="group" aria-labelledby="res-label">
									<button aria-pressed={residency === 'in'} onclick={() => (residency = 'in')}>In-state</button>
									<button aria-pressed={residency === 'out'} onclick={() => (residency = 'out')}>Out-of-state</button>
								</div>
							</div>
							<div class="control grow">
								<SchoolSearch schools={data.schools} selected={selectedSchool} onselect={(s) => (selectedSchool = s)} />
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
							<p class="sel-line ui">
								{#if range}
									<strong>Selected {fmtUSD(range[0])}–{fmtUSD(range[1])}</strong> · {fmtInt(selIds.size)}
									{selIds.size === 1 ? 'school' : 'schools'}
									<button class="link" onclick={() => (range = null)}>Reset</button>
								{:else}
									Drag across the chart to select a tuition range.
								{/if}
							</p>
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

			<div class="readout ui">
				<p data-testid="range-readout" aria-live="polite">
					{#if range}
						<strong>Selected: {fmtUSD(range[0])} – {fmtUSD(range[1])}</strong> ·
						{fmtInt(selIds.size)} {selIds.size === 1 ? 'school' : 'schools'}
						({byControl.map((c) => `${fmtInt(c.n)} ${c.label.toLowerCase()}`).join(', ')})
					{:else}
						<strong>No range selected:</strong> showing all {fmtInt(data.schools.length)} schools. Drag across the
						chart, or type a range.
					{/if}
				</p>
				<div class="range-inputs">
					<label>From $<input id="range-lo" type="number" min="0" step="500" value={range ? range[0] : ''}
							onchange={(e) => setRangeFromInputs(e.currentTarget.value, range ? range[1] : xMaxTuition)} /></label>
					<label>to $<input id="range-hi" type="number" min="0" step="500" value={range ? range[1] : ''}
							onchange={(e) => setRangeFromInputs(range ? range[0] : 0, e.currentTarget.value)} /></label>
					<button class="btn" data-testid="reset" onclick={() => (range = null)} disabled={!range}>Reset to all schools</button>
				</div>
			</div>
			<p class="source ui">
				Each bar counts <strong>schools</strong> (each school counts once, regardless of size) whose average published
				{residency === 'out' ? 'out-of-state' : 'in-state'} tuition and fees from 2017–18 to 2021–22 fall in a $2,500 band.
				The in-state/out-of-state switch mostly changes public schools; nearly all private schools publish one price.
				Nominal dollars. Source: College Scorecard.
			</p>

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

			<div class="table-scroll">
			<table class="summary ui">
				<caption>
					{range ? 'Selected range' : 'All schools'}: published {residency === 'out' ? 'out-of-state' : 'in-state'} tuition
					by type (each school counts once)
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
		</section>

		<!-- 3. EARNINGS -->
		<section class="wrap" id="earnings">
			<p class="step ui">2 · What do graduates earn?</p>
			<h2>Early earnings depend heavily on the major</h2>
			<p class="prose">
				A <em>program</em> is one major at one college. For each program, the Scorecard reports the median earnings, one
				year after graduation, of graduates who received federal financial aid, worked that year, and were not enrolled
				in school. Small programs are suppressed for privacy, so the reported programs cover
				{fmtPct(f.scope.degree_share_in_programs_with_earnings, 0)} of the degrees in our data.
			</p>

			<Scrolly bind:step={earningsStep} class="scrolly" style="--sticky-h: {earningsStickyH}px">
				<div class="graphic">
					<div class="sticky scrollable" bind:this={earningsPanel} bind:clientHeight={earningsStickyH}>
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
						<strong>Now compare for yourself.</strong> All majors are back. Click a row, or use the major menu below the
						chart, to see every college’s program. Select a tuition range above to compare those schools with all
						schools.
					</li>
				</ol>
			</Scrolly>

			<div class="controls ui">
				<div class="control">
					<span class="label" id="sort-label">Order majors by</span>
					<div class="segmented" role="group" aria-labelledby="sort-label">
						<button aria-pressed={sortBy === 'deg'} onclick={() => (sortBy = 'deg')}>Most degrees</button>
						<button aria-pressed={sortBy === 'high'} onclick={() => (sortBy = 'high')}>Highest earnings</button>
						<button aria-pressed={sortBy === 'low'} onclick={() => (sortBy = 'low')}>Lowest earnings</button>
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
			<p class="source ui">
				Rows are majors (4-digit CIP codes), ranked by bachelor’s degrees awarded at all schools. Sorting always uses
				the all-schools values, so rows do not jump when you filter, and the earnings axis is fixed at
				{fmtUSDk(earnDomain[0])}–{fmtUSDk(earnDomain[1])} (values beyond it are drawn at the edge and marked ›). The
				<strong>median program</strong> is the middle value of programs’ reported medians: each program counts once
				regardless of size, so it is not the median graduate. The <strong>middle 50%</strong> runs from the 25th to the
				75th percentile of programs. Majors with fewer than {MIN_PROGRAMS_FOR_INTERVAL} reporting programs show
				individual programs as open circles. Share of degrees is weighted by degrees awarded in 2020–21 and 2021–22.
				Dimmed rows during the story are de-emphasized, never filtered out. Source: College Scorecard.
			</p>

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

		<!-- 4. MEANING -->
		<section class="wrap" id="meaning">
			<p class="step ui">3 · What does this mean?</p>
			<h2>What you study is associated with bigger earnings gaps than what you pay, but price still shows up</h2>
			<div class="insights">
				<article>
					<h3>Popular does not mean high-paying</h3>
					<p>
						{short(f.popularity_vs_earnings.most_popular)} is the most common major
						({fmtPct(f.popularity_vs_earnings.most_popular_share)} of degrees), yet its median program
						({fmtUSD(f.popularity_vs_earnings.most_popular_p50)}) ranks
						{f.popularity_vs_earnings.most_popular_rank_by_p50_in_top20}th of the 20 most-awarded majors. Across the
						{f.popularity_vs_earnings.majors} majors with at least 30 reporting programs, the rank correlation between
						degrees awarded and median program earnings is ρ = {f.popularity_vs_earnings.spearman.toFixed(2)}: essentially
						no relationship.
					</p>
				</article>
				<article>
					<h3>The gaps between majors are large</h3>
					<p>
						Among the 20 most-awarded majors, the median program ranges from
						{fmtUSD(f.between_vs_within.lowest_p50)} ({short(f.between_vs_within.lowest_major)}) to
						{fmtUSD(f.between_vs_within.highest_p50)} ({short(f.between_vs_within.highest_major)}), a gap of
						{fmtUSD(f.between_vs_within.between_gap)}. Within a single major, the middle half of programs typically spans
						about {fmtUSD(f.between_vs_within.median_within_iqr)}.
					</p>
				</article>
				<article>
					<h3>Higher prices are linked to modestly higher earnings within a major</h3>
					<p>
						In all {f.tuition_quartile_gap_within_major.majors} of these majors, programs at the highest-tuition quarter of
						schools (≥ {fmtUSD(f.tuition_quartiles.edges[2])} in-state) reported a higher median than programs at the
						lowest-tuition quarter (&lt; {fmtUSD(f.tuition_quartiles.edges[0])}). The typical gap was
						{fmtUSD(f.tuition_quartile_gap_within_major.median_gap)}, from {fmtUSD(gapRows[0].gap)}
						({short(gapRows[0].title)}) to {fmtUSD(gapRows.at(-1).gap)} ({short(gapRows.at(-1).title)}). Rank correlations
						between tuition and earnings within a major are positive but modest (median ρ =
						{f.tuition_vs_earnings_within_major.median_spearman.toFixed(2)}).
					</p>
				</article>
			</div>
			<div class="message">
				<p class="kicker ui">Our message, checked against the data</p>
				<p>
					<strong>What you study is associated with much larger differences in early earnings than how much your college
						charges.</strong> A major’s popularity tells you almost nothing about its typical early pay. But our original
					claim that higher tuition does not indicate higher earnings goes too far. Within the same major, pricier
					schools report somewhat higher early earnings, with wide overlap between cheap and expensive programs.
				</p>
				<p class="small">
					These are descriptive comparisons, not causal effects. Students who attend expensive schools differ in family
					income, preparation, location and networks, and the earnings cover only aided graduates who were working one
					year out.
				</p>
			</div>
		</section>

		<!-- 5. EXPLORE (placeholder) -->
		<section class="wrap" id="explore">
			<p class="step ui">4 · Explore further</p>
			<div class="placeholder ui">Placeholder: content coming soon.</div>
		</section>

		<!-- 6. TAKEAWAY + METHODS (placeholder) -->
		<section class="wrap" id="methods">
			<p class="step ui">5 · Takeaway</p>
			<div class="placeholder ui">Placeholder: content coming soon.</div>
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
		padding-top: 72px;
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
	.readout {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 8px 16px;
		font-size: 14px;
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--grid);
	}
	.readout p {
		margin: 0;
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
		margin: 6px 0 0;
		font-size: 13px;
		color: var(--ink-2);
	}
	.emphasis-note {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 6px;
		font-size: 12.5px;
		color: var(--ink-2);
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

	.insights {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 24px;
		margin: 24px 0 32px;
	}
	.insights article {
		padding-top: 12px;
		border-top: 2px solid var(--ink);
	}
	.insights h3 {
		font-size: 19px;
		margin: 0 0 8px;
	}
	.insights p {
		font-size: 16px;
		margin: 0;
	}
	.message {
		max-width: var(--measure);
		padding: 20px 24px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.message .kicker {
		margin-bottom: 8px;
	}

	code {
		font-size: 0.85em;
		background: var(--wash);
		padding: 1px 4px;
		border-radius: 4px;
		overflow-wrap: anywhere;
	}
	.placeholder {
		min-height: 160px;
		display: grid;
		place-items: center;
		margin-top: 16px;
		border: 1.5px dashed var(--axis);
		border-radius: 12px;
		color: var(--muted);
		font-size: 14px;
	}
	footer {
		padding: 64px 24px 48px;
		font-size: 13px;
		color: var(--muted);
	}
</style>
