<script lang="ts">
	/**
	 * The key picker's controls in the browser bar (ADR-446, ADR-447):
	 * Following / Locked, and Detect key. Sits where the browse switch would
	 * (column 1 of the bar controls), which in Key mode is otherwise empty.
	 */
	import { session } from '$lib/stores/session.svelte';
	import { setKeyFollow } from '$lib/services/sessionCommands';
	import type { KeyDetect } from './keyDetect.svelte';

	let { keyDetect }: { keyDetect: KeyDetect } = $props();
</script>

<div class="key-controls">
	<!-- Turning Follow back on makes the surface detect at once. -->
	<button
		class="follow-btn"
		class:on={session.keyFollowEnabled}
		onclick={() => setKeyFollow(!session.keyFollowEnabled)}
		aria-pressed={session.keyFollowEnabled}
		aria-label={session.keyFollowEnabled
			? 'The key follows the loops. Tap to lock it.'
			: 'The key is locked. Tap to let it follow the loops.'}
	>
		{session.keyFollowEnabled ? 'Following' : 'Locked'}
	</button>
	<button
		class="detect-btn"
		class:pending={keyDetect.pending}
		onclick={() => keyDetect.detect()}
		aria-label="Detect the key of the launched clips and set it"
	>
		{keyDetect.pending ? 'Listening…' : 'Detect key'}
	</button>
</div>

<style>
	.key-controls {
		grid-column: 1;
		justify-self: start;
		height: 100%;
		display: flex;
		gap: var(--spacing-sm);
	}
	.follow-btn,
	.detect-btn {
		height: 100%;
		padding: 0 var(--spacing-lg);
		border-radius: 12px;
		border: 1px solid var(--browser-border, #2a2e37);
		background: var(--browser-bg-primary, #16181d);
		color: var(--foreground, #eef0f4);
		font-size: var(--text-lg);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		cursor: pointer;
	}
	.follow-btn:active,
	.detect-btn:active { transform: scale(0.96); }
	.follow-btn.on { background: var(--accent); border-color: var(--accent); color: #0c0d10; }
	.detect-btn.pending { color: var(--accent); border-color: var(--accent); }
</style>
