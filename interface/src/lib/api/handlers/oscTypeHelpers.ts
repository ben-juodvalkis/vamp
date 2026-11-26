/**
 * OSC Type Helpers
 *
 * Safe type coercion functions for OSCArg values.
 */

import { logger } from '$lib/utils/logger';
import type { OSCArg } from '$lib/types/osc';

/**
 * Safely convert an OSCArg to a number
 */
export function toNumber(arg: OSCArg): number {
	if (typeof arg === 'number') return arg;
	if (typeof arg === 'string') {
		const num = Number(arg);
		return isNaN(num) ? 0 : num;
	}
	if (typeof arg === 'boolean') return arg ? 1 : 0;
	if (arg instanceof Uint8Array) {
		logger.warn('Cannot convert Uint8Array to number', { length: arg.length });
	}
	return 0;
}

/**
 * Safely convert an OSCArg to a string
 */
export function toString(arg: OSCArg): string {
	if (typeof arg === 'string') return arg;
	if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
	if (arg instanceof Uint8Array) {
		logger.warn('Cannot convert Uint8Array to string', { length: arg.length });
		return '[Binary Data]';
	}
	return '';
}

/**
 * An OSCArg as a finite number, or null when it is not one. For values
 * where 0 is meaningful and junk must be told apart from it (meters,
 * levels, step positions).
 */
export function toFiniteNumber(v: OSCArg): number | null {
	if (typeof v === 'number') return v;
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/** An OSCArg as a boolean: nonzero, `true`, `'1'` or `'true'`. */
export function toBool(v: OSCArg): boolean {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'number') return v !== 0;
	if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
	return Boolean(v);
}
