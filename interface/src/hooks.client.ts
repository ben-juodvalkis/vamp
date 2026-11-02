import type { ClientInit } from '@sveltejs/kit';

/**
 * The browser demo (ADR-502) installs its in-page Live before the layout
 * dials one. `VITE_VAMP_DEMO` is replaced at build time, so in every other
 * build this branch, and the dynamic import with it, is compiled out.
 */
export const init: ClientInit = async () => {
	if (import.meta.env.VITE_VAMP_DEMO === '1') {
		const { installDemo } = await import('$lib/demo');
		installDemo();
	}
};
