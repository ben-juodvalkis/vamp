import { describe, it, expect } from 'vitest';
import { validateOctets } from '$lib/utils/connectValidation';

describe('validateOctets', () => {
	it('should accept valid two-octet strings', () => {
		expect(validateOctets('37.129')).toBe(true);
		expect(validateOctets('0.0')).toBe(true);
		expect(validateOctets('255.255')).toBe(true);
		expect(validateOctets('1.1')).toBe(true);
		expect(validateOctets('100.200')).toBe(true);
	});

	it('should accept values with surrounding whitespace', () => {
		expect(validateOctets(' 37.129 ')).toBe(true);
		expect(validateOctets('  1.1  ')).toBe(true);
	});

	it('should reject values outside 0-255 range', () => {
		expect(validateOctets('256.0')).toBe(false);
		expect(validateOctets('0.256')).toBe(false);
		expect(validateOctets('-1.0')).toBe(false);
		expect(validateOctets('0.-1')).toBe(false);
		expect(validateOctets('999.999')).toBe(false);
	});

	it('should reject leading zeros', () => {
		expect(validateOctets('00.1')).toBe(false);
		expect(validateOctets('01.1')).toBe(false);
		expect(validateOctets('1.01')).toBe(false);
		expect(validateOctets('007.008')).toBe(false);
	});

	it('should reject wrong number of parts', () => {
		expect(validateOctets('1.2.3')).toBe(false);
		expect(validateOctets('1')).toBe(false);
		expect(validateOctets('1.2.3.4')).toBe(false);
		expect(validateOctets('')).toBe(false);
	});

	it('should reject non-numeric input', () => {
		expect(validateOctets('abc')).toBe(false);
		expect(validateOctets('a.b')).toBe(false);
		expect(validateOctets('1.abc')).toBe(false);
		expect(validateOctets('abc.1')).toBe(false);
	});

	it('should reject empty parts', () => {
		expect(validateOctets('.')).toBe(false);
		expect(validateOctets('.1')).toBe(false);
		expect(validateOctets('1.')).toBe(false);
	});
});
