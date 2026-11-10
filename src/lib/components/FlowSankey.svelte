<script>
	// D3 visualization 3: a Sankey of bachelor's degrees flowing from the price of the college (fifths of
	// schools by published in-state tuition) to the field studied to the program's early-earnings band.
	// All flows stay in gray; a highlight (story step, clicked node, or the brushed tuition range) is drawn
	// on top in ink as the part of each flow that belongs to it.
	import * as d3 from 'd3';
	import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
	import { onMount, untrack } from 'svelte';
	import { bandShares, flowLinks, fmtInt, fmtPct } from '$lib/data/summarize.js';
	import { createTooltip } from './tooltip.js';

	let {
		flow, // flowData(): { rows, brackets, fields, bands }
		highlight = null, // { keep(row) -> bool, nodes: Set of node ids, shares?: false } or null
		picked = null, // node id the reader clicked (drawn with a ring)
		height = 440,
		onpick // (nodeId) => void
	} = $props();

	let width = $state(0);
	let svgEl;
	let tooltip;
	let graph = null; // last laid-out sankey graph, reused by the highlight layer

	const compact = $derived(width < 560);
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

	const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1); // keeps "$39.2K" intact
	const nodeName = (n) =>
		n.col === 0 ? n.data.name : n.col === 1 ? (compact ? n.data.compact : n.data.name) : n.data.name;

	function draw(flow, allLinks, width, height, compact) {
		const labelL = compact ? 82 : 132;
		const labelR = compact ? 86 : 124;
		const top = 30;
		const nodes = [
			...flow.brackets.map((d) => ({ id: `b${d.key}`, col: 0, data: d })),
			...flow.fields.map((d) => ({ id: `f${d.key}`, col: 1, data: d })),
			...flow.bands.map((d) => ({ id: `e${d.key}`, col: 2, data: d }))
		];
		const links = [...allLinks].map(([id, value]) => {
			const [source, target] = id.split('|');
			return { id, source, target, value };
		});
		graph = sankey()
			.nodeId((d) => d.id)
			.nodeWidth(compact ? 9 : 12)
			.nodePadding(compact ? 7 : 10)
			.nodeSort(null) // keep cheapest→priciest, largest field→Other, lowest pay→not reported
			.extent([
				[labelL, top],
				[width - labelR, height - 4]
			])({ nodes, links });
		// On phones the field labels sit between the middle and right columns, so move the middle column left
		// to give them room. Links follow automatically: they are drawn from the nodes' x positions.
		if (compact) {
			const x0 = Math.round(labelL + 0.25 * (width - labelR - labelL));
			for (const n of graph.nodes.filter((n) => n.col === 1)) {
				const w = n.x1 - n.x0;
				n.x0 = x0;
				n.x1 = x0 + w;
			}
		}

		const svg = d3.select(svgEl).attr('width', width).attr('height', height);
		svg.selectAll('*').remove();

		// Column headings
		const heads = [
			[labelL - 7, 'end', compact ? 'Price (in-state)' : 'College price (in-state)'],
			[(graph.nodes.find((n) => n.col === 1).x0 + graph.nodes.find((n) => n.col === 1).x1) / 2, 'middle', compact ? 'Field' : 'Field of study'],
			[width - labelR + 6, 'start', compact ? 'Pay, 1 yr out' : 'Pay 1 year out']
		];
		svg.append('g')
			.selectAll('text')
			.data(heads)
			.join('text')
			.attr('x', (d) => d[0])
			.attr('y', 12)
			.attr('text-anchor', (d) => d[1])
			.attr('font-size', compact ? 11 : 12)
			.attr('font-weight', 600)
			.attr('fill', 'var(--ink-2)')
			.text((d) => d[2]);

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
			.attr('aria-label', (d) => `${nodeName(d)}${d.col === 0 ? `, ${d.data.range}` : ''}: ${fmtInt(d.value)} degrees. Highlight its graduates.`)
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
			.attr('x', (d) => (d.col === 0 ? d.x0 - 7 : d.x1 + 6))
			.attr('y', (d) => (d.y0 + d.y1) / 2)
			.attr('text-anchor', (d) => (d.col === 0 ? 'end' : 'start'))
			.attr('font-size', compact ? 11 : 12.5);
		label.append('tspan').attr('class', 'name').attr('font-weight', 600).text(nodeName);
		// Second line: price range (left) or the highlighted share (right, filled by applyHighlight)
		label.filter((d) => d.col !== 1)
			.append('tspan')
			.attr('class', (d) => (d.col === 0 ? 'sub' : 'sub share'))
			.attr('x', (d) => (d.col === 0 ? d.x0 - 7 : d.x1 + 6))
			.attr('dy', '1.15em')
			.text((d) => (d.col === 0 ? d.data.range : ''));
		// Vertically center one- or two-line labels on the bar
		label.attr('dy', (d) => (d.col === 1 ? '0.35em' : '-0.2em'));
	}

	function applyHighlight(hl, picked) {
		if (!svgEl || !graph) return;
		const svg = d3.select(svgEl);
		const sub = hl ? flowLinks(flow.rows, hl.keep) : null;
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const linkH = (d) => Math.max(1, d.width);
		// The highlighted part of a flow is drawn along the top edge of that flow, at its share of the width.
		const part = (d) => (sub?.get(d.id) ?? 0) / d.value;
		const path = (d) => {
			const w = linkH(d) * part(d);
			const dy = -linkH(d) / 2 + w / 2;
			return d3.linkHorizontal()({ source: [d.source.x1, d.y0 + dy], target: [d.target.x0, d.y1 + dy] });
		};

		svg.select('g.base').classed('muted', !!hl);
		const ink = svg
			.select('g.ink')
			.selectAll('path')
			.data(hl ? graph.links.filter((d) => part(d) > 0) : [], (d) => d.id)
			.join('path')
			.attr('d', path);
		(reduce ? ink : ink.transition().duration(300)).attr('stroke-width', (d) => Math.max(0.75, linkH(d) * part(d)));

		svg.selectAll('g.node')
			.classed('on', (d) => !!hl?.nodes.has(d.id))
			.classed('picked', (d) => d.id === picked);

		// Right-hand labels show where the highlighted degrees end up
		// (hidden when several groups are highlighted together, since one share would blend them)
		const shares = hl && hl.shares !== false ? bandShares(flow.rows, hl.keep) : null;
		svg.selectAll('tspan.share').text((d) =>
			shares && shares[d.data.key] != null ? `${fmtPct(shares[d.data.key], 0)}${d.data.key === 4 ? ' of degrees' : ''}` : ''
		);
	}

	function nodeTip(d) {
		const share = (d.value / totalDeg) || 0;
		const rows = [
			["Bachelor's degrees, 2020–22", fmtInt(d.value)],
			['Share of all degrees', fmtPct(share)]
		];
		if (d.col === 0) rows.unshift(['Colleges', `${fmtInt(d.data.schools)} (${d.data.range})`]);
		if (d.col !== 2) {
			const s = bandShares(flow.rows, d.col === 0 ? (r) => r.b === d.data.key : (r) => r.f === d.data.key);
			rows.push([`Pay ${flow.bands[3].name}`, fmtPct(s[3], 0)], [`Pay ${lowerFirst(flow.bands[0].name)}`, fmtPct(s[0], 0)]);
		}
		return {
			title: d.col === 0 ? `${d.data.name} of colleges by price` : d.col === 2 ? `Pay ${lowerFirst(d.data.name)}` : nodeName(d),
			rows,
			note: `Click to highlight ${d.col === 2 ? 'the degrees that end here' : 'its graduates'}.${d.col === 1 && d.data.key !== 'other' ? ' Also selects its most common major in the earnings chart below.' : ''}`
		};
	}

	function linkTip(d) {
		const from = d.source.col === 0 ? `${d.source.data.name} (${d.source.data.range})` : nodeName(d.source);
		return {
			title: `${from} → ${d.target.col === 2 ? `pay ${lowerFirst(d.target.data.name)}` : nodeName(d.target)}`,
			rows: [
				["Bachelor's degrees", fmtInt(d.value)],
				[`Share of ${from}'s degrees`, fmtPct(d.value / d.source.value)]
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
		stroke: var(--ink);
		stroke-opacity: 0.62;
	}
	.chart :global(g.node) {
		cursor: pointer;
		outline: none;
	}
	.chart :global(g.node .bar) {
		fill: var(--ink-2);
	}
	.chart :global(g.node.on .bar) {
		fill: var(--ink);
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
		fill: var(--ink-2);
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
