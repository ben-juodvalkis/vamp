/**
 * The browser demo's set (ADR-502): the default scene cut to six tracks, so a
 * visitor meets a set small enough to take in (Ben, 2026-11-02).
 *
 * Drums, Bass, Keys, Guitar, Vox and Pad, with two of the screenshot scene's
 * states put back to rest, since the demo cannot follow them through: the
 * Guitar loop plays instead of sitting mid-recording forever, and the Pad is
 * unmuted. The phone screenshot the site maps is shot from this scene too:
 *
 *   node -e "import('./scripts/shot/demo-scene.mjs').then((m) => console.log(JSON.stringify(m.buildDemoScene())))" > demo.json
 *   npm run shot -- session --scene demo.json
 */

import { buildDefaultScene } from './scene.mjs';

export const DEMO_TRACK_COUNT = 6;

// T-record field offsets (wire-protocol §3) and slot states (scene.mjs).
const T_MUTE = 4;
const SLOT_PLAYING = 2;
const SLOT_RECORDING = 3;

export function buildDemoScene() {
	const scene = buildDefaultScene({ trackCount: DEMO_TRACK_COUNT });
	const args = scene.treeArgs;
	for (let k = 0; k < args.length; k++) {
		if (args[k] === 'T' && /^tracks\/\d+$/.test(String(args[k + 1]))) args[k + T_MUTE] = 0;
		if (args[k] === 'S' && /^tracks\/\d+\/slots\/\d+$/.test(String(args[k + 1])) && args[k + 2] === SLOT_RECORDING) {
			args[k + 2] = SLOT_PLAYING;
		}
	}
	for (const entry of scene.playing ?? []) if (entry.status === 2) entry.status = 1;
	scene.name = 'demo';
	return scene;
}
