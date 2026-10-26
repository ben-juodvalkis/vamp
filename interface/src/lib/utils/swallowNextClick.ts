/**
 * Drop the one `click` that follows a press which opened something under the
 * finger (2026-10-26).
 *
 * `use:press` fires on `pointerup`; iPad Safari sends the press's `click`
 * after that, hit-tested at the touch point against the page as it is by
 * then. When the press opened an overlay, that click lands on whatever the
 * overlay put there: + Effect opened the browser on Audio Effects and its
 * click loaded the Beat Repeat tile under the finger, then the browser
 * closed, so the tap read as "added an effect without opening the browser".
 * Desktop Chrome sends the click to the pressed button instead, which this
 * swallows just the same. A click that never comes leaves the guard to lapse
 * after `ms`, so a real tap is never eaten.
 */
export function swallowNextClick(ms = 500): void {
	if (typeof window === 'undefined') return;
	const stop = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		done();
	};
	const timer = setTimeout(() => done(), ms);
	function done() {
		clearTimeout(timer);
		window.removeEventListener('click', stop, true);
	}
	window.addEventListener('click', stop, true);
}
