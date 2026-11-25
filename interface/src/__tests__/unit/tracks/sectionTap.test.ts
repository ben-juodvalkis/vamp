import { describe, it, expect, vi } from 'vitest';
import { sectionAt, dispatchSectionTap, type SectionTapHandlers } from '$lib/components/v6/tracks/TrackStrip/utils/sectionTap';

/** A Card with sections stacked at the given [top, bottom] rows. */
function card(sections: Array<[string, number, number]>) {
	const root = document.createElement('div');
	for (const [name, top, bottom] of sections) {
		const el = document.createElement('div');
		el.setAttribute('data-section', name);
		el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 80 }) as DOMRect;
		root.appendChild(el);
	}
	return root;
}

const nothingUnder = { elementFromPoint: () => null };

describe('sectionAt', () => {
	it('takes the section under the finger when there is one', () => {
		const c = card([['clip', 0, 100]]);
		const doc = { elementFromPoint: () => c.firstElementChild };
		expect(sectionAt(10, 50, c, doc)).toBe('clip');
	});

	it('gives a seam to the nearest section on the Y axis', () => {
		const c = card([
			['clip', 0, 100],
			['device', 108, 200],
			['permute', 208, 300]
		]);
		expect(sectionAt(10, 102, c, nothingUnder)).toBe('clip');
		expect(sectionAt(10, 106, c, nothingUnder)).toBe('device');
		expect(sectionAt(10, 205, c, nothingUnder)).toBe('permute');
		// Below the Card (the slop over the name seam): the last section.
		expect(sectionAt(10, 320, c, nothingUnder)).toBe('permute');
	});

	it('resolves nothing with no Card', () => {
		expect(sectionAt(10, 10, null, nothingUnder)).toBeNull();
	});
});

function handlers(groupGestureActive = false): SectionTapHandlers {
	return {
		groupGestureActive,
		groupTap: vi.fn(),
		fold: vi.fn(),
		clip: vi.fn(),
		permute: vi.fn(),
		device: vi.fn(),
		groupBody: vi.fn()
	};
}

describe('dispatchSectionTap', () => {
	it('routes each section to its action', () => {
		const h = handlers();
		dispatchSectionTap('clip', h);
		dispatchSectionTap('permute', h);
		dispatchSectionTap('device', h);
		dispatchSectionTap('fold', h);
		dispatchSectionTap('group-body', h);
		for (const k of ['clip', 'permute', 'device', 'fold', 'groupBody'] as const) {
			expect(h[k]).toHaveBeenCalledTimes(1);
		}
		expect(h.groupTap).not.toHaveBeenCalled();
	});

	it('with the Group button held, a select tap is a group tap; fold is still fold', () => {
		const h = handlers(true);
		dispatchSectionTap('clip', h);
		dispatchSectionTap('group-body', h);
		expect(h.groupTap).toHaveBeenCalledTimes(2);
		expect(h.clip).not.toHaveBeenCalled();
		dispatchSectionTap('fold', h);
		expect(h.fold).toHaveBeenCalledTimes(1);
	});

	it('a tap on no section does nothing, Group held or not', () => {
		const h = handlers(true);
		dispatchSectionTap(null, h);
		expect(Object.values(h).filter((v) => typeof v === 'function' && vi.isMockFunction(v) && v.mock.calls.length)).toEqual([]);
	});
});
