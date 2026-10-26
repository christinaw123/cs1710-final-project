<script>
	// Linked detail for visualization 2: every program in one major, placed by its school's
	// published tuition (same x scale as the histogram) and its reported median earnings
	// (same earnings scale as the major chart).
	import * as d3 from 'd3';
	import { onMount } from 'svelte';
	import { CONTROLS, controlByKey, fmtInt, fmtUSD, fmtUSDk, tuitionOf } from '$lib/data/summarize.js';
	import { createTooltip } from './tooltip.js';

	let { points, residency, range, xMax, yDomain, nationalP50, selectedSchool = null } = $props();

	const height = 398;
	const margin = { top: 34, right: 16, bottom: 46, left: 56 };
	let width = $state(0);
	let svgEl;
	let tooltip;

	onMount(() => {
		tooltip = createTooltip();
		return () => tooltip.destroy();
	});

	$effect(() => {
		if (!width || !svgEl) return;
		draw(points, residency, range, selectedSchool, width);
	});

	function draw(points, residency, range, selectedSchool, width) {
		const innerW = width - margin.left - margin.right;
		const innerH = height - margin.top - margin.bottom;
		const x = d3.scaleLinear().domain([0, xMax]).range([0, innerW]);
		const y = d3.scaleLinear().domain(yDomain).range([innerH, 0]).clamp(true);
		const svg = d3.select(svgEl).attr('width', width).attr('height', height);
		svg.selectAll('*').remove();
		const root = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

		root
			.append('g')
			.call(d3.axisLeft(y).ticks(6).tickFormat(fmtUSDk).tickSize(-innerW))
			.call((g) => g.select('.domain').remove());
		root
			.append('g')
			.attr('transform', `translate(0,${innerH})`)
			.call(
				d3
					.axisBottom(x)
					.tickValues(d3.range(0, xMax + 1, innerW < 420 ? 20000 : 10000))
					.tickFormat(fmtUSDk)
					.tickSizeOuter(0)
			)
			.call((g) => g.select('.domain').attr('stroke', 'var(--axis)'));
		root
			.append('text')
			.attr('x', innerW)
			.attr('y', innerH + 38)
			.attr('text-anchor', 'end')
			.attr('font-size', 12)
			.attr('fill', 'var(--ink-2)')
			.text(`School's average published ${residency === 'out' ? 'out-of-state' : 'in-state'} tuition & fees`);
		root
			.append('text')
			.attr('x', -margin.left)
			.attr('y', -20)
			.attr('font-size', 12)
			.attr('fill', 'var(--ink-2)')
			.text("Program's median earnings, 1 yr");

		if (range) {
			root
				.append('rect')
				.attr('x', x(range[0]))
				.attr('width', Math.max(1, x(Math.min(range[1], xMax)) - x(range[0])))
				.attr('height', innerH)
				.attr('fill', 'var(--select-wash)');
		}

		const pts = points
			.map((p) => ({ ...p, t: tuitionOf(p.school, residency) }))
			.filter((p) => p.t != null);
		const inRange = (p) => !range || (p.t >= range[0] && p.t <= range[1]);

		root
			.append('g')
			.selectAll('circle')
			.data(pts)
			.join('circle')
			.attr('cx', (p) => x(p.t))
			.attr('cy', (p) => y(p.earn))
			.attr('r', 3.5)
			.attr('fill', (p) => controlByKey.get(p.school.control).color)
			.attr('stroke', 'var(--surface)')
			.attr('stroke-width', 1)
			.attr('opacity', (p) => (inRange(p) ? 0.85 : 0.15));

		// Reference: the median program in this major, all schools
		if (nationalP50 != null) {
			root
				.append('line')
				.attr('x1', 0)
				.attr('x2', innerW)
				.attr('y1', y(nationalP50))
				.attr('y2', y(nationalP50))
				.attr('stroke', 'var(--ink-2)')
				.attr('stroke-width', 1);
			root
				.append('text')
				.attr('x', innerW)
				.attr('y', y(nationalP50) - 6)
				.attr('text-anchor', 'end')
				.attr('font-size', 11)
				.attr('fill', 'var(--ink-2)')
				.attr('paint-order', 'stroke')
				.attr('stroke', 'var(--surface)')
				.attr('stroke-width', 4)
				.text(`Median program, all schools: ${fmtUSD(nationalP50)}`);
		}

		const mine = selectedSchool ? pts.find((p) => p.school.unitid === selectedSchool.unitid) : null;
		if (mine) {
			const mx = x(mine.t);
			const my = y(mine.earn);
			root
				.append('circle')
				.attr('cx', mx)
				.attr('cy', my)
				.attr('r', 8)
				.attr('fill', 'none')
				.attr('stroke', 'var(--ink)')
				.attr('stroke-width', 2);
			root
				.append('text')
				.attr('x', mx + (mx > innerW * 0.6 ? -12 : 12))
				.attr('y', my + 4)
				.attr('text-anchor', mx > innerW * 0.6 ? 'end' : 'start')
				.attr('font-size', 12)
				.attr('font-weight', 600)
				.attr('fill', 'var(--ink)')
				.attr('paint-order', 'stroke')
				.attr('stroke', 'var(--surface)')
				.attr('stroke-width', 4)
				.text(selectedSchool.name);
		}

		// Nearest-point hover layer (dots are small; the pointer only needs to be closest).
		const delaunay = d3.Delaunay.from(
			pts,
			(p) => x(p.t),
			(p) => y(p.earn)
		);
		const hover = root.append('circle').attr('r', 6).attr('fill', 'none').attr('stroke', 'var(--ink)').attr('stroke-width', 1.5).attr('visibility', 'hidden');
		root
			.append('rect')
			.attr('width', innerW)
			.attr('height', innerH)
			.attr('fill', 'transparent')
			.on('pointermove', (event) => {
				const [mx, my] = d3.pointer(event);
				const i = delaunay.find(mx, my);
				const p = pts[i];
				if (p == null || Math.hypot(x(p.t) - mx, y(p.earn) - my) > 24) {
					hover.attr('visibility', 'hidden');
					return tooltip.hide();
				}
				hover.attr('cx', x(p.t)).attr('cy', y(p.earn)).attr('visibility', 'visible');
				tooltip.show(
					{
						title: p.school.name,
						rows: [
							['Median earnings, 1 yr', fmtUSD(p.earn)],
							['Graduates with earnings counted', fmtInt(p.n_wne)],
							['Published tuition & fees', fmtUSD(p.t)],
							['Bachelor’s degrees (2 yrs)', fmtInt(p.deg)],
							['Type', CONTROLS.find((c) => c.key === p.school.control).label]
						],
						note: `${p.school.city}, ${p.school.state}${p.earn > yDomain[1] || p.earn < yDomain[0] ? ' · drawn at the edge of the axis' : ''}`
					},
					event.clientX,
					event.clientY
				);
			})
			.on('pointerleave', () => {
				hover.attr('visibility', 'hidden');
				tooltip.hide();
			});
	}
</script>

<div class="chart" bind:clientWidth={width}>
	<svg bind:this={svgEl} role="img" aria-label="Scatter plot of programs in the selected major by tuition and earnings"></svg>
</div>

<style>
	.chart {
		width: 100%;
		min-height: 380px;
	}
</style>
