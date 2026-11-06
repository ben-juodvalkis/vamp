/**
 * The chain's Recent column (ADR-484): the effects added lately, newest
 * first, once each; the column shows the first four that fit the chain:
 * no MIDI effect off a MIDI track, nothing the chain already holds; Live's
 * own effects fill what the recents leave.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const track = vi.hoisted(() => ({ type: 'midi' as 'midi' | 'audio' }));
const send = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/simpleClient', () => ({ send }));
vi.mock('$lib/services/effectView.svelte', () => ({ openViewWhenLanded: () => () => {} }));
vi.mock('$lib/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('$lib/stores/v6/selectedTrackStore.svelte', () => ({
	selectedTrackStore: {
		get trackType() {
			return track.type;
		},
		selectedTrackPath: 'tracks/0'
	}
}));

import { recordRecentEffect, recentEffects, recentForChain, addEffectToChain, pruneMissingRecents, _resetRecentEffectsForTests, RECENT_EFFECTS_MAX, DEFAULT_EFFECTS } from '$lib/services/recentEffects.svelte';
import type { ItemKind } from '$lib/utils/placeKinds';
import { _setEffectsFolderForTests } from '$lib/services/effectSources.svelte';

const SHELF = { name: 'Audio-Midi Effects', source: 'place:Audio-Midi Effects', devices: { Guitar: 'Guitar/Guitar.adg', 'Bass Amp': 'Guitar/Bass Amp.adg', Wah: 'Guitar/Wah.adg', 'Tone Shaper': 'Tone/Tone Shaper.amxd' } };

const fx = (name: string, kind: ItemKind = 'audio-effect') => ({ name, fullPath: `/shelf/${name}.adv`, source: '', rel: '', kind });

beforeEach(() => {
	_resetRecentEffectsForTests();
	_setEffectsFolderForTests(SHELF);
	track.type = 'midi';
	localStorage.clear();
});

describe('recent effects', () => {
	it('keeps the newest first, each once, and remembers them', () => {
		recordRecentEffect(fx('Echo'));
		recordRecentEffect(fx('Chorus'));
		recordRecentEffect(fx('Echo'));
		expect(recentEffects().map((r) => r.name)).toEqual(['Echo', 'Chorus']);
		expect(JSON.parse(localStorage.getItem('vamp.recentEffects')!).map((r: { name: string }) => r.name)).toEqual(['Echo', 'Chorus']);
	});

	it('keeps at most the list length', () => {
		for (let i = 0; i < RECENT_EFFECTS_MAX + 3; i++) recordRecentEffect(fx(`Fx ${i}`));
		expect(recentEffects()).toHaveLength(RECENT_EFFECTS_MAX);
	});

	it('shows up to twelve (or fewer on request), skipping what the chain holds and filling from older ones', () => {
		for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'Glue', 'Redux', 'Drum Buss', 'Chorus', 'Saturator', 'Echo']) recordRecentEffect(fx(n));
		expect(recentForChain(['Wavetable', 'Echo', 'Chorus']).map((r) => r.name)).toEqual(['Saturator', 'Drum Buss', 'Redux', 'Glue', 'J', 'I', 'H', 'G', 'F', 'E', 'D', 'C']);
		expect(recentForChain(['Wavetable', 'Echo', 'Chorus'], 4).map((r) => r.name)).toEqual(['Saturator', 'Drum Buss', 'Redux', 'Glue']);
	});

	it('shows no MIDI effect on an audio track', () => {
		recordRecentEffect(fx('Echo'));
		recordRecentEffect(fx('Arpeggiator', 'midi-effect'));
		recordRecentEffect(fx('Note Chance', 'max-midi-effect'));
		expect(recentForChain([]).map((r) => r.name).slice(0, 3)).toEqual(['Note Chance', 'Arpeggiator', 'Echo']);
		track.type = 'audio';
		expect(recentForChain([]).map((r) => r.name).slice(0, 2)).toEqual(['Echo', 'Reverb']);
	});

	it('fills an empty list with Live\'s own effects, skipping what the chain holds', () => {
		expect(recentForChain([])).toHaveLength(12);
		expect(recentForChain([]).map((r) => r.name).slice(0, 4)).toEqual(['Echo', 'Reverb', 'Auto Filter', 'Guitar']);
		expect(recentForChain(['Wavetable', 'Echo', 'Reverb']).map((r) => r.name).slice(0, 2)).toEqual(['Auto Filter', 'Guitar']);
		// The chain always has its own ghost Utility.
		expect(DEFAULT_EFFECTS.map((d) => d.name)).not.toContain('Utility');
		expect(DEFAULT_EFFECTS.map((d) => d.name)).toEqual(expect.arrayContaining(['Guitar', 'Bass Amp']));
		// Compressor and Phaser last, so they fill only what the rest leave.
		expect(DEFAULT_EFFECTS.map((d) => d.name).slice(-2)).toEqual(['Compressor', 'Phaser']);
	});

	it('puts the recents first, then the defaults they do not already name', () => {
		recordRecentEffect(fx('Echo'));
		recordRecentEffect(fx('Wah'));
		const names = recentForChain([]).map((r) => r.name);
		expect(names.slice(0, 3)).toEqual(['Wah', 'Echo', 'Reverb']);
		expect(names.filter((n) => n === 'Echo')).toHaveLength(1);
	});

	it('skips a default whose device is a recent or on the chain under another name', () => {
		recordRecentEffect(fx('Hybrid Reverb'));
		expect(recentForChain([]).map((r) => r.name)).not.toContain('Reverb');
		_resetRecentEffectsForTests();
		expect(recentForChain(['Hybrid Reverb']).map((r) => r.name)).not.toContain('Reverb');
	});

	it('inserts a default by name, with no file', async () => {
		send.mockClear();
		await addEffectToChain(DEFAULT_EFFECTS.find((d) => d.name === 'Reverb')!);
		expect(send).toHaveBeenCalledWith(expect.stringContaining('device/load'), ['tracks/0', '', '', 'native:Hybrid', 'Reverb']);
	});

	it('loads the amp racks from the effects folder, by name (ADR-498)', async () => {
		send.mockClear();
		await addEffectToChain(DEFAULT_EFFECTS.find((d) => d.name === 'Bass Amp')!);
		expect(send).toHaveBeenCalledWith(expect.stringContaining('device/load'), ['tracks/0', '', '', 'place:Audio-Midi Effects', 'Guitar/Bass Amp.adg']);
	});

	it('drops a recent whose file the Mac reports gone, and keeps Live devices by name', async () => {
		recordRecentEffect(fx('Echo'));
		recordRecentEffect(fx('Tone Shaper'));
		recordRecentEffect({ name: 'Reverb', fullPath: 'native:Hybrid', source: 'native:Hybrid', rel: 'Reverb', kind: 'audio-effect' });
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			const { paths } = JSON.parse(String(init.body)) as { paths: string[] };
			expect(paths).toEqual(['/shelf/Tone Shaper.adv', '/shelf/Echo.adv']);
			return new Response(JSON.stringify({ exists: { '/shelf/Echo.adv': true, '/shelf/Tone Shaper.adv': false } }));
		});
		vi.stubGlobal('fetch', fetchMock);
		await pruneMissingRecents();
		vi.unstubAllGlobals();
		expect(recentEffects().map((r) => r.name)).toEqual(['Reverb', 'Echo']);
		expect(JSON.parse(localStorage.getItem('vamp.recentEffects')!).map((r: { name: string }) => r.name)).toEqual(['Reverb', 'Echo']);
	});

	it('offers no amp rack the effects folder lacks', () => {
		_setEffectsFolderForTests(null);
		const names = recentForChain([]).map((r) => r.name);
		expect(names).not.toContain('Guitar');
		expect(names).not.toContain('Bass Amp');
		expect(names).toHaveLength(12);
	});
});
