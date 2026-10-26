<script>
	// D3 visualization 1: stacked histogram of schools by average published tuition & fees,
	// with a brush that selects a tuition range shared with the earnings chart.
	import * as d3 from 'd3';
	import { onMount } from 'svelte';
	import { CONTROLS, fmtInt, fmtUSD, fmtUSDk, tuitionOf } from '$lib/data/summarize.js';
	import { createTooltip } from './tooltip.js';

	let { schools, xMax, residency, range, selectedSchool = null, onrange } = $props();

	const BIN = 2500;
	const GAP = 2;
	const height = 300;
	const margin = { top: 34, right: 14, bottom: 46, left: 44 };

	let width = $state(0);
	let svgEl;
	let tooltip;
	let brush;
	let brushWidth = 0;

	// Fixed axes: xMax (from the page) covers both residency modes and y is the tallest bin in
	// either mode, so toggling in-state/out-of-state never rescales the chart.
	function binCounts(mode) {
		const n = xMax / BIN;
		const bins = d3.range(n).map((i) => ({ i, x0: i * BIN, x1: (i + 1) * BIN, counts: { 1: 0, 2: 0, 3: 0 }, total: 0 }));
		for (const s of schools) {
			const t = tuitionOf(s, mode);
			if (t == null) continue;
			const b = bins[Math.min(n - 1, Math.floor(t / BIN))];
			b.counts[s.control] += 1;
			b.total += 1;
		}
		return bins;
	}
	const bins = $derived({ in: binCounts('in'), out: binCounts('out') });
	const yMax = $derived(Math.max(d3.max(bins.in, (b) => b.total), d3.max(bins.out, (b) => b.total)));

	onMount(() => {
		tooltip = createTooltip();
		return () => tooltip.destroy();
	});

	$effect(() => {
		if (!width || !svgEl) return;
		draw(bins[residency], range, selectedSchool, width);
	});

	function segPath(x0, x1, yBottom, yTop, r) {
		const h = yBottom - yTop;
		const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, h));
		return `M${x0},${yBottom}V${yTop + rr}Q${x0},${yTop} ${x0 + rr},${yTop}H${x1 - rr}Q${x1},${yTop} ${x1},${yTop + rr}V${yBottom}Z`;
	}

	function draw(binData, range, selectedSchool, width) {
		const innerW = width - margin.left - margin.right;
		const innerH = height - margin.top - margin.bottom;
		const x = d3.scaleLinear().domain([0, xMax]).range([0, innerW]);
		const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);
		const svg = d3.select(svgEl).attr('width', width).attr('height', height);

		const root = svg
			.selectAll('g.root')
			.data([null])
			.join('g')
			.attr('class', 'root')
			.attr('transform', `translate(${margin.left},${margin.top})`);

		// Y grid + axis
		root
			.selectAll('g.y-axis')
			.data([null])
			.join('g')
			.attr('class', 'y-axis')
			.call(
				d3
					.axisLeft(y)
					.ticks(5)
					.tickSize(-innerW)
					.tickFormat((d) => fmtInt(d))
			)
			.call((g) => g.select('.domain').remove())
			.call((g) => g.selectAll('.tick line').attr('stroke', 'var(--grid)'));
		root
			.selectAll('text.y-label')
			.data([null])
			.join('text')
			.attr('class', 'y-label')
			.attr('x', -margin.left)
			.attr('y', -18)
			.attr('fill', 'var(--ink-2)')
			.attr('font-size', 12)
			.text(`Number of schools in each ${fmtUSD(BIN)} tuition band`);

		// X axis
		root
			.selectAll('g.x-axis')
			.data([null])
			.join('g')
			.attr('class', 'x-axis')
			.attr('transform', `translate(0,${innerH})`)
			.call(
				d3
					.axisBottom(x)
					.tickValues(d3.range(0, xMax + 1, innerW < 420 ? 20000 : 10000))
					.tickFormat(fmtUSDk)
					.tickSizeOuter(0)
			);
		root
			.selectAll('text.x-label')
			.data([null])
			.join('text')
			.attr('class', 'x-label')
			.attr('x', innerW)
			.attr('y', innerH + 38)
			.attr('text-anchor', 'end')
			.attr('fill', 'var(--ink-2)')
			.attr('font-size', 12)
			.text(
				residency === 'out'
					? 'Average published out-of-state tuition & fees per year'
					: 'Average published in-state tuition & fees per year'
			);

		// Stacked bars: Public at the baseline, then private nonprofit, then for-profit.
		const inRange = (b) => !range || (b.x1 > range[0] && b.x0 <= range[1]);
		const segs = [];
		for (const b of binData) {
			let cum = 0;
			const present = CONTROLS.filter((c) => b.counts[c.key] > 0);
			present.forEach((c, j) => {
				const n = b.counts[c.key];
				const yBottom = y(cum) - (j > 0 ? GAP : 0);
				const yTop = Math.min(y(cum + n), yBottom - 1);
				segs.push({ bin: b, control: c, n, yBottom, yTop, isTop: j === present.length - 1 });
				cum += n;
			});
		}
		root
			.selectAll('g.bars')
			.data([null])
			.join('g')
			.attr('class', 'bars')
			.selectAll('path')
			.data(segs, (d) => `${d.bin.i}-${d.control.key}`)
			.join('path')
			.attr('d', (d) =>
				segPath(x(d.bin.x0) + GAP / 2, x(d.bin.x1) - GAP / 2, d.yBottom, d.yTop, d.isTop ? 4 : 0)
			)
			.attr('fill', (d) => d.control.color)
			.attr('opacity', (d) => (inRange(d.bin) ? 1 : 0.22));

		// Selected school marker
		const school = selectedSchool;
		const t = school ? tuitionOf(school, residency) : null;
		const markData = t != null ? [{ school, t }] : [];
		const mark = root
			.selectAll('g.school-mark')
			.data(markData)
			.join((enter) => {
				const g = enter.append('g').attr('class', 'school-mark').attr('pointer-events', 'none');
				g.append('line');
				g.append('path');
				g.append('text').attr('class', 'name');
				return g;
			});
		mark.attr('transform', (d) => `translate(${x(d.t)},0)`);
		mark.select('line').attr('y1', -4).attr('y2', innerH).attr('stroke', 'var(--ink)').attr('stroke-width', 1.5);
		mark.select('path').attr('d', `M0,${innerH}l-6,10h12z`).attr('fill', 'var(--ink)');
		mark
			.select('text.name')
			.attr('y', -8)
			.attr('text-anchor', (d) => (x(d.t) > innerW * 0.6 ? 'end' : 'start'))
			.attr('dx', (d) => (x(d.t) > innerW * 0.6 ? -4 : 4))
			.attr('font-size', 12)
			.attr('font-weight', 600)
			.attr('fill', 'var(--ink)')
			.text((d) => `${truncate(d.school.name, innerW < 420 ? 24 : 40)} · ${fmtUSD(d.t)}`);

		// Brush (re-created when the width changes)
		let brushG = root.select('g.brush');
		if (brushG.empty() || brushWidth !== innerW) {
			brushG.remove();
			brushWidth = innerW;
			brush = d3
				.brushX()
				.extent([
					[0, 0],
					[innerW, innerH]
				])
				.on('brush end', (event) => {
					if (!event.sourceEvent) return; // ignore programmatic moves
					if (!event.selection) return onrange(null);
					const [lo, hi] = event.selection.map((px) => Math.round(x.invert(px) / 100) * 100);
					onrange([Math.max(0, lo), Math.min(xMax, hi)]);
				});
			brushG = root.append('g').attr('class', 'brush').call(brush);
			brushG.select('.selection').attr('fill', 'var(--select)').attr('fill-opacity', 0.08).attr('stroke', 'var(--select)');
			brushG
				.on('pointermove', (event) => {
					const [px] = d3.pointer(event, brushG.node());
					const b = bins[residency][Math.floor(x.invert(px) / BIN)];
					if (!b) return tooltip.hide();
					tooltip.show(
						{
							title: `${fmtUSD(b.x0)} – ${fmtUSD(b.x1 - 1)}`,
							rows: [
								...CONTROLS.map((c) => [c.label, `${fmtInt(b.counts[c.key])} schools`]),
								['All', `${fmtInt(b.total)} schools`]
							],
							note: 'Drag across the chart to select a tuition range.'
						},
						event.clientX,
						event.clientY
					);
				})
				.on('pointerleave', () => tooltip.hide());
		}
		// Keep the brush in sync with the shared range (e.g. after Reset or typed inputs).
		const current = d3.brushSelection(brushG.node());
		if (range) {
			const px = range.map((v) => x(Math.min(v, xMax)));
			if (!current || Math.abs(current[0] - px[0]) > 1 || Math.abs(current[1] - px[1]) > 1) {
				brushG.call(brush.move, px);
			}
		} else if (current) {
			brushG.call(brush.move, null);
		}
		mark.raise();
	}

	function truncate(s, n) {
		return s.length > n ? s.slice(0, n - 1) + '…' : s;
	}

	const ariaLabel = $derived(
		`Histogram of ${schools.length} schools by average published ${residency === 'out' ? 'out-of-state' : 'in-state'} tuition and fees, stacked by public, private nonprofit, and private for-profit.`
	);
</script>

<div class="legend ui" aria-hidden="true">
	{#each CONTROLS as c (c.key)}
		<span class="key"><span class="swatch" style:background={c.color}></span>{c.label}</span>
	{/each}
	{#if selectedSchool}
		<span class="key"><span class="school-key"></span>Your school</span>
	{/if}
</div>
<div class="chart" bind:clientWidth={width}>
	<svg bind:this={svgEl} role="img" aria-label={ariaLabel}></svg>
</div>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		font-size: 13px;
		color: var(--ink-2);
		margin-bottom: 4px;
	}
	.key {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 3px;
	}
	.school-key {
		width: 2px;
		height: 14px;
		background: var(--ink);
	}
	.chart {
		width: 100%;
		min-height: 300px;
	}
	.chart :global(.brush .overlay) {
		cursor: crosshair;
	}
</style>
