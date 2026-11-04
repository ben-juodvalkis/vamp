/**
 * The phone's tab bar and colour ribbon (ADR-503): a tab press hands the tab
 * up, Rec names the track it will record, the ribbon draws one segment per
 * track in its state and frames the tracks on screen.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.mock('$lib/utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import PhoneTabBar from '$lib/components/v6/phone/PhoneTabBar.svelte';
import PhoneTrackRibbon from '$lib/components/v6/phone/PhoneTrackRibbon.svelte';
import { _resetForTests, replaceTree, type TrackRecord } from '$lib/stores/v3/normalized.svelte';
import { applyTrackMeter, __resetMeterStoreForTests } from '$lib/stores/v3/meters.svelte';
import { session } from '$lib/stores/session.svelte';

function track(index: number, name: string, extra: Partial<TrackRecord> = {}): TrackRecord {
	return {
		trackPath: `tracks/${index}`,
		name,
		color: 0xff3636,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: true,
		hasAudioInput: false,
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: '',
		devices: new SvelteMap(),
		slots: new SvelteMap(),
		...extra
	};
}

async function tap(el: Element) {
	await fireEvent.pointerDown(el);
	await fireEvent.pointerUp(el);
	await tick();
}

beforeEach(() => {
	_resetForTests();
	__resetMeterStoreForTests();
	replaceTree(1, [track(0, 'Drums'), track(1, 'Bass', { mute: true }), track(2, 'Keys', { solo: true })]);
	session.selectTrackOptimistically(0);
});

afterEach(() => cleanup());

describe('PhoneTabBar', () => {
	it('draws the four tabs around Rec, the current one pressed', () => {
		const { container } = render(PhoneTabBar, { tab: 'clips', onSelect: vi.fn() });
		const tabs = [...container.querySelectorAll('[data-phone-tab]')].map((el) => el.getAttribute('data-phone-tab'));
		expect(tabs).toEqual(['mix', 'clips', 'track', 'browse']);
		expect(container.querySelector('[data-phone-tab="clips"]')?.getAttribute('aria-pressed')).toBe('true');
		expect(container.querySelector('[data-phone-tab="mix"]')?.getAttribute('aria-pressed')).toBe('false');
		// Rec sits between Clips and Track.
		const order = [...container.querySelectorAll('[data-phone-tab], [data-debug="phone-rec"]')].map(
			(el) => el.getAttribute('data-phone-tab') ?? 'rec'
		);
		expect(order).toEqual(['mix', 'clips', 'rec', 'track', 'browse']);
	});

	it('hands up the tab a press lands on', async () => {
		const onSelect = vi.fn();
		const { container } = render(PhoneTabBar, { tab: 'mix', onSelect });
		await tap(container.querySelector('[data-phone-tab="track"]')!);
		expect(onSelect).toHaveBeenCalledWith('track');
	});

	it('names the track Rec will record', async () => {
		const { container } = render(PhoneTabBar, { tab: 'mix', onSelect: vi.fn() });
		expect(container.querySelector('.rec-target')?.textContent).toBe('Drums');
		session.selectTrackOptimistically(2);
		await tick();
		expect(container.querySelector('.rec-target')?.textContent).toBe('Keys');
	});
});

describe('PhoneTrackRibbon', () => {
	it('draws a segment per track with its mute, solo, selection and meter', async () => {
		applyTrackMeter('tracks/0', 0.5, 0.5);
		const { container } = render(PhoneTrackRibbon, { tracks: [0, 1, 2], window: null, onPick: vi.fn() });
		await tick();
		const segs = [...container.querySelectorAll('[data-ribbon-track]')];
		expect(segs).toHaveLength(3);
		expect(segs[0].classList.contains('is-selected')).toBe(true);
		expect(segs[1].classList.contains('is-muted')).toBe(true);
		expect(segs[2].classList.contains('is-soloed')).toBe(true);
		const level = (segs[0].querySelector('.level') as HTMLElement).style.transform;
		expect(parseFloat(level.replace('scaleY(', ''))).toBeCloseTo(0.5, 3);
		expect(container.querySelector('.frame')).toBeNull();
	});

	it('frames the tracks on screen', () => {
		const { container } = render(PhoneTrackRibbon, {
			tracks: [0, 1, 2],
			window: { start: 1, end: 2.5 },
			onPick: vi.fn()
		});
		const frame = container.querySelector('.frame') as HTMLElement;
		const pct = (v: string) => parseFloat(v.replace('calc(', ''));
		expect(pct(frame.style.left)).toBeCloseTo(33.333, 2);
		expect(pct(frame.style.width)).toBeCloseTo(50, 2);
	});

	it('hands up the track a press lands on', async () => {
		const onPick = vi.fn();
		const { container } = render(PhoneTrackRibbon, { tracks: [0, 1, 2], window: null, onPick });
		await tap(container.querySelector('[data-ribbon-track="2"]')!);
		expect(onPick).toHaveBeenCalledWith(2);
	});
});
