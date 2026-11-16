import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BrowserWheelsFace from '$lib/components/v6/browser/BrowserWheelsFace.svelte';

describe('BrowserWheelsFace', () => {
	it('reports the release of a touch on the wheels, once', async () => {
		const onRelease = vi.fn();
		const { container } = render(BrowserWheelsFace, { props: { onRelease } });
		const face = container.querySelector('.wheels-face')!;
		await fireEvent.pointerDown(face);
		await fireEvent.pointerUp(window);
		await fireEvent.pointerUp(window);
		expect(onRelease).toHaveBeenCalledTimes(1);
	});

	it('ignores a release that began elsewhere', async () => {
		const onRelease = vi.fn();
		render(BrowserWheelsFace, { props: { onRelease } });
		await fireEvent.pointerUp(window);
		await fireEvent.pointerCancel(window);
		expect(onRelease).not.toHaveBeenCalled();
	});
});
