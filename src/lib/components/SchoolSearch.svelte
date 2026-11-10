<script>
	// Accessible combobox for adding a college. The chosen colleges live on the page (shown as chips in each
	// filter bar); this field only finds the next one, so it empties after each pick and leaves out colleges
	// already chosen.
	let {
		schools,
		onselect,
		exclude = [], // UNITIDs already chosen
		placeholder = 'Find your college',
		id = 'school-search',
		compact = false // filter-bar version: hidden label, 30px field, × to clear the text
	} = $props();

	let query = $state('');
	let open = $state(false);
	let active = $state(0);

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 2) return [];
		const starts = [];
		const contains = [];
		for (const s of schools) {
			if (exclude.includes(s.unitid)) continue;
			const n = s.name.toLowerCase();
			if (n.startsWith(q)) starts.push(s);
			else if (n.includes(q)) contains.push(s);
			if (starts.length >= 8) break;
		}
		return [...starts, ...contains].slice(0, 8);
	});

	function choose(s) {
		onselect(s);
		query = '';
		open = false;
	}

	function onkeydown(e) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			active = Math.min(active + 1, matches.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Enter' && open && matches[active]) {
			e.preventDefault();
			choose(matches[active]);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="search ui" class:compact>
	<label for={id} class:sr-only={compact}>{placeholder}</label>
	<div class="field">
		<svg class="icon" viewBox="0 0 20 20" width={compact ? 15 : 18} height={compact ? 15 : 18} aria-hidden="true">
			<circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2" />
			<path d="M13 13l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		</svg>
		<input
			{id}
			type="search"
			autocomplete="off"
			{placeholder}
			role="combobox"
			aria-expanded={open && matches.length > 0}
			aria-controls="{id}-list"
			aria-activedescendant={open && matches[active] ? `${id}-${active}` : undefined}
			bind:value={query}
			oninput={() => {
				open = true;
				active = 0;
			}}
			onfocus={() => (open = true)}
			onblur={() => setTimeout(() => (open = false), 120)}
			{onkeydown}
		/>
		{#if query}
			<button class="x" onclick={() => (query = '')} aria-label="Clear the search text" title="Clear the search text">×</button>
		{/if}
	</div>
	{#if open && matches.length}
		<ul id="{id}-list" role="listbox">
			{#each matches as s, i (s.unitid)}
				<li
					id="{id}-{i}"
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					onmousedown={(e) => {
						e.preventDefault();
						choose(s);
					}}
				>
					<span>{s.name}</span><span class="loc">{s.city}, {s.state}</span>
				</li>
			{/each}
		</ul>
	{:else if open && query.trim().length >= 2}
		<p class="none">No match among the {schools.length.toLocaleString()} schools in scope.</p>
	{/if}
</div>

<style>
	.search {
		position: relative;
		font-size: 14px;
		min-width: 0;
	}
	label {
		display: block;
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		margin-bottom: 4px;
	}
	.field {
		position: relative;
		display: flex;
		gap: 6px;
	}
	.icon {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--ink-2);
		pointer-events: none;
	}
	input {
		width: 100%;
		min-width: 0;
		/* 16px also keeps iOS Safari from zooming in on focus */
		font-size: 16px;
		padding: 9px 12px 9px 38px;
		border: 1.5px solid var(--ink-2);
		border-radius: 10px;
	}
	input:focus {
		border-color: var(--ink);
	}
	.compact .icon {
		left: 9px;
	}
	/* Matches the other filter-bar controls: 30px tall, 13px type, light border */
	.compact input {
		box-sizing: border-box;
		height: 30px;
		font-size: 13px;
		padding: 0 30px;
		border: 1px solid var(--axis);
		border-radius: 8px;
	}
	.compact input:focus {
		border-color: var(--ink-2);
	}
	/* The browser's own clear button would sit on top of ours */
	.compact input::-webkit-search-cancel-button {
		display: none;
	}
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
	@media (max-width: 600px) {
		.compact input {
			font-size: 16px;
		}
	}
	ul {
		position: absolute;
		z-index: 20;
		left: 0;
		right: 0;
		margin: 4px 0 0;
		padding: 4px;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
	}
	.compact ul {
		right: auto;
		width: max(100%, min(380px, calc(100vw - 32px)));
	}
	li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 8px;
		border-radius: 6px;
		cursor: pointer;
	}
	li.active,
	li:hover {
		background: var(--wash);
	}
	.loc {
		color: var(--muted);
		white-space: nowrap;
	}
	.none {
		position: absolute;
		margin: 4px 0 0;
		font-size: 13px;
		color: var(--muted);
	}
</style>
