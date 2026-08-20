<script lang="ts">
	import Avatar from "./Avatar.svelte";
	import RoseMark from "./RoseMark.svelte";
	import Composer from "./Composer.svelte";
	import MemberList from "./MemberList.svelte";
	import SearchPanel from "./SearchPanel.svelte";
	import RoomList from "./RoomList.svelte";
	import MyProfileDialog from "./MyProfileDialog.svelte";
	import StatusMenu from "./StatusMenu.svelte";
	import AddRoomDialog from "./AddRoomDialog.svelte";
	import ProfileDialog from "./ProfileDialog.svelte";
	import UserProfileDialog from "./UserProfileDialog.svelte";
	import Settings from "./Settings.svelte";
	import VerifyDialog from "./VerifyDialog.svelte";
	import Timeline from "./Timeline.svelte";
	import { openRoom, sendFiles, mx } from "$lib/matrix/client.svelte";
	import { verify } from "$lib/matrix/verification.svelte";
	import type { MessageView } from "$lib/matrix/views";
	import { PRESENCE_COLOURS, profile } from "$lib/matrix/profile.svelte";

	let settingsOpen = $state(false);
	let verifyOpen = $state(false);
	// The rail opens a status menu first; the card is a step behind that, and
	// editing a step behind the card.
	let statusMenu: { x: number; y: number } | null = $state(null);
	let profileOpen = $state(false);
	let profileEditOpen = $state(false);
	let viewingUser: string | null = $state(null);
	let replyTo: MessageView | null = $state(null);
	let addRoomOpen = $state(false);
	let membersOpen = $state(false);
	let searchOpen = $state(false);

	/**
	 * Drag counter rather than a boolean.
	 *
	 * dragenter/dragleave fire for every child element the pointer crosses, so
	 * a plain flag flickers off the moment you move over a message. Counting
	 * enters against leaves is the only thing that stays stable.
	 */
	let dragDepth = $state(0);
	const dragging = $derived(dragDepth > 0);

	function hasFiles(event: DragEvent): boolean {
		return Array.from(event.dataTransfer?.types ?? []).includes("Files");
	}

	function onDrop(event: DragEvent) {
		dragDepth = 0;
		if (!activeRoom) return;
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (!files.length) return;
		event.preventDefault();
		void sendFiles(files);
	}

	// An incoming request has to open the dialog by itself: the other end is
	// sitting there waiting, and a request that only appears if you happen to
	// click something is a request that gets missed.
	$effect(() => {
		if (verify.incoming && verify.stage !== "idle") verifyOpen = true;
	});

	function onKeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key === "f") {
			event.preventDefault();
			searchOpen = true;
		}
	}

	const activeRoom = $derived(mx.rooms.find((room) => room.id === mx.activeRoomId) ?? null);

	// A reply targets one event in one room, so switching rooms must drop it —
	// otherwise Send would post it into the wrong conversation.
	$effect(() => {
		mx.activeRoomId;
		replyTo = null;
	});
	const spaces = $derived(mx.rooms.filter((room) => room.isSpace));
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell">
	<!-- The narrow rail: spaces, then you. -->
	<nav class="rail">
		<button
			class="rail-button profile"
			title="Status and profile"
			onclick={(event) => {
				const box = event.currentTarget.getBoundingClientRect();
				statusMenu = { x: box.right + 8, y: box.top };
			}}
		>
			<Avatar
				id={mx.userId}
				name={profile.displayName || mx.userId}
				mxc={profile.avatar}
				size={40}
			/>
			<i class="presence" style:background={PRESENCE_COLOURS[profile.presence]}></i>
		</button>

		<div class="rail-divider"></div>

		<div class="rail-scroll">
			{#each spaces as space (space.id)}
				<button
					class="rail-button"
					class:active={mx.activeSpaceId === space.id}
					title={space.name}
					onclick={() => (mx.activeSpaceId = space.id)}
				>
					<Avatar id={space.id} name={space.name} mxc={space.avatarUrl} size={44} square />
				</button>
			{/each}
		</div>

		<button class="rail-button me" title="Settings" onclick={() => (settingsOpen = true)}>
			<span class="menu-icon" aria-hidden="true">
				<i></i>
				<i></i>
				<i></i>
			</span>
		</button>
	</nav>

	<div class="column">
		{#if verify.checked && !verify.deviceVerified && mx.cryptoReady}
			<button class="verify-banner" onclick={() => (verifyOpen = true)}>
				<strong>This device isn't verified</strong>
				<span>Encrypted history stays unreadable until it is. Verify now.</span>
			</button>
		{/if}
		<RoomList onaddroom={() => (addRoomOpen = true)} />
	</div>

	<main
		class="main"
		ondragenter={(event) => {
			if (hasFiles(event)) dragDepth += 1;
		}}
		ondragover={(event) => {
			if (hasFiles(event) && activeRoom) event.preventDefault();
		}}
		ondragleave={() => {
			dragDepth = Math.max(0, dragDepth - 1);
		}}
		ondrop={onDrop}
	>
		{#if dragging && activeRoom}
			<div class="drop">
				<div class="drop-card">
					<strong>Drop to send</strong>
					<span>
						{activeRoom.isEncrypted
							? "Encrypted before it leaves this machine."
							: "This room isn't encrypted."}
					</span>
				</div>
			</div>
		{/if}
		{#if activeRoom}
			<header class="room-header">
				<Avatar
					id={activeRoom.id}
					name={activeRoom.name}
					mxc={activeRoom.avatarUrl}
					size={28}
					square={!activeRoom.isDirect}
				/>
				<div class="titles">
					<h1>{activeRoom.name}</h1>
					{#if activeRoom.topic}
						<p class="topic faint">{activeRoom.topic}</p>
					{/if}
				</div>
				{#if activeRoom.isEncrypted}
					<span class="tag" title="End-to-end encrypted">🔒 Encrypted</span>
				{/if}
				<button class="header-button" title="Search (Ctrl+F)" onclick={() => (searchOpen = true)}>
					⌕
				</button>
				<button
					class="header-button"
					class:on={membersOpen}
					title="Members"
					onclick={() => (membersOpen = !membersOpen)}
				>
					{mx.members.length || ""} ☰
				</button>
			</header>

			<Timeline
				onuser={(userId) => (viewingUser = userId)}
				onreply={(message) => (replyTo = message)}
			/>
			<Composer
				roomName={activeRoom.name}
				encrypted={activeRoom.isEncrypted}
				{replyTo}
				oncancelreply={() => (replyTo = null)}
			/>
		{:else}
			<div class="nothing">
				<RoseMark size={220} />
				<h2>Rose Greenhouse</h2>
				<p class="faint">Pick a room on the left.</p>
				{#if mx.rooms.length === 0}
					<p class="faint small">
						You're not in any rooms yet. Join one from another client for now —
						room directory and room creation are next on the list.
					</p>
				{/if}
			</div>
		{/if}
	</main>

	{#if activeRoom && membersOpen}
		<MemberList onuser={(userId) => (viewingUser = userId)} />
	{/if}
</div>

{#if settingsOpen}
	<Settings
		onclose={() => (settingsOpen = false)}
		onverify={() => {
			settingsOpen = false;
			verifyOpen = true;
		}}
		onprofile={() => {
			settingsOpen = false;
			profileEditOpen = true;
		}}
	/>
{/if}

{#if verifyOpen}
	<VerifyDialog onclose={() => (verifyOpen = false)} />
{/if}

{#if statusMenu}
	<StatusMenu
		x={statusMenu.x}
		y={statusMenu.y}
		onclose={() => (statusMenu = null)}
		onview={() => {
			statusMenu = null;
			profileOpen = true;
		}}
	/>
{/if}

{#if profileOpen}
	<MyProfileDialog
		onclose={() => (profileOpen = false)}
		onedit={() => {
			profileOpen = false;
			profileEditOpen = true;
		}}
	/>
{/if}

{#if profileEditOpen}
	<ProfileDialog onclose={() => (profileEditOpen = false)} />
{/if}

{#if searchOpen}
	<SearchPanel onclose={() => (searchOpen = false)} />
{/if}

{#if addRoomOpen}
	<AddRoomDialog onclose={() => (addRoomOpen = false)} />
{/if}

{#if viewingUser}
	<UserProfileDialog userId={viewingUser} onclose={() => (viewingUser = null)} />
{/if}

{#if mx.error && mx.phase === "ready"}
	<div class="banner">
		<span>{mx.error}</span>
		<button onclick={() => (mx.error = "")}>×</button>
	</div>
{/if}

<style>
	.shell {
		display: flex;
		height: 100%;
		min-height: 0;
	}

	/* Mirrored rather than reordered in the markup, so tab order and screen
	   readers still follow the reading order of the document. */
	:global(:root[data-side="right"]) .shell {
		flex-direction: row-reverse;
	}

	.rail {
		width: var(--rail-width, 68px);
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 10px 0;
		background: var(--rail-fill, var(--rail));
		border-right: var(--border-width, 1px) solid var(--border);
		overflow: hidden;
	}

	.rail-scroll {
		flex: 1;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		overflow-y: auto;
		min-height: 0;
	}

	.rail-scroll::-webkit-scrollbar {
		width: 0;
	}

	.rail-button {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: var(--radius);
		color: var(--text-dim);
		transition: background 120ms ease;
	}

	.rail-button:hover,
	.rail-button.active {
		background: var(--raised);
		color: var(--text);
	}

	.profile {
		position: relative;
	}

	/* The presence dot sits on the avatar, the way every chat app does it, so
	   it is readable at a glance without a second row of UI. */
	.presence {
		position: absolute;
		right: 4px;
		bottom: 4px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--rail);
	}

	.rail-divider {
		width: 28px;
		height: 1px;
		background: var(--border);
	}

	.me {
		margin-top: auto;
	}

	.menu-icon {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		width: 20px;
	}

	.menu-icon i {
		display: block;
		height: 2px;
		border-radius: 2px;
		background: currentColor;
	}

	.column {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.verify-banner {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 8px 12px;
		text-align: left;
		background: var(--accent-muted);
		border-bottom: 1px solid var(--border);
		color: var(--text);
	}

	.verify-banner strong {
		font-size: 12px;
	}

	.verify-banner span {
		font-size: 11px;
		color: var(--text-dim);
	}

	.verify-banner:hover {
		background: var(--raised);
	}

	.main {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		background: var(--surface-fill, var(--surface));
		min-width: 0;
		min-height: 0;
	}

	.drop {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		background: rgb(0 0 0 / 0.55);
		pointer-events: none;
	}

	.drop-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 22px 34px;
		border: 2px dashed var(--accent);
		border-radius: calc(var(--radius) * 1.4);
		background: var(--overlay);
	}

	.drop-card strong {
		font-size: 16px;
	}

	.drop-card span {
		font-size: 12px;
		color: var(--text-dim);
	}

	.room-header {
		flex: none;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--border);
	}

	.titles {
		min-width: 0;
		flex: 1;
	}

	h1 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.topic {
		margin: 0;
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.header-button {
		flex: none;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 9px;
		border-radius: var(--button-radius, var(--radius));
		border: var(--border-width, 1px) solid var(--border);
		color: var(--text-dim);
		font-size: 11px;
	}

	.header-button:hover,
	.header-button.on {
		color: var(--text);
		border-color: var(--accent);
	}

	.tag {
		flex: none;
		font-size: 11px;
		color: var(--text-faint);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 2px 8px;
	}

	.nothing {
		flex: 1;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 4px;
		text-align: center;
		padding: 24px;
	}

	.nothing h2 {
		margin: 6px 0 0;
		font-size: 18px;
	}

	.nothing p {
		margin: 0;
	}

	.small {
		max-width: 380px;
		font-size: 12px;
		margin-top: 10px;
	}

	.banner {
		position: fixed;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: min(560px, 90vw);
		padding: 10px 14px;
		background: var(--overlay);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		font-size: 13px;
		z-index: 40;
	}

	.banner button {
		color: var(--text-faint);
		font-size: 18px;
		line-height: 1;
	}
</style>
