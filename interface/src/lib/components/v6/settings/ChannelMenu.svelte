<script lang="ts">
	/**
	 * The input-channel dropdown in Settings → Recording (ADR-534), drawn by
	 * the page rather than the system: Safari's own <select> picker shows
	 * text only and freezes while it is open, and every row here carries its
	 * channel's live level, so you can see which input your instrument is on
	 * before you pick it. The closed button carries the picked channel's.
	 *
	 * The list is `position: fixed` under (or over, when there is no room)
	 * its button, because the settings list it sits in clips its overflow.
	 * It closes on a pick, Escape, a press outside it, or a scroll of the
	 * section under it. Arrow keys move between rows.
	 */
	import { tick } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	let {
		options,
		value,
		label,
		levelsOf,
		meters,
		disabled = false,
		onpick
	}: {
		options: string[];
		value: string;
		label: (ch: string) => string;
		/** Each side's level, 0..1, for a channel name (`'5'`, `'1/2'`). */
		levelsOf: (ch: string) => number[];
		/** Whether there are levels to draw (a device Vamp for Mac meters). */
		meters: boolean;
		disabled?: boolean;
		onpick: (ch: string) => void;
	} = $props();

	let open = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
	let list = $state<HTMLDivElement | null>(null);
	let place = $state({ left: 0, top: 0, width: 0, maxHeight: 0, above: false });

	const ROW = 48;
	const GAP = 4;

	function measure() {
		if (!trigger) return;
		const r = trigger.getBoundingClientRect();
		const below = window.innerHeight - r.bottom - 16;
		const aboveRoom = r.top - 16;
		const want = Math.min(options.length * ROW + 8, 420);
		const above = below < Math.min(want, 240) && aboveRoom > below;
		const maxHeight = Math.max(ROW * 2, Math.min(want, above ? aboveRoom : below));
		place = {
			left: r.left,
			top: above ? r.top - GAP - maxHeight : r.bottom + GAP,
			width: Math.max(r.width, 224),
			maxHeight,
			above
		};
	}

	async function show() {
		if (disabled || open) return;
		measure();
		open = true;
		await tick();
		const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLElement>('[role="option"]');
		selected?.scrollIntoView?.({ block: 'nearest' });
		selected?.focus();
	}

	function hide(refocus = true) {
		if (!open) return;
		open = false;
		if (refocus) trigger?.focus();
	}

	function pick(ch: string) {
		onpick(ch);
		hide();
	}

	function onListKeydown(event: KeyboardEvent) {
		const rows = [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
		const i = rows.indexOf(document.activeElement as HTMLElement);
		const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			hide();
		} else if (step) {
			event.preventDefault();
			rows[Math.min(rows.length - 1, Math.max(0, i + step))]?.focus();
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			rows[event.key === 'Home' ? 0 : rows.length - 1]?.focus();
		} else if (event.key === 'Tab') {
			hide(false);
		}
	}

	function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			void show();
		}
	}

	// A press outside, a scroll of the section, or a resize closes it.
	$effect(() => {
		if (!open) return;
		const outside = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!list?.contains(t) && !trigger?.contains(t)) hide(false);
		};
		const away = (e: Event) => {
			if (!list?.contains(e.target as Node)) hide(false);
		};
		window.addEventListener('pointerdown', outside, true);
		window.addEventListener('scroll', away, true);
		window.addEventListener('resize', away);
		return () => {
			window.removeEventListener('pointerdown', outside, true);
			window.removeEventListener('scroll', away, true);
			window.removeEventListener('resize', away);
		};
	});
</script>

{#snippet levelBars(ch: string)}
	<span class="cm-meters" aria-hidden="true">
		{#each levelsOf(ch) as level, i (i)}
			<span class="cm-meter"><span class="cm-meter-fill" style:width={`${Math.min(1, Math.max(0, level)) * 100}%`}></span></span>
		{/each}
	</span>
{/snippet}

<button
	bind:this={trigger}
	class="set-select cm-trigger"
	type="button"
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-label="Input channel: {value ? label(value) : 'none'}"
	{disabled}
	onclick={() => (open ? hide() : void show())}
	onkeydown={onTriggerKeydown}
	data-capture-channel
>
	<span class="cm-label">{value ? label(value) : 'No inputs'}</span>
	{#if meters && value}{@render levelBars(value)}{/if}
	<ChevronDown class="cm-chevron" aria-hidden="true" />
</button>

{#if open}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		bind:this={list}
		class="cm-list"
		class:above={place.above}
		role="listbox"
		aria-label="Input channel"
		style:left={`${place.left}px`}
		style:top={`${place.top}px`}
		style:width={`${place.width}px`}
		style:max-height={`${place.maxHeight}px`}
		onkeydown={onListKeydown}
		data-capture-channel-list
	>
		{#each options as ch (ch)}
			<button
				class="cm-option"
				class:on={ch === value}
				type="button"
				role="option"
				aria-selected={ch === value}
				onclick={() => pick(ch)}
				data-capture-channel-option={ch}
			>
				<span class="cm-label">{label(ch)}</span>
				{#if meters}{@render levelBars(ch)}{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.cm-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-md);
		width: 15rem;
		max-width: 100%;
		padding-right: var(--spacing-sm);
		text-align: left;
	}
	.cm-label {
		flex: 0 0 auto;
		min-width: 5.5rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.cm-trigger :global(.cm-chevron) {
		flex-shrink: 0;
		width: 1rem;
		height: 1rem;
		margin-left: auto;
		color: var(--muted-foreground);
	}
	.cm-list {
		position: fixed;
		z-index: 1010;
		display: flex;
		flex-direction: column;
		padding: 4px;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--popover);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
	}
	.cm-option {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		flex-shrink: 0;
		min-height: 44px;
		padding: 0 var(--spacing-md);
		font-size: 0.9375rem;
		font-weight: var(--font-weight-medium);
		color: var(--foreground);
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.cm-option + .cm-option {
		margin-top: 2px;
	}
	.cm-option.on {
		background: var(--phosphor);
		color: var(--flat-on-fg);
	}
	.cm-option:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	@media (hover: hover) {
		.cm-option:not(.on):hover {
			background: var(--secondary);
		}
	}
	/* One bar a side, Live's meter green; the rows' all move at once. */
	.cm-meters {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		min-width: 3rem;
	}
	.cm-meter {
		display: block;
		height: 5px;
		border-radius: 1px;
		background: var(--flat-meter-bg, var(--surface-well));
		overflow: hidden;
	}
	.cm-meter-fill {
		display: block;
		height: 100%;
		background: var(--act-play);
		transition: width 80ms linear;
	}
	.cm-option.on .cm-meter {
		background: color-mix(in srgb, var(--flat-on-fg) 22%, var(--phosphor));
	}
	.cm-option.on .cm-meter-fill {
		background: var(--flat-on-fg);
	}
</style>
