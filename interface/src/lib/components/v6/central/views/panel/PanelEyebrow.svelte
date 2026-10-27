<script lang="ts">
	/**
	 * The eyebrow over a section of an instrument panel (ADR-487): Live's
	 * section name, centred, 0.75rem, in the device's ink. With a page and a
	 * way to open it, it is a button ("Hammer ›") that opens the section's
	 * page; without a name it still takes its line, so the boxes of every
	 * section in a row start on the same pixel. A hand-laid face uses it over
	 * its own columns, as `PanelGroupView` does over a group.
	 */
	interface Props {
		title?: string;
		page?: string;
		onOpen?: (page: string) => void;
		color: string;
	}

	let { title, page, onOpen, color }: Props = $props();
</script>

{#if page && onOpen}
	<button class="panel-eyebrow eyebrow-link" style="color: {color};" data-page={page} onclick={() => onOpen?.(page)}>
		{title} ›
	</button>
{:else}
	<span class="panel-eyebrow" style="color: {color};">{title ?? ''}&nbsp;</span>
{/if}

<style>
	/* The house eyebrow (EnvelopeGroup's): 0.75rem, centred, upright. */
	.panel-eyebrow {
		flex: 0 0 auto;
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1rem;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}
	/* A link to the section's page: the eyebrow's line, as wide as a
	   finger can find, underlined so it reads as something to press. */
	.eyebrow-link {
		align-self: center;
		background: none;
		border: 0;
		padding: 0 0.75rem;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	:global([data-grammar='flat']) .panel-eyebrow {
		font-weight: var(--font-weight-medium);
	}
</style>
