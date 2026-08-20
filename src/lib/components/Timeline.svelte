<script lang="ts">
	import Attachment from "./Attachment.svelte";
	import EmojiPicker from "./EmojiPicker.svelte";
	import Avatar from "./Avatar.svelte";
	import { deleteMessage, editMessage, loadMore, mx, toggleReaction } from "$lib/matrix/client.svelte";
	import ConfirmDialog from "./ConfirmDialog.svelte";
	import { uploads } from "$lib/matrix/upload.svelte";
	import { formatTimestamp, type MessageView } from "$lib/matrix/views";
	import { activeTheme } from "$lib/theme/theme.svelte";

	interface Props {
		onuser: (userId: string) => void;
		onreply: (message: MessageView) => void;
	}

	let { onuser, onreply }: Props = $props();

	/** Which message the emoji picker is open for, and where. */
	let picking: { id: string; x: number; y: number } | null = $state(null);

	/** The message being edited inline, and the text so far. */
	let editing: { id: string; draft: string } | null = $state(null);
	let deleting: MessageView | null = $state(null);

	function beginEdit(message: MessageView) {
		editing = { id: message.id, draft: message.body };
	}

	async function commitEdit() {
		if (!editing) return;
		const { id, draft } = editing;
		const original = mx.timeline.find((entry) => entry.id === id);
		// Nothing to send if it is unchanged; closing quietly is the right
		// outcome rather than posting an edit that changes nothing.
		if (!draft.trim() || draft.trim() === original?.body) {
			editing = null;
			return;
		}
		editing = null;
		await editMessage(id, draft);
	}

	function react(messageId: string, key: string) {
		const message = mx.timeline.find((entry) => entry.id === messageId);
		void toggleReaction(messageId, key, message?.reactions.find((r) => r.key === key));
	}

	let scroller: HTMLDivElement | null = $state(null);

	// Read from the theme so "avatar size" in settings is a real setting.
	const avatarSize = $derived(activeTheme().shape.avatarSize);
	const compact = $derived(activeTheme().shape.density === "compact");
	const clock = $derived(activeTheme().shape.clock);
	const bubbles = $derived(activeTheme().shape.bubbles);

	const stamp = (at: number) =>
		clock === "off" ? "" : formatTimestamp(at, Date.now(), clock);
	let pinned = $state(true);

	/**
	 * Follow the bottom only while the reader is already there.
	 *
	 * Yanking someone back down while they're reading history is the single
	 * most irritating thing a chat client can do, so the scroll position is
	 * only touched when they were pinned to the bottom already.
	 */
	$effect(() => {
		// Depend on the timeline so this runs after each rebuild.
		mx.timeline.length;
		if (!scroller || !pinned) return;
		queueMicrotask(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	});

	function onScroll() {
		if (!scroller) return;
		const distanceFromBottom =
			scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		pinned = distanceFromBottom < 80;

		if (scroller.scrollTop < 240) void loadMore();
	}
</script>

<div class="timeline" bind:this={scroller} onscroll={onScroll}>
	{#if mx.loadingMore}
		<p class="status faint">Loading earlier messages…</p>
	{:else if !mx.canLoadMore && mx.timeline.length}
		<p class="status faint">This is the beginning of the room.</p>
	{/if}

	{#each mx.timeline as message (message.id)}
		<article
			class="message"
			class:compact
			class:bubbles
			class:continuation={message.continuation}
			class:pending={message.pending}
			class:failed={message.failed}
		>
			{#if compact}
				<span class="gutter-time compact-time">{stamp(message.timestamp)}</span>
			{:else if message.continuation}
				<span class="gutter-time">{stamp(message.timestamp)}</span>
			{:else}
				<button
					class="sender-button"
					onclick={() => onuser(message.sender)}
					title="View profile"
				>
					<Avatar
						id={message.sender}
						name={message.senderName}
						mxc={message.senderAvatar}
						size={avatarSize}
					/>
				</button>
			{/if}

			<div class="content selectable">
				{#if message.replyPreview}
					<button
						class="reply-quote"
						onclick={() => message.replyTo && onuser(message.replyPreview!.sender)}
						title="Replying to {message.replyPreview.sender}"
					>
						<span class="reply-who">{message.replyPreview.sender}</span>
						<span class="reply-body">{message.replyPreview.body}</span>
					</button>
				{/if}
				{#if compact}
					<button class="inline-author" onclick={() => onuser(message.sender)}>
						{message.senderName}
					</button>
				{:else if !message.continuation}
					<header>
						<button class="author" onclick={() => onuser(message.sender)}>
							{message.senderName}
						</button>
						{#if clock !== "off"}<time>{stamp(message.timestamp)}</time>{/if}
					</header>
				{/if}

				{#if editing?.id === message.id}
					<form
						class="edit-form"
						onsubmit={(event) => {
							event.preventDefault();
							void commitEdit();
						}}
					>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							bind:value={editing.draft}
							autofocus
							onkeydown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									editing = null;
								}
							}}
						/>
						<span class="edit-hint faint">Enter saves · Esc cancels</span>
					</form>
				{:else if message.kind === "redacted"}
					<p class="body removed">message deleted</p>
				{:else if message.decryptionFailed}
					<p class="body undecryptable">
						🔒 Unable to decrypt this message.
						<span class="faint">
							It was sent before this device joined, or the keys never arrived.
						</span>
					</p>
				{:else if message.kind === "image" || message.kind === "file" || message.kind === "video" || message.kind === "audio"}
					<Attachment {message} />
				{:else if message.kind === "emote"}
					<p class="body emote">* {message.senderName} {message.body}</p>
				{:else}
					<p class="body" class:notice={message.kind === "notice"}>{message.body}</p>
				{/if}

				{#if message.edited}<span class="edited faint">(edited)</span>{/if}
				{#if message.failed}<span class="edited failed-note">not sent</span>{/if}

				{#if message.reactions.length}
					<div class="reactions">
						{#each message.reactions as reaction (reaction.key)}
							<button
								class="pill"
								class:mine={reaction.mine}
								title={reaction.who.join(", ")}
								onclick={() => react(message.id, reaction.key)}
							>
								<span>{reaction.key}</span>
								<em>{reaction.count}</em>
							</button>
						{/each}
						<button
							class="pill add"
							title="Add a reaction"
							onclick={(event) => {
								const box = event.currentTarget.getBoundingClientRect();
								picking = { id: message.id, x: box.left, y: box.bottom + 6 };
							}}
						>+</button>
					</div>
				{/if}
			</div>

			<!--
				Hover actions live outside the content column so they never
				reflow the message text as they appear.
			-->
			<div class="actions">
				<button
					class="action"
					title="Reply"
					onclick={() => onreply(message)}
					aria-label="Reply"
				>↩</button>
				{#if message.mine && message.kind !== "redacted"}
					<button
						class="action"
						title="Edit"
						aria-label="Edit"
						onclick={() => beginEdit(message)}
					>✎</button>
					<button
						class="action danger"
						title="Delete"
						aria-label="Delete"
						onclick={() => (deleting = message)}
					>🗑</button>
				{/if}
				<button
					class="action"
					title="React"
					aria-label="React"
					onclick={(event) => {
						const box = event.currentTarget.getBoundingClientRect();
						picking = { id: message.id, x: box.left - 200, y: box.bottom + 6 };
					}}
				>☺</button>
			</div>
		</article>
	{:else}
		<p class="status faint">No messages here yet. Say something.</p>
	{/each}

	{#if deleting}
		<ConfirmDialog
			title="Delete this message?"
			body={"The text is removed for everyone, but the message itself stays in the " +
				"room marked as deleted — Matrix has no way to make it never have existed.\n\n" +
				"Anyone who already read it, or whose client cached it, may still have a copy."}
			confirmLabel="Delete"
			danger
			onconfirm={() => {
				const target = deleting!.id;
				deleting = null;
				void deleteMessage(target);
			}}
			oncancel={() => (deleting = null)}
		/>
	{/if}

	{#if picking}
		<EmojiPicker
			x={picking.x}
			y={picking.y}
			onpick={(emoji) => {
				react(picking!.id, emoji);
				picking = null;
			}}
			onclose={() => (picking = null)}
		/>
	{/if}

	{#each uploads.active as upload (upload.id)}
		<div class="upload">
			<span class="up-name">{upload.name}</span>
			{#if upload.error}
				<span class="up-error">{upload.error}</span>
			{:else}
				<span class="up-bar">
					<span class="up-fill" style:width="{Math.round((upload.progress ?? 0) * 100)}%"></span>
				</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.timeline {
		flex: 1;
		overflow-y: auto;
		padding: 16px 18px 8px;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--message-gap);
	}

	.status {
		text-align: center;
		font-size: 12px;
		margin: 8px 0;
	}

	.message {
		position: relative;
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}

	.actions {
		position: absolute;
		top: -12px;
		right: 8px;
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--overlay);
		border: var(--border-width, 1px) solid var(--border);
		border-radius: var(--radius);
		opacity: 0;
		pointer-events: none;
	}

	.message:hover .actions,
	.actions:focus-within {
		opacity: 1;
		pointer-events: auto;
	}

	.action {
		width: 26px;
		height: 24px;
		display: grid;
		place-items: center;
		border-radius: calc(var(--radius) * 0.6);
		color: var(--text-dim);
		font-size: 13px;
	}

	.action:hover {
		background: var(--raised);
		color: var(--text);
	}

	.action.danger:hover {
		color: var(--danger);
	}

	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 2px;
	}

	.edit-hint {
		font-size: 10px;
	}

	.reply-quote {
		display: flex;
		gap: 6px;
		align-items: baseline;
		max-width: 100%;
		margin-bottom: 3px;
		padding-left: 8px;
		border-left: 2px solid var(--accent-muted);
		font-size: 12px;
		text-align: left;
		color: var(--text-faint);
	}

	.reply-who {
		flex: none;
		color: var(--accent);
		font-weight: var(--bold-weight, 700);
	}

	.reply-body {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.reactions {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 5px;
	}

	.pill {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--raised);
		font-size: 12px;
		line-height: 1.6;
	}

	.pill:hover {
		border-color: var(--accent);
	}

	.pill.mine {
		border-color: var(--accent);
		background: var(--accent-muted);
	}

	.pill em {
		font-style: normal;
		font-size: 11px;
		color: var(--text-dim);
	}

	.pill.add {
		color: var(--text-faint);
		padding: 1px 9px;
	}

	.message.continuation {
		margin-top: calc(var(--message-gap) * -0.6);
	}

	.message.pending {
		opacity: 0.55;
	}

	/* Bubbles wrap only the content column, so the avatar stays outside the
	   fill the way every chat app that does this draws it. */
	.message.bubbles .content {
		background: var(--raised-fill, var(--raised));
		border: var(--border-width, 1px) solid var(--border);
		border-radius: calc(var(--radius) * 1.1);
		padding: 7px 11px;
		flex: 0 1 auto;
		max-width: min(760px, 100%);
	}

	.gutter-time {
		width: var(--avatar-size, 38px);
		flex: none;
		font-size: 10px;
		color: var(--text-faint);
		text-align: right;
		line-height: 1.6;
		opacity: 0;
	}

	.message:hover .gutter-time {
		opacity: 1;
	}

	/* Compact: one line per message, name inline, no avatar column. */
	.message.compact {
		gap: 8px;
		align-items: baseline;
	}

	.message.compact .content {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}

	.message.compact .body {
		margin: 0;
	}

	.compact-time {
		opacity: 1;
		flex: none;
		width: auto;
		min-width: 42px;
	}

	.inline-author {
		flex: none;
		font-weight: var(--bold-weight, 700);
		font-size: 0.92em;
	}

	.content {
		min-width: 0;
		flex: 1;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.author {
		font-weight: var(--bold-weight, 700);
		font-size: 14px;
		color: var(--text);
	}

	.author:hover,
	.inline-author:hover {
		text-decoration: underline;
	}

	.sender-button {
		flex: none;
		line-height: 0;
		border-radius: var(--avatar-rounding, 50%);
	}

	time {
		font-size: 11px;
		color: var(--text-faint);
	}

	.body {
		margin: 2px 0 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.body.notice {
		color: var(--text-dim);
	}

	.body.emote {
		color: var(--text-dim);
		font-style: italic;
	}

	.body.removed {
		color: var(--text-faint);
		font-style: italic;
	}

	.body.undecryptable {
		color: var(--warning);
		font-size: 0.95em;
	}


	.edited {
		font-size: 11px;
		margin-left: 6px;
	}

	.upload {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius);
		font-size: 12px;
	}

	.up-name {
		flex: none;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.up-bar {
		flex: 1;
		height: 5px;
		border-radius: 3px;
		background: var(--raised);
		overflow: hidden;
	}

	.up-fill {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 120ms linear;
	}

	.up-error {
		color: var(--danger);
	}

	.failed-note {
		color: var(--danger);
	}
</style>
