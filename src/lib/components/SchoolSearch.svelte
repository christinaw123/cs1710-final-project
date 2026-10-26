<script>
	// Accessible combobox for finding a college among the schools in scope.
	let { schools, selected = null, onselect } = $props();

	let query = $state('');
	let open = $state(false);
	let active = $state(0);
	const id = 'school-search';

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 2) return [];
		const starts = [];
		const contains = [];
		for (const s of schools) {
			const n = s.name.toLowerCase();
			if (n.startsWith(q)) starts.push(s);
			else if (n.includes(q)) contains.push(s);
			if (starts.length >= 8) break;
		}
		return [...starts, ...contains].slice(0, 8);
	});

	function choose(s) {
		onselect(s);
		query = s.name;
		open = false;
	}

	function clear() {
		onselect(null);
		query = '';
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

<div class="search ui">
	<label for={id}>Find a college</label>
	<div class="field">
		<input
			{id}
			type="search"
			autocomplete="off"
			placeholder="Start typing a college name"
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
		{#if selected}
			<button class="btn clear" onclick={clear} aria-label="Clear selected college">Clear</button>
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
	{:else if open && query.trim().length >= 2 && !selected}
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
		font-size: 12px;
		color: var(--ink-2);
		margin-bottom: 4px;
	}
	.field {
		display: flex;
		gap: 6px;
	}
	input {
		width: 100%;
		min-width: 0;
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
