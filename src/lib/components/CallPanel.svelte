<script lang="ts">
	import {
		answerCall,
		call,
		callDuration,
		hangUp,
		rejectCall,
		streams,
		toggleCamera,
		toggleMute,
		toggleScreenshare
	} from "$lib/matrix/call.svelte";

	let remoteVideo: HTMLVideoElement | null = $state(null);
	let localVideo: HTMLVideoElement | null = $state(null);
	let remoteAudio: HTMLAudioElement | null = $state(null);

	/*
	 * Streams are attached to elements rather than passed as a `src`.
	 *
	 * A MediaStream has no URL — `srcObject` is the only way to hand one to a
	 * media element, and it has to happen after the element exists, which is
	 * why this is an effect rather than an attribute.
	 */
	$effect(() => {
		const remote = streams.remote;
		if (remoteVideo) remoteVideo.srcObject = remote;
		// Audio is attached separately so a voice call still plays sound when
		// there is no video element on screen at all.
		if (remoteAudio) remoteAudio.srcObject = remote;
	});

	$effect(() => {
		if (localVideo) localVideo.srcObject = streams.local;
	});

	const status = $derived(
		call.phase === "ringing"
			? `${call.withWhom || "Someone"} is calling`
			: call.phase === "dialling"
				? "Calling…"
				: call.phase === "connecting"
					? "Connecting…"
					: call.phase === "active"
						? callDuration(call.seconds)
						: "Call ended"
	);
</script>

<section class="call" class:video={call.video && call.phase === "active"}>
	<!-- Always present: a voice call has no video element to carry the audio. -->
	<audio bind:this={remoteAudio} autoplay></audio>

	{#if call.video && call.phase === "active"}
		<div class="stage">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video class="remote" bind:this={remoteVideo} autoplay playsinline></video>
			<!-- svelte-ignore a11y_media_has_caption -->
			<video class="local" bind:this={localVideo} autoplay playsinline muted></video>
		</div>
	{/if}

	<div class="bar">
		<div class="who">
			<strong>{call.withWhom || call.roomName}</strong>
			<span class="status">{status}</span>
			{#if call.error}<span class="err">{call.error}</span>{/if}
		</div>

		<div class="controls">
			{#if call.phase === "ringing"}
				<button class="button danger" onclick={rejectCall}>Decline</button>
				<button class="button" onclick={() => answerCall(false)}>Answer</button>
				{#if call.video}
					<button class="button primary" onclick={() => answerCall(true)}>
						Answer with video
					</button>
				{/if}
			{:else}
				<button class="round" class:on={call.muted} title="Mute" onclick={toggleMute}>
					{call.muted ? "🔇" : "🎙"}
				</button>
				{#if call.video}
					<button
						class="round"
						class:on={call.cameraOff}
						title="Camera"
						onclick={toggleCamera}
					>
						{call.cameraOff ? "📷̸" : "📷"}
					</button>
				{/if}
				{#if call.canScreenshare}
					<button
						class="round"
						class:on={call.screensharing}
						title="Share screen"
						onclick={toggleScreenshare}
					>🖥</button>
				{/if}
				<button class="button danger" onclick={hangUp}>Hang up</button>
			{/if}
		</div>
	</div>
</section>

<style>
	.call {
		flex: none;
		border-bottom: var(--border-width, 1px) solid var(--border);
		background: var(--raised-fill, var(--raised));
	}

	.stage {
		position: relative;
		background: #000;
		aspect-ratio: 16 / 9;
		max-height: 46vh;
	}

	.remote {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	/* Small, in a corner, and never covering the middle of the other person. */
	.local {
		position: absolute;
		right: 12px;
		bottom: 12px;
		width: 22%;
		max-width: 200px;
		border-radius: var(--radius);
		border: 2px solid var(--border-strong);
		object-fit: cover;
		background: #000;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 14px;
	}

	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.who strong {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status {
		font-size: 11px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.err {
		font-size: 11px;
		color: var(--danger);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.round {
		width: var(--control-height, 36px);
		height: var(--control-height, 36px);
		display: grid;
		place-items: center;
		border-radius: 50%;
		border: var(--border-width, 1px) solid var(--border);
		background: var(--surface);
		font-size: 15px;
	}

	.round:hover {
		border-color: var(--accent);
	}

	.round.on {
		background: var(--accent-muted);
		border-color: var(--accent);
	}

	.button.danger {
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
