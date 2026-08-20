<script lang="ts">
	import "../app.css";
	import { initTheme } from "$lib/theme/theme.svelte";

	// Before the first paint, so nobody sees a flash of the default palette.
	initTheme();

	let { children } = $props();
</script>

{@render children()}
