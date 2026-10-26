<script>
	// D3 visualization 2: for each major, the spread of programs' reported median earnings
	// across colleges (middle 50% interval + median program), all schools vs. the selected
	// tuition range, with the share of bachelor's degrees alongside.
	import * as d3 from 'd3';
	import { onMount, untrack } from 'svelte';
	import { MIN_PROGRAMS_FOR_INTERVAL, fmtInt, fmtPct, fmtUSD, fmtUSDk } from '$lib/data/summarize.js';
	import { createTooltip } from './tooltip.js';

	let {
		rows, // [{ cip, title, nat, sel }] in display order; nat/sel are summarizeMajors entries
		hasRange,
		xDomain,
		shareMax,
		rowHeight = 38, // wide layout row height; the page shrinks it so the chart fits a sticky slot
		emphasis = null, // scroll-story highlight: CIPs kept at full strength; other rows dimmed, not removed
		selectedMajor = null,
		schoolEarn = null, // Map cip -> { earn, note } for the searched school
		schoolName = null,
		onselect
	} = $props();

	let width = $state(0);
	let svgEl;
	let tooltip;

	// Narrow screens use compact one-line rows so the whole chart fits beside the story text.
	const compact = $derived(width < 640);
	const rowH = $derived(compact ? 24 : Math.max(28, Math.min(38, rowHeight)));
	const axisTop = 30;
	const axisBottom = 40;
	const height = $derived(axisTop + rows.length * rowH + axisBottom);

	onMount(() => {
		tooltip = createTooltip();
		return () => tooltip.destroy();
	});

	$effect(() => {
		if (!width || !svgEl) return;
		draw(rows, hasRange, selectedMajor, schoolEarn, width, height, compact, rowH);
	});

	// Emphasis only toggles classes on existing rows, so story steps never redraw the chart.
	$effect(() => applyEmphasis(emphasis));

	function applyEmphasis(cips) {
		if (!svgEl) return;
		d3.select(svgEl)
			.selectAll('g.row')
			.classed('dimmed', (d) => !!cips && !cips.includes(d.cip))
			.classed('emph', (d) => !!cips && cips.includes(d.cip));
	}

	function truncate(s, n) {
		return s.length > n ? s.slice(0, n - 1) + '…' : s;
	}

	function draw(rows, hasRange, selectedMajor, schoolEarn, width, height, compact, rowH) {
		const labelW = compact ? Math.max(110, Math.min(170, width * 0.36)) : Math.min(250, Math.max(170, width * 0.27));
		const shareW = compact ? 0 : 104;
		const plotX0 = compact ? labelW + 12 : labelW + shareW + 24;
		const plotX1 = width - 14;
		const x = d3.scaleLinear().domain(xDomain).range([plotX0, plotX1]).clamp(true);
		const share = d3.scaleLinear().domain([0, shareMax]).range([0, shareW - 44]).clamp(true);
		const trackY = rowH / 2; // vertical center of the earnings marks within a row
		const twoLineLabels = !compact && rowH >= 32;
		const svg = d3.select(svgEl).attr('width', width).attr('height', height);
		svg.selectAll('*').remove();

		const ticks = x.ticks(width < 480 ? 4 : 7);
		// Vertical gridlines + axes
		svg
			.append('g')
			.selectAll('line')
			.data(ticks)
			.join('line')
			.attr('x1', (d) => x(d))
			.attr('x2', (d) => x(d))
			.attr('y1', axisTop)
			.attr('y2', height - axisBottom)
			.attr('stroke', 'var(--grid)');
		svg
			.append('g')
			.attr('transform', `translate(0,${axisTop})`)
			.call(d3.axisTop(x).tickValues(ticks).tickFormat(fmtUSDk).tickSize(0).tickPadding(8))
			.call((g) => g.select('.domain').remove());
		svg
			.append('g')
			.attr('transform', `translate(0,${height - axisBottom})`)
			.call(d3.axisBottom(x).tickValues(ticks).tickFormat(fmtUSDk).tickSizeOuter(0))
			.call((g) => g.select('.domain').attr('stroke', 'var(--axis)'));
		svg
			.append('text')
			.attr('x', plotX1)
			.attr('y', height - 6)
			.attr('text-anchor', 'end')
			.attr('font-size', 12)
			.attr('fill', 'var(--ink-2)')
			.text(width < 480 ? 'Program median earnings, 1 yr (2024 $)' : "Programs' median earnings 1 year after graduating (2024 $)");
		if (!compact) {
			svg
				.append('text')
				.attr('x', labelW + 8)
				.attr('y', axisTop - 10)
				.attr('font-size', 12)
				.attr('fill', 'var(--ink-2)')
				.text('Share of degrees');
		}

		const row = svg
			.append('g')
			.selectAll('g.row')
			.data(rows, (d) => d.cip)
			.join('g')
			.attr('class', 'row')
			.attr('data-cip', (d) => d.cip)
			.attr('transform', (_, i) => `translate(0,${axisTop + i * rowH})`);

		// Hit target / selection highlight spans the full row
		row
			.append('rect')
			.attr('class', 'hit')
			.attr('width', width)
			.attr('height', rowH)
			.attr('rx', 6)
			.attr('fill', (d) => (d.cip === selectedMajor ? 'var(--select-wash)' : 'transparent'))
			.attr('tabindex', 0)
			.attr('role', 'button')
			.attr('aria-label', (d) => `${d.title}: show programs in this major`)
			.style('cursor', 'pointer')
			.on('click', (_, d) => onselect(d.cip))
			.on('keydown', (event, d) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onselect(d.cip);
				}
			})
			.on('pointermove', (event, d) => tooltip.show(tooltipContent(d, hasRange), event.clientX, event.clientY))
			.on('pointerleave', () => tooltip.hide())
			.on('focus', function (event, d) {
				const r = this.getBoundingClientRect();
				tooltip.show(tooltipContent(d, hasRange), r.left + plotX0, r.bottom);
			})
			.on('blur', () => tooltip.hide());

		const g = row.append('g').attr('class', 'marks').attr('pointer-events', 'none');

		// Labels
		g.append('text')
			.attr('x', 8)
			.attr('y', twoLineLabels ? rowH / 2 - 3 : rowH / 2 + 4)
			.attr('font-size', compact ? 11.5 : 13)
			.attr('font-weight', (d) => (d.cip === selectedMajor ? 700 : 500))
			.attr('fill', 'var(--ink)')
			.text((d) => truncate(d.title, Math.floor(labelW / (compact ? 6.3 : 6.9))));
		if (twoLineLabels) {
			g.append('text')
				.attr('x', 8)
				.attr('y', rowH / 2 + 11)
				.attr('font-size', 11)
				.attr('fill', 'var(--muted)')
				.text((d) => {
					const n = (hasRange ? d.sel : d.nat)?.n ?? 0;
					return `${fmtInt(n)} program${n === 1 ? '' : 's'} report earnings`;
				});
		}

		// Degree share bars (wide layout; compact rows show share in the tooltip and story labels)
		if (!compact) {
			const sx = labelW + 8;
			g.append('rect')
				.attr('x', sx)
				.attr('y', rowH / 2 - (hasRange ? 7 : 4))
				.attr('height', hasRange ? 5 : 8)
				.attr('width', (d) => share(d.nat.share ?? 0))
				.attr('rx', 2)
				.attr('fill', hasRange ? 'var(--band-national)' : 'var(--ink-2)');
			if (hasRange) {
				g.append('rect')
					.attr('x', sx)
					.attr('y', rowH / 2 + 1)
					.attr('height', 5)
					.attr('width', (d) => share(d.sel?.share ?? 0))
					.attr('rx', 2)
					.attr('fill', 'var(--select)');
			}
			g.append('text')
				.attr('x', (d) => sx + share(Math.max(d.nat.share ?? 0, hasRange ? (d.sel?.share ?? 0) : 0)) + 5)
				.attr('y', rowH / 2 + 4)
				.attr('font-size', 11)
				.attr('fill', 'var(--ink-2)')
				.style('font-variant-numeric', 'tabular-nums')
				.text((d) => fmtPct(hasRange ? (d.sel?.share ?? 0) : d.nat.share));
		}

		// Earnings: all schools
		const natBandH = compact ? 8 : hasRange ? 12 : 10;
		const nat = g.filter((d) => d.nat.n >= MIN_PROGRAMS_FOR_INTERVAL);
		nat.append('rect')
			.attr('x', (d) => x(d.nat.p25))
			.attr('width', (d) => Math.max(2, x(d.nat.p75) - x(d.nat.p25)))
			.attr('y', trackY - natBandH / 2)
			.attr('height', natBandH)
			.attr('rx', 3)
			.attr('fill', hasRange ? 'var(--band-national)' : 'var(--ink-2)')
			.attr('fill-opacity', hasRange ? 1 : 0.32);
		nat.append('circle')
			.attr('cx', (d) => x(d.nat.p50))
			.attr('cy', trackY)
			.attr('r', compact ? 4 : 4.5)
			.attr('fill', hasRange ? 'var(--surface)' : 'var(--ink)')
			.attr('stroke', hasRange ? 'var(--band-national-ink)' : 'var(--surface)')
			.attr('stroke-width', 2);
		smallSample(g.filter((d) => d.nat.n > 0 && d.nat.n < MIN_PROGRAMS_FOR_INTERVAL), (d) => d.nat, hasRange ? 'var(--band-national-ink)' : 'var(--ink)');
		g.filter((d) => d.nat.n === 0)
			.append('text')
			.attr('x', plotX0)
			.attr('y', trackY + 4)
			.attr('font-size', 11)
			.attr('fill', 'var(--muted)')
			.text('No program reports earnings');

		// Earnings: selected tuition range
		if (hasRange) {
			const sel = g.filter((d) => d.sel && d.sel.n >= MIN_PROGRAMS_FOR_INTERVAL);
			sel.append('rect')
				.attr('x', (d) => x(d.sel.p25))
				.attr('width', (d) => Math.max(2, x(d.sel.p75) - x(d.sel.p25)))
				.attr('y', trackY - 2)
				.attr('height', 4)
				.attr('rx', 2)
				.attr('fill', 'var(--select)');
			sel.append('circle')
				.attr('cx', (d) => x(d.sel.p50))
				.attr('cy', trackY)
				.attr('r', compact ? 4.5 : 5)
				.attr('fill', 'var(--select)')
				.attr('stroke', 'var(--surface)')
				.attr('stroke-width', 2);
			smallSample(g.filter((d) => d.sel && d.sel.n > 0 && d.sel.n < MIN_PROGRAMS_FOR_INTERVAL), (d) => d.sel, 'var(--select)');
			g.filter((d) => !d.sel || d.sel.n === 0)
				.append('text')
				.attr('x', plotX1)
				.attr('y', trackY + 4)
				.attr('text-anchor', 'end')
				.attr('font-size', 11)
				.attr('fill', 'var(--ink-2)')
				.text('none reported in range');
		}

		// Values beyond the fixed axis are clamped to the edge and flagged with a chevron.
		const over = [];
		for (const d of rows) {
			for (const s of [d.nat, hasRange ? d.sel : null]) {
				if (!s || !s.n) continue;
				// Flag only marks that are actually drawn at the edge: the interval/median, or the
				// individual circles shown for small samples.
				const drawn = s.n >= MIN_PROGRAMS_FOR_INTERVAL ? [s.p25, s.p50, s.p75] : s.earn;
				if (drawn.some((v) => v > xDomain[1] || v < xDomain[0])) over.push(d.cip);
			}
		}
		g.filter((d) => over.includes(d.cip))
			.append('path')
			.attr('d', `M${plotX1 + 3},${trackY - 4}l4,4l-4,4`)
			.attr('fill', 'none')
			.attr('stroke', 'var(--muted)')
			.attr('stroke-width', 1.5);

		// Searched school's program in this major
		if (schoolEarn) {
			g.filter((d) => schoolEarn.get(d.cip)?.earn != null)
				.append('path')
				.attr('transform', (d) => `translate(${x(schoolEarn.get(d.cip).earn)},${trackY})`)
				.attr('d', d3.symbol(d3.symbolDiamond, 90)())
				.attr('fill', 'var(--surface)')
				.attr('stroke', 'var(--ink)')
				.attr('stroke-width', 2);
		}

		// Direct labels for the median program (all schools), shown only on rows a story step emphasizes.
		g.filter((d) => d.nat.n >= MIN_PROGRAMS_FOR_INTERVAL)
			.append('text')
			.attr('class', 'value-label')
			.each(function (d) {
				const text = compact ? fmtUSD(d.nat.p50) : `${fmtUSD(d.nat.p50)} median program`;
				const fits = x(d.nat.p75) + 8 + text.length * 6.2 <= plotX1;
				d3.select(this)
					.attr('x', fits ? x(Math.min(d.nat.p75, xDomain[1])) + 8 : x(Math.max(d.nat.p25, xDomain[0])) - 8)
					.attr('text-anchor', fits ? 'start' : 'end')
					.text(text);
			})
			.attr('y', trackY + 4)
			.attr('font-size', 11.5)
			.attr('font-weight', 700)
			.attr('fill', 'var(--ink)')
			.attr('paint-order', 'stroke')
			.attr('stroke', 'var(--surface)')
			.attr('stroke-width', 4);

		applyEmphasis(untrack(() => emphasis));

		function smallSample(sel, get, color) {
			sel.each(function (d) {
				d3.select(this)
					.selectAll('circle.small')
					.data(get(d).earn)
					.join('circle')
					.attr('class', 'small')
					.attr('cx', (v) => x(v))
					.attr('cy', trackY)
					.attr('r', 3.5)
					.attr('fill', 'none')
					.attr('stroke', color)
					.attr('stroke-width', 1.5);
			});
		}
	}

	function tooltipContent(d, hasRange) {
		const describe = (s) =>
			s && s.n >= MIN_PROGRAMS_FOR_INTERVAL
				? `${fmtUSD(s.p50)} (middle 50%: ${fmtUSDk(s.p25)}–${fmtUSDk(s.p75)})`
				: s && s.n > 0
					? `${s.n} program${s.n === 1 ? '' : 's'} only`
					: 'not reported';
		const rows = [
			['Median program, all schools', describe(d.nat)],
			['Programs reporting, all schools', fmtInt(d.nat.n)],
			['Share of degrees, all schools', fmtPct(d.nat.share)]
		];
		if (hasRange) {
			rows.push(
				['Median program, selected range', describe(d.sel)],
				['Programs reporting, selected range', fmtInt(d.sel?.n ?? 0)],
				['Share of degrees, selected range', fmtPct(d.sel?.share ?? 0)]
			);
		}
		if (d.earn_nat != null) rows.push(['All graduates nationally (Scorecard)', fmtUSD(d.earn_nat)]);
		const school = schoolEarn?.get(d.cip);
		if (schoolName && school) {
			rows.push([
				truncate(schoolName, 32),
				school.earn != null ? fmtUSD(school.earn) : school.note === 'DUP' ? 'shown at another campus' : 'suppressed'
			]);
		}
		return {
			title: d.title,
			rows,
			note: `Earnings reported for programs holding ${fmtPct((hasRange ? d.sel?.coverage : d.nat.coverage) ?? 0, 0)} of this major's degrees${hasRange ? ' in the range' : ''}. Click to see every program.`
		};
	}
</script>

<div class="chart" bind:clientWidth={width}>
	<svg bind:this={svgEl} role="group" aria-label="Earnings by major: one row per major"></svg>
</div>

<style>
	.chart {
		width: 100%;
	}
	.chart :global(rect.hit:hover) {
		fill: var(--wash);
	}
	.chart :global(rect.hit:focus-visible) {
		outline: none;
		stroke: var(--accent);
		stroke-width: 2;
	}
	/* Story emphasis: dimmed rows stay in place (and stay hoverable), they are not filtered out. */
	.chart :global(g.row.dimmed > g.marks) {
		opacity: 0.2;
	}
	.chart :global(g.row .value-label) {
		opacity: 0;
	}
	.chart :global(g.row.emph .value-label) {
		opacity: 1;
	}
	@media (prefers-reduced-motion: no-preference) {
		.chart :global(g.row > g.marks),
		.chart :global(g.row .value-label) {
			transition: opacity 250ms ease;
		}
	}
</style>
