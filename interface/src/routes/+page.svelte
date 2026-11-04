<script lang="ts">
	import Layout from '$lib/layouts/default/Layout.svelte';
	import PhoneLayout from '$lib/layouts/phone/PhoneLayout.svelte';
	import { PHONE_MEDIA_QUERY } from '$lib/utils/phoneLayout';

	// A phone-sized screen gets the tabs (ADR-503). Decided in the browser,
	// after the first render, so the server's page (the iPad's) hydrates as
	// it always has; a rotation or a Slide Over resize can switch it later.
	let phone = $state(false);

	$effect(() => {
		const query = window.matchMedia(PHONE_MEDIA_QUERY);
		phone = query.matches;
		const onChange = (e: MediaQueryListEvent) => (phone = e.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});
</script>

{#if phone}
	<PhoneLayout />
{:else}
	<Layout />
{/if}
