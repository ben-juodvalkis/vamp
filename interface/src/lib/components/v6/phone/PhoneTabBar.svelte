<script lang="ts">
	/**
	 * The phone's tab bar (ADR-503): Mix, Clips, Rec, Track, Browse. Rec is
	 * in the middle, under the thumb, and is the iPad's own Record button —
	 * the same hold-to-record or tap-to-toggle on the selected track — with
	 * that track's name under it so it is clear what it will record.
	 * In landscape it stands as a rail down the left edge, top to bottom
	 * in the same order.
	 */
	import SlidersVertical from '@lucide/svelte/icons/sliders-vertical';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import Blocks from '@lucide/svelte/icons/blocks';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import RecordButton from '$lib/components/v6/controls/RecordButton.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { v3Store } from '$lib/stores/v3/normalized.svelte';
	import { press } from '$lib/actions/press';
	import type { PhoneTab } from '$lib/utils/phoneLayout';

	interface Props {
		tab: PhoneTab;
		onSelect: (tab: PhoneTab) => void;
	}

	let { tab, onSelect }: Props = $props();

	const left = [
		{ id: 'mix' as const, label: 'Mix', icon: SlidersVertical },
		{ id: 'clips' as const, label: 'Clips', icon: LayoutGrid }
	];
	const right = [
		{ id: 'track' as const, label: 'Track', icon: Blocks },
		{ id: 'browse' as const, label: 'Browse', icon: FolderOpen }
	];

	const recTarget = $derived(
		session.selectedTrackIndex < 0
			? 'Master'
			: (v3Store.tracks.get(`tracks/${session.selectedTrackIndex}`)?.name ??
					`Track ${session.selectedTrackIndex + 1}`)
	);
</script>

{#snippet tabButton(t: { id: PhoneTab; label: string; icon: typeof Blocks })}
	{@const Icon = t.icon}
	<button
		type="button"
		class="tab"
		class:is-on={tab === t.id}
		data-phone-tab={t.id}
		aria-pressed={tab === t.id}
		use:press={{ onPress: () => onSelect(t.id), touchAction: 'manipulation' }}
	>
		<Icon class="tab-icon" aria-hidden="true" />
		<span>{t.label}</span>
	</button>
{/snippet}

<nav class="tab-bar" aria-label="Phone tabs" data-debug="phone-tab-bar">
	{#each left as t (t.id)}{@render tabButton(t)}{/each}
	<div class="rec" data-debug="phone-rec">
		<div class="rec-cell"><RecordButton source="track" /></div>
		<span class="rec-target">{recTarget}</span>
	</div>
	{#each right as t (t.id)}{@render tabButton(t)}{/each}
</nav>

<style>
	.tab-bar {
		height: 64px;
		display: grid;
		grid-template-columns: 1fr 1fr 84px 1fr 1fr;
		align-items: stretch;
		border-top: 1px solid var(--line);
		padding-inline: 4px;
	}
	@media (orientation: landscape) {
		.tab-bar {
			width: 72px;
			height: 100%;
			grid-template-columns: none;
			grid-template-rows: 1fr 1fr 76px 1fr 1fr;
			border-top: 0;
			border-right: 1px solid var(--line);
			padding-inline: 0;
			padding-block: 4px;
		}
		.rec-target {
			max-width: 68px;
		}
	}

	.tab {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		font-size: 0.6875rem;
		font-weight: var(--font-weight-medium, 500);
		-webkit-tap-highlight-color: transparent;
		cursor: pointer;
	}
	.tab :global(.tab-icon) {
		width: 24px;
		height: 24px;
	}
	.tab.is-on {
		color: var(--foreground);
	}
	.tab.is-on :global(.tab-icon) {
		color: var(--phosphor);
	}

	.rec {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
	}
	/* RecordButton draws the largest circle its cell allows. */
	.rec-cell {
		width: 46px;
		height: 46px;
		display: flex;
	}
	.rec-cell > :global(*) {
		flex: 1;
	}
	.rec-target {
		max-width: 80px;
		font-size: 0.625rem;
		color: var(--muted-foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
