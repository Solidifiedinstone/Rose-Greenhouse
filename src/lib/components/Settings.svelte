<script lang="ts">
	import { logout, mx, setGlobalReceipts, unblockUser } from "$lib/matrix/client.svelte";
	import { verify } from "$lib/matrix/verification.svelte";
	import ThemeEditor from "./ThemeEditor.svelte";
	import {
		formatMinutes,
		notifications,
		setNotificationsEnabled,
		setQuietHours
	} from "$lib/matrix/notify.svelte";
	import { PRESENCE_LABELS, profile } from "$lib/matrix/profile.svelte";

	interface Props {
		onclose: () => void;
		onverify: () => void;
		onprofile: () => void;
	}

	let { onclose, onverify, onprofile }: Props = $props();

</script>

<div
	class="scrim"
	role="button"
	tabindex="-1"
	onclick={onclose}
	onkeydown={(event) => event.key === "Escape" && onclose()}
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="panel" onclick={(event) => event.stopPropagation()}>
		<header>
			<h2>Settings</h2>
			<button class="button" onclick={onclose}>Close</button>
		</header>

		<section>
			<h3>Account</h3>
			<p class="row-line">
				<span class="dim">Signed in as</span>
				<strong>{mx.displayName || mx.userId}</strong>
			</p>
			<p class="row-line">
				<span class="dim">Homeserver</span>
				<code>{mx.homeserver}</code>
			</p>
			<p class="row-line">
				<span class="dim">Encryption</span>
				{#if mx.cryptoReady}
					<span style:color="var(--success)">ready</span>
				{:else}
					<span style:color="var(--warning)">unavailable</span>
				{/if}
			</p>
			<p class="row-line">
				<span class="dim">This device</span>
				{#if verify.deviceVerified}
					<span style:color="var(--success)">verified</span>
				{:else}
					<span style:color="var(--warning)">not verified</span>
					<button class="button" onclick={onverify}>Verify</button>
				{/if}
			</p>
			<p class="row-line">
				<span class="dim">Key backup</span>
				<span class="dim">{verify.keyBackup ? "active" : "none"}</span>
			</p>
			<button class="button" onclick={onprofile}>Edit profile</button>
			<button class="button danger" onclick={logout} disabled={mx.busy}>
				{mx.busy ? "Signing out…" : "Sign out"}
			</button>
		</section>

		<section>
			<h3>Notifications</h3>
			<label class="toggle">
				<input
					type="checkbox"
					checked={notifications.enabled}
					onchange={(event) => setNotificationsEnabled(event.currentTarget.checked)}
				/>
				<span>Desktop notifications</span>
			</label>
			<label class="toggle">
				<input
					type="checkbox"
					checked={notifications.quiet.enabled}
					onchange={(event) =>
						setQuietHours({ ...notifications.quiet, enabled: event.currentTarget.checked })}
				/>
				<span>Quiet hours</span>
			</label>
			{#if notifications.quiet.enabled}
				<div class="quiet">
					<label>
						<span>From</span>
						<input
							type="time"
							value={formatMinutes(notifications.quiet.from)}
							onchange={(event) => {
								const [h, m] = event.currentTarget.value.split(":").map(Number);
								setQuietHours({ ...notifications.quiet, from: h * 60 + m });
							}}
						/>
					</label>
					<label>
						<span>To</span>
						<input
							type="time"
							value={formatMinutes(notifications.quiet.to)}
							onchange={(event) => {
								const [h, m] = event.currentTarget.value.split(":").map(Number);
								setQuietHours({ ...notifications.quiet, to: h * 60 + m });
							}}
						/>
					</label>
				</div>
				<p class="dim small">
					Notifications are held, not dropped — you get one summary when quiet
					hours end.
					{#if notifications.held.length}
						<strong>{notifications.held.length} waiting.</strong>
					{/if}
				</p>
			{/if}
			<p class="dim small">
				What counts as notifiable comes from your Matrix push rules, so it
				matches Element and your phone. Mute a single room by right-clicking
				it. Your status is <strong>{PRESENCE_LABELS[profile.presence]}</strong>{#if profile.presence === "dnd"}
					— everything is silenced while that's set{/if}.
			</p>
		</section>

		<section>
			<h3>Privacy</h3>
			<label class="toggle">
				<input
					type="checkbox"
					checked={!mx.receiptsOff}
					onchange={(event) => setGlobalReceipts(event.currentTarget.checked)}
				/>
				<span>Send read receipts</span>
			</label>
			<p class="dim small">
				Off means Matrix's private receipt: the server still remembers where
				you read to, so your unread counts keep working, but nobody else is
				told. Override it for one room by right-clicking it.
			</p>
		</section>

		<section>
			<h3>Blocked</h3>
			{#if mx.ignored.length}
				<p class="dim small">
					Their messages are hidden everywhere, on every device you sign in from.
					They are not told, and they can still see what you send in rooms you
					share.
				</p>
				<ul class="blocked">
					{#each mx.ignored as userId (userId)}
						<li>
							<code>{userId}</code>
							<button class="button" onclick={() => unblockUser(userId)} disabled={mx.busy}>
								Unblock
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="dim small">Nobody is blocked.</p>
			{/if}
		</section>

		<ThemeEditor />

	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.55);
		display: grid;
		place-items: center;
		padding: 24px;
		z-index: 50;
	}

	.panel {
		width: min(640px, 100%);
		max-height: 86vh;
		overflow-y: auto;
		background: var(--overlay);
		border: 1px solid var(--border-strong);
		border-radius: calc(var(--radius) * 1.6);
		padding: 22px 24px 26px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	h2 {
		margin: 0;
		font-size: 19px;
	}

	h3 {
		margin: 0 0 10px;
		font-size: 12px;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	section {
		padding: 18px 0;
		border-top: 1px solid var(--border);
	}

	.row-line {
		margin: 0 0 8px;
		display: flex;
		gap: 10px;
		align-items: baseline;
		font-size: 14px;
	}

	.row-line .dim {
		min-width: 110px;
		font-size: 12px;
	}

	.small {
		font-size: 12px;
		margin: 0 0 12px;
	}












	.toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		margin-bottom: 8px;
	}

	.toggle input {
		width: auto;
	}

	.quiet {
		display: flex;
		gap: 16px;
		margin: 4px 0 8px 24px;
	}

	.quiet label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.quiet input {
		width: auto;
		padding: 4px 6px;
		font-size: 12px;
	}

	.blocked {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.blocked li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--raised);
	}

	.blocked code {
		font-size: 12px;
		background: none;
		overflow-wrap: anywhere;
	}
</style>
