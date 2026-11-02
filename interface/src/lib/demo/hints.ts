/**
 * The browser demo's one-line hint (ADR-502): a sentence about whatever the
 * visitor just touched, shown under the demo's frame on the page that embeds
 * it, or along the bottom of the screen when the demo is open on its own.
 *
 * Two sources, in order of precision:
 *
 * - **What the touch sent.** Every write leaves through the one socket, so
 *   the engine's `onInbound` sees exactly what was touched: which parameter
 *   of which device, which track, which clip. `describeWrite` names it from
 *   the scene the engine is playing.
 * - **What was pressed**, for touches that send nothing (opening a browser
 *   category, switching its mode): `describePress` reads the pressed button.
 */

type Scene = { treeArgs: unknown[] };

const RAIL = new Set(['Recent', 'Drum', 'Perc', 'Bass', 'FX', 'Inst', 'Key', 'Synth']);
const MODES: Record<string, string> = {
	Instrument: 'Instrument: a tap loads the preset on a track of its own.',
	Simpler: 'Simpler: a tap loads the sample into Simpler, ready to play.',
	Clip: 'Clip: a tap loads the loop as a clip, warped to the tempo.',
	Effect: 'Effect: a tap adds the effect to the selected track’s chain.'
};

export const FIRST_HINT = 'Touch anything and this line says what it does. Vamp is playing a pretend Live set here.';

/** The record of `tag` at `path` in the scene's tree, as its values. */
function record(scene: Scene, tag: string, path: string): unknown[] | null {
	const args = scene.treeArgs;
	for (let k = 0; k < args.length; k++) {
		if (args[k] === tag && args[k + 1] === path) return args.slice(k + 1, k + 4);
	}
	return null;
}

const trackName = (scene: Scene, path: string) =>
	path === 'master' ? 'Main' : String(record(scene, 'T', path)?.[1] ?? 'This track');
const deviceName = (scene: Scene, path: string) => String(record(scene, 'D', path)?.[1] ?? 'This device');
const trackOf = (path: string) => /^(tracks\/\d+|master)/.exec(path)?.[1] ?? '';
const slotNumber = (path: string) => Number(/\/slots\/(\d+)/.exec(path)?.[1] ?? 0) + 1;
const words = (name: string) =>
	name
		.replace(/^vm\./, '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/_/g, ' ')
		.toLowerCase();

/** A sentence for a write the interface sent, or null to leave the line as it is. */
export function describeWrite(scene: Scene, address: string, args: unknown[]): string | null {
	const [a, b] = args;
	const path = typeof a === 'string' ? a : '';
	switch (address) {
		case '/looping/v3/param/set': {
			const devicePath = path.replace(/\/params\/\d+$/, '');
			const param = record(scene, 'P', path)?.[1];
			return `${deviceName(scene, devicePath)} · ${param ?? 'a control'}: Vamp sets it in Live as you drag.`;
		}
		case '/looping/v3/property/set':
			return `${deviceName(scene, path)} · ${words(String(b ?? ''))}: one of Vamp’s own controls for this device.`;
		case '/looping/v3/track/select':
			return `${trackName(scene, path)}: its instrument and effects now fill the screen.`;
		case '/looping/v3/device/select':
			return `${deviceName(scene, path)}: all of its controls are in the middle of the screen.`;
		case '/looping/v3/device/move':
			return `${deviceName(scene, path)} moved in the chain. Live’s order changes with it.`;
		case '/looping/v3/device/load':
			return `Added to ${trackName(scene, path)}’s effects chain, at the end.`;
		case '/looping/v3/track/prepare_for_preset':
			return 'Loading an instrument from the browser onto a track.';
		case '/looping/v3/clip/launch':
			return `${trackName(scene, trackOf(path))}: clip ${slotNumber(path)} launched. In Live, a launch waits for the next bar.`;
		case '/looping/v3/clip/stop':
			return `${trackName(scene, path)} stopped.`;
		case '/looping/v3/clip/focus':
			return `${trackName(scene, trackOf(path))}, clip ${slotNumber(path)}: its tools are in the middle of the screen.`;
		case '/looping/v3/scene/launch':
			return `Scene ${Number(/\d+/.exec(path)?.[0] ?? 0) + 1}: every clip in that row launches together.`;
		case '/looping/v3/scene/stop':
			return 'Every clip stopped.';
		case '/looping/v3/track/mute':
			return `${trackName(scene, path)} ${b === 1 ? 'muted' : 'unmuted'}. Tap the name again to switch.`;
		case '/looping/v3/track/solo':
			return `${trackName(scene, path)} ${b === 1 ? 'soloed' : 'unsoloed'}. Two fingers on a track solo it.`;
		case '/looping/v3/track/volume':
			return `${trackName(scene, path)}’s volume: drag a strip up or down.`;
		case '/looping/v3/master/volume':
			return 'Main volume: the whole set.';
		case '/looping/session/tempo':
			return 'Tempo: Live’s, for the whole set.';
		default:
			// Edits only: the grid reads every clip's notes on its own as it draws.
			if (/^\/looping\/v3\/clip\/notes\/(add|remove|modify|duplicate)$/.test(address)) {
				return 'Note editor: each edit goes straight into the clip in Live.';
			}
			if (address.startsWith('/looping/v3/clip/groove/set/')) return 'Groove: the clip’s timing, from one of Live’s grooves.';
			if (address.startsWith('/looping/v3/clip/set/')) return `Clip ${words(address.split('/').pop() ?? '')}: written to the clip in Live.`;
			return null;
	}
}

/** A sentence for a press that may send nothing, or null. */
export function describePress(target: Element | null): string | null {
	const button = target?.closest('button, [role="button"]');
	const label = (button?.getAttribute('aria-label') || button?.textContent || '').trim();
	if (RAIL.has(label)) {
		return label === 'Recent'
			? 'Recent: what you loaded lately, one tap to load again.'
			: `${label}: a category of the library. Tap a folder, then a preset. The demo has a few in each.`;
	}
	if (MODES[label]) return MODES[label];
	if (target?.closest('.drill-browser')) return 'The browser: tap a folder, then a preset to load it.';
	return null;
}
