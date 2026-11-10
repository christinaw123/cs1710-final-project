<script>
	// Linked detail for visualization 2: every program in one major, placed by its school's
	// published tuition (same x scale as the histogram) and its reported median earnings
	// (same earnings scale as the major chart).
	import * as d3 from 'd3';
	import { onMount } from 'svelte';
	import { CONTROLS, controlByKey, fmtInt, fmtUSD, fmtUSDk, tuitionOf } from '$lib/data/summarize.js';
	import { createTooltip } from './tooltip.js';
	import { collegePath } from './collegeMarks.js';

	let { points, residency, range, xMax, yDomain, nationalP50, colleges = [] } = $props(); // colleges: chosen, up to three

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
		draw(points, residency, range, colleges, width);
	});

	function draw(points, residency, range, colleges, width) {
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

		// Earnings beyond the fixed axis are drawn at its edge as triangles (▲ above, ▼ below), so a clamped
		// dot never reads as the edge value; the tooltip still gives the real number.
		const edge = (p) => (p.earn > yDomain[1] ? 'up' : p.earn < yDomain[0] ? 'down' : null);
		const fill = (p) => controlByKey.get(p.school.control).color;
		root
			.append('g')
			.selectAll('circle')
			.data(pts.filter((p) => !edge(p)))
			.join('circle')
			.attr('cx', (p) => x(p.t))
			.attr('cy', (p) => y(p.earn))
			.attr('r', 3.5)
			.attr('fill', fill)
			.attr('stroke', 'var(--surface)')
			.attr('stroke-width', 1)
			.attr('opacity', (p) => (inRange(p) ? 0.85 : 0.15));
		const clamped = pts.filter(edge);
		root
			.append('g')
			.selectAll('path')
			.data(clamped)
			.join('path')
			.attr('transform', (p) => `translate(${x(p.t)},${y(p.earn)})${edge(p) === 'down' ? ' rotate(180)' : ''}`)
			.attr('d', d3.symbol(d3.symbolTriangle, 36)())
			.attr('fill', fill)
			.attr('stroke', 'var(--surface)')
			.attr('stroke-width', 1)
			.attr('opacity', (p) => (inRange(p) ? 0.85 : 0.15));
		if (clamped.length) {
			const n = (dir) => clamped.filter((p) => edge(p) === dir).length;
			const part = (dir, sym, word, v) => (n(dir) ? `${sym} ${fmtInt(n(dir))} ${word} ${fmtUSDk(v)}` : null);
			root
				.append('text')
				.attr('x', innerW)
				.attr('y', innerW < 460 ? -6 : -20)
				.attr('text-anchor', 'end')
				.attr('font-size', 11)
				.attr('fill', 'var(--ink-2)')
				.text(`${[part('up', '▲', 'above', yDomain[1]), part('down', '▼', 'below', yDomain[0])].filter(Boolean).join(' · ')}, drawn at the edge`);
		}

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
			// Below the line when a chosen college's label sits on it (e.g. a major with one reporting program)
			const clash = colleges.some((c) => {
				const p = pts.find((q) => q.school.unitid === c.unitid);
				return p && Math.abs(y(p.earn) - y(nationalP50)) < 16;
			});
			root
				.append('text')
				.attr('x', innerW)
				.attr('y', y(nationalP50) + (clash ? 22 : -6))
				.attr('text-anchor', 'end')
				.attr('font-size', 11)
				.attr('fill', 'var(--ink-2)')
				.attr('paint-order', 'stroke')
				.attr('stroke', 'var(--surface)')
				.attr('stroke-width', 4)
				.text(`Median program, all schools: ${fmtUSD(nationalP50)}`);
		}

		// Chosen colleges' programs in this major: the college's shape drawn around its dot, and a label
		const mine = colleges
			.map((c) => ({ c, p: pts.find((q) => q.school.unitid === c.unitid) }))
			.filter((m) => m.p)
			.sort((a, b) => y(a.p.earn) - y(b.p.earn));
		const taken = []; // labels already placed: { toRight, y }
		for (const { c, p } of mine) {
			const mx = x(p.t);
			const my = y(p.earn);
			root
				.append('path')
				.attr('class', 'college-ring')
				.attr('transform', `translate(${mx},${my})`)
				.attr('d', collegePath(c.mark, 300))
				.attr('fill', 'none')
				.attr('stroke', 'var(--ink)')
				.attr('stroke-width', 2);
			// Label on whichever side has more room, with the real earnings (the dot may sit at the clamped edge),
			// shortened to the space it has (about 6.8px per character at 12px bold); a label that would sit on
			// another one moves down a line.
			const right = innerW + margin.right - mx - 14;
			const left = mx + margin.left - 14;
			const toRight = right >= left;
			const value = ` · ${fmtUSD(p.earn)}`;
			const room = Math.floor((toRight ? right : left) / 6.8) - value.length;
			const name = c.name.length > room ? `${c.name.slice(0, Math.max(6, room - 1))}…` : c.name;
			let ly = my + 4;
			while (taken.some((t) => t.toRight === toRight && Math.abs(t.y - ly) < 14)) ly += 14;
			taken.push({ toRight, y: ly });
			root
				.append('text')
				.attr('x', mx + (toRight ? 14 : -14))
				.attr('y', ly)
				.attr('text-anchor', toRight ? 'start' : 'end')
				.attr('font-size', 12)
				.attr('font-weight', 600)
				.attr('fill', 'var(--ink)')
				.attr('paint-order', 'stroke')
				.attr('stroke', 'var(--surface)')
				.attr('stroke-width', 4)
				.text(name + value)
				.append('title')
				.text(`${c.name}${value}`);
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
