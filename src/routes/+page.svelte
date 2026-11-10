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

	// Opening hook: two electrical engineers, one Ivy League and one state school, told in year order.
	// Net worths: Forbes for Bezos (1998, 2006, 2020, 2026) and Huang (2020, 2026). Huang's 1999 and 2006 values (est)
	// value his Nvidia shares from SEC filings. Tuition comes from our own data. Sources and photo credits: Appendix D.
	let hookStep = $state(null);
	const HOOK_PEOPLE = [
		{ key: 'bezos', name: 'Jeff Bezos', school: 'Princeton', type: 'private nonprofit (Ivy League)', unitid: '186131', color: 'var(--c-nonprofit)', inState: false },
		{ key: 'huang', name: 'Jensen Huang', school: 'Oregon State', type: 'public', unitid: '209542', color: 'var(--c-public)', inState: true }
	];
	// Photos of places and products belong to their event. Photos of the two men carry `taken` and are attached
	// only to events in or after that year, so no photo ever appears before the year it was taken.
	const HOOK_EVENTS = [
		{ who: 'huang', year: 1984, text: 'Graduates from Oregon State in electrical engineering.',
			photo: { src: 'oregon-state-memorial-union.jpg', caption: 'Oregon State’s Memorial Union (photographed 2019)' } },
		{ who: 'bezos', year: 1986, text: 'Graduates from Princeton in electrical engineering and computer science.',
			photo: { src: 'bezos-1986.jpg', caption: 'Bezos’s Princeton yearbook photo, 1986', taken: 1986, focus: 'center 35%' } },
		{ who: 'huang', year: 1993, text: 'At 30, co-founds Nvidia, planning it over meals at a Denny’s. He had finished a Stanford master’s the year before while working full time.',
			photo: { src: 'nvidia-dennys.jpg', caption: 'The San Jose Denny’s where Nvidia was planned (photographed 2023)' } },
		{ who: 'bezos', year: 1994, text: 'At 30, quits a Wall Street job and starts Amazon in his garage.',
			photo: { src: 'amazon-garage.jpg', caption: 'Amazon’s first garage, Bellevue, Washington (photographed 2024)' } },
		{ who: 'bezos', year: 1999, text: 'Two years after Amazon goes public, Time names him its 1999 Person of the Year.', worth: 7.8,
			photo: { src: 'amazon-hq-1999.jpg', caption: 'Amazon’s Seattle headquarters from 1999 to 2010 (photographed 2012)' } },
		{ who: 'huang', year: 1999, text: 'Nvidia goes public, and its GeForce 256 is marketed as “the world’s first GPU.”', worth: 0.037, est: true,
			photo: { src: 'geforce-256.jpg', caption: 'A GeForce 256 chip (photographed 2009)' } },
		{ who: 'bezos', year: 2006, text: 'Amazon launches Amazon Web Services, renting out its computing power.', worth: 4.3,
			photo: { src: 'bezos-2005.jpg', caption: 'Bezos in 2005', taken: 2005, focus: 'center 30%' } },
		{ who: 'huang', year: 2006, text: 'Nvidia launches CUDA, letting its graphics chips run general math, later the engine of AI.', worth: 0.39, est: true,
			photo: { src: 'geforce-8800.jpg', caption: 'A GeForce 8800, the first card to run CUDA (photographed 2006)' } },
		{ who: 'bezos', year: 2020, text: 'The world’s richest person.', worth: 113,
			photo: { src: 'bezos-2019.jpg', caption: 'Bezos in 2019', taken: 2019, focus: 'center 25%' } },
		{ who: 'huang', year: 2020, text: 'In July, Nvidia passes Intel as America’s most valuable chipmaker.', worth: 4.7,
			photo: { src: 'huang-2018.jpg', caption: 'Huang in 2018', taken: 2018, focus: 'center 30%' } },
		{ who: 'bezos', year: 2026, text: 'No. 4 in the world. In 2021 he stepped down as Amazon’s CEO.', worth: 224,
			photo: { src: 'bezos-2026.jpg', caption: 'Bezos at Blue Origin, May 2026', taken: 2026, focus: 'center 15%' } },
		{ who: 'huang', year: 2026, text: 'No. 8 in the world. In 2025 Nvidia became the first company worth $5 trillion, on the strength of its AI chips.', worth: 154,
			photo: { src: 'huang-2026.jpg', caption: 'Huang at Stanford, April 2026', taken: 2026, focus: 'center 25%' } }
	];
	const HOOK_YEARS = [...new Set(HOOK_EVENTS.map((e) => e.year))]; // one timeline dot (and scroll step) per year
	// Each person's bar fills toward his own peak net worth ($ billions), so it shows how far along he is.
	const HOOK_PEAK = Object.fromEntries(
		HOOK_PEOPLE.map((p) => [p.key, Math.max(...HOOK_EVENTS.filter((e) => e.who === p.key && e.worth != null).map((e) => e.worth))])
	);
	const fmtWorth = (e) => `${e.est ? '≈' : ''}${e.worth >= 1 ? `$${e.worth}B` : `$${Math.round(e.worth * 1000)}M`}`;
	// The pinned stage shows one year at a time. Each side shows that person's latest milestone up to that year
	// (hidden when it is from an earlier year) and the latest net worth we can source.
	const stageYear = $derived(HOOK_YEARS[hookStep ?? 0]);
	const stage = $derived(
		Object.fromEntries(
			HOOK_PEOPLE.map((p) => {
				const past = HOOK_EVENTS.filter((e) => e.who === p.key && e.year <= stageYear);
				return [
					p.key,
					{
						event: past.at(-1),
						worth: past.findLast((e) => e.worth != null)
					}
				];
			})
		)
	);
	const HOOK_CREDITS = [
		['Memorial Union, Oregon State University (2019)', 'Gary Halvorson, Oregon State Archives', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'https://commons.wikimedia.org/wiki/File:Memorial_Union,_Oregon_State_University,_Corvallis_-_DPLA_-_8aa8840e3a87aa53902834c13f8db7e0.jpg'],
		['Pacific Medical Center (Pacific Tower), Seattle (2012)', 'Joe Mabel', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', 'https://commons.wikimedia.org/wiki/File:Pacific_Medical_Center_pano_01.jpg'],
		['Jeffrey P. Bezos, Princeton yearbook (1986), cropped', 'Princeton University', 'Public domain', null, 'https://commons.wikimedia.org/wiki/File:Jeffrey_P._Bezos_1986.jpg'],
		['Denny’s at 2484 Berryessa Road, San Jose (2023)', 'Coolcaesar', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 'https://commons.wikimedia.org/wiki/File:2484_Berryessa_Road.jpg'],
		['Amazon’s founding site in Bellevue, Washington (2024)', 'SounderBruce', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 'https://commons.wikimedia.org/wiki/File:Amazon%27s_founding_site_in_Bellevue,_Washington_-_garage.jpg'],
		['NVIDIA GeForce 256 GPU (2009)', 'Konstantin Lanzet', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', 'https://commons.wikimedia.org/wiki/File:KL_NVIDIA_Geforce_256.jpg'],
		['Jeff Bezos (2005)', 'James Duncan Davidson', 'Public domain', null, 'https://commons.wikimedia.org/wiki/File:Jeff_Bezos_2005.jpg'],
		['XFX GeForce 8800 GTS (2006)', 'Tyro (English Wikipedia)', 'Public domain', null, 'https://commons.wikimedia.org/wiki/File:Geforce8800gts.jpg'],
		['Jeff Bezos at a Blue Origin event (2019)', 'Daniel Oberhaus', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'https://commons.wikimedia.org/wiki/File:Jeff_Bezos_Unveils_Blue_Origin_Lunar_Lander.jpg'],
		['Jensen Huang at SC18 (2018)', 'Raysonho @ Open Grid Scheduler / Scalable Grid Engine', 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/', 'https://commons.wikimedia.org/wiki/File:JensenHuangSC18.jpg'],
		['Jensen Huang at Stanford (2026)', 'Anderseidesvik', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 'https://commons.wikimedia.org/wiki/File:Jensen_huang_stanford_2026-04-30_003.jpg'],
		['Jeff Bezos at Blue Origin (May 29, 2026), cropped', 'NASA/John Kraus', 'Public domain', null, 'https://commons.wikimedia.org/wiki/File:Administrator_Isaacman_Visits_Blue_Origin_(NHQ20260529_admin_0005).jpg']
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
	// 310px covers the controls, compare bar, legend and axes above and below the rows.
	const earningsRowHeight = $derived(Math.floor((vh - 310) / Math.max(rows.length, 1)));

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
			<Scrolly bind:step={hookStep} class="hook-scroller">
				<!-- The stage stays pinned for the whole hook; the invisible steps underneath only advance the year. -->
				<div class="hook-stage" data-testid="hook-stage">
					<div class="stage-row stage-top">
						{#each HOOK_PEOPLE as p, side (p.key)}
							{@const school = schoolById.get(p.unitid)}
							{@const w = stage[p.key].worth}
							{@const here = stage[p.key].event?.year === stageYear}
							{#if side === 1}<div aria-hidden="true"></div>{/if}
							<div class="stage-person" class:idle={!here} style="--person-color: {p.color}" data-testid="hook-head-{p.key}">
								<p class="who"><span class="swatch" style:background={p.color}></span>{p.name}</p>
								<p class="school ui">
									{p.school}<span class="long">{` · ${p.type}`}</span>{` · ${fmtUSD(school?.tuition_in)}/yr${p.inState ? ' in-state' : ''}`}
								</p>
								<p class="worth" data-testid="hook-worth-{p.key}">{w ? fmtWorth(w) : '—'}</p>
								<p class="worth-cap ui">
									{w ? `${w.year} · ${w.est ? 'est. value of his Nvidia shares' : 'net worth (Forbes)'}` : 'no public net worth yet'}
								</p>
								<div class="worth-bar" aria-hidden="true">
									<span style:width="{w ? Math.max(1, (w.worth / HOOK_PEAK[p.key]) * 100) : 0}%"></span>
								</div>
							</div>
						{/each}
					</div>
					<ol class="year-dots ui" aria-hidden="true">
						{#each HOOK_YEARS as y, i (y)}
							<li class:reached={i <= (hookStep ?? 0)} class:current={y === stageYear}><span class="dot"></span><span class="yr">{y}</span></li>
						{/each}
					</ol>
					<div class="stage-row stage-cards" aria-live="polite">
						{#each HOOK_PEOPLE as p, side (p.key)}
							{@const s = stage[p.key]}
							{#if side === 1}
								<ol class="year-line ui" aria-label="Year">
									{#each HOOK_YEARS as y, i (y)}
										<li class:reached={i <= (hookStep ?? 0)} class:current={y === stageYear} aria-current={y === stageYear ? 'step' : undefined}>
											<span class="dot"></span><span class="yr" data-testid={y === stageYear ? 'hook-year' : undefined}>{y}</span>
										</li>
									{/each}
								</ol>
							{/if}
							<!-- A card is only shown in its own year; in a year that doesn't involve this person, it fades away. -->
							<div class="stage-slot">
								{#if s.event}
									{#key s.event}
										<article
											class="tl-card {side === 0 ? 'left' : 'right'}"
											class:away={s.event.year !== stageYear}
											aria-hidden={s.event.year !== stageYear}
											style="--person-color: {p.color}"
											data-testid="hook-card-{p.key}"
											data-year={s.event.year}
										>
											{#if s.event.photo}
												<figure class="tl-photo">
													<img
														src="{base}/images/hook/{s.event.photo.src}"
														alt={s.event.photo.caption}
														data-taken={s.event.photo.taken ?? ''}
														style:object-position={s.event.photo.focus ?? 'center'}
													/>
													<figcaption class="ui">{s.event.photo.caption}</figcaption>
												</figure>
											{/if}
											<p class="tl-name ui">
												<span class="swatch" style:background={p.color}></span>{p.name.split(' ')[1]}, {s.event.year}
											</p>
											<p class="tl-text">{s.event.text}</p>
										</article>
									{/key}
								{/if}
							</div>
						{/each}
					</div>
				</div>
				<div class="stage-steps" aria-hidden="true">
					{#each HOOK_YEARS as y, i (y)}
						<div class="stage-step" data-step={i}></div>
					{/each}
				</div>
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
								<SchoolSearch schools={data.schools} selected={selectedSchool} onselect={(s) => (selectedSchool = s)} />
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

		<!-- 7. APPENDIX: data notes moved out of the story so the charts stay uncluttered -->
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
					<strong>Net worth.</strong> Bezos: Forbes 400 (1999, $7.8 billion, as reported by
					<a href="https://ca.finance.yahoo.com/news/jeff-bezos-money-timeline-see-170013030.html">Yahoo Finance</a>; we
					could not open the original list) and Forbes’ World’s Billionaires lists for 2006, 2020 and 2026. Huang:
					Forbes’ 2020 and 2026 lists. Forbes did not list Huang earlier, so his 1999 and 2006 values
					(marked ≈) estimate his Nvidia shares from Nvidia’s SEC filings: 3.1 million shares at the $12 IPO price
					(<a href="https://www.sec.gov/Archives/edgar/data/1045810/0001012870-99-000192.txt">IPO prospectus, January 1999</a>)
					and 16.9 million shares at $23.13 (<a href="https://www.sec.gov/Archives/edgar/data/1045810/000119312506110604/ddef14a.htm">2006 proxy statement</a>).
					Each bar fills toward that person’s own 2026 net worth ($224 billion for Bezos, $154 billion for Huang), so it
					shows how far along he was, not who was richer; the numbers above the bars compare the two.
				</p>
				<p class="source ui">
					<strong>Tuition</strong> is the published 2017–18 to 2021–22 average from College Scorecard, the same figures as
					the tuition chart; Oregon State’s is the in-state price. Two people are anecdotes, not evidence. They set up the
					question that the rest of the page answers with data.
				</p>
				<p class="source ui"><strong>Photos</strong> (Wikimedia Commons; resized, and some cropped to frame the person):</p>
				<ul class="credits source ui">
					{#each HOOK_CREDITS as [what, author, license, licenseUrl, page] (page)}
						<li>
							<a href={page}>{what}</a> by {author},
							{#if licenseUrl}<a href={licenseUrl}>{license}</a>{:else}{license}{/if}
						</li>
					{/each}
				</ul>
				<p class="back ui"><a href="#hook">↑ Back to the top</a></p>
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

	/* ---- Hook: a pinned stage. The stage never moves; each scroll step advances the story one year. ---- */
	#hook {
		padding-top: 24px;
		--tl-mid: 76px;
	}
	.wrap :global(.hook-scroller) {
		display: grid;
		max-width: 980px;
		margin: 0 auto;
	}
	.hook-stage,
	.stage-steps {
		grid-area: 1 / 1;
		min-width: 0;
	}
	.hook-stage {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 16px;
		height: 100vh;
		height: 100svh;
		padding: 16px 0;
		background: var(--page);
	}
	/* Invisible scroll triggers underneath the stage, one per year */
	.stage-steps {
		pointer-events: none;
	}
	.stage-step {
		height: 60vh;
	}
	/* Extra room after the last year so 2026 stays pinned before the stage scrolls away */
	.stage-step:last-child {
		height: 100vh;
	}
	.stage-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--tl-mid) minmax(0, 1fr);
	}
	.stage-top {
		padding-bottom: 14px;
		border-bottom: 1px solid var(--border);
	}
	.stage-person p {
		margin: 0;
	}
	.stage-person .who {
		font-size: 22px;
		font-weight: 700;
	}
	.stage-person .school {
		margin-top: 2px;
		font-size: 13px;
		color: var(--ink-2);
	}
	.stage-person .worth {
		margin-top: 8px;
		font-family: var(--sans);
		font-size: clamp(28px, 3.6vw, 40px);
		font-weight: 700;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.stage-person .worth-cap {
		font-size: 12px;
		color: var(--ink-2);
	}
	.stage-person .swatch,
	.tl-name .swatch {
		margin-right: 6px;
	}
	.worth-bar {
		height: 8px;
		margin-top: 6px;
		overflow: hidden;
		background: var(--wash);
		border-radius: 4px;
	}
	.worth-bar span {
		display: block;
		height: 100%;
		background: var(--person-color);
		border-radius: 4px;
	}
	.stage-slot {
		min-width: 0;
	}
	/* In a year that doesn't involve this person, their net-worth panel steps back */
	.stage-person.idle {
		opacity: 0.45;
	}
	/* Year line between the two cards (wide screens) */
	.year-line {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: center;
		margin: 0;
		padding: 4px 0;
		list-style: none;
	}
	.year-line::before {
		content: '';
		position: absolute;
		top: 12px;
		bottom: 12px;
		left: calc(50% - 1px);
		width: 2px;
		background: var(--border);
	}
	.year-line li,
	.year-dots li {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		font-size: 11px;
		color: var(--muted);
	}
	.year-line li {
		padding: 2px 0;
		background: var(--page);
	}
	.year-line .dot,
	.year-dots .dot {
		width: 10px;
		height: 10px;
		background: var(--page);
		border: 2px solid var(--axis);
		border-radius: 50%;
	}
	.year-line li.reached .dot,
	.year-dots li.reached .dot {
		background: var(--ink-2);
		border-color: var(--ink-2);
	}
	.year-line li.current,
	.year-dots li.current {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink);
	}
	.year-line li.current .dot,
	.year-dots li.current .dot {
		width: 14px;
		height: 14px;
		background: var(--ink);
		border-color: var(--ink);
		box-shadow:
			0 0 0 3px var(--page),
			0 0 0 5px var(--ink-2);
	}
	/* Only the current year is labeled; the other dots stay as unlabeled progress marks */
	.year-line li:not(.current) .yr,
	.year-dots li:not(.current) .yr {
		visibility: hidden;
	}
	/* Horizontal year dots replace the center line on phones */
	.year-dots {
		display: none;
	}
	.tl-card {
		min-width: 0;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	/* A card disappears in years that don't involve its person; its space stays so the other side doesn't jump */
	.tl-card.away {
		opacity: 0;
		visibility: hidden;
	}
	.tl-card p {
		margin: 0;
	}
	.tl-photo {
		margin: 0 0 10px;
	}
	.tl-photo img {
		display: block;
		width: 100%;
		aspect-ratio: 3 / 2;
		max-height: min(210px, 26vh);
		object-fit: cover;
		background: var(--wash);
		border-radius: 8px;
	}
	.tl-photo figcaption {
		margin-top: 4px;
		font-size: 11.5px;
		line-height: 1.3;
		color: var(--ink-2);
	}
	.tl-name {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.tl-card .tl-text {
		margin-top: 4px;
		font-size: 17px;
		line-height: 1.5;
	}
	@media (prefers-reduced-motion: no-preference) {
		/* No `to` keyframe, so a card created while away fades in to its own (hidden) opacity */
		.tl-card {
			animation: stage-in 350ms ease;
			transition:
				opacity 300ms ease,
				visibility 300ms;
		}
		.stage-person {
			transition: opacity 300ms ease;
		}
		.worth-bar span {
			transition: width 500ms ease;
		}
	}
	@keyframes stage-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
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
	.credits {
		margin: 4px 0 0;
		padding-left: 20px;
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
		/* Hook on phones: year dots move into a row under the net-worth panel; everything shrinks to fit one screen */
		#hook {
			--tl-mid: 10px;
		}
		.hook-stage {
			gap: 10px;
			padding: 10px 0;
		}
		.year-line {
			visibility: hidden;
		}
		.year-dots {
			position: relative;
			display: flex;
			justify-content: space-between;
			margin: 0;
			padding: 0;
			list-style: none;
		}
		.year-dots::before {
			content: '';
			position: absolute;
			top: 6px;
			left: 10px;
			right: 10px;
			height: 2px;
			background: var(--border);
		}
		.year-dots li {
			font-size: 9.5px;
		}
		.year-dots li.current {
			font-size: 11px;
		}
		.stage-person .who {
			font-size: 16px;
		}
		.stage-person .school {
			font-size: 11px;
		}
		.stage-person .school .long {
			display: none;
		}
		/* Reserve two lines so both net-worth numbers line up even when one tuition line wraps */
		.stage-person .school,
		.stage-person .worth-cap {
			line-height: 1.4;
			min-height: 2.8em;
		}
		.stage-person .worth {
			margin-top: 4px;
			font-size: 22px;
		}
		.stage-person .worth-cap {
			font-size: 10.5px;
		}
		.tl-card {
			padding: 9px;
		}
		.tl-photo img {
			max-height: 16svh;
		}
		.tl-photo figcaption {
			font-size: 10px;
		}
		.tl-card .tl-text {
			font-size: 14px;
			line-height: 1.4;
		}
	}
</style>
