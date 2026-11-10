<script>
	// D3 visualization 3: a Sankey of bachelor's degrees flowing from the price of the college (quarters of
	// schools by published in-state tuition, the same four percentile buckets as the pay bands) to the field studied to the program's early-earnings band.
	// Both outer columns run high to low (priciest and best-paid on top) and are labeled by percentile,
	// with the dollar range as a caption underneath.
	// All flows stay in gray; a highlight (story step, clicked node, or the brushed tuition range) is drawn
	// on top, in color, as the part of each flow that belongs to it. Up to two groups can be highlighted at
	// once, each in its own color (--hl-1 violet, --hl-2 magenta).
	import * as d3 from 'd3';
	import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
	import { onMount, untrack } from 'svelte';
	import { bandShares, flowLinks, fmtInt, fmtPct } from '$lib/data/summarize.js';
	import { createTooltip } from './tooltip.js';

	let {
		flow, // flowData(): { rows, brackets, fields, bands }
		highlight = null, // { groups: [{ node: id | null, keep(row) -> bool }] } or null; one color per group
		picked = null, // node id the reader clicked (drawn with a ring)
		height = 440,
		onpick // (nodeId) => void
	} = $props();

	let width = $state(0);
	let svgEl;
	let tooltip;
	let graph = null; // last laid-out sankey graph, reused by the highlight layer

	const compact = $derived(width < 560);
	// Under 300px (a 320px phone) the middle labels would run into the pay column: smaller type, tighter margins
	const tiny = $derived(width < 300);
	const allLinks = $derived(flowLinks(flow.rows));
	const totalDeg = $derived(d3.sum(flow.rows, (r) => r.deg));

	onMount(() => {
		tooltip = createTooltip();
		return () => tooltip.destroy();
	});

	$effect(() => {
		if (!width || !svgEl) return;
		draw(flow, allLinks, width, height, compact);
		applyHighlight(untrack(() => highlight), untrack(() => picked));
	});

	// Highlights only redraw the ink layer and labels, never the layout.
	$effect(() => applyHighlight(highlight, picked));

	// Font sizes: group names, their dollar captions, and the column headings
	const type = $derived(
		tiny ? { name: 10, cap: 9, head: 10 } : compact ? { name: 11, cap: 9.5, head: 11 } : { name: 12.5, cap: 10.5, head: 12 }
	);
	// Short label on the chart: a percentile range for price groups and pay bands (the headings say "percentile")
	const nodeName = (n) => (n.col === 1 && compact ? n.data.compact : n.data.name);
	// Full name for tooltips and screen readers
	const longName = (n) =>
		n.col === 0
			? `${n.data.name} price percentile (${n.data.range})`
			: n.col === 1
				? nodeName(n)
				: n.data.range
					? `${n.data.name} pay percentile (${n.data.range})`
					: 'pay not reported';

	function draw(flow, allLinks, width, height, compact) {
		const labelL = tiny ? 70 : compact ? 82 : 132;
		const labelR = tiny ? 70 : compact ? 86 : 124;
		const top = compact ? 34 : 36; // room for two-line column headings
		// Priciest colleges and highest pay at the top. "Not reported" stays at the bottom, off the pay scale.
		const nodes = [
			...[...flow.brackets].reverse().map((d) => ({ id: `b${d.key}`, col: 0, data: d })),
			...flow.fields.map((d) => ({ id: `f${d.key}`, col: 1, data: d })),
			...[...flow.bands.slice(0, 4).reverse(), flow.bands[4]].map((d) => ({ id: `e${d.key}`, col: 2, data: d }))
		];
		const links = [...allLinks].map(([id, value]) => {
			const [source, target] = id.split('|');
			return { id, source, target, value };
		});
		graph = sankey()
			.nodeId((d) => d.id)
			.nodeWidth(compact ? 9 : 12)
			.nodePadding(compact ? 7 : 10)
			.nodeSort(null) // keep the order above: priciest→cheapest, largest field→Other, highest pay→not reported
			.extent([
				[labelL, top],
				[width - labelR, height - 4]
			])({ nodes, links });
		// On phones the field labels sit between the middle and right columns, so move the middle column left
		// to give them room. Links follow automatically: they are drawn from the nodes' x positions.
		if (compact) {
			const x0 = Math.round(labelL + (tiny ? 0.16 : 0.25) * (width - labelR - labelL));
			for (const n of graph.nodes.filter((n) => n.col === 1)) {
				const w = n.x1 - n.x0;
				n.x0 = x0;
				n.x1 = x0 + w;
			}
		}

		const svg = d3.select(svgEl).attr('width', width).attr('height', height);
		svg.selectAll('*').remove();

		// Column headings, with "percentile" as a caption under the price and pay columns
		const mid = graph.nodes.find((n) => n.col === 1);
		const heads = [
			{ x: labelL - 7, anchor: 'end', title: tiny ? 'In-state price' : compact ? 'Price (in-state)' : 'College price (in-state)', sub: 'percentile' },
			{ x: (mid.x0 + mid.x1) / 2, anchor: 'middle', title: compact ? 'Field' : 'Field of study', sub: null },
			{ x: width - labelR + 6, anchor: 'start', title: compact ? 'Pay, 1 yr out' : 'Pay 1 year out', sub: 'percentile' }
		];
		const head = svg
			.append('g')
			.attr('class', 'heads')
			.selectAll('text')
			.data(heads)
			.join('text')
			.attr('text-anchor', (d) => d.anchor);
		head.append('tspan')
			.attr('x', (d) => d.x)
			.attr('y', 12)
			.attr('font-size', type.head)
			.attr('font-weight', 600)
			.attr('fill', 'var(--ink-2)')
			.text((d) => d.title);
		head.filter((d) => d.sub)
			.append('tspan')
			.attr('x', (d) => d.x)
			.attr('y', 12 + type.cap * 1.35)
			.attr('font-size', type.cap)
			.attr('fill', 'var(--ink-3)')
			.text((d) => d.sub);

		// Base flows (all degrees) in gray
		svg.append('g')
			.attr('class', 'base')
			.attr('fill', 'none')
			.selectAll('path')
			.data(graph.links, (d) => d.id)
			.join('path')
			.attr('d', sankeyLinkHorizontal())
			.attr('stroke-width', (d) => Math.max(1, d.width))
			.on('pointermove', (event, d) => tooltip.show(linkTip(d), event.clientX, event.clientY))
			.on('pointerleave', () => tooltip.hide());

		// Highlight layer (filled in by applyHighlight)
		svg.append('g').attr('class', 'ink').attr('fill', 'none').attr('pointer-events', 'none');

		// Nodes: bar + label, clickable and keyboard-focusable
		const node = svg
			.append('g')
			.selectAll('g.node')
			.data(graph.nodes, (d) => d.id)
			.join('g')
			.attr('class', 'node')
			.attr('data-node', (d) => d.id)
			.attr('tabindex', 0)
			.attr('role', 'button')
			.attr('aria-label', (d) => `${longName(d)}: ${fmtInt(d.value)} degrees. Highlight its graduates.`)
			.on('click', (_, d) => onpick(d.id))
			.on('keydown', (event, d) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onpick(d.id);
				}
			})
			.on('pointermove', (event, d) => tooltip.show(nodeTip(d), event.clientX, event.clientY))
			.on('pointerleave', () => tooltip.hide())
			.on('focus', function (_, d) {
				const r = this.getBoundingClientRect();
				tooltip.show(nodeTip(d), r.right, r.bottom);
			})
			.on('blur', () => tooltip.hide());

		// Generous invisible hit area covering the bar and its label
		node.append('rect')
			.attr('class', 'hit')
			.attr('x', (d) => (d.col === 0 ? 0 : d.x0 - 2))
			.attr('y', (d) => d.y0 - 2)
			.attr('width', (d) => (d.col === 0 ? d.x1 + 2 : d.col === 1 ? d.x1 - d.x0 + 4 + (compact ? 70 : 120) : width - d.x0))
			.attr('height', (d) => Math.max(14, d.y1 - d.y0 + 4))
			.attr('fill', 'transparent');
		node.append('rect')
			.attr('class', 'bar')
			.attr('x', (d) => d.x0)
			.attr('y', (d) => d.y0)
			.attr('width', (d) => d.x1 - d.x0)
			.attr('height', (d) => Math.max(1.5, d.y1 - d.y0))
			.attr('rx', 2);

		const label = node
			.append('text')
			.attr('class', 'label')
			.attr('text-anchor', (d) => (d.col === 0 ? 'end' : 'start'))
			.attr('font-size', type.name);
		label.append('tspan').attr('class', 'name').attr('font-weight', 600).text(nodeName);
		// Dollar range under each price group and pay band, in caption type
		label.filter((d) => d.data.range)
			.append('tspan')
			.attr('class', 'sub')
			.attr('font-size', type.cap)
			.text((d) => d.data.range);
		// Under each pay band, the highlighted degrees' share (filled by applyHighlight)
		label.filter((d) => d.col === 2).append('tspan').attr('class', 'share');
		label.selectAll('tspan').attr('x', (d) => (d.col === 0 ? d.x0 - 7 : d.x1 + 6));
		stackLabels(label);
	}

	// Stacks each label's non-empty lines (name, caption, share) and centers the block on its bar.
	function stackLabels(labels) {
		labels.each(function (d) {
			const lines = [...this.querySelectorAll('tspan')].filter((t) => t.textContent);
			const size = (t) => (t.classList.contains('sub') ? type.cap : type.name);
			const lineH = (t) => size(t) * (t.classList.contains('sub') ? 1.3 : 1.2);
			let y = (d.y0 + d.y1) / 2 - d3.sum(lines, lineH) / 2;
			for (const t of lines) {
				t.setAttribute('y', y + lineH(t) / 2 + 0.35 * size(t));
				y += lineH(t);
			}
		});
	}

	function applyHighlight(hl, picked) {
		if (!svgEl || !graph) return;
		const svg = d3.select(svgEl);
		const groups = hl?.groups ?? [];
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const linkH = (d) => Math.max(1, d.width);
		// Each group's part of a flow is drawn along the top edge of that flow at its share of the width,
		// stacked below any earlier group's part, so overlapping groups never cover each other.
		const segs = [];
		const used = new Map(); // link id -> share of its width already drawn
		groups.forEach((g, gi) => {
			const sub = flowLinks(flow.rows, g.keep);
			for (const d of graph.links) {
				const part = (sub.get(d.id) ?? 0) / d.value;
				if (part <= 0) continue;
				const before = used.get(d.id) ?? 0;
				used.set(d.id, before + part);
				segs.push({ key: `${gi}|${d.id}`, gi, d, part, before });
			}
		});
		const path = (s) => {
			const h = linkH(s.d);
			const dy = -h / 2 + h * s.before + (h * s.part) / 2;
			return d3.linkHorizontal()({ source: [s.d.source.x1, s.d.y0 + dy], target: [s.d.target.x0, s.d.y1 + dy] });
		};

		svg.select('g.base').classed('muted', groups.length > 0);
		const ink = svg
			.select('g.ink')
			.selectAll('path')
			.data(segs, (s) => s.key)
			.join('path')
			.attr('d', path)
			.attr('stroke', (s) => `var(--hl-${s.gi + 1})`);
		(reduce ? ink : ink.transition().duration(300)).attr('stroke-width', (s) => Math.max(0.75, linkH(s.d) * s.part));

		// Highlighted nodes take their group's color, so each color sits next to its own label.
		const groupOf = (id) => groups.findIndex((g) => g.node === id);
		svg.selectAll('g.node')
			.classed('on', (d) => groupOf(d.id) >= 0)
			.classed('picked', (d) => d.id === picked)
			.select('.bar')
			.style('fill', (d) => (groupOf(d.id) >= 0 ? `var(--hl-${groupOf(d.id) + 1})` : null));

		// Right-hand labels show where the highlighted degrees end up (only for a single group, since one
		// share would blend two groups together)
		const shares = groups.length === 1 ? bandShares(flow.rows, groups[0].keep) : null;
		svg.selectAll('tspan.share').text((d) =>
			shares && shares[d.data.key] != null ? `${fmtPct(shares[d.data.key], 0)}${d.data.key === 4 ? ' of degrees' : ''}` : ''
		);
		stackLabels(svg.selectAll('g.node .label'));
	}

	function nodeTip(d) {
		const share = (d.value / totalDeg) || 0;
		const rows = [
			["Bachelor's degrees, 2020–22", fmtInt(d.value)],
			['Share of all degrees', fmtPct(share)]
		];
		if (d.col === 0) rows.unshift(['Colleges', `${fmtInt(d.data.schools)} (${d.data.range})`]);
		if (d.col === 2 && d.data.range) rows.unshift(['Program median pay', d.data.range]);
		if (d.col !== 2) {
			const s = bandShares(flow.rows, d.col === 0 ? (r) => r.b === d.data.key : (r) => r.f === d.data.key);
			rows.push(
				[`Pay in the ${flow.bands[3].name} percentile`, fmtPct(s[3], 0)],
				[`Pay in the ${flow.bands[0].name} percentile`, fmtPct(s[0], 0)]
			);
		}
		return {
			title:
				d.col === 0
					? `Colleges in the ${d.data.name} percentile by price`
					: d.col === 2
						? d.data.range ? `Pay in the ${d.data.name} percentile` : 'Pay not reported'
						: nodeName(d),
			rows,
			note: `Click to highlight ${d.col === 2 ? 'the degrees that end here' : 'its graduates'}.${d.col === 1 && d.data.key !== 'other' ? ' Also selects its most common major in the earnings chart below.' : ''}`
		};
	}

	function linkTip(d) {
		return {
			title: `${longName(d.source)} → ${longName(d.target)}`,
			rows: [
				["Bachelor's degrees", fmtInt(d.value)],
				[`Share of ${d.source.col === 0 ? 'these colleges' : nodeName(d.source)}'s degrees`, fmtPct(d.value / d.source.value)]
			]
		};
	}
</script>

<div class="chart" bind:clientWidth={width} style:min-height="{height}px">
	<svg bind:this={svgEl} role="group" aria-label="Flow of bachelor's degrees from college price, to field of study, to early pay"></svg>
</div>

<style>
	.chart {
		width: 100%;
	}
	.chart :global(g.base path) {
		stroke: var(--band-national);
		stroke-opacity: 0.85;
	}
	.chart :global(g.base path:hover) {
		stroke: var(--band-national-ink);
	}
	.chart :global(g.base.muted path) {
		stroke-opacity: 0.55;
	}
	.chart :global(g.ink path) {
		stroke-opacity: 0.88;
	}
	.chart :global(g.node) {
		cursor: pointer;
		outline: none;
	}
	.chart :global(g.node .bar) {
		fill: var(--ink-2);
	}
	.chart :global(g.node .label) {
		fill: var(--ink);
		paint-order: stroke;
		stroke: var(--surface);
		stroke-width: 4px;
		stroke-linejoin: round;
	}
	.chart :global(g.node .sub) {
		font-weight: 400;
		fill: var(--ink-3);
	}
	.chart :global(g.node .share) {
		font-weight: 700;
		fill: var(--ink);
	}
	.chart :global(g.node.on .name) {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.chart :global(g.node:hover .bar),
	.chart :global(g.node.picked .bar) {
		fill: var(--ink);
	}
	.chart :global(g.node:focus-visible .bar) {
		stroke: var(--accent);
		stroke-width: 2px;
	}
</style>
