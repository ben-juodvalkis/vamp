// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseAmxd, parsePresetXml, readPresetParams } from '$lib/server/places/presetParams';

// The shape of the rig's Disco Filter.adv, trimmed.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.0">
	<AutoFilter2>
		<On>
			<LomId Value="0" />
			<Manual Value="true" />
		</On>
		<Filter_Frequency>
			<LomId Value="0" />
			<Manual Value="169.668594" />
		</Filter_Frequency>
		<Filter_Resonance>
			<LomId Value="0" />
			<Manual Value="0.4453125" />
		</Filter_Resonance>
		<Filter_Type>
			<LomId Value="0" />
			<Manual Value="2" />
		</Filter_Type>
	</AutoFilter2>
</Ableton>`;

let dir: string | null = null;
afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = null;
});

describe('preset params', () => {
	it('reads the device class and every saved value, booleans as 1/0', () => {
		expect(parsePresetXml(XML)).toEqual({
			className: 'AutoFilter2',
			params: { On: 1, Filter_Frequency: 169.668594, Filter_Resonance: 0.4453125, Filter_Type: 2 },
			labels: {}
		});
	});

	it("reads a rack's class, its own macros before a nested rack's, and their names", () => {
		// The shape of the rig's Guitar.adg, trimmed: the outer rack's macros come first.
		const rack = `<Ableton><GroupDevicePreset><Device><AudioEffectGroupDevice Id="0">
			<MacroControls.0><LomId Value="0" /><Manual Value="0" /></MacroControls.0>
			<MacroControls.1><LomId Value="0" /><Manual Value="20" /></MacroControls.1>
			<MacroDisplayNames.0 Value="Gain" /><MacroDisplayNames.1 Value="Spring" />
			<Branches><AudioEffectGroupDevice Id="1"><MacroControls.0><LomId Value="0" /><Manual Value="99" /></MacroControls.0></AudioEffectGroupDevice></Branches>
		</AudioEffectGroupDevice></Device></GroupDevicePreset></Ableton>`;
		const p = parsePresetXml(rack);
		expect(p.className).toBe('AudioEffectGroupDevice');
		expect(p.params['MacroControls.0']).toBe(0);
		expect(p.params['MacroControls.1']).toBe(20);
		expect(p.labels['MacroDisplayNames.0']).toBe('Gain');
	});

	it('reads a gzipped .adv from disk', async () => {
		dir = mkdtempSync(join(tmpdir(), 'preset-params-'));
		const file = join(dir, 'Disco Filter.adv');
		writeFileSync(file, gzipSync(Buffer.from(XML)));
		const p = await readPresetParams(file);
		expect(p.className).toBe('AutoFilter2');
		expect(p.params.Filter_Frequency).toBe(169.668594);
	});

	// A Max device's .amxd: the `ampf` header with its type code, then the
	// patcher JSON. Blur's own shape: its Loop Rate is Live's "Rate".
	const box = (longname: string, shortname: string, initial: number[] | undefined, enable = 1) => ({
		box: { maxclass: 'live.numbox', saved_attribute_attributes: { valueof: { parameter_longname: longname, parameter_shortname: shortname, parameter_initial: initial, parameter_initial_enable: enable } } }
	});
	const amxd = (type: string, patcher: unknown) =>
		Buffer.concat([Buffer.from(`ampf\x04\x00\x00\x00${type}meta\x04\x00\x00\x00\x00\x00\x00\x00ptch\x00\x10\x00\x00`, 'latin1'), Buffer.from(JSON.stringify(patcher))]);

	it("reads a Max device's saved values by the name Live gives each, its short name", () => {
		const p = parseAmxd(
			amxd('aaaa', {
				patcher: {
					boxes: [
						box('Loop Rate', 'Rate', [22]),
						box('Mix', 'Mix', [0]),
						box('_info', '_info', [1]),
						box('Seam', 'Seam', [36], 0),
						{ box: { maxclass: 'bpatcher', patcher: { boxes: [box('Width', 'Width', [12.5])] } } }
					]
				}
			})
		);
		expect(p.className).toBe('MxDeviceAudioEffect');
		expect(p.params).toEqual({ Rate: 22, Mix: 0, Width: 12.5 });
	});

	it("reads a MIDI effect's class, and a frozen device's patchers among its embedded files", () => {
		const frozen = Buffer.concat([
			amxd('mmmm', { patcher: { boxes: [box('Chance', 'Chance', [100])] } }),
			Buffer.from('\x00\x01binary{"not": "a patcher"}\x00', 'latin1'),
			Buffer.from(JSON.stringify({ patcher: { boxes: [box('Spread', 'Spread', [3])] } }))
		]);
		const p = parseAmxd(frozen);
		expect(p.className).toBe('MxDeviceMidiEffect');
		expect(p.params).toEqual({ Chance: 100, Spread: 3 });
	});

	it('reads an .amxd from disk', async () => {
		dir = mkdtempSync(join(tmpdir(), 'preset-params-'));
		const file = join(dir, 'Comb.amxd');
		writeFileSync(file, amxd('aaaa', { patcher: { boxes: [box('Tune', 'Tune', [0]), box('Mix', 'Mix', [17.58])] } }));
		expect((await readPresetParams(file)).params).toEqual({ Tune: 0, Mix: 17.58 });
	});
});
