/**
 * The strip's device band (the second card section, between Clip and
 * Permute).
 *
 * `trackDeviceGlance` is the whole decision: which device the band
 * stands for, WHICH PICTURE it draws (the mark of the category an
 * instrument's preset came from, a knob, a glyph, or nothing), which
 * controls that knob
 * read, and what a tap opens. What is pinned here is what would be wrong
 * on a strip if it broke — the head is the chain-FIRST instrument (not
 * just any device), an audio track falls back to its chain head and
 * never claims a plug-in as its instrument, the view type a tap opens
 * resolves only for devices the rig actually draws a view for, and a
 * control's value is normalized by the P record's own min/max rather
 * than assumed to be 0..1.
 *
 * It reads only the v3 tree, which is the point: the band is live on
 * every track without subscribing to anything.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import {
	_resetForTests,
	replaceTree,
	v3Store,
	type DeviceRecord,
	type ParamRecord,
	type TrackRecord
} from '$lib/stores/v3/normalized.svelte';
import type { OSCArg } from '$lib/types/osc';
import { trackDeviceGlance } from '$lib/components/v6/tracks/composables/useTrackDevice.svelte';
import { machineStore } from '$lib/stores/machineStore.svelte';

// The library's folder reaches the client over /bridge/machine at run time
// (onboarding.plan.md §6.5), from a Mac's own config; here, a fixture one.
const LIBRARY = '/Volumes/Audio/User Library/Looping Presets/Instruments';
machineStore.update(JSON.stringify({ paths: { instrumentsBase: LIBRARY, effectPresetsBase: '', m4lDevicesRoot: '' }, totalmix: null }));

type ParamSpec = { name: string; value: number; min?: number; max?: number };

function device(
	devicePath: string,
	name: string,
	className: string,
	params: ParamSpec[] = []
): DeviceRecord {
	const map = new SvelteMap<string, ParamRecord>();
	params.forEach((p, i) => {
		const paramPath = `${devicePath}/params/${i}`;
		map.set(paramPath, {
			paramPath,
			name: p.name,
			displayName: p.name,
			min: p.min ?? 0,
			max: p.max ?? 1,
			value: p.value,
			unit: ''
		});
	});
	return { devicePath, name, className, params: map, properties: new SvelteMap<string, OSCArg>() };
}

/** A track whose chain is the given devices, in order. */
function track(
	trackPath: string,
	kind: 'midi' | 'audio',
	devices: DeviceRecord[],
	recorded: { role?: string; preset?: string } = {}
): TrackRecord {
	return {
		trackPath,
		name: 'T',
		color: 0,
		mute: false,
		solo: false,
		arm: false,
		hasMidiInput: kind === 'midi',
		hasAudioInput: kind === 'audio',
		hasArrangementClips: false,
		isFoldable: false,
		foldState: false,
		groupTrackIndex: -1,
		role: recorded.role ?? '',
		preset: recorded.preset,
		devices: new SvelteMap<string, DeviceRecord>(devices.map((d) => [d.devicePath, d])),
		slots: new SvelteMap()
	};
}

/** Enough leading params that index 21 (Drift's "Osc 1 Shape") exists. */
function paramsUpTo(index: number, value: number, range?: { min: number; max: number }): ParamSpec[] {
	const out: ParamSpec[] = [];
	for (let i = 0; i <= index; i++) {
		out.push({
			name: i === 0 ? 'Device On' : `P${i}`,
			value: i === index ? value : 0,
			min: i === index ? range?.min : undefined,
			max: i === index ? range?.max : undefined
		});
	}
	return out;
}

beforeEach(() => {
	_resetForTests();
});

describe('trackDeviceGlance', () => {
	it('names the chain-first instrument, not the MIDI effect ahead of it', () => {
		replaceTree(1, [
			track('tracks/0', 'midi', [
				device('tracks/0/devices/0', 'Arpeggiator', 'MidiArpeggiator'),
				device('tracks/0/devices/1', '32 Pad Kit Jazz', 'DrumGroupDevice'),
				device('tracks/0/devices/2', 'Reverb', 'Hybrid')
			])
		]);

		const glance = trackDeviceGlance('tracks/0');

		expect(glance.kind).toBe('instrument');
		expect(glance.name).toBe('32 Pad Kit Jazz');
		expect(glance.instrumentType).toBe('drumrack');
		expect(glance.headPath).toBe('tracks/0/devices/1');
		// No recorded category, so no drum: the drum is the Drum CATEGORY's
		// mark, not the Drum Rack's (user, 2026-09-18). With no named macro
		// to draw either, the kit is only "an instrument".
		expect(glance.mode).toBe('glyph');
		expect(glance.glyph).toBe('device');
	});

	it('falls back to the chain head on an audio track, and resolves its view type', () => {
		replaceTree(1, [
			track('tracks/1', 'audio', [
				device('tracks/1/devices/0', 'Auto Filter', 'AutoFilter2'),
				device('tracks/1/devices/1', 'Delay', 'Delay'),
				device('tracks/1/devices/2', 'Bass Amp', 'AudioEffectGroupDevice')
			])
		]);

		const glance = trackDeviceGlance('tracks/1');

		expect(glance.kind).toBe('device');
		expect(glance.name).toBe('Auto Filter');
		expect(glance.instrumentType).toBeNull();
		// The Auto Filter's own central view — `filter` in the registry.
		expect(glance.deviceViewType).toBe('filter');
		// An audio track gets a glyph, and the glyph is the GUITAR three
		// devices down the chain, not the filter at its head.
		expect(glance.mode).toBe('glyph');
		expect(glance.glyph).toBe('guitar');
	});

	it('leaves the view type null for a device the rig draws no view for', () => {
		replaceTree(1, [
			track('tracks/1', 'audio', [device('tracks/1/devices/0', 'Blur', 'MxDeviceAudioEffect')])
		]);

		const glance = trackDeviceGlance('tracks/1');

		expect(glance.kind).toBe('device');
		expect(glance.name).toBe('Blur');
		// `smudge` is a real preset, but it has no entry in the device view
		// registry (it is a lane of the Chorus view, not a view of its own)
		// — the band still names it and still selects the track.
		expect(glance.deviceViewType).toBeNull();
	});

	it('opens the Guitar view for a Bass at the chain head', () => {
		// `bass` gained a registry entry with the Bass tile in the audio
		// track's fx1 column (2026-09-14), so a bass track's device band
		// opens the view carrying the Bass mix fader instead of falling
		// back to the clip view.
		replaceTree(1, [
			track('tracks/1', 'audio', [device('tracks/1/devices/0', 'Bass Amp', 'AudioEffectGroupDevice')])
		]);

		const glance = trackDeviceGlance('tracks/1');

		expect(glance.kind).toBe('device');
		expect(glance.name).toBe('Bass Amp');
		expect(glance.deviceViewType).toBe('bass');
	});

	it('never calls a plug-in on an AUDIO track the track\'s instrument', () => {
		// `AuPluginDevice` is in INSTRUMENT_CLASSES (it is how Omnisphere
		// is found), so without the track-kind gate a guitar track's amp
		// sim came back as an instrument — inked as the track's voice and
		// opening an instrument view that does not exist.
		replaceTree(1, [
			track('tracks/1', 'audio', [device('tracks/1/devices/0', 'Helix Native', 'AuPluginDevice')])
		]);

		const glance = trackDeviceGlance('tracks/1');

		expect(glance.kind).toBe('device');
		expect(glance.instrumentType).toBeNull();
		expect(glance.instrumentViewType).toBeNull();
	});

	it('names a plug-in instrument on a MIDI track but opens no view for it', () => {
		replaceTree(1, [
			track('tracks/2', 'midi', [device('tracks/2/devices/0', 'Serum', 'AuPluginDevice')])
		]);

		const glance = trackDeviceGlance('tracks/2');

		expect(glance.kind).toBe('instrument');
		expect(glance.name).toBe('Serum');
		expect(glance.instrumentType).toBe('plugin');
		// No `plugin` entry in the instrument registry: opening one lands
		// on the empty default view, so the tap takes the fallback instead.
		expect(glance.instrumentViewType).toBeNull();
	});

	it('never resolves an ambiguous class by class alone', () => {
		// AuPluginDevice is Guitar, Helix Native, Omnisphere and Komplete
		// Kontrol at once. A plug-in whose name matches no preset must not
		// inherit the first one that happens to share the class — that is
		// how a mystery plug-in would have drawn a guitar.
		replaceTree(1, [
			track('tracks/1', 'audio', [device('tracks/1/devices/0', 'Some Other Plugin', 'AuPluginDevice')])
		]);

		const glance = trackDeviceGlance('tracks/1');

		expect(glance.deviceViewType).toBeNull();
		expect(glance.ink).toBeNull();
		expect(glance.glyph).toBe('keys');
	});

	it("reads an audio track's Simpler as a Simpler rather than a mystery device", () => {
		// The rig has no `DEVICE_PRESETS` entry for a Simpler, so the
		// preset table says nothing; the class does.
		replaceTree(1, [
			track('tracks/1', 'audio', [
				device('tracks/1/devices/0', 'Field Rec', 'OriginalSimpler'),
				device('tracks/1/devices/1', 'Reverb', 'Hybrid')
			])
		]);

		expect(trackDeviceGlance('tracks/1').glyph).toBe('simpler');
	});

	it('reads a control and normalizes it by the P record range', () => {
		// Drift's shape knob is param 21 ("Osc 1 Shape"). Give the record a
		// −1..1 range so a plain "value as fraction" read would be wrong.
		replaceTree(1, [
			track('tracks/2', 'midi', [
				device('tracks/2/devices/0', 'Drift', 'Drift', paramsUpTo(21, 0.5, { min: -1, max: 1 }))
			])
		]);

		const glance = trackDeviceGlance('tracks/2');

		expect(glance.instrumentType).toBe('drift');
		expect(glance.mode).toBe('knobs');
		const shape = glance.controls.find((c) => c.label === 'Shp');
		expect(shape?.value).toBeCloseTo(0.75);
	});

	it('falls back to a glyph for an instrument that lists none of its controls', () => {
		// An Operator with nothing at 8 / 26 / 29 / 34 — a device whose
		// parameters have not landed yet. The band must draw SOMETHING;
		// collapsing to nothing reads as a rendering fault.
		replaceTree(1, [
			track('tracks/3', 'midi', [device('tracks/3/devices/0', 'Operator', 'Operator')])
		]);

		const glance = trackDeviceGlance('tracks/3');

		expect(glance.controls).toEqual([]);
		expect(glance.mode).toBe('glyph');
		expect(glance.glyph).toBe('keys');
	});

	it('skips macros Live never named, and keeps the ones it did', () => {
		// A rack draws its macros; a bare "Macro 5" says nothing a strip
		// has room for, so the walk passes over it to the next named one.
		replaceTree(1, [
			track('tracks/3', 'midi', [
				device('tracks/3/devices/0', 'Stack', 'InstrumentGroupDevice', [
					{ name: 'Device On', value: 1 },
					{ name: 'Macro 1', value: 0.2 },
					{ name: 'Drive', value: 0.5 },
					{ name: 'Macro 3', value: 0.9 },
					{ name: 'Filter Freq', value: 0.25 }
				])
			])
		]);

		const glance = trackDeviceGlance('tracks/3');

		expect(glance.mode).toBe('knobs');
		// Both are squeezed to four: "Drive" → "Drv", "Filter Freq" → "Fltr".
		expect(glance.controls.map((c) => c.label)).toEqual(['Drv', 'Fltr']);
		expect(glance.controls[0].value).toBeCloseTo(0.5);
	});

	it('splits the Instrument Rack pattern variant off the first macro name', () => {
		replaceTree(1, [
			track('tracks/4', 'midi', [
				device('tracks/4/devices/0', 'Patterns', 'InstrumentGroupDevice', [
					{ name: 'Device On', value: 1 },
					{ name: 'Pattern 16', value: 0 }
				])
			]),
			track('tracks/5', 'midi', [
				device('tracks/5/devices/0', 'Stack', 'InstrumentGroupDevice', [
					{ name: 'Device On', value: 1 },
					{ name: 'Macro 1', value: 0 }
				])
			])
		]);

		expect(trackDeviceGlance('tracks/4').instrumentType).toBe('instrument-rack-pattern');
		expect(trackDeviceGlance('tracks/5').instrumentType).toBe('instrument-rack');
		// The pattern rack draws a shaker, not a knob on its pattern number.
		expect(trackDeviceGlance('tracks/4').mode).toBe('glyph');
		expect(trackDeviceGlance('tracks/4').glyph).toBe('shaker');
	});

	it("opens the Pattern Rack view for an audio track's Audio Effect Rack named \"Pattern N\" (the Shaker)", () => {
		replaceTree(1, [
			track('tracks/0', 'audio', [
				device('tracks/0/devices/0', 'Audio Effect Rack', 'AudioEffectGroupDevice', [
					{ name: 'Device On', value: 1 },
					{ name: 'Pattern 4', value: 0 },
					{ name: 'Offbeat', value: 0 }
				])
			]),
			track('tracks/1', 'audio', [
				device('tracks/1/devices/0', 'Audio Effect Rack', 'AudioEffectGroupDevice', [
					{ name: 'Device On', value: 1 },
					{ name: 'Macro 1', value: 0 }
				])
			])
		]);

		const shaker = trackDeviceGlance('tracks/0');
		expect(shaker.kind).toBe('instrument');
		expect(shaker.instrumentType).toBe('instrument-rack-pattern');
		expect(shaker.instrumentViewType).toBe('instrument-rack-pattern');
		expect(shaker.glyph).toBe('shaker');
		// Any other audio rack is still just the chain head, not an instrument.
		expect(trackDeviceGlance('tracks/1').kind).not.toBe('instrument');
	});

	it('draws the INSTRUMENT, not the effects after it', () => {
		replaceTree(1, [
			track('tracks/6', 'midi', [
				device('tracks/6/devices/0', 'Wavetable', 'InstrumentVector', [
					{ name: 'Device On', value: 1 },
					{ name: 'A', value: 0.4 },
					{ name: 'B', value: 0.4 },
					{ name: 'C', value: 0.4 },
					{ name: 'Osc 1 Position', value: 0.6 }
				]),
				device('tracks/6/devices/1', 'Permute', 'MxDeviceAudioEffect'),
				device('tracks/6/devices/2', 'Delay', 'Delay')
			])
		]);

		const glance = trackDeviceGlance('tracks/6');

		expect(glance.name).toBe('Wavetable');
		expect(glance.headPath).toBe('tracks/6/devices/0');
		// Wavetable's table names index 4 as its position knob.
		expect(glance.controls.map((c) => c.label)).toEqual(['Pos']);
		expect(glance.controls[0].value).toBeCloseTo(0.6);
	});

	it('reports an empty chain as a ghost rather than inventing a head', () => {
		replaceTree(1, [track('tracks/7', 'midi', [])]);

		const glance = trackDeviceGlance('tracks/7');

		expect(glance.kind).toBe('empty');
		expect(glance.mode).toBe('ghost');
		expect(glance.name).toBeNull();
		expect(glance.headPath).toBeNull();
		expect(glance.controls).toEqual([]);
	});

	it('reports a ghost for a track the tree has not seen yet', () => {
		expect(v3Store.tracks.get('tracks/9')).toBeUndefined();
		expect(trackDeviceGlance('tracks/9').kind).toBe('empty');
	});

	describe('the category mark (user, 2026-09-18)', () => {
		const omni = () => device('tracks/0/devices/0', 'Omnisphere', 'AuPluginDevice');
		const glanceFor = (recorded: { role?: string; preset?: string }, head = omni()) => {
			replaceTree(1, [track('tracks/0', 'midi', [head], recorded)]);
			return trackDeviceGlance('tracks/0');
		};
		const filed = (rel: string) => ({ preset: `${LIBRARY}/${rel}` });

		it.each([
			['Ableton/Key/Organs/Organ.adg', 'keyboard'],
			['Omni/Synth/Pads/Warm.aupreset', 'synth'],
			['Omni/Bass/Acoustic/Martin/Fingered.aupreset', 'upright-bass'],
			['Ableton/Perc/Latin/Congas.adg', 'hand-drum'],
			['Ableton/Drum/Packs/Kit.adg', 'drum'],
			['Omni/Inst/Guitar/Acoustic/Nylon.aupreset', 'guitar'],
			['NI/Inst/String/Ensemble/Violins.nksf', 'violin'],
			['NI/Inst/Vocal/Choir/Aahs.nksf', 'mic'],
			['Omni/Inst/Plucked/Misc/Koto.aupreset', 'harp'],
			['Omni/Inst/Mystery/Thing.aupreset', 'device']
		])('%s draws the %s', (rel, glyph) => {
			const glance = glanceFor(filed(rel));
			expect(glance.mode).toBe('glyph');
			expect(glance.glyph).toBe(glyph);
		});

		it('reads the category folder, not the deepest folder that names one', () => {
			// `categoryFromPresetPath` reads both of these as synth: every
			// Omnisphere Drum preset and 2,146 of its 2,470 Bass presets sit
			// under a Synth subfolder.
			expect(glanceFor(filed('Omni/Drum/Synth/Boomers/Boom.aupreset')).glyph).toBe('drum');
			expect(glanceFor(filed('Omni/Bass/Synth/808/Sub.aupreset')).glyph).toBe('upright-bass');
		});

		it('draws brass as a trumpet in Wind/Brass today and in a Brass folder after the split', () => {
			expect(glanceFor(filed('Ableton/Inst/Wind/Brass/Horns.adg')).glyph).toBe('trumpet');
			expect(glanceFor(filed('Ableton/Inst/Brass/Horns.adg')).glyph).toBe('trumpet');
			expect(glanceFor(filed('Ableton/Inst/Wind/Winds/Flute.adg')).glyph).toBe('saxophone');
			expect(glanceFor(filed('Omni/Inst/Wind/Acoustic/Sax.aupreset')).glyph).toBe('saxophone');
		});

		it('gives a Perc Drum Rack the hand drum', () => {
			const kit = device('tracks/0/devices/0', 'Cuba', 'DrumGroupDevice');
			expect(glanceFor(filed('NI/Perc/NI/Cuba/Cuba.adg'), kit).glyph).toBe('hand-drum');
		});

		it('leaves FX on the knob until FX has a mark', () => {
			const drift = device('tracks/0/devices/0', 'Drift', 'Drift', paramsUpTo(21, 0.5));
			expect(glanceFor(filed('Ableton/FX/Location/Rain.adg'), drift).mode).toBe('knobs');
		});

		it('falls back to the recorded role when no preset is recorded', () => {
			// A track loaded before protocol 3.9.0, or through a Place.
			expect(glanceFor({ role: 'key' }).glyph).toBe('keyboard');
			expect(glanceFor({ role: 'drum', preset: '/Users/x/Packs/Kit.adg' }).glyph).toBe('drum');
			// Inst by role alone knows no subfolder: "an instrument", not a guess.
			expect(glanceFor({ role: 'inst' }).glyph).toBe('device');
		});

		it('believes the category folder over the recorded role', () => {
			expect(glanceFor({ role: 'synth', ...filed('Omni/Bass/Synth/808/Sub.aupreset') }).glyph).toBe(
				'upright-bass'
			);
		});

		it('keeps the knob for a track that recorded no category', () => {
			const drift = device('tracks/0/devices/0', 'Drift', 'Drift', paramsUpTo(21, 0.5));
			expect(glanceFor({}, drift).mode).toBe('knobs');
		});

		it('keeps the shaker on the pattern rack whatever it was filed under', () => {
			const patterns = device('tracks/0/devices/0', 'Patterns', 'InstrumentGroupDevice', [
				{ name: 'Device On', value: 1 },
				{ name: 'Pattern 16', value: 0 }
			]);
			expect(glanceFor(filed('Ableton/Perc/Shaker Lite/Shakers.adg'), patterns).glyph).toBe('shaker');
		});

		it('draws the Sampler mark on a Sampler, filed or not, in place of its knob', () => {
			const sampler = device('tracks/0/devices/0', 'Sampler', 'MultiSampler', paramsUpTo(30, 0.5));
			for (const recorded of [{}, { role: 'key' }]) {
				const glance = glanceFor(recorded, sampler);
				expect(glance.mode).toBe('glyph');
				expect(glance.glyph).toBe('sampler');
			}
		});

		it('draws the Simpler mark on a Simpler, filed or not, in place of its knob', () => {
			const simpler = device('tracks/0/devices/0', 'Simpler', 'OriginalSimpler', paramsUpTo(30, 0.5));
			for (const recorded of [{}, { role: 'key' }]) {
				const glance = glanceFor(recorded, simpler);
				expect(glance.mode).toBe('glyph');
				expect(glance.glyph).toBe('simpler');
			}
		});

		it('never gives an audio track a category mark', () => {
			replaceTree(1, [
				track('tracks/1', 'audio', [device('tracks/1/devices/0', 'Bass Amp', 'AudioEffectGroupDevice')], {
					role: 'key'
				})
			]);
			expect(trackDeviceGlance('tracks/1').glyph).toBe('guitar');
		});
	});
});
