<script>
	// Major picker: a button showing the current major that opens a compact, searchable panel (instead of a
	// native <select>, whose list of 300+ majors fills the whole screen). With no search text the panel lists
	// the most common majors first, then every major under its broad field; typing filters by major or field.
	import { tick } from 'svelte';

	let {
		options, // [{ cip, title, family, deg }]
		value = $bindable(), // selected cip
		id,
		compact = false // filter-bar version: 30px trigger, 13px type
	} = $props();

	const TOP_N = 8;

	let open = $state(false);
	let query = $state('');
	let active = $state(0); // index into `flat`
	let root;
	let inputEl = $state(null);
	let listEl = $state(null);
	let alignRight = $state(false); // open toward the left when there's no room on the right

	// The panel can't stick out of a scrolling ancestor (it would be clipped), nor out of the window.
	function roomOnRight() {
		const trigger = root.querySelector('.trigger').getBoundingClientRect();
		let edge = window.innerWidth - 8;
		for (let el = root.parentElement; el && el !== document.body; el = el.parentElement) {
			const o = getComputedStyle(el);
			if (/(auto|scroll|hidden|clip)/.test(o.overflowX)) {
				edge = Math.min(edge, el.getBoundingClientRect().right);
				break;
			}
		}
		const width = Math.max(trigger.width, Math.min(380, window.innerWidth - 32));
		return trigger.left + width <= edge;
	}

	const current = $derived(options.find((o) => o.cip === value));

	// Sections shown in the panel; `flat` is the same items in display order, for keyboard navigation.
	const sections = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (q) {
			const hits = options.filter((o) => o.title.toLowerCase().includes(q) || o.family?.toLowerCase().includes(q));
			// Majors whose own name matches come before ones that only match by field
			hits.sort((a, b) => +!a.title.toLowerCase().includes(q) - +!b.title.toLowerCase().includes(q));
			return hits.length ? [{ name: `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`, items: hits }] : [];
		}
		const top = [...options].sort((a, b) => b.deg - a.deg).slice(0, TOP_N);
		const byFamily = new Map();
		for (const o of options) {
			const f = o.family || 'Other';
			if (!byFamily.has(f)) byFamily.set(f, []);
			byFamily.get(f).push(o);
		}
		const families = [...byFamily].sort((a, b) => a[0].localeCompare(b[0]));
		return [{ name: 'Most common', items: top }, ...families.map(([name, items]) => ({ name, items }))];
	});
	const flat = $derived(sections.flatMap((s) => s.items));

	async function show() {
		alignRight = !roomOnRight();
		open = true;
		query = '';
		await tick();
		active = Math.max(0, flat.findIndex((o) => o.cip === value));
		inputEl?.focus();
		scrollActive('center');
	}
	function hide(refocus = false) {
		open = false;
		if (refocus) root?.querySelector('.trigger')?.focus();
	}
	function choose(o) {
		value = o.cip;
		hide(true);
	}
	async function scrollActive(block = 'nearest') {
		await tick();
		listEl?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block });
	}
	function onkeydown(e) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(0, Math.min(flat.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
			scrollActive();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (flat[active]) choose(flat[active]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			hide(true);
		}
	}
	// Close when focus leaves the whole picker (a click elsewhere, or Tab away)
	function onfocusout(e) {
		if (open && !root.contains(e.relatedTarget)) hide();
	}
	function onpointerdownOutside(e) {
		if (open && !root.contains(e.target)) hide();
	}

	// Bold the part of a title that matches the search
	function parts(title) {
		const q = query.trim();
		const i = q ? title.toLowerCase().indexOf(q.toLowerCase()) : -1;
		return i < 0 ? [title, '', ''] : [title.slice(0, i), title.slice(i, i + q.length), title.slice(i + q.length)];
	}
</script>

<svelte:window onpointerdown={onpointerdownOutside} />

<div class="picker ui" class:compact bind:this={root} {onfocusout} data-value={value}>
	<button
		{id}
		type="button"
		class="trigger"
		aria-haspopup="listbox"
		aria-expanded={open}
		title={current?.title}
		onclick={() => (open ? hide() : show())}
	>
		<span class="current">{current?.title ?? 'Choose a major'}</span>
		<svg class="chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
	</button>

	{#if open}
		<div class="panel" class:right={alignRight} role="dialog" aria-label="Choose a major">
			<div class="search">
				<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
					<circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2" />
					<path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
				</svg>
				<input
					bind:this={inputEl}
					type="search"
					autocomplete="off"
					placeholder="Search {options.length} majors or fields"
					role="combobox"
					aria-expanded="true"
					aria-controls="{id}-list"
					aria-activedescendant={flat[active] ? `${id}-opt-${active}` : undefined}
					bind:value={query}
					oninput={() => {
						active = 0;
						listEl?.scrollTo({ top: 0 });
					}}
					{onkeydown}
				/>
			</div>
			<div class="list" id="{id}-list" role="listbox" bind:this={listEl}>
				{#each sections as sec (sec.name)}
					{@const offset = flat.indexOf(sec.items[0])}
					<div role="group" aria-label={sec.name}>
						<p class="group" aria-hidden="true">{sec.name}</p>
						{#each sec.items as o, j (o.cip)}
							{@const i = offset + j}
							{@const [a, m, b] = parts(o.title)}
							<!-- Keyboard use goes through the search box (arrows + Enter, aria-activedescendant), as in a standard combobox -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								id="{id}-opt-{i}"
								data-i={i}
								tabindex="-1"
								role="option"
								aria-selected={o.cip === value}
								class="opt"
								class:active={i === active}
								class:selected={o.cip === value}
								onpointermove={() => (active = i)}
								onmousedown={(e) => e.preventDefault()}
								onclick={() => choose(o)}
							>
								<span class="check" aria-hidden="true">{o.cip === value ? '✓' : ''}</span>
								<span class="t">{a}<strong>{m}</strong>{b}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="none">No major matches “{query.trim()}”.</p>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		min-width: 0;
		font-size: 14px;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		height: 36px;
		padding: 0 10px;
		font: inherit;
		color: var(--ink);
		text-align: left;
		background: var(--surface);
		border: 1px solid var(--axis);
		border-radius: 8px;
		cursor: pointer;
	}
	.trigger:hover,
	.trigger[aria-expanded='true'] {
		border-color: var(--ink-2);
	}
	.compact .trigger {
		height: 30px;
		font-size: 13px;
		padding: 0 8px;
	}
	.current {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.chev {
		flex: none;
		color: var(--ink-2);
	}

	/* The panel: a fixed, modest height that scrolls, never the whole screen */
	.panel {
		position: absolute;
		z-index: 30;
		top: calc(100% + 4px);
		left: 0;
		width: max(100%, min(380px, calc(100vw - 32px)));
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
		overflow: hidden;
	}
	.panel.right {
		left: auto;
		right: 0;
	}
	.search {
		position: relative;
		padding: 8px;
		border-bottom: 1px solid var(--border);
	}
	.search svg {
		position: absolute;
		left: 18px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--ink-2);
		pointer-events: none;
	}
	.search input {
		box-sizing: border-box;
		width: 100%;
		height: 32px;
		padding: 0 10px 0 30px;
		font-size: 13px;
		border: 1px solid var(--axis);
		border-radius: 7px;
	}
	.search input:focus {
		outline: none;
		border-color: var(--ink-2);
	}
	.list {
		max-height: min(340px, 50vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0 4px 6px;
	}
	/* Field headings stay pinned while their majors scroll past */
	.group {
		position: sticky;
		top: 0;
		z-index: 1;
		margin: 0;
		padding: 8px 8px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ink-3);
		background: var(--surface);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.opt {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 6px 8px;
		font-size: 13px;
		line-height: 1.3;
		color: var(--ink);
		border-radius: 6px;
		cursor: pointer;
	}
	.opt.active {
		background: var(--wash);
	}
	.opt.selected {
		font-weight: 600;
	}
	.opt strong {
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.check {
		flex: none;
		width: 12px;
		color: var(--accent);
	}
	.none {
		margin: 0;
		padding: 14px 8px;
		font-size: 13px;
		color: var(--muted);
	}
	@media (max-width: 600px) {
		/* 16px keeps iOS Safari from zooming in on focus */
		.search input {
			font-size: 16px;
		}
	}
</style>
