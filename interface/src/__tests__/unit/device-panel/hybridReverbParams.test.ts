import { describe, it, expect } from 'vitest';
import {
	TIDES_RATE,
	TIDES_RATE_MAX,
	tidesRateLabel,
	toRaw,
	toPosition
} from '$lib/components/v6/device-panel/hybridReverbParams';

describe('hybridReverbParams', () => {
	it('labels Ti Rate the way Live does (str_for_value, 2026-10-02)', () => {
		expect(TIDES_RATE_MAX).toBe(29);
		expect(tidesRateLabel(0)).toBe('1/128 T');
		expect(tidesRateLabel(3)).toBe('1/128 D');
		expect(tidesRateLabel(16)).toBe('1/4');
		expect(tidesRateLabel(22)).toBe('1');
		expect(tidesRateLabel(29)).toBe('4 D');
	});

	it('spreads the slider over all 30 Ti Rate steps', () => {
		expect(toRaw(TIDES_RATE, 0)).toBe(0);
		expect(toRaw(TIDES_RATE, 1)).toBe(29);
		expect(toRaw(TIDES_RATE, 0.5)).toBe(15);
		expect(toPosition(TIDES_RATE, 29)).toBe(1);
		expect(toRaw(TIDES_RATE, toPosition(TIDES_RATE, 22))).toBe(22);
	});

	it('passes 0..1 parameters through unchanged', () => {
		expect(toRaw(11, 0.3)).toBe(0.3);
		expect(toPosition(11, 0.3)).toBe(0.3);
		expect(toRaw(11, 1.4)).toBe(1);
	});
});
