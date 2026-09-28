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
 * Parameter entry (retained for downstream consumers that still
 * import this type from '$lib/api/handlers')
 */
export interface ParameterEntry {
	deviceId: number;
	paramIndex: number;
	value: number;
}
