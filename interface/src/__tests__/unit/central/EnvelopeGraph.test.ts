/**
 * EnvelopeGraph and LfoGraph (ADR-514): an envelope and an LFO drawn as
 * Live draws them, from a panel's parameters by name.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import EnvelopeGraph, { envelopeShape } from '$lib/components/v6/central/EnvelopeGraph.svelte';
import LfoGraph, { lfoShape } from '$lib/components/v6/central/LfoGraph.svelte';
import type { PanelParams } from '$lib/components/v6/central/views/panel/usePanelParams.svelte';

afterEach(cleanup);

/** A device listing `values` (each 0..1), recording what is written. */
function fakeParams(values: Record<string, number>) {
	const writes: [string, number, string | undefined][] = [];
	const params: PanelParams = {
		has: (n) => n in values,
		raw: (n) => values[n],
		range: (n) => (n in values ? { min: 0, max: 1 } : undefined),
		display: () => undefined,
		isOn: (sw) => !sw || (values[sw] ?? 1) >= 0.5,
		write: (n, v, sw) => writes.push([n, v, sw]),
		unit: (n) => values[n],
		writeUnit: (n, t, sw) => writes.push([n, Math.max(0, Math.min(1, t)), sw])
	};
	return { params, writes };
}

describe('envelopeShape', () => {
	it('lays attack and decay a quarter each at most, holds to three quarters, releases in the last', () => {
		const s = envelopeShape({ a: 1, d: 1, s: 0.5, r: 1 });
		expect(s.peak).toEqual({ x: 0.25, y: 0 });
		expect(s.sustain).toEqual({ x: 0.5, y: 0.5 });
		expect(s.hold).toEqual({ x: 0.75, y: 0.5 });
		expect(s.end).toEqual({ x: 1, y: 1 });
	});

	it('draws a zero time as a vertical edge and the levels it is given', () => {
		const s = envelopeShape({ a: 0, d: 0, s: 1, r: 0, i: 0.25, p: 0.75, f: 0.5 });
		expect(s.start).toEqual({ x: 0, y: 0.75 });
		expect(s.peak).toEqual({ x: 0, y: 0.25 });
		expect(s.end).toEqual({ x: 0.75, y: 0.5 });
	});
});

describe('lfoShape', () => {
	it('reads every instrument’s spelling of a shape', () => {
		expect(lfoShape('Sine')(0.25)).toBeCloseTo(1);
		expect(lfoShape('Tri')(0)).toBeCloseTo(0);
		expect(lfoShape('Saw Up')(0.75)).toBeCloseTo(0.5);
		expect(lfoShape('Saw Dn')(0.75)).toBeCloseTo(-0.5);
		expect(lfoShape('Rect')(0.25)).toBe(1);
		expect(lfoShape('Square')(0.75)).toBe(-1);
		expect(lfoShape('S & H')(0.1)).toBe(lfoShape('Noise')(0.1));
		expect(lfoShape(undefined)(0.25)).toBeCloseTo(1);
	});
});

describe('EnvelopeGraph', () => {
	const names = { attack: 'Atk', decay: 'Dec', sustain: 'Sus', release: 'Rel' };

	it('reads the sustain level and ghosts while its section is off', () => {
		const { params } = fakeParams({ Atk: 0.1, Dec: 0.4, Sus: 0.6, Rel: 0.3, On: 0 });
		const { container } = render(EnvelopeGraph, { params, names, ink: '#f80', sw: 'On' });
		expect(container.querySelector('[role="slider"]')!.getAttribute('aria-valuenow')).toBe('60');
		expect(container.querySelector('.env-graph')!.classList.contains('off')).toBe(true);
	});

	it('moves the stage under the square nearest the finger, and draws none for a stage the device does not list', () => {
		// jsdom lays nothing out, so every square sits at one point: the
		// first listed one (Attack's; no Initial is listed) is the nearest.
		const { params, writes } = fakeParams({ Atk: 0.1, Dec: 0.4, Sus: 0.6, Rel: 0.3 });
		const { container } = render(EnvelopeGraph, { params, names: { ...names, initial: 'Init' }, ink: '#f80' });
		expect([...container.querySelectorAll('[data-env-handle]')].map((h) => h.getAttribute('data-env-handle'))).toEqual([]);
		const svg = container.querySelector('svg')!;
		svg.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }));
		svg.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 10, clientY: 0, bubbles: true }));
		expect(writes.map((w) => w[0])).toEqual(['Atk']);
	});

	it('ghosts an envelope the device does not list', () => {
		const { params } = fakeParams({});
		const { container } = render(EnvelopeGraph, { params, names, ink: '#f80' });
		expect(container.querySelector('.env-graph')!.classList.contains('off')).toBe(true);
	});
});

describe('LfoGraph', () => {
	it('draws its amount as the wave’s depth', () => {
		const { params } = fakeParams({ Amt: 0.4, Rate: 0.5 });
		const { container } = render(LfoGraph, { params, shape: 'Sine', rate: 'Rate', amount: 'Amt', ink: '#0af' });
		expect(container.querySelector('[role="slider"]')!.getAttribute('aria-valuenow')).toBe('40');
	});
});
