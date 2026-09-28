import { describe, it, expect } from 'vitest';
import {
	findVendorById,
	findVendorByVendorId,
	isSpecialButtonType,
	SPECIAL_BUTTON_TYPES,
	VENDOR_BUTTON_INDEX_OFFSET,
	type BrowserVendor
} from '$lib/components/v6/browser/utils/vendorModel';

const vendors: BrowserVendor[] = [
	{ id: 'place:drum', name: 'Drum', color: '#f00', vendorId: 'place:drum', trackType: 'midi' },
	{ id: 'place:bass', name: 'Bass', color: '#0f0', vendorId: 'place:bass', trackType: 'midi' },
	{ id: 'recent', name: 'Recent', color: '#00f', vendorId: 'recent-instruments', trackType: 'midi' }
];

describe('vendorModel — findVendorById', () => {
	it('finds by button id', () => {
		expect(findVendorById(vendors, 'place:bass')?.vendorId).toBe('place:bass');
		expect(findVendorById(vendors, 'recent')?.vendorId).toBe('recent-instruments');
	});

	it('returns undefined for null / unknown ids', () => {
		expect(findVendorById(vendors, null)).toBeUndefined();
		expect(findVendorById(vendors, undefined)).toBeUndefined();
		expect(findVendorById(vendors, 'nope')).toBeUndefined();
	});
});

describe('vendorModel — findVendorByVendorId', () => {
	it('finds by adapter vendorId', () => {
		expect(findVendorByVendorId(vendors, 'recent-instruments')?.id).toBe('recent');
		expect(findVendorByVendorId(vendors, 'place:drum')?.id).toBe('place:drum');
	});

	it('returns undefined for null / unknown vendorIds', () => {
		expect(findVendorByVendorId(vendors, null)).toBeUndefined();
		expect(findVendorByVendorId(vendors, 'recent')).toBeUndefined(); // button id, not vendorId
	});
});

describe('vendorModel — isSpecialButtonType', () => {
	it('matches the special button types', () => {
		for (const t of SPECIAL_BUTTON_TYPES) {
			expect(isSpecialButtonType(t)).toBe(true);
		}
	});

	it('rejects vendor/type buttons and empties', () => {
		expect(isSpecialButtonType('vendor')).toBe(false);
		expect(isSpecialButtonType('')).toBe(false);
		expect(isSpecialButtonType(undefined)).toBe(false);
		expect(isSpecialButtonType(null)).toBe(false);
	});
});

describe('vendorModel — VENDOR_BUTTON_INDEX_OFFSET', () => {
	it('pins the offset to VendorButtonGrid\'s leading-slot count', () => {
		// Record/Recent/Audio occupy data-index 0..2; first type button is 3.
		expect(VENDOR_BUTTON_INDEX_OFFSET).toBe(3);
	});

	it('recovers the vendor-list index from a col-0 data-index', () => {
		// data-index 3 → first type button → vendors[0]
		expect(vendors[3 - VENDOR_BUTTON_INDEX_OFFSET]).toBe(vendors[0]);
	});
});
