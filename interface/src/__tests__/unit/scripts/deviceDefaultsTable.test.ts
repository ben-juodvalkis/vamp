/**
 * The installer and the surface each carry the class → display-name table
 * `insert_device` needs (issue #491 follow-up). One drifting from the other
 * would install a default under one name and insert under another, and
 * the surface would silently fall back to the browser load for that
 * device. Pin them equal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../../..');

async function installerTable(): Promise<Record<string, string>> {
	const mod = await import(/* @vite-ignore */ resolve(ROOT, 'scripts/install-device-defaults.mjs'));
	return mod.NATIVE_DEVICE_NAMES as Record<string, string>;
}

function surfaceTable(): Record<string, string> {
	const py = readFileSync(resolve(ROOT, 'surface/components/DeviceLoadComponent.py'), 'utf8');
	const block = /NATIVE_DEVICE_NAMES: Dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(py);
	if (!block) throw new Error('NATIVE_DEVICE_NAMES not found in DeviceLoadComponent.py');
	const table: Record<string, string> = {};
	for (const m of block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) table[m[1]] = m[2];
	return table;
}

describe('device defaults table', () => {
	it('is the same in the installer and the surface', async () => {
		const js = await installerTable();
		const py = surfaceTable();
		expect(Object.keys(py).length).toBeGreaterThan(10);
		expect(js).toEqual(py);
	});

	it('names every class devicePresets.ts expects of a native single-device preset', async () => {
		const js = await installerTable();
		const ts = readFileSync(resolve(ROOT, 'interface/src/lib/config/devicePresets.ts'), 'utf8');
		const expected = new Set<string>();
		for (const m of ts.matchAll(/presetPath: '\{effectPresetsBase\}\/[^']+\.adv'[\s\S]*?expectedClassName: '([^']+)'/g)) {
			expected.add(m[1]);
		}
		for (const cls of expected) {
			if (cls === 'AudioEffectGroupDevice' || cls === 'AuPluginDevice') continue;
			// A Max device's .adv (Pitch Hack) has no default slot; the installer skips it.
			if (cls.startsWith('MxDevice')) continue;
			expect(js[cls], `no display name for ${cls}`).toBeTruthy();
		}
	});
});
