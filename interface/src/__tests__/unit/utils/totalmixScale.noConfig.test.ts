/**
 * `totalmixScale.ts` has to load on a config with no TotalMix block.
 *
 * With the `totalmix` switch off (general-release audit §7b) a config need
 * carry no `osc.totalmix` at all, and nothing on screen is then drawn with
 * this module — but it is still imported by the strip every page mounts. It
 * used to destructure the block at import time, which on such a config threw
 * and took the whole interface down with it. It now falls back to the mixer's
 * own range (ADR-423).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('$config/constants.json', () => ({ default: { osc: {} } }));

describe('totalmixScale with no osc.totalmix block', () => {
	it('loads, on the mixer\'s own range', async () => {
		const scale = await import('$lib/utils/totalmixScale');
		expect(scale.MIN_DB).toBe(-65);
		expect(scale.MAX_DB).toBe(6);
		expect(scale.SILENCE_DB).toBe(-300);
		expect(scale.dbToFraction(-65)).toBe(0);
		expect(scale.dbToFraction(6)).toBe(1);
	});
});
