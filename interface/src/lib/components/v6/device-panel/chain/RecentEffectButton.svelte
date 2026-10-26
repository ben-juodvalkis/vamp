<script lang="ts">
	/**
	 * One of the chain's Recent buttons (ADR-484): an effect added lately,
	 * drawn as a ghost like the + Effect cell, so it does not pull the eye, its device's picture at the
	 * values its file saves (as its browser tile draws them) beside its name.
	 * A tap adds it to this chain again.
	 */
	import DevicePicture from '$lib/components/v6/browser/DevicePicture.svelte';
	import { presetParams, type PresetParams } from '$lib/services/presetParams';
	import { presetControl, resolveParam, type ParamRef } from '$lib/components/v6/device-panel/deviceControls';
	import { addEffectToChain, type RecentEffect } from '$lib/services/recentEffects.svelte';
	import { press } from '$lib/actions/press';

	// Not `effect`: a variable of that name turns `$effect` into a store read.
	let { recent }: { recent: RecentEffect } = $props();

	let saved = $state<PresetParams | null>(null);
	$effect(() => {
		const path = recent.fullPath;
		saved = null;
		if (!/\.(adv|adg|amxd)$/i.test(path)) return;
		let cancelled = false;
		void presetParams(path).then((p) => !cancelled && (saved = p));
		return () => (cancelled = true);
	});

	const picture = $derived.by(() => {
		const found = presetControl(saved, recent.name);
		if (!found || found.control.kind === 'eq' || !found.control.picture) return null;
		const get = (ref: ParamRef) => found.values[resolveParam(ref)];
		if (found.control.kind === 'xy') {
			const at = found.control.read(get);
			return { kind: found.control.picture, x: at.x, y: at.y };
		}
		return { kind: found.control.picture, x: found.control.read(get), y: 0 };
	});
</script>

<button
	type="button"
	class="recent-effect"
	aria-label="Add {recent.name} again"
	data-debug="chain-recent"
	use:press={{ onPress: () => void addEffectToChain(recent), touchAction: 'none', stopPropagation: true }}
>
	<span class="recent-picture" aria-hidden="true">
		{#if picture}<DevicePicture kind={picture.kind} x={picture.x} y={picture.y} ink="var(--muted-foreground)" />{/if}
	</span>
	<!-- "+ Echo": what a tap does (the user, 2026-10-26). -->
	<span class="recent-name">+ {recent.name}</span>
</button>

<style>
	/* A ghost, as the + Effect cell beside it is drawn (the user, the same
	   day): no fill of its own, a dashed line, the picture and name in muted
	   ink at the ghost opacity; full ink while pressed. */
	.recent-effect {
		flex: 1 1 0;
		min-height: 0;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 10px;
		padding: 0 10px;
		border: 1px dashed var(--line-strong);
		border-radius: 2px;
		background: transparent;
		color: var(--muted-foreground);
		font: inherit;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		-webkit-tap-highlight-color: transparent;
	}
	.recent-effect > span {
		opacity: var(--opacity-ghost);
	}
	.recent-effect:active {
		background: var(--secondary);
		color: var(--foreground);
	}
	.recent-effect:active > span {
		opacity: 1;
	}
	.recent-picture {
		position: relative;
		flex: 0 0 auto;
		width: 44px;
		height: 30px;
	}
	.recent-picture > :global(*) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.recent-name {
		min-width: 0;
		font-size: 0.875rem;
		font-weight: var(--font-weight-medium);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
