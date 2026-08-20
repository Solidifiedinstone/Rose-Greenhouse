<script lang="ts">
	import { getClient } from "$lib/matrix/client.svelte";
	import { resolveAttachment, type EncryptedFile } from "$lib/matrix/upload.svelte";
	import { formatSize } from "$lib/matrix/views";
	import type { MessageView } from "$lib/matrix/views";

	interface Props {
		message: MessageView;
	}

	let { message }: Props = $props();

	let url: string | null = $state(null);
	let failed = $state(false);

	/**
	 * Resolving is async because an encrypted attachment has to be fetched as
	 * ciphertext and decrypted here — the homeserver cannot do it, and must
	 * never be able to.
	 */
	$effect(() => {
		const client = getClient();
		const mxc = message.mediaUrl;
		const file = message.encryptedFile as EncryptedFile | null;
		if (!client) return;

		let cancelled = false;
		url = null;
		failed = false;
		resolveAttachment(client, mxc, file)
			.then((resolved) => {
				if (cancelled) return;
				url = resolved;
				failed = resolved === null;
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

{#if message.kind === "image"}
	{#if url}
		<img
			class="attachment"
			src={url}
			alt={message.body}
			style:aspect-ratio={message.mediaWidth && message.mediaHeight
				? `${message.mediaWidth} / ${message.mediaHeight}`
				: undefined}
		/>
	{:else if failed}
		<p class="body faint">🖼 {message.body} — couldn't load this image.</p>
	{:else}
		<p class="body faint">🖼 {message.body} — loading…</p>
	{/if}
{:else}
	<p class="body file">
		<span class="clip">📎</span>
		{#if url}
			<a href={url} download={message.body} target="_blank" rel="noreferrer">{message.body}</a>
		{:else}
			{message.body}
		{/if}
		{#if message.fileSize}<span class="faint">· {formatSize(message.fileSize)}</span>{/if}
		{#if failed}<span class="faint">· unavailable</span>{/if}
	</p>
{/if}

<style>
	.attachment {
		margin-top: 4px;
		max-width: min(480px, 100%);
		max-height: 380px;
		border-radius: var(--radius);
		display: block;
		object-fit: contain;
		background: var(--code-bg);
	}

	.body {
		margin: 2px 0 0;
		overflow-wrap: anywhere;
	}

	.clip {
		margin-right: 4px;
	}

	.faint {
		color: var(--text-faint);
	}
</style>
