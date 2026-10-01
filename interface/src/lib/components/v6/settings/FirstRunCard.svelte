<script lang="ts">
	/**
	 * Settings → Setup, the first-run checklist (onboarding.plan.md §7):
	 * Settings opened by itself because the Mac has saved nothing yet. Each
	 * step ticks itself when the app sees it done (`firstRunSteps`), a step a
	 * section of Settings does carries a button there, and the last word is
	 * the address to open on the iPad.
	 *
	 * The page's header ends it: Finish setup saves the ticks as they stand,
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
		addresses,
		addressState
	}: { steps: FirstRunStep[]; addresses: IpadAddress[]; addressState: 'loading' | 'ready' | 'failed' } = $props();
</script>

<div class="set-section">
	<p class="set-lead">
		Nothing has been set up on this Mac yet. Each step ticks itself when the app sees it done; the ones only the Mac
		can do are explained beside them. None of them means typing into a config file.
	</p>

	<ol class="set-list set-steps">
		{#each steps as step, i (step.key)}
			<li class="set-row set-step" class:done={step.done} data-step={step.key} data-done={step.done}>
				<span class="set-step-mark" aria-hidden="true">
					{#if step.done}<Check class="set-step-icon" />{/if}
				</span>
				<span class="set-row-main">
					<span class="set-row-label">{i + 1}. {step.label}</span>
					<span class="set-row-sub">{step.how}</span>
				</span>
				{#if step.goTo}
					<button class="set-btn set-step-go" onclick={() => (settingsStore.section = step.goTo!.section)}>
						{step.goTo.label}<ChevronRight class="set-btn-icon" aria-hidden="true" />
					</button>
				{/if}
			</li>
		{/each}
	</ol>

	<section class="set-group" data-step="ipad">
		<h2 class="set-group-title">{steps.length + 1}. Open it on the iPad</h2>
		<IpadAddresses {addresses} state={addressState} />
	</section>

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
	.set-lead {
		font-size: 0.9375rem;
		line-height: 1.45;
		color: var(--muted-foreground);
	}
	.set-step {
		align-items: flex-start;
	}
	.set-step-mark {
		flex-shrink: 0;
		display: inline-flex;
		width: 1.5rem;
		height: 1.5rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1px solid var(--line-strong);
		background: var(--surface-well);
		color: var(--muted-foreground);
		margin-top: 0.0625rem;
	}
	.set-step-mark :global(.set-step-icon) {
		width: 0.875rem;
		height: 0.875rem;
	}
	.set-step.done .set-step-mark {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
	}
	.set-step-go {
		align-self: center;
		flex-shrink: 0;
		min-width: 11.5rem;
		justify-content: space-between;
		gap: var(--spacing-xs);
		padding-inline: var(--spacing-md) var(--spacing-sm);
	}
	@media (max-width: 559.98px) {
		.set-step {
			flex-wrap: wrap;
		}
		.set-step-go {
			min-width: 0;
			margin-left: calc(1.5rem + var(--spacing-md));
		}
	}
</style>
