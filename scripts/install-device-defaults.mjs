#!/usr/bin/env node
/**
 * Install the app's effect presets as Live's user defaults (issue #491).
 *
 * Live keeps a per-device default preset under the User Library:
 *
 *     Defaults/Audio Effects/<device display name>.adv
 *     Defaults/MIDI Effects/<device display name>.adv
 *
 * and applies it whenever that device is created by name — from Live's own
 * browser, and (measured 2026-09-10 on 12.4.15b2) from the LOM's
 * `Track.insert_device` / `Chain.insert_device`. That is what lets the
 * surface insert an FX-grid tile's device straight into a drum pad's chain
 * or onto the track in one call, with one undo step, and still get the
 * tile's preset rather than the factory settings: the default IS the
 * preset. The surface only takes the insert path when the default file is
 * byte-identical to the preset file (`DeviceLoadComponent`), so a machine
 * that has not run this script simply keeps loading the preset through
 * the browser.
 *
 * What it installs: every preset `devicePresets.ts` points at that is a
 * single native Live device (`.adv` whose root device class is in the
 * table below). Racks (`.adg`), plug-in presets (`.aupreset`) and Max for
 * Live devices have no default slot and are skipped. The display names
 * are the ones Live reports as `class_display_name`, measured by inserting
 * each on the rig; a class missing from the table is reported, not
 * guessed.
 *
 * An existing default that differs is backed up first, to
 * `<User Library>/Looping Test/defaults-backup-<date>/`, so the choice is
 * reversible by hand.
 *
 *   node scripts/install-device-defaults.mjs            # install
 *   node scripts/install-device-defaults.mjs --dry-run  # print the plan
 *   node scripts/install-device-defaults.mjs --check    # exit 1 if any default is missing or differs
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { loadConstants } = createRequire(import.meta.url)('../interface/bridge/utils/constants.js');
const constants = loadConstants();
const USER_LIBRARY = constants.paths.userLibraryBase;
const EFFECT_PRESETS = constants.paths.effectPresetsBase;

/**
 * Root device class inside a `.adv` → the name Live shows for it, which is
 * both the default file's name and what `insert_device` takes. Measured
 * 2026-09-10 (Live 12.4.15b2) by inserting each name and reading
 * `class_name` / `class_display_name`. Keep in step with
 * `NATIVE_DEVICE_NAMES` in
 * `surface/components/DeviceLoadComponent.py`.
 *
 * **This map has no fallback, and cannot have one.** An unknown class is
 * reported as `no-display-name` and skipped, deliberately: 12 of the 21 rows
 * here are not recoverable from the class string by any rule — `StereoGain` →
 * `Utility`, `Hybrid` → `Hybrid Reverb`, `Chorus2` → `Chorus-Ensemble`,
 * `PhaserNew` → `Phaser-Flanger`. Guessing would name a default file wrongly
 * and Live would silently never read it.
 *
 * Do not carry a conclusion here over from `DEVICE_CLASS_NAMES` in
 * `scripts/shot/scene.mjs`, which is easy to meet in the same afternoon and
 * points the OTHER way — display name → class, for the screenshot mock. That
 * one DOES fall back (the name with non-letters stripped), so most of its rows
 * are optional and two are inert. This one's rows are all load-bearing.
 */
export const NATIVE_DEVICE_NAMES = {
	Delay: 'Delay',
	Echo: 'Echo',
	AutoFilter2: 'Auto Filter',
	Compressor2: 'Compressor',
	Gate: 'Gate',
	GlueCompressor: 'Glue Compressor',
	MultibandDynamics: 'Multiband Dynamics',
	Saturator: 'Saturator',
	BeatRepeat: 'Beat Repeat',
	ChannelEq: 'Channel EQ',
	DrumBuss: 'Drum Buss',
	Pedal: 'Pedal',
	StereoGain: 'Utility',
	Redux2: 'Redux',
	Hybrid: 'Hybrid Reverb',
	PhaserNew: 'Phaser-Flanger',
	Chorus2: 'Chorus-Ensemble',
	MidiArpeggiator: 'Arpeggiator',
	MidiRandom: 'Random',
	MidiVelocity: 'Velocity',
	MidiChord: 'Chord'
};

/** The device class a `.adv` carries: the first element under `<Ableton>`. `null` when unreadable. */
export function presetDeviceClass(path) {
	try {
		const xml = gunzipSync(readFileSync(path)).toString('utf8', 0, 4096);
		const m = /<Ableton\b[^>]*>\s*<([A-Za-z0-9]+)\b/.exec(xml);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

/** Every `.adv` under the effect-preset base that `devicePresets.ts` names. */
export function presetFiles() {
	const ts = readFileSync(join(ROOT, 'interface', 'src', 'lib', 'config', 'devicePresets.ts'), 'utf8');
	const files = new Set();
	for (const m of ts.matchAll(/presetPath: `\$\{constants\.paths\.effectPresetsBase\}\/([^`]+\.adv)`/g)) {
		files.add(m[1]);
	}
	return [...files].sort();
}

export function plan() {
	const rows = [];
	for (const rel of presetFiles()) {
		const src = join(EFFECT_PRESETS, rel);
		const cls = presetDeviceClass(src);
		const display = cls ? NATIVE_DEVICE_NAMES[cls] : null;
		if (!cls) {
			rows.push({ rel, status: 'unreadable' });
			continue;
		}
		// A Max device's .adv (Pitch Hack) is a preset of an .amxd: Live has no
		// default slot for it and the surface always loads it through the
		// browser, so there is nothing to install and nothing to vouch for.
		if (cls.startsWith('MxDevice')) {
			rows.push({ rel, cls, status: 'max-device' });
			continue;
		}
		if (!display) {
			rows.push({ rel, cls, status: 'no-display-name' });
			continue;
		}
		const kind = cls.startsWith('Midi') ? 'MIDI Effects' : 'Audio Effects';
		const dest = join(USER_LIBRARY, 'Defaults', kind, `${display}.adv`);
		let status = 'install';
		if (existsSync(dest)) {
			status = readFileSync(dest).equals(readFileSync(src)) ? 'identical' : 'replace';
		}
		rows.push({ rel, cls, display, dest, status });
	}
	return rows;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const check = argv.includes('--check');
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly && !(USER_LIBRARY && EFFECT_PRESETS)) {
	console.error(
		'install-device-defaults copies the owner\'s effect presets: it needs paths.userLibraryBase and ' +
			'paths.effectPresetsBase, set in config/constants.local.json.'
	);
	process.exit(1);
}

if (invokedDirectly) {
	const rows = plan();
	const now = new Date();
	const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	const backupDir = join(USER_LIBRARY, 'Looping Test', `defaults-backup-${stamp}`);
	let missing = 0;
	// A preset the plan could not read, or a class the name table does not
	// know, is a default this script cannot vouch for. It counts against
	// `--check` — the question `--check` answers is "is the insert-by-name
	// path live for every tile?", and "I could not look" is not "yes". It
	// used to skip silently and report every default as the preset with
	// nothing checked at all (code review, 2026-09-12).
	let unchecked = 0;
	const failed = [];
	for (const r of rows) {
		if (r.status === 'max-device') {
			console.log(`  skip     ${r.rel}  (Max device: no default slot, loads through the browser)`);
			continue;
		}
		if (r.status === 'unreadable' || r.status === 'no-display-name') {
			console.log(`  skip     ${r.rel}  (${r.status}${r.cls ? `: ${r.cls}` : ''})`);
			unchecked += 1;
			continue;
		}
		const label = r.status === 'identical' ? 'ok       ' : r.status === 'replace' ? 'replace  ' : 'install  ';
		console.log(`  ${label}${r.rel.padEnd(22)} → Defaults/${basename(dirname(r.dest))}/${basename(r.dest)}`);
		if (r.status === 'identical') continue;
		missing += 1;
		if (dryRun || check) continue;
		try {
			if (r.status === 'replace') {
				mkdirSync(backupDir, { recursive: true });
				copyFileSync(r.dest, join(backupDir, basename(r.dest)));
				console.log(`           backed up the old one to ${backupDir}`);
			}
			mkdirSync(dirname(r.dest), { recursive: true });
			copyFileSync(join(EFFECT_PRESETS, r.rel), r.dest);
		} catch (e) {
			// Live's own Defaults folders can be root-owned; report and go on,
			// the surface falls back to the browser load for a device whose
			// default is not the preset.
			failed.push(`${r.dest}: ${e.code ?? e.message}`);
			console.log(`           FAILED: ${e.code ?? e.message}`);
		}
	}
	if (failed.length) {
		console.log(`\n${failed.length} default(s) could not be written — check the folder's permissions (ls -ld on it); the surface keeps loading those through the browser:`);
		for (const f of failed) console.log(`  ${f}`);
	}
	if (check) {
		const parts = [];
		if (missing) parts.push(`${missing} default(s) missing or different`);
		if (unchecked) parts.push(`${unchecked} preset(s) unchecked (unreadable, or a class the name table lacks)`);
		console.log(parts.length ? `\n${parts.join('; ')}` : '\nevery default is the app preset');
		process.exit(parts.length ? 1 : 0);
	}
	if (dryRun) console.log(`\n(dry run — ${missing} would change)`);
	if (!dryRun && !check) process.exit(failed.length ? 1 : 0);
}
