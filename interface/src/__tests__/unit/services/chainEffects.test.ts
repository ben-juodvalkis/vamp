/**
 * The chain's load path (ADR-523): a palette chip or a browser pick, onto
 * the selected track's chain. A Live device by name, one of the user's
 * effects by name from the effects folder (ADR-498), or a preset file.
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

import { addEffectToChain, fitsSelectedTrack } from '$lib/services/chainEffects.svelte';
import { _setEffectsFolderForTests } from '$lib/services/effectSources.svelte';

const SHELF = { name: 'Audio-Midi Effects', source: 'place:Audio-Midi Effects', devices: { Guitar: 'Guitar/Guitar.adg', 'Bass Amp': 'Guitar/Bass Amp.adg' } };

beforeEach(() => {
	_setEffectsFolderForTests(SHELF);
	track.type = 'midi';
	send.mockClear();
});

describe('adding an effect to the chain', () => {
	it('inserts a Live device by name, with no file', async () => {
		await addEffectToChain({ name: 'Reverb', fullPath: 'default:reverb', source: 'native:Hybrid', rel: 'Reverb', kind: 'audio-effect', preset: 'reverb' });
		expect(send).toHaveBeenCalledWith(expect.stringContaining('device/load'), ['tracks/0', '', '', 'native:Hybrid', 'Reverb']);
	});

	it('loads one of the user\'s effects from the effects folder, by name (ADR-498)', async () => {
		await addEffectToChain({ name: 'Bass Amp', fullPath: 'default:bass', source: '', rel: '', kind: 'audio-effect', preset: 'bass' });
		expect(send).toHaveBeenCalledWith(expect.stringContaining('device/load'), ['tracks/0', '', '', 'place:Audio-Midi Effects', 'Guitar/Bass Amp.adg']);
	});

	it('loads nothing the effects folder lacks', async () => {
		_setEffectsFolderForTests(null);
		await addEffectToChain({ name: 'Bass Amp', fullPath: 'default:bass', source: '', rel: '', kind: 'audio-effect', preset: 'bass' });
		expect(send).not.toHaveBeenCalledWith(expect.stringContaining('device/load'), expect.anything());
	});

	it('puts a MIDI effect only on a MIDI track', async () => {
		expect(fitsSelectedTrack({ kind: 'midi-effect' })).toBe(true);
		track.type = 'audio';
		expect(fitsSelectedTrack({ kind: 'midi-effect' })).toBe(false);
		expect(fitsSelectedTrack({ kind: 'audio-effect' })).toBe(true);
		await addEffectToChain({ name: 'Arpeggiator', fullPath: 'default:arpeggiator', source: 'native:MidiArpeggiator', rel: 'Arpeggiator', kind: 'midi-effect', preset: 'arpeggiator' });
		expect(send).not.toHaveBeenCalledWith(expect.stringContaining('device/load'), expect.anything());
	});
});
