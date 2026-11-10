<script>
	// The shape that stands for compared college `index` (diamond, square, triangle), for HTML legends and chips.
	import { collegePath } from './collegeMarks.js';

	let { index = 0, size = 12 } = $props();
</script>

<svg class="college-mark" width={size} height={size} viewBox="-8 -8 16 16" aria-hidden="true">
	<path d={collegePath(index, 70)} fill="var(--surface)" stroke="var(--ink)" stroke-width="2" />
</svg>

<style>
	.college-mark {
		flex: none;
		display: inline-block;
		vertical-align: -1px;
		overflow: visible;
	}
</style>
