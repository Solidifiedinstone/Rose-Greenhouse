<script lang="ts">
	import Attachment from "./Attachment.svelte";
	import Avatar from "./Avatar.svelte";
	import { openThread, sendThreadMessage, threadView, describe } from "$lib/matrix/client.svelte";
	import { renderMarkdown } from "$lib/matrix/markdown";
	import { formatTimestamp } from "$lib/matrix/views";
	import { activeTheme } from "$lib/theme/theme.svelte";

	interface Props {
		onuser: (userId: string) => void;
	}

	let { onuser }: Props = $props();

	let draft = $state("");
	let sending = $state(false);
	let failure = $state("");
	let scroller: HTMLDivElement | null = $state(null);

	const avatarSize = $derived(activeTheme().shape.avatarSize);

	$effect(() => {
		threadView.messages.length;
		queueMicrotask(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	});

	async function send() {
		const text = draft.trim();
		if (!text || sending) return;
		draft = "";
		failure = "";
		sending = true;
		try {
			await sendThreadMessage(text);
		} catch (error) {
			failure = describe(error);
			draft = text;
		} finally {
			sending = false;
		}
	}
</script>

<aside class="thread">
	<header>
		<span class="title">Thread</span>
		<button class="close" onclick={() => openThread(null)} title="Close thread">×</button>
	</header>

	{#if threadView.rootBody}
		<p class="root selectable">{threadView.rootBody}</p>
	{/if}

	<div class="messages" bind:this={scroller}>
		{#if threadView.loading}
			<p class="status faint">Loading replies…</p>
		{/if}
		{#each threadView.messages as message (message.id)}
			<article class="message" class:continuation={message.continuation}>
				{#if message.continuation}
					<span class="gutter"></span>
				{:else}
					<button class="who" onclick={() => onuser(message.sender)} title="View profile">
						<Avatar
							id={message.sender}
							name={message.senderName}
							mxc={message.senderAvatar}
							size={avatarSize}
						/>
					</button>
				{/if}
				<div class="content selectable">
					{#if !message.continuation}
						<header class="line">
							<span class="author">{message.senderName}</span>
							<time>{formatTimestamp(message.timestamp)}</time>
						</header>
					{/if}
					{#if message.kind === "redacted"}
						<p class="body faint">message deleted</p>
					{:else if message.decryptionFailed}
						<p class="body warn">🔒 Unable to decrypt this message.</p>
					{:else if message.kind !== "text" && message.kind !== "notice" && message.kind !== "emote"}
						<Attachment {message} />
					{:else if message.html}
						<p class="body">{@html renderMarkdown(message.body)}</p>
					{:else}
						<p class="body">{message.body}</p>
					{/if}
				</div>
			</article>
		{:else}
			{#if !threadView.loading}
				<p class="status faint">No replies yet. Start one.</p>
			{/if}
		{/each}
	</div>

	<div class="composer">
		{#if failure}<p class="error-text">{failure}</p>{/if}
		<textarea
			bind:value={draft}
			rows="2"
			placeholder="Reply in thread"
			onkeydown={(event) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					void send();
				}
			}}
		></textarea>
		<button class="button primary" onclick={send} disabled={!draft.trim() || sending}>
			{sending ? "Sending…" : "Reply"}
		</button>
	</div>
</aside>

<style>
	.thread {
		width: 330px;
		flex: none;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--sidebar-fill, var(--sidebar));
		border-left: var(--border-width, 1px) solid var(--border);
	}

	header {
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-bottom: var(--border-width, 1px) solid var(--border);
	}

	.title {
		flex: 1;
		font-size: 13px;
		font-weight: var(--bold-weight, 700);
	}

	.close {
		color: var(--text-faint);
		font-size: 17px;
		line-height: 1;
	}

	.close:hover {
		color: var(--text);
	}

	.root {
		flex: none;
		margin: 0;
		padding: 9px 12px;
		border-bottom: var(--border-width, 1px) solid var(--border);
		border-left: 2px solid var(--accent);
		font-size: 12px;
		color: var(--text-dim);
		overflow-wrap: anywhere;
	}

	.messages {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: var(--message-gap, 12px);
	}

	.message {
		display: flex;
		gap: 9px;
		align-items: flex-start;
	}

	.gutter {
		width: var(--avatar-size, 38px);
		flex: none;
	}

	.who {
		flex: none;
		line-height: 0;
	}

	.content {
		flex: 1;
		min-width: 0;
	}

	.line {
		display: flex;
		align-items: baseline;
		gap: 7px;
		padding: 0;
		border: none;
	}

	.author {
		font-size: 13px;
		font-weight: var(--bold-weight, 700);
	}

	time {
		font-size: 10px;
		color: var(--text-faint);
	}

	.body {
		margin: 2px 0 0;
		font-size: 13px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.body.warn {
		color: var(--warning);
	}

	.status {
		text-align: center;
		font-size: 12px;
	}

	.composer {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border-top: var(--border-width, 1px) solid var(--border);
	}

	.composer textarea {
		resize: none;
		font-size: 13px;
	}
</style>
