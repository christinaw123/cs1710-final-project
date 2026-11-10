<script>
	// The reader's filters (college, public-school price, tuition range). The same bar sits above every chart,
	// step 1 included, but each copy lists only the filters that change its chart (`show`). The page owns the
	// state, so a change in any copy shows up in all of them.
	// Where the price toggle only matters through the tuition range (it decides which colleges fall in the
	// range), it is not listed on its own: the range chip names it and its editor holds the toggle.
	// On phones the bar can fold into a one-line summary to save room in the sticky chart panels.
	import { tick } from 'svelte';
	import SchoolSearch from './SchoolSearch.svelte';
	import CollegeMark from './CollegeMark.svelte';
	import { MAX_COLLEGES } from './collegeMarks.js';
	import { fmtInt, fmtUSDk } from '$lib/data/summarize.js';

	let {
		idPrefix, // unique per copy, for the inputs' ids
		show = ['college', 'price', 'tuition'], // the filters that change this chart
		searchId = undefined, // id for the college search (defaults to `${idPrefix}-school`)
		schools,
		colleges = [], // chosen colleges, in order: [{ unitid, name, mark }] (name already says which one, if shared)
		onschool, // (school) => void: add a college
		onremoveschool, // (unitid) => void
		residency,
		onresidency, // ('in' | 'out') => void
		range = null,
		onrange, // ([lo, hi] | null) => void
		xMax,
		count = null, // schools in the range
		collapsible = true, // fold into a summary line on phones
		children = null // extra controls for this chart, shown after the shared ones
	} = $props();

	const hasCollege = $derived(show.includes('college'));
	const hasPrice = $derived(show.includes('price'));
	const hasTuition = $derived(show.includes('tuition'));
	const priceInRange = $derived(hasTuition && !hasPrice);

	let open = $state(false);
	let editing = $state(false);
	let rangeEl = $state(null);

	async function openEditor() {
		editing = true;
		await tick();
		rangeEl?.querySelector('input')?.focus();
	}
	// The editor folds back into the chip once focus leaves it (the inputs' change events have already fired).
	// Only focus leaving the editor's own controls counts: Chromium also reports a focus-out when the clicked
	// chip is swapped for the inputs, which must not close them again.
	function closeIfLeft(e) {
		if (editing && e.target.closest('.editor') && !rangeEl.contains(e.relatedTarget)) editing = false;
	}
	function onRangeKey(e) {
		if (e.key === 'Enter') e.currentTarget.dispatchEvent(new Event('change', { bubbles: true }));
		else if (e.key === 'Escape') {
			editing = false;
			tick().then(() => rangeEl?.querySelector('.tuition')?.focus());
		}
	}

	// Same rules as the brush: an empty pair clears the range, an inverted one is ignored.
	function setRange(lo, hi, input) {
		if (lo === '' && hi === '') return onrange(null);
		const a = Number(lo);
		const b = Number(hi);
		if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
			input.value = range ? range[input.dataset.end === 'lo' ? 0 : 1] : '';
			return;
		}
		onrange([Math.max(0, a), Math.min(xMax, b)]);
	}

	const resLabel = $derived(residency === 'out' ? 'Out-of-state' : 'In-state');
	const rangeLabel = $derived(range ? `${fmtUSDk(range[0])}–${fmtUSDk(range[1])}` : 'any');
	const countLabel = $derived(range && count != null ? `${fmtInt(count)} ${count === 1 ? 'school' : 'schools'}` : '');
</script>

{#snippet priceToggle()}
	<div class="segmented res" role="group" aria-label="Public schools’ price">
		<button aria-pressed={residency === 'in'} onclick={() => onresidency('in')}>In-state</button>
		<button aria-pressed={residency === 'out'} onclick={() => onresidency('out')}>Out-of-state</button>
	</div>
{/snippet}

<div class="fb-wrap">
<div class="filter-bar ui" class:collapsible class:open class:has-colleges={hasCollege && colleges.length} role="group" aria-label="Filters for this chart" data-testid="{idPrefix}-filters">
	{#if collapsible}
		<button class="summary" aria-expanded={open} aria-controls="{idPrefix}-filter-controls" onclick={() => (open = !open)}>
			<span class="title">Filters</span>
			<span class="sum-text">
				{#if hasCollege}<span class:on={colleges.length}
						>{colleges.length ? `${colleges[0].name}${colleges.length > 1 ? ` + ${colleges.length - 1} more` : ''}` : 'No college'}</span
					>{/if}
				{#if hasPrice}<span class="sep">{resLabel}</span>{/if}
				{#if hasTuition}<span class="sep" class:on={range}
						>{range ? `Tuition ${rangeLabel}${priceInRange ? ` ${resLabel.toLowerCase()}` : ''}` : 'Any tuition'}</span
					>{/if}
			</span>
			<span class="edit">{open ? 'Done' : 'Edit'}</span>
		</button>
	{/if}
	<div class="controls" id="{idPrefix}-filter-controls">
		{#if hasCollege}
			{#each colleges as c (c.unitid)}
				<span class="college-chip" title={c.name}>
					<CollegeMark index={c.mark} />
					<span class="chip-name">{c.name}</span>
					<button class="x" aria-label="Remove {c.name}" title="Remove {c.name}" onclick={() => onremoveschool(c.unitid)}>×</button>
				</span>
			{/each}
		{/if}
		{#if hasCollege && colleges.length < MAX_COLLEGES}
			<div class="college">
				<SchoolSearch
					id={searchId ?? `${idPrefix}-school`}
					compact
					{schools}
					exclude={colleges.map((c) => c.unitid)}
					placeholder={colleges.length ? 'Compare another college' : 'Find your college'}
					onselect={onschool}
				/>
			</div>
		{/if}
		{#if hasPrice}{@render priceToggle()}{/if}
		{#if hasTuition}
			<!-- The range reads as a chip and opens into inputs, so the whole bar fits on one line -->
			<div class="range" class:editing bind:this={rangeEl} onfocusout={closeIfLeft}>
				{#if editing}
					<div class="editor" role="group" aria-label="Tuition range">
						<span class="range-label" aria-hidden="true">Tuition</span>
						<label>
							<span aria-hidden="true">$</span><span class="sr-only">Tuition from</span>
							<input
								id="{idPrefix}-range-lo"
								data-end="lo"
								type="number"
								min="0"
								step="500"
								placeholder="any"
								value={range ? range[0] : ''}
								onchange={(e) => setRange(e.currentTarget.value, range ? range[1] : xMax, e.currentTarget)}
								onkeydown={onRangeKey}
							/>
						</label>
						<span aria-hidden="true">–</span>
						<label>
							<span aria-hidden="true">$</span><span class="sr-only">to</span>
							<input
								id="{idPrefix}-range-hi"
								data-end="hi"
								type="number"
								min="0"
								step="500"
								placeholder="any"
								value={range ? range[1] : ''}
								onchange={(e) => setRange(range ? range[0] : 0, e.currentTarget.value, e.currentTarget)}
								onkeydown={onRangeKey}
							/>
						</label>
						{#if priceInRange}{@render priceToggle()}{/if}
						<button class="done" onclick={() => (editing = false)}>Done</button>
					</div>
				{:else}
					<div class="field" class:has-x={range}>
						<button
							class="tuition"
							class:on={range}
							data-testid="{idPrefix}-tuition"
							onclick={openEditor}
							title="Change the tuition range"
						>
							<span class="range-label">Tuition</span>
							<strong>{rangeLabel}</strong>
							{#if range && priceInRange}<span class="res-note">{resLabel.toLowerCase()}</span>{/if}
							{#if countLabel}<span class="count">· {countLabel}</span>{/if}
						</button>
						{#if range}
							<button class="x" aria-label="Clear the tuition range" title="Clear the tuition range" onclick={() => onrange(null)}>×</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		{@render children?.()}
	</div>
</div>
</div>

<style>
	/* The wrapper spans the chart's width, so its size decides what fits; the bar itself hugs its controls */
	.fb-wrap {
		position: relative;
		z-index: 4; /* the college list drops down over the chart below */
		container-type: inline-size;
	}
	.filter-bar {
		/* One look for every control in the bar: same height, border, corner and type size */
		--ctl-h: 30px;
		--ctl-border: 1px solid var(--axis);
		--ctl-radius: 8px;
		width: fit-content;
		max-width: 100%;
		margin: 0 0 10px;
		padding: 7px 10px;
		font-size: 13px;
		color: var(--ink-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	/* One row, so the bar can hug its controls (Chrome sizes a wrapping row by its widest item); a range being
	   edited wraps inside its own box instead. Only narrow columns let the controls wrap. */
	.controls {
		display: flex;
		align-items: center;
		gap: 8px 10px;
	}
	@container (max-width: 640px) {
		.filter-bar {
			width: auto;
		}
		.controls {
			flex-wrap: wrap;
		}
	}
	.title {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
	}
	/* A chosen college: its shape, its name (shortened, full name on hover) and a remove button */
	.college-chip {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 6px;
		max-width: 220px;
		height: var(--ctl-h);
		padding: 0 30px 0 9px;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		background: var(--surface);
		border: var(--ctl-border);
		border-radius: var(--ctl-radius);
	}
	.chip-name {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	/* With college chips the bar spans its column and wraps, so up to three colleges always fit */
	.has-colleges {
		width: auto;
	}
	.has-colleges .controls {
		flex-wrap: wrap;
	}
	.has-colleges .college {
		flex-basis: 200px;
	}
	.college {
		flex: 1 1 260px;
		min-width: 170px;
		max-width: 300px;
	}
	/* The price switch and the range chip keep their size; the college field is the one that gives way */
	.segmented.res,
	.range:not(.editing) {
		flex-shrink: 0;
	}
	.segmented.res button {
		white-space: nowrap;
	}
	.segmented.res {
		height: var(--ctl-h);
		border: var(--ctl-border);
		border-radius: var(--ctl-radius);
	}
	.segmented.res button {
		padding: 0 10px;
		font-size: 13px;
	}
	.segmented.res button + button {
		border-left: var(--ctl-border);
	}
	.range,
	.editor {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.range-label {
		font-weight: 600;
		color: var(--ink);
	}
	.field {
		position: relative;
	}
	.tuition {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: var(--ctl-h);
		padding: 0 10px;
		font-size: 13px;
		color: var(--ink-2);
		white-space: nowrap;
		background: var(--surface);
		border: var(--ctl-border);
		border-radius: var(--ctl-radius);
		cursor: pointer;
	}
	.has-x .tuition {
		padding-right: 30px;
	}
	.tuition:hover,
	.done:hover {
		border-color: var(--ink-2);
	}
	.tuition strong {
		font-weight: 500;
		color: var(--muted);
	}
	.tuition.on strong {
		font-weight: 600;
		color: var(--ink);
	}
	.count {
		font-variant-numeric: tabular-nums;
	}
	/* In narrow chart columns the range's school count gives way first, so the college name stays readable */
	@container (max-width: 680px) {
		.tuition .count {
			display: none;
		}
	}
	/* Clear button inside the right edge of a control, the same as the college search's */
	.x {
		position: absolute;
		right: 4px;
		top: 50%;
		transform: translateY(-50%);
		width: 22px;
		height: 22px;
		padding: 0;
		font-size: 16px;
		line-height: 1;
		color: var(--ink-2);
		background: transparent;
		border: 0;
		border-radius: 999px;
		cursor: pointer;
	}
	.x:hover {
		color: var(--ink);
		background: var(--wash);
	}
	.editor label {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.editor input {
		width: 80px;
		height: var(--ctl-h);
		padding: 0 8px;
		font-size: 13px;
		border: var(--ctl-border);
		border-radius: var(--ctl-radius);
	}
	.done {
		height: var(--ctl-h);
		padding: 0 12px;
		font-size: 13px;
		font-weight: 600;
		background: var(--surface);
		border: var(--ctl-border);
		border-radius: var(--ctl-radius);
		cursor: pointer;
	}
	.summary {
		display: none;
	}

	@media (max-width: 600px) {
		.filter-bar {
			width: auto;
		}
		/* 16px keeps iOS Safari from zooming in when an input is focused */
		.editor input {
			font-size: 16px;
		}
		.college {
			flex-basis: 100%;
			max-width: none;
		}
		/* Up to three college chips share one row on a phone; the full names are in the table and legends */
		.college-chip {
			flex: 0 1 auto;
			min-width: 0;
			max-width: calc((100% - 20px) / 3);
		}
		/* Phones: a one-line summary that opens the controls */
		.collapsible {
			padding: 0;
		}
		.collapsible .summary {
			display: flex;
			align-items: center;
			gap: 8px;
			width: 100%;
			padding: 6px 10px;
			font-size: 13px;
			text-align: left;
			color: var(--ink-2);
			background: transparent;
			border: 0;
			cursor: pointer;
		}
		.sum-text {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}
		.sum-text .sep:not(:first-child)::before {
			content: ' · ';
		}
		.sum-text .on {
			font-weight: 600;
			color: var(--ink);
		}
		.edit {
			padding: 1px 9px;
			font-weight: 600;
			color: var(--ink);
			border: var(--ctl-border);
			border-radius: var(--ctl-radius);
		}
		.collapsible .controls {
			display: none;
			padding: 4px 10px 10px;
		}
		.collapsible.open .controls {
			display: flex;
		}
	}
</style>
