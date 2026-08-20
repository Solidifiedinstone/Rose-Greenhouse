<script lang="ts">
	import { describe, sendFiles, sendMessage, sendReply, mx } from "$lib/matrix/client.svelte";
	import type { MessageView } from "$lib/matrix/views";
	import { hasMarkdown, renderMarkdown } from "$lib/matrix/markdown";
	import { schedule, scheduledFor, unschedule } from "$lib/matrix/scheduled.svelte";

	interface Props {
		roomName: string;
		encrypted: boolean;
		/** The message being replied to, or null. */
		replyTo: MessageView | null;
		oncancelreply: () => void;
	}

	let { roomName, encrypted, replyTo, oncancelreply }: Props = $props();

	let draft = $state("");
	let sending = $state(false);
	let failure = $state("");
	let box: HTMLTextAreaElement | null = $state(null);
	let picker: HTMLInputElement | null = $state(null);
	let preview = $state(false);
	let scheduling = $state(false);
	let when = $state("");

	const pending = $derived(mx.activeRoomId ? scheduledFor(mx.activeRoomId) : []);

	function scheduleIt() {
		const text = draft.trim();
		if (!text || !mx.activeRoomId) return;
		// An empty time means "next time I'm online", which is a real choice
		// rather than an error.
		const at = when ? new Date(when).getTime() : null;
		if (at !== null && !Number.isFinite(at)) return;

		schedule({
			roomId: mx.activeRoomId,
			roomName,
			body: text,
			sendAt: at
		});
		draft = "";
		when = "";
		scheduling = false;
		resize();
	}

	function whenLabel(sendAt: number | null): string {
		if (sendAt === null) return "when next online";
		return new Date(sendAt).toLocaleString(undefined, {
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit"
		});
	}

	const formatted = $derived(hasMarkdown(draft) ? renderMarkdown(draft) : "");

	function chosen(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (files.length) void sendFiles(files);
		// Cleared so picking the same file twice in a row still fires.
		input.value = "";
	}

	/**
	 * Pasting an image should send it — that is how a screenshot gets into a
	 * chat, and it is the single most-used upload path there is.
	 */
	function onPaste(event: ClipboardEvent) {
		const files = Array.from(event.clipboardData?.files ?? []);
		if (!files.length) return;
		event.preventDefault();
		void sendFiles(files);
	}

	async function send() {
		const text = draft.trim();
		if (!text || sending) return;

		// Cleared before the await: the local echo appears immediately, and a
		// composer that stays full until the server answers feels broken.
		draft = "";
		failure = "";
		sending = true;
		resize();
		try {
			if (replyTo) {
				await sendReply(text, replyTo.id);
				oncancelreply();
			} else {
				await sendMessage(text);
			}
		} catch (error) {
			failure = describe(error);
			draft = text;
		} finally {
			sending = false;
		}
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void send();
		}
	}

	/** Grow with the text, up to a point, then scroll. */
	function resize() {
		if (!box) return;
		box.style.height = "auto";
		box.style.height = `${Math.min(box.scrollHeight, 180)}px`;
	}
</script>

<div class="composer">
	{#if replyTo}
		<div class="replying">
			<span class="replying-label">Replying to</span>
			<span class="replying-who">{replyTo.senderName}</span>
			<span class="replying-body">{replyTo.body}</span>
			<button class="cancel" onclick={oncancelreply} title="Cancel reply">×</button>
		</div>
	{/if}
	{#if failure}
		<p class="error-text">{failure}</p>
	{/if}
	{#if preview && formatted}
		<div class="preview selectable">{@html formatted}</div>
	{/if}

	{#if pending.length}
		<div class="pending">
			{#each pending as entry (entry.id)}
				<div class="pending-row" class:failed={entry.error}>
					<span class="pending-when">{whenLabel(entry.sendAt)}</span>
					<span class="pending-body">{entry.body}</span>
					{#if entry.error}<span class="pending-error">{entry.error}</span>{/if}
					<button class="pending-cancel" title="Cancel" onclick={() => unschedule(entry.id)}>
						×
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if scheduling}
		<div class="schedule-bar">
			<span>Send</span>
			<input type="datetime-local" bind:value={when} />
			<span class="dim">{when ? "" : "— leave empty for next time you're online"}</span>
			<button class="button" onclick={() => (scheduling = false)}>Cancel</button>
			<button class="button primary" onclick={scheduleIt} disabled={!draft.trim()}>
				Schedule
			</button>
		</div>
	{/if}

	<div class="row">
		<input
			type="file"
			multiple
			bind:this={picker}
			onchange={chosen}
			hidden
			aria-hidden="true"
			tabindex="-1"
		/>
		<button
			class="button attach"
			title="Attach a file"
			aria-label="Attach a file"
			onclick={() => picker?.click()}
			disabled={mx.phase !== "ready"}
		>
			+
		</button>
		<textarea
			bind:this={box}
			bind:value={draft}
			oninput={resize}
			onkeydown={onKeydown}
			onpaste={onPaste}
			rows="1"
			placeholder={`Message ${roomName}`}
			disabled={mx.phase !== "ready"}
		></textarea>
		<button
			class="button"
			class:on={scheduling}
			title="Send later"
			aria-label="Send later"
			onclick={() => (scheduling = !scheduling)}
			disabled={mx.phase !== "ready"}
		>
			🕑
		</button>
		{#if formatted}
			<button
				class="button"
				class:on={preview}
				title="Preview formatting"
				onclick={() => (preview = !preview)}
			>
				◑
			</button>
		{/if}
		<button class="button primary" onclick={send} disabled={!draft.trim() || sending}>
			Send
		</button>
	</div>
	<p class="hint faint">
		Enter sends · Shift+Enter for a new line · **bold**, `code`, > quote, - list
		{#if encrypted}· 🔒 encrypted{/if}
		{#if mx.typing.length}
			· {mx.typing.slice(0, 3).join(", ")}
			{mx.typing.length === 1 ? "is" : "are"} typing…
		{/if}
	</p>
</div>

<style>
	.composer {
		flex: none;
		padding: 10px 18px 14px;
		border-top: 1px solid var(--border);
		background: var(--surface);
	}

	.row {
		display: flex;
		gap: 10px;
		align-items: flex-end;
	}

	textarea {
		resize: none;
		overflow-y: auto;
		max-height: 180px;
		line-height: 1.45;
	}

	.hint {
		margin: 6px 2px 0;
		font-size: 11px;
	}

	.replying {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 8px;
		padding: 6px 10px;
		border-left: 2px solid var(--accent);
		background: var(--raised);
		border-radius: var(--radius);
		font-size: 12px;
	}

	.replying-label {
		color: var(--text-faint);
		flex: none;
	}

	.replying-who {
		color: var(--accent);
		font-weight: var(--bold-weight, 700);
		flex: none;
	}

	.replying-body {
		flex: 1;
		min-width: 0;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cancel {
		flex: none;
		color: var(--text-faint);
		font-size: 16px;
		line-height: 1;
	}

	.cancel:hover {
		color: var(--danger);
	}

	.preview {
		margin-bottom: 8px;
		padding: 9px 11px;
		background: var(--raised);
		border: var(--border-width, 1px) dashed var(--border-strong);
		border-radius: var(--radius);
		font-size: 13px;
		line-height: 1.5;
	}

	.preview :global(code) {
		font-family: var(--mono-family);
		background: var(--code-bg);
		padding: 1px 5px;
		border-radius: 5px;
	}

	.preview :global(pre) {
		margin: 4px 0;
		padding: 8px 10px;
		background: var(--code-bg);
		border-radius: var(--radius);
		overflow-x: auto;
	}

	.preview :global(blockquote) {
		margin: 3px 0;
		padding-left: 9px;
		border-left: 2px solid var(--border-strong);
		color: var(--text-dim);
	}

	.button.on {
		border-color: var(--accent);
		color: var(--accent);
	}

	.pending {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 8px;
	}

	.pending-row {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 4px 9px;
		border-radius: var(--radius);
		border: var(--border-width, 1px) dashed var(--border-strong);
		font-size: 11px;
	}

	.pending-row.failed {
		border-color: var(--danger);
	}

	.pending-when {
		flex: none;
		color: var(--accent);
	}

	.pending-body {
		flex: 1;
		min-width: 0;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pending-error {
		flex: none;
		color: var(--danger);
	}

	.pending-cancel {
		flex: none;
		color: var(--text-faint);
		font-size: 14px;
		line-height: 1;
	}

	.pending-cancel:hover {
		color: var(--danger);
	}

	.schedule-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		padding: 7px 9px;
		border-radius: var(--radius);
		background: var(--raised);
		font-size: 12px;
	}

	.schedule-bar input {
		width: auto;
		font-size: 12px;
		padding: 4px 6px;
	}

	.schedule-bar .dim {
		flex: 1;
		color: var(--text-faint);
		font-size: 11px;
	}

	.attach {
		flex: none;
		width: var(--control-height, 38px);
		padding: 0;
		font-size: 20px;
		font-weight: 400;
		line-height: 1;
	}
</style>
