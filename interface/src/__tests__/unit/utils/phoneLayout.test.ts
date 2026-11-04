/**
 * The phone layout's pure decisions (ADR-503): which screens get it, the
 * remembered tab, and the ribbon's frame over the tracks on screen.
 */
import { describe, it, expect } from 'vitest';
import { isPhoneViewport, parsePhoneTab, ribbonWindow, PHONE_MEDIA_QUERY } from '$lib/utils/phoneLayout';
import { PHONE_COLUMN_PITCH, PHONE_ROW_INSET } from '$lib/components/v6/phone/phoneGeometry';

describe('isPhoneViewport', () => {
	it.each([
		['iPhone 16 Pro portrait', 393, 852, true],
		['iPhone 16 Pro landscape', 852, 393, true],
		['iPhone SE portrait', 375, 667, true],
		['iPad Slide Over', 320, 1024, true],
		['iPad Pro 12.9 landscape', 1366, 1024, false],
		['iPad Pro 12.9 portrait', 1024, 1366, false],
		['iPad mini landscape', 1133, 744, false],
		['iPad mini portrait', 744, 1133, false],
		['iPad split view half', 678, 1024, false]
	])('%s (%ix%i) → %s', (_name, width, height, phone) => {
		expect(isPhoneViewport(width, height)).toBe(phone);
	});

	it('says the same thing as a media query', () => {
		expect(PHONE_MEDIA_QUERY).toBe('(max-width: 599px), (max-height: 499px)');
	});
});

describe('parsePhoneTab', () => {
	it('keeps a known tab and falls back to Mix for anything else', () => {
		expect(parsePhoneTab('clips')).toBe('clips');
		expect(parsePhoneTab('browse')).toBe('browse');
		expect(parsePhoneTab(null)).toBe('mix');
		expect(parsePhoneTab('settings')).toBe('mix');
	});
});

describe('ribbonWindow', () => {
	const at = (scrollLeft: number, extra: Partial<Parameters<typeof ribbonWindow>[0]> = {}) =>
		ribbonWindow({
			scrollLeft,
			clientWidth: 393,
			pitch: PHONE_COLUMN_PITCH,
			count: 12,
			inset: PHONE_ROW_INSET,
			...extra
		});

	it('frames the five strips and a sliver a 393-point phone shows at rest', () => {
		const w = at(0);
		expect(w.start).toBe(0);
		expect(w.end).toBeCloseTo((393 - 12) / 72, 5);
	});

	it('moves by one track per column pitch scrolled', () => {
		const w = at(PHONE_ROW_INSET + 3 * PHONE_COLUMN_PITCH);
		expect(w.start).toBeCloseTo(3, 5);
		expect(w.end - w.start).toBeCloseTo(393 / 72, 5);
	});

	it('leaves out what a pinned column covers', () => {
		const w = at(0, { pinned: 84 });
		expect(w.end).toBeCloseTo((393 - 84 - 12) / 72, 5);
	});

	it('never runs past the last track', () => {
		const w = at(10_000);
		expect(w.start).toBe(12);
		expect(w.end).toBe(12);
	});

	it('frames nothing with no tracks or no pitch', () => {
		expect(at(0, { count: 0 })).toEqual({ start: 0, end: 0 });
		expect(at(0, { pitch: 0 })).toEqual({ start: 0, end: 0 });
	});
});
