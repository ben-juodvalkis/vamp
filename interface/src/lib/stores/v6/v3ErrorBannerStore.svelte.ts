/**
 * V3 Error Banner Store (PR-5e2)
 *
 * Surfaces transient user-facing error notices from the Python Control
 * Surface. Today the only producer is GrooveComponent's pool-exhausted
 * refusal — firing a set when all 32 pool slots are in use returns
 * `/looping/v3/error [originatingAddress, "pool-exhausted", clipPath, detail]`
 * and the write is dropped server-side. The banner tells the user why
 * the knob didn't move.
 *
 * Auto-dismiss after `AUTO_DISMISS_MS` so transient errors don't stack
 * up; manual dismiss via `clear()` is available for persistent banners
 * future codes might want.
 */

export interface V3ErrorBanner {
	code: string;
	path: string;
	detail: string;
	timestamp: number;
}

const AUTO_DISMISS_MS = 6000;

let _banner = $state<V3ErrorBanner | null>(null);
let _timeout: ReturnType<typeof setTimeout> | null = null;

function show(code: string, path: string, detail: string) {
	_banner = { code, path, detail, timestamp: Date.now() };
	if (_timeout !== null) {
		clearTimeout(_timeout);
	}
	_timeout = setTimeout(() => {
		_banner = null;
		_timeout = null;
	}, AUTO_DISMISS_MS);
}

function clear() {
	_banner = null;
	if (_timeout !== null) {
		clearTimeout(_timeout);
		_timeout = null;
	}
}

export const v3ErrorBannerStore = {
	get banner() {
		return _banner;
	},
	show,
	clear
};
