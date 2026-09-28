// @vitest-environment node
/**
 * The roots `/api/sample-peaks` and `/api/similar-samples` answer for
 * (general-release audit §5.3): the lexical check, the Live-project rule, and
 * the three places the roots are read from — `constants.json`, Live's own
 * `Library.cfg`, and the Live apps in `/Applications`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeConstants } from '$lib/server/runtimeConfig';
import {
	LIVE_PROJECT_MARKER,
	coreLibraryRoots,
	isAllowedSamplePath,
	isInsideLiveProject,
	isUnderRoot,
	liveLibraryRoots,
	newestLibraryCfg,
	normalizeSamplePath,
	sampleRoots
} from '$lib/server/sampleRoots';

let scratch: string;

beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'sample-roots-'));
});

afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe('normalizeSamplePath', () => {
	it('collapses dot segments before anything is checked', () => {
		expect(normalizeSamplePath('/Lib/Samples/../../../etc/passwd')).toBe('/etc/passwd');
		expect(normalizeSamplePath('/Lib/./Samples//kick.wav')).toBe('/Lib/Samples/kick.wav');
	});

	it('refuses anything that is not one absolute path', () => {
		expect(normalizeSamplePath('Samples/kick.wav')).toBeNull();
		expect(normalizeSamplePath('')).toBeNull();
		expect(normalizeSamplePath(null)).toBeNull();
		expect(normalizeSamplePath('/Lib/kick.wav\0.png')).toBeNull();
	});
});

describe('isUnderRoot', () => {
	it('matches at a segment boundary, not as a string prefix', () => {
		expect(isUnderRoot('/Music/Samples Organized/kick.wav', '/Music/Samples Organized')).toBe(true);
		expect(isUnderRoot('/Music/Samples Organized', '/Music/Samples Organized/')).toBe(true);
		expect(isUnderRoot('/Music/Samples OrganizedEvil/kick.wav', '/Music/Samples Organized')).toBe(false);
		expect(isUnderRoot('/Music/kick.wav', '/Music/Samples Organized')).toBe(false);
	});

	it('treats the two Unicode forms macOS hands out as one path', () => {
		const composed = '/Music/Björk';
		const decomposed = '/Music/Björk';
		expect(isUnderRoot(`${decomposed}/hum.wav`, composed)).toBe(true);
		expect(isUnderRoot(`${composed}/hum.wav`, decomposed)).toBe(true);
	});
});

describe('isInsideLiveProject', () => {
	function project(name: string): string {
		const dir = join(scratch, name);
		mkdirSync(join(dir, LIVE_PROJECT_MARKER), { recursive: true });
		return dir;
	}

	it('finds the marker above a recording and beside a capture', () => {
		const dir = project('mele 9-17-26 Project');
		expect(isInsideLiveProject(join(dir, 'Samples', 'Recorded', '1-Audio 0001.wav'))).toBe(true);
		expect(isInsideLiveProject(join(dir, 'LOOPING_CAPTURE_20260923_110436.wav'))).toBe(true);
	});

	it('does not count a folder with no marker, or a marker that is a file', () => {
		mkdirSync(join(scratch, 'Loose'));
		expect(isInsideLiveProject(join(scratch, 'Loose', 'take.wav'))).toBe(false);
		mkdirSync(join(scratch, 'Fake'));
		writeFileSync(join(scratch, 'Fake', LIVE_PROJECT_MARKER), '');
		expect(isInsideLiveProject(join(scratch, 'Fake', 'take.wav'))).toBe(false);
	});
});

describe('isAllowedSamplePath', () => {
	it('allows a root or a project, and nothing a `..` climbs out to', () => {
		const root = join(scratch, 'Library');
		mkdirSync(root);
		mkdirSync(join(scratch, 'Proj', LIVE_PROJECT_MARKER), { recursive: true });
		expect(isAllowedSamplePath(join(root, 'kick.wav'), [root])).toBe(true);
		expect(isAllowedSamplePath(join(scratch, 'Proj', 'Samples', 'x.wav'), [root])).toBe(true);
		expect(isAllowedSamplePath(join(scratch, 'Elsewhere', 'x.wav'), [root])).toBe(false);
		expect(isAllowedSamplePath('/etc/x.wav', [root])).toBe(false);
		const climbed = normalizeSamplePath(`${root}/../../../../etc/x.wav`);
		expect(climbed).not.toBeNull();
		expect(isAllowedSamplePath(climbed as string, [root])).toBe(false);
	});

	/*
	 * This repo's own root holds a stray, empty `Ableton Project Info` (a set
	 * was saved there once, and 28 clip references in real sets still point
	 * into its `Samples/`). Without the extension check every file in the
	 * checkout was "inside a Live project" — `config/.ws-secret` included.
	 */
	it('allows only sample files, even inside a root or a project', () => {
		const root = join(scratch, 'Library');
		const repo = join(scratch, 'Looping');
		mkdirSync(join(repo, LIVE_PROJECT_MARKER), { recursive: true });
		expect(isAllowedSamplePath(join(repo, 'config', '.ws-secret'), [root])).toBe(false);
		expect(isAllowedSamplePath(join(repo, 'logs', 'bridge.log'), [root])).toBe(false);
		expect(isAllowedSamplePath(join(root, 'taxes.pdf'), [root])).toBe(false);
		expect(isAllowedSamplePath(join(repo, 'Samples', 'Recorded', 'take.aif'), [root])).toBe(true);
		expect(isAllowedSamplePath(join(root, 'LOUD.WAV'), [root])).toBe(true);
		expect(isAllowedSamplePath(join(root, 'Kit.alc'), [root])).toBe(true);
		expect(isAllowedSamplePath(join(root, 'Film.mov'), [root])).toBe(true);
	});
});

describe("Live's own library, read from Library.cfg", () => {
	// Shaped like the real file (Live 12.4.15b3), trimmed to one of each.
	const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12402" Creator="Ableton Live 12.4.15b3">
	<ContentLibrary>
		<UserLibrary>
			<LibraryProject Id="1">
				<ProjectLocation />
				<ProjectName Value="User Library" />
				<ProjectPath Value="/Users/Shared/Music/Soundbanks/Ableton/Live Libraries" />
			</LibraryProject>
		</UserLibrary>
		<SliceInfoList>
			<LibrarySliceInfo Id="2322487" Path="/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/Packs/Sequencers" DisplayName="Sequencers" UniqueId="314" />
		</SliceInfoList>
		<UserFolderInfoList>
			<UserFolderInfo Id="409399" Path="/Users/Shared/Music/Soundbanks/Native Instruments/Expansions" DisplayName="Expansions" IconName="" />
			<UserFolderInfo Id="409404" Path="/Users/Shared/Music/Drums &amp; Loops" DisplayName="D&amp;L" IconName="" />
		</UserFolderInfoList>
		<PreferredFactoryPacksInstallationPath Value="/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/Packs" />
		<DefaultTemplateSet Value="/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library/Templates/Untitled.als" />
	</ContentLibrary>
</Ableton>`;

	it('reads every Place, pack, the packs folder and the User Library — nothing else', () => {
		expect(liveLibraryRoots(XML).sort()).toEqual(
			[
				'/Users/Shared/Music/Soundbanks/Native Instruments/Expansions',
				'/Users/Shared/Music/Drums & Loops',
				'/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/Packs/Sequencers',
				'/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/Packs',
				'/Users/Shared/Music/Soundbanks/Ableton/Live Libraries/User Library'
			].sort()
		);
	});

	it('takes the Library.cfg Live wrote last, not the highest version string', () => {
		const write = (dir: string, when: number | null) => {
			mkdirSync(join(scratch, dir));
			if (when === null) return;
			const file = join(scratch, dir, 'Library.cfg');
			writeFileSync(file, XML);
			utimesSync(file, when, when);
		};
		// `Live 12.4b7` sorts after every `Live 12.4.x`; install.sh measured that trap.
		write('Live 12.4b7', 1_700_000_000);
		write('Live 12.4.15b3', 1_800_000_000);
		write('Live 12.5b1', null);
		expect(newestLibraryCfg(scratch)).toBe(join(scratch, 'Live 12.4.15b3', 'Library.cfg'));
		expect(newestLibraryCfg(join(scratch, 'absent'))).toBeNull();
	});
});

describe('coreLibraryRoots', () => {
	it("finds every Live app's Core Library — the index holds the Suite's while the Beta runs", () => {
		for (const app of ['Ableton Live 12 Beta.app', 'Ableton Live 12 Suite.app', 'Max.app']) {
			mkdirSync(join(scratch, app));
		}
		expect(coreLibraryRoots(scratch, ['/Volumes/Apps/Ableton Live 12 Lite.app']).sort()).toEqual(
			[
				join(scratch, 'Ableton Live 12 Beta.app', 'Contents', 'App-Resources', 'Core Library'),
				join(scratch, 'Ableton Live 12 Suite.app', 'Contents', 'App-Resources', 'Core Library'),
				'/Volumes/Apps/Ableton Live 12 Lite.app/Contents/App-Resources/Core Library'
			].sort()
		);
	});
});

describe('the configured roots', () => {
	// This Mac's config, its local file over the tracked defaults: the two
	// paths are a Mac's own (general-release plan.md §3), so on a clone with
	// no local file there are none to check.
	const paths = (runtimeConstants().paths ?? {}) as Record<string, unknown> & {
		placesRoots?: Record<string, string>;
	};

	it('includes the library (the Places come from Library.cfg)', () => {
		const roots = sampleRoots();
		for (const key of ['userLibraryBase', 'abletonPacksBase']) {
			if (paths[key]) expect(roots, key).toContain(paths[key]);
		}
		// `paths.placesRoots` left the config on 2026-09-26; every Place the
		// gate allows is read from Live's own Library.cfg (`liveLibraryRoots`).
		for (const [name, root] of Object.entries(paths.placesRoots ?? {})) {
			if (!name.startsWith('_')) expect(roots, name).toContain(root);
		}
	});
});
