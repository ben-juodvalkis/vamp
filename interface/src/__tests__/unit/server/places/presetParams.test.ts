// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parsePresetXml, readPresetParams } from '$lib/server/places/presetParams';

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
			params: { On: 1, Filter_Frequency: 169.668594, Filter_Resonance: 0.4453125, Filter_Type: 2 }
		});
	});

	it('reads a gzipped .adv from disk', async () => {
		dir = mkdtempSync(join(tmpdir(), 'preset-params-'));
		const file = join(dir, 'Disco Filter.adv');
		writeFileSync(file, gzipSync(Buffer.from(XML)));
		const p = await readPresetParams(file);
		expect(p.className).toBe('AutoFilter2');
		expect(p.params.Filter_Frequency).toBe(169.668594);
	});
});
