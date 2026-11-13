<script lang="ts">
	/**
	 * Settings → Setup, the first-run checklist (onboarding.plan.md §7):
	 * Settings opened by itself because the Mac has saved nothing yet. Each
	 * step ticks itself when the app sees it done (`firstRunSteps`), a step a
	 * section of Settings does carries a button there, and the last step is
	 * the address to open on the iPad, drawn as a step like the others.
	 *
	 * The page's head ends it: Finish setup saves the ticks as they stand,
	 * which ends the first run (`ticks.ts`), and closes; Set up later closes,
	 * and the page opens again next time for as long as the Mac has saved
	 * nothing. A tick saves too, so once one is made there is only Finish.
	 */
	import { settingsStore } from '$lib/stores/v6/settingsStore.svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import IpadAddresses from './IpadAddresses.svelte';
	import type { FirstRunStep } from './firstRunSteps';
	import type { IpadAddress } from './ipadAddress';

	let {
		steps,
		progress,
		addresses,
		addressState
	}: {
		steps: FirstRunStep[];
		progress: { done: number; total: number };
		addresses: IpadAddress[];
		addressState: 'loading' | 'ready' | 'failed';
	} = $props();

	const allDone = $derived(progress.done === progress.total);
</script>

<div class="set-section">
	<div class="setup-intro">
		<p class="set-lead">
			Nothing has been set up on this Mac yet. Each step ticks itself when Vamp sees it done; none of them means typing into
			a config file.
		</p>
		<div class="setup-progress" aria-label="{progress.done} of {progress.total} required steps done">
			<span class="setup-progress-word">
				{#if allDone}<strong>Ready to play.</strong> The rest is optional.{:else}<strong>{progress.done} of {progress.total}</strong> required steps done{/if}
			</span>
			<span class="setup-bar" aria-hidden="true">
				<span class="setup-bar-fill" style:width={`${progress.total ? (progress.done / progress.total) * 100 : 0}%`}></span>
			</span>
		</div>
	</div>

	<ol class="set-list setup-steps">
		{#each steps as step, i (step.key)}
			<li class="set-row setup-step" class:done={step.done} data-step={step.key} data-done={step.done}>
				<span class="setup-mark" aria-hidden="true">
					{#if step.done}<Check class="setup-mark-icon" />{:else}{i + 1}{/if}
				</span>
				<span class="set-row-main">
					<span class="set-row-label">
						{step.label}
						{#if step.optional}<span class="setup-tag">Optional</span>{/if}
					</span>
					<span class="set-row-sub">{step.how}</span>
				</span>
				{#if step.goTo}
					<button class="set-btn setup-go" onclick={() => (settingsStore.section = step.goTo!.section)}>
						{step.goTo.label}<ChevronRight class="set-btn-icon" aria-hidden="true" />
					</button>
				{/if}
			</li>
		{/each}
		<li class="set-row setup-step setup-step-ipad" data-step="ipad">
			<span class="setup-mark" aria-hidden="true">{steps.length + 1}</span>
			<span class="set-row-main">
				<span class="set-row-label">Open it on the iPad</span>
				<div class="setup-ipad">
					<IpadAddresses {addresses} state={addressState} />
				</div>
			</span>
		</li>
	</ol>

	<p class="set-note">
		{#if settingsStore.firstRun}
			<strong>Finish setup</strong> saves your Places and stops this page opening by itself. <strong>Set up later</strong>
			closes it for now; it opens again next time.
		{:else}
			Your Places are saved. <strong>Finish setup</strong> closes this page; the gear in the master track’s view opens it
			again.
		{/if}
	</p>
</div>

<style>
	.setup-intro {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}
	.setup-progress {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		max-width: 28rem;
	}
	.setup-progress-word {
		font-size: 0.875rem;
		color: var(--muted-foreground);
	}
	.setup-progress-word strong {
		color: var(--foreground);
		font-weight: 600;
	}
	.setup-bar {
		display: block;
		height: 6px;
		border-radius: 3px;
		background: var(--surface-well);
		border: 1px solid var(--line-strong);
		overflow: hidden;
	}
	.setup-bar-fill {
		display: block;
		height: 100%;
		background: var(--phosphor);
		transition: width 0.3s ease;
	}
	.setup-step {
		align-items: flex-start;
		padding-block: var(--spacing-lg);
	}
	.setup-mark {
		flex-shrink: 0;
		display: inline-flex;
		width: 1.75rem;
		height: 1.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1px solid var(--line-strong);
		background: var(--surface-well);
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.setup-mark :global(.setup-mark-icon) {
		width: 1rem;
		height: 1rem;
		stroke-width: 3;
	}
	.setup-step.done .setup-mark {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	.setup-step .set-row-label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-sm);
		line-height: 1.75rem;
	}
	.setup-step.done .set-row-label {
		color: var(--muted-foreground);
	}
	.setup-tag {
		padding: 0 0.375rem;
		font-size: 0.6875rem;
		font-weight: var(--font-weight-medium);
		line-height: 1.25rem;
		color: var(--fg-tertiary);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
	}
	.setup-go {
		align-self: center;
		flex-shrink: 0;
		min-width: 11.5rem;
		justify-content: space-between;
		gap: var(--spacing-xs);
		padding-inline: var(--spacing-md) var(--spacing-sm);
	}
	.setup-ipad {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-sm);
	}
	@media (max-width: 559.98px) {
		.setup-step {
			flex-wrap: wrap;
		}
		.setup-go {
			min-width: 0;
			margin-left: calc(1.75rem + var(--spacing-lg));
		}
	}
</style>
