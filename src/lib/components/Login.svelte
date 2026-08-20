<script lang="ts">
	import RoseMark from "./RoseMark.svelte";
	import { cancelAddAccount, login, mx } from "$lib/matrix/client.svelte";

	let homeserver = $state("matrix.org");
	let username = $state("");
	let password = $state("");

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (mx.busy) return;
		try {
			await login(homeserver, username, password);
		} catch {
			// `login` has already put a readable message in mx.error; there is
			// nothing useful to add here, and rethrowing would only reach the
			// console.
		} finally {
			password = "";
		}
	}
</script>

<div class="screen">
	<form class="card" onsubmit={submit}>
		<div class="brand">
			<RoseMark size={86} />
			<div>
				<h1>Rose Greenhouse</h1>
				<p class="faint">
					{mx.addingAccount ? "Sign in to another account." : "Sign in to your Matrix account."}
				</p>
			</div>
		</div>

		<label>
			<span>Homeserver</span>
			<input
				bind:value={homeserver}
				placeholder="matrix.org"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
				disabled={mx.busy}
			/>
			<small class="faint">
				A domain, or a full URL. Where your account lives — not where you chat.
			</small>
		</label>

		<label>
			<span>Username</span>
			<input
				bind:value={username}
				placeholder="you"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
				autocomplete="username"
				disabled={mx.busy}
			/>
		</label>

		<label>
			<span>Password</span>
			<input
				type="password"
				bind:value={password}
				autocomplete="current-password"
				disabled={mx.busy}
			/>
		</label>

		{#if mx.error}
			<p class="error-text">{mx.error}</p>
		{/if}

		<button
			class="button primary"
			type="submit"
			disabled={mx.busy || !username.trim() || !password}
		>
			{mx.busy ? "Signing in…" : "Sign in"}
		</button>

		{#if mx.addingAccount}
			<button class="button" type="button" onclick={cancelAddAccount} disabled={mx.busy}>
				Back to {mx.accounts[0]?.userId ?? "your account"}
			</button>
		{/if}

		<p class="note faint">
			Your access token is stored by the app itself, with owner-only
			permissions — never in browser storage.
		</p>
	</form>
</div>

<style>
	.screen {
		height: 100%;
		display: grid;
		place-items: center;
		background: var(--backdrop);
		padding: 24px;
	}

	.card {
		width: min(420px, 100%);
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 28px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) * 1.6);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 4px;
	}

	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 800;
	}

	.brand p {
		margin: 2px 0 0;
		font-size: 13px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.4px;
		text-transform: uppercase;
		color: var(--text-dim);
	}

	label small {
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
	}

	.note {
		margin: 0;
		font-size: 11px;
		text-align: center;
	}
</style>
