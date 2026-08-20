<script lang="ts">
	import AppShell from "$lib/components/AppShell.svelte";
	import Login from "$lib/components/Login.svelte";
	import RoseMark from "$lib/components/RoseMark.svelte";
	import { start, mx } from "$lib/matrix/client.svelte";
	import { onMount } from "svelte";

	onMount(() => {
		void start();
	});
</script>

{#if mx.phase === "starting"}
	<div class="splash">
		<RoseMark size={200} />
		<p class="faint">Opening the greenhouse…</p>
	</div>
{:else if mx.phase === "login"}
	<Login />
{:else if mx.phase === "connecting"}
	<div class="splash">
		<div class="pulse"><RoseMark size={200} /></div>
		<p class="faint">Syncing with {mx.homeserver}…</p>
		<p class="faint small">First sync on a busy account can take a moment.</p>
	</div>
{:else}
	<AppShell />
{/if}

<style>
	.splash {
		height: 100%;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 6px;
		background: var(--backdrop);
		text-align: center;
	}

	.pulse {
		animation: breathe 1.8s ease-in-out infinite;
	}

	.small {
		font-size: 12px;
	}

	p {
		margin: 0;
	}

	@keyframes breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
</style>
