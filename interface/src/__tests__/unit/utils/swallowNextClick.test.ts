import { afterEach, describe, expect, it, vi } from 'vitest';
import { swallowNextClick } from '$lib/utils/swallowNextClick';

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

function tile() {
	const el = document.createElement('button');
	const onClick = vi.fn();
	el.addEventListener('click', onClick);
	document.body.appendChild(el);
	return { el, onClick };
}

describe('swallowNextClick', () => {
	it('drops the click that follows the press: the tile the overlay put under the finger never sees it', () => {
		const { el, onClick } = tile();
		swallowNextClick();
		el.click(); // iPad Safari's click, landing on the browser tile
		expect(onClick).not.toHaveBeenCalled();
		el.click(); // the next, real tap
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('lapses when no click follows, so a later real tap goes through', () => {
		vi.useFakeTimers();
		const { el, onClick } = tile();
		swallowNextClick(500);
		vi.advanceTimersByTime(501);
		el.click();
		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
