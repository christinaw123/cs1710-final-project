<script>
	// Thin Scrollama wrapper. The parent owns the step state (bind:step); Scrollama callbacks only
	// write the index of the step crossing the trigger line. Children mark steps with [data-step].
	// If Scrollama cannot load, step stays null and the steps read as ordinary text.
	import { onMount } from 'svelte';

	let {
		step = $bindable(null),
		offset = 0.5, // trigger line (fraction of viewport height) on wide screens
		narrowOffset = 0.8, // on narrow screens the text sits below the sticky graphic
		children,
		...rest
	} = $props();

	let root;

	onMount(() => {
		let scroller;
		let cancelled = false;
		const narrow = window.matchMedia('(max-width: 899px)');
		const currentOffset = () => (narrow.matches ? narrowOffset : offset);
		const onResize = () => scroller?.resize();
		const onBreakpoint = () => scroller?.offset(currentOffset());

		import('scrollama')
			.then(({ default: scrollama }) => {
				if (cancelled) return;
				scroller = scrollama()
					.setup({ step: root.querySelectorAll('[data-step]'), offset: currentOffset() })
					.onStepEnter(({ index }) => (step = index))
					.onStepExit(({ index, direction }) => {
						// Scrolling back above the first step returns to the un-narrated state.
						if (index === 0 && direction === 'up') step = null;
					});
				window.addEventListener('resize', onResize);
				narrow.addEventListener('change', onBreakpoint);
			})
			.catch((error) => {
				console.warn('Scrollama unavailable; showing the narrative without scroll effects.', error);
				step = null;
			});

		return () => {
			cancelled = true;
			window.removeEventListener('resize', onResize);
			narrow.removeEventListener('change', onBreakpoint);
			scroller?.destroy();
		};
	});
</script>

<div bind:this={root} {...rest}>
	{@render children()}
</div>
