<script lang="ts">
	import Avatar from "./Avatar.svelte";
	import { mx } from "$lib/matrix/client.svelte";
	import { powerLabel } from "$lib/matrix/views";

	interface Props {
		onuser: (userId: string) => void;
	}

	let { onuser }: Props = $props();

	let filter = $state("");

	const shown = $derived(
		mx.members.filter((member) => {
			const needle = filter.trim().toLowerCase();
			if (!needle) return true;
			return (
				member.name.toLowerCase().includes(needle) ||
				member.userId.toLowerCase().includes(needle)
			);
		})
	);

	// Grouped by role, because "who can do something about this" is the usual
	// reason for opening a member list.
	const groups = $derived([
		{ label: "Admins", members: shown.filter((m) => m.membership === "join" && m.power >= 100) },
		{
			label: "Moderators",
			members: shown.filter((m) => m.membership === "join" && m.power >= 50 && m.power < 100)
		},
		{ label: "Members", members: shown.filter((m) => m.membership === "join" && m.power < 50) },
		{ label: "Invited", members: shown.filter((m) => m.membership === "invite") }
	]);

	const dotFor = (presence: string) =>
		presence === "online"
			? "var(--success)"
			: presence === "unavailable"
				? "var(--warning)"
				: "transparent";
</script>

<aside class="members">
	<div class="search">
		<input bind:value={filter} placeholder="Find someone" spellcheck="false" />
	</div>

	<div class="scroll">
		{#each groups as group (group.label)}
			{#if group.members.length}
				<h2>{group.label} — {group.members.length}</h2>
				{#each group.members as member (member.userId)}
					<button class="member" onclick={() => onuser(member.userId)}>
						<span class="pic">
							<Avatar id={member.userId} name={member.name} mxc={member.avatar} size={28} />
							{#if member.presence === "online" || member.presence === "unavailable"}
								<i class="dot" style:background={dotFor(member.presence)}></i>
							{/if}
						</span>
						<span class="who">
							<span class="name">{member.name}</span>
							{#if powerLabel(member.power)}
								<span class="power">{powerLabel(member.power)}</span>
							{/if}
						</span>
					</button>
				{/each}
			{/if}
		{:else}
			<p class="empty faint">Nobody matches that.</p>
		{/each}
	</div>
</aside>

<style>
	.members {
		width: 220px;
		flex: none;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--sidebar-fill, var(--sidebar));
		border-left: var(--border-width, 1px) solid var(--border);
	}

	.search {
		padding: 10px;
		border-bottom: var(--border-width, 1px) solid var(--border);
	}

	.search input {
		padding: 6px 9px;
		font-size: 12px;
		background: var(--backdrop);
	}

	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 8px 6px 16px;
		min-height: 0;
	}

	h2 {
		margin: 10px 8px 5px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.member {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 5px 8px;
		border-radius: var(--radius);
		text-align: left;
		color: var(--text-dim);
	}

	.member:hover {
		background: var(--raised);
		color: var(--text);
	}

	.pic {
		position: relative;
		flex: none;
		line-height: 0;
	}

	.dot {
		position: absolute;
		right: -1px;
		bottom: -1px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 2px solid var(--sidebar);
	}

	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.name {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.power {
		font-size: 10px;
		color: var(--accent);
	}

	.empty {
		margin: 16px 10px;
		font-size: 12px;
	}
</style>
