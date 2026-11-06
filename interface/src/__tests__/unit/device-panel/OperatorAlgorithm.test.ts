/**
 * Operator's chain cell draws its algorithm behind the pad: Live's layout
 * for the current algorithm, an oscillator filled while its switch is on.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import OperatorAlgorithm, { OPERATOR_ALGORITHMS } from '$lib/components/v6/device-panel/chain/OperatorAlgorithm.svelte';

describe('OperatorAlgorithm', () => {
	it('has Live\'s 11 algorithms, each placing four oscillators on distinct squares', () => {
		expect(OPERATOR_ALGORITHMS).toHaveLength(11);
		for (const alg of OPERATOR_ALGORITHMS) {
			expect(new Set(alg.map(([c, r]) => `${c},${r}`)).size).toBe(4);
		}
	});

	it('Alg. 1 stacks D over C over B over A; Alg. 11 lays them side by side', () => {
		const ys = (i: number) => OPERATOR_ALGORITHMS[i].map(([, r]) => r);
		expect(ys(0)).toEqual([6, 4, 2, 0]);
		expect(new Set(ys(10)).size).toBe(1);
	});

	it('fills the oscillators that are on and outlines the rest', () => {
		const { container } = render(OperatorAlgorithm, { algorithm: 4, on: [true, false, true, false] });
		expect(container.querySelector('[data-operator-algorithm]')?.getAttribute('data-operator-algorithm')).toBe('4');
		const on = [...container.querySelectorAll('rect')].map((r) => [r.dataset.osc, r.dataset.on, r.getAttribute('fill')]);
		expect(on.map(([o, d]) => `${o}${d}`)).toEqual(['A1', 'B0', 'C1', 'D0']);
		expect(on[1][2]).toBe('none');
		expect(on[0][2]).not.toBe('none');
	});
});
