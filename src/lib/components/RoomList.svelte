<script lang="ts">
	import Avatar from "./Avatar.svelte";
	import ConfirmDialog from "./ConfirmDialog.svelte";
	import ContextMenu, { type MenuItem } from "./ContextMenu.svelte";
	import {
		blockUser,
		deleteRoom,
		hideRoom,
		isBlocked,
		leaveRoom,
		markRoomRead,
		muteRoom,
		mx,
		openRoom,
		otherMemberOf,
		receiptsPrivate,
		roomMuted,
		setRoomReceipts,
		unblockUser,
		unhideAll
	} from "$lib/matrix/client.svelte";
	import type { RoomView } from "$lib/matrix/views";
	import { activeTheme } from "$lib/theme/theme.svelte";

	const previews = $derived(activeTheme().shape.roomPreviews);

	interface Props {
		onaddroom: () => void;
	}

	let { onaddroom }: Props = $props();

	let filter = $state("");

	let menu: { x: number; y: number; items: MenuItem[] } | null = $state(null);
	let confirm: {
		title: string;
		body: string;
		confirmLabel: string;
		danger: boolean;
		run: () => void;
	} | null = $state(null);

	function ask(
		title: string,
		body: string,
		confirmLabel: string,
		run: () => void,
		danger = true
	) {
		confirm = { title, body, confirmLabel, danger, run };
	}

	/**
	 * Build the menu for one room.
	 *
	 * The wording here is the feature. Matrix cannot delete a conversation for
	 * everybody, and a menu item that implies otherwise would be a lie told at
	 * the exact moment somebody is trying to get rid of something. Each
	 * destructive item says what it actually does.
	 */
	function menuFor(room: RoomView, event: MouseEvent) {
		event.preventDefault();
		const other = otherMemberOf(room.id);

		const muted = roomMuted(room.id);
		const items: MenuItem[] = [
			{
				label: "Mark as read",
				disabled: room.unread === 0,
				run: () => markRoomRead(room.id)
			},
			{
				label: muted ? "Unmute notifications" : "Mute notifications",
				detail: muted
					? "Notifications from this room resume, here and on your other devices."
					: "No notifications from this room, on any device you're signed into.",
				run: () => void muteRoom(room.id, !muted)
			},
			{
				label: receiptsPrivate(room.id)
					? "Send read receipts here"
					: "Read privately here",
				detail: receiptsPrivate(room.id)
					? "Others will see when you've read this room again."
					: "Your read position still syncs to you, but nobody else is told.",
				// The new "send" value is the opposite of "currently private".
				run: () => setRoomReceipts(room.id, /* send */ receiptsPrivate(room.id))
			},
			{ separator: true },
			{
				label: "Remove from sidebar",
				detail: "Hides it here only. You stay in the room and messages keep arriving.",
				run: () => hideRoom(room.id)
			},
			{
				label: "Leave room",
				detail: "You leave. Your copy of the history stays on the server.",
				danger: true,
				run: () =>
					ask(
						`Leave ${room.name}?`,
						"You will stop receiving messages. You can rejoin if it is public " +
							"or you are invited again. Your history is kept.",
						"Leave",
						() => void leaveRoom(room.id)
					)
			},
			{
				label: "Delete chat",
				detail: "Leaves and forgets it — your history goes. Theirs does not.",
				danger: true,
				run: () =>
					ask(
						`Delete ${room.name}?`,
						"This leaves the room and forgets it, so your copy of the history " +
							"is discarded and cannot be recovered.\n\nIt does not delete " +
							"anything for anyone else — Matrix gives no way to do that. The " +
							"other side keeps their copy of the conversation.",
						"Delete my copy",
						() => void deleteRoom(room.id)
					)
			}
		];

		if (other) {
			items.push({ separator: true });
			if (isBlocked(other.userId)) {
				items.push({
					label: `Unblock ${other.name}`,
					detail: "You will start seeing what they send again.",
					run: () => void unblockUser(other.userId)
				});
			} else {
				items.push({
					label: `Block ${other.name}`,
					detail:
						"Hides everything they send, on every device you sign in from. " +
						"It does not hide your messages from them.",
					danger: true,
					run: () =>
						ask(
							`Block ${other.name}?`,
							`You will stop seeing anything ${other.name} sends, in every room, ` +
								"on every device, including messages already on screen.\n\nThey " +
								"are not told, and they can still see what you send in rooms you " +
								"share. Unblock from this menu or in settings.",
							"Block",
							() => void blockUser(other.userId)
						)
				});
			}
		}

		menu = { x: event.clientX, y: event.clientY, items };
	}

	const visible = $derived.by(() => {
		const needle = filter.trim().toLowerCase();
		return mx.rooms.filter((room) => {
			// A space is a container, not a conversation — it belongs in the
			// rail, never in the room list.
			if (room.isSpace) return false;
			if (needle && !room.name.toLowerCase().includes(needle)) return false;
			if (mx.activeSpaceId && !room.spaceIds.includes(mx.activeSpaceId)) return false;
			return true;
		});
	});

	const invites = $derived(visible.filter((room) => room.membership === "invite"));
	const joined = $derived(visible.filter((room) => room.membership !== "invite"));

	function select(room: RoomView) {
		openRoom(room.id);
	}
</script>

<aside class="sidebar">
	<div class="search">
		<input bind:value={filter} placeholder="Find a room" spellcheck="false" />
		<button class="new-room" onclick={onaddroom} title="New room or join one" aria-label="Add a room">
			+
		</button>
	</div>

	<div class="scroll">
		{#if invites.length}
			<h2>Invites — {invites.length}</h2>
			{#each invites as room (room.id)}
				<button
					class="room invite"
					class:active={room.id === mx.activeRoomId}
					onclick={() => select(room)}
					oncontextmenu={(event) => menuFor(room, event)}
				>
					<Avatar id={room.id} name={room.name} mxc={room.avatarUrl} size={32} square />
					<span class="body">
						<span class="name">{room.name}</span>
						{#if previews}<span class="preview">invited you</span>{/if}
					</span>
				</button>
			{/each}
		{/if}

		<h2>Rooms — {joined.length}</h2>
		{#each joined as room (room.id)}
			<button
				class="room"
				class:active={room.id === mx.activeRoomId}
				class:unread={room.unread > 0}
				onclick={() => select(room)}
				oncontextmenu={(event) => menuFor(room, event)}
			>
				<Avatar
					id={room.id}
					name={room.name}
					mxc={room.avatarUrl}
					size={32}
					square={!room.isDirect}
				/>
				<span class="body">
					<span class="name">
						{room.name}
						{#if room.isEncrypted}<span class="lock" title="Encrypted">🔒</span>{/if}
					</span>
					{#if previews && room.preview}
						<span class="preview">{room.preview}</span>
					{/if}
				</span>
				{#if room.highlights > 0}
					<span class="badge highlight">{room.highlights}</span>
				{:else if room.unread > 0}
					<span class="badge">{room.unread > 99 ? "99+" : room.unread}</span>
				{/if}
			</button>
		{:else}
			<p class="empty faint">
				{#if filter.trim()}
					Nothing matches that.
				{:else if mx.activeSpaceId}
					Nothing in this space yet — or its rooms haven't synced.
				{:else}
					No rooms yet.
				{/if}
			</p>
		{/each}

		{#if mx.hidden.length}
			<button class="hidden-note" onclick={unhideAll}>
				{mx.hidden.length} hidden — show {mx.hidden.length === 1 ? "it" : "them"} again
			</button>
		{/if}
	</div>
</aside>

{#if menu}
	<ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

{#if confirm}
	<ConfirmDialog
		title={confirm.title}
		body={confirm.body}
		confirmLabel={confirm.confirmLabel}
		danger={confirm.danger}
		onconfirm={() => {
			const run = confirm!.run;
			confirm = null;
			run();
		}}
		oncancel={() => (confirm = null)}
	/>
{/if}

<style>
	.sidebar {
		width: var(--sidebar-width, 260px);
		flex: none;
		display: flex;
		flex-direction: column;
		background: var(--sidebar-fill, var(--sidebar));
		border-right: var(--border-width, 1px) solid var(--border);
		min-height: 0;
	}









	.search {
		display: flex;
		gap: 6px;
		padding: 10px;
		border-bottom: var(--border-width, 1px) solid var(--border);
	}

	.search input {
		padding: 7px 10px;
		font-size: 13px;
		background: var(--backdrop);
	}

	.new-room {
		flex: none;
		width: 30px;
		border-radius: var(--button-radius, var(--radius));
		border: var(--border-width, 1px) solid var(--border);
		color: var(--text-dim);
		font-size: 17px;
		line-height: 1;
	}

	.new-room:hover {
		color: var(--text);
		border-color: var(--accent);
	}

	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 8px 6px 16px;
		min-height: 0;
	}

	h2 {
		margin: 10px 8px 6px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.room {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border-radius: var(--radius);
		text-align: left;
		color: var(--text-dim);
	}

	.room:hover {
		background: var(--raised);
		color: var(--text);
	}

	.room.active {
		background: var(--raised);
		color: var(--text);
	}

	.room.unread {
		color: var(--text);
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.name {
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.room.unread .name {
		font-weight: 700;
	}

	.preview {
		font-size: 12px;
		color: var(--text-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lock {
		font-size: 10px;
		opacity: 0.6;
	}

	.badge {
		flex: none;
		min-width: 20px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--border-strong);
		color: var(--text);
		font-size: 11px;
		font-weight: 700;
		text-align: center;
	}

	.badge.highlight {
		background: var(--unread);
		color: var(--accent-text);
	}

	.invite .preview {
		color: var(--accent);
	}

	.empty {
		margin: 16px 10px;
		font-size: 13px;
	}

	.hidden-note {
		display: block;
		width: calc(100% - 16px);
		margin: 12px 8px 0;
		padding: 6px 8px;
		border-radius: var(--radius);
		border: 1px dashed var(--border);
		color: var(--text-faint);
		font-size: 11px;
		text-align: left;
	}

	.hidden-note:hover {
		color: var(--text-dim);
		border-color: var(--border-strong);
	}
</style>
