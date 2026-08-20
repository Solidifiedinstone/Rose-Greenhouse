<script lang="ts">
	import { describe, sendFiles, sendMessage, sendReply, mx } from "$lib/matrix/client.svelte";
	import type { MessageView } from "$lib/matrix/views";

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
		<button class="button primary" onclick={send} disabled={!draft.trim() || sending}>
			Send
		</button>
	</div>
	<p class="hint faint">
		Enter sends · Shift+Enter for a new line · drop or paste files to send
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

	.attach {
		flex: none;
		width: var(--control-height, 38px);
		padding: 0;
		font-size: 20px;
		font-weight: 400;
		line-height: 1;
	}
</style>
