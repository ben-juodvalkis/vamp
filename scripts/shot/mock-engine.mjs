/**
 * The mock surface's half of the v3 wire protocol, with no transport.
 *
 * `mock-surface.mjs` puts this behind a WebSocket server for the screenshot
 * and multitouch harnesses; `interface/src/lib/demo` puts it behind an
 * in-page socket so the interface runs in a browser with nothing else at all.
 * One implementation, so the demo and the harnesses cannot drift apart. What
 * it answers, and why, is listed in `mock-surface.mjs`'s header.
 *
 * Browser-safe: no Node built-ins. `connect(ws)` takes anything with
 * `readyState`, `OPEN` and `send(text)` — a `ws` socket, or the demo's.
 */

import {
	buildDefaultScene,
	DEFAULT_FEATURES,
	PROPERTY_DEFAULTS,
	HYBRID_IR_LISTS,
	SCENE_ETAG,
	PROTOCOL_VERSION,
	vmPadFx,
	padChainEntry,
	padChainRecords,
	appendPadDevice,
	deviceClassName,
	appendTrackDevice,
	appendTrack,
	replaceInstrument,
	takeEmptyLastTrack
} from './scene.mjs';

const PING_INTERVAL_MS = 5_000;
const SURFACE_HEARTBEAT_MS = 1_000;
/** The surface throttles song time to 10 Hz; the demo's clock ticks at it. */
const LIVE_TICK_MS = 100;
/** Live meters at 30 Hz; the demo's at 20, which reads as smooth. */
const METER_TICK_MS = 50;

/**
 * One scene's mock surface. Every client that connects sees the same scene,
 * and a structural change (a device move, a pad load) is shared, as Live's
 * set would be.
 *
 * `onInbound(address, args)` is called for every message a client sends,
 * already unwrapped from any `/bridge/batch` envelope and before the dispatch
 * sees it (the multitouch harness records the wire through it).
 *
 * `live: true` is the browser demo's (ADR-502): the song plays — song time
 * and playheads move at the scene's tempo — and the performance writes a
 * visitor makes are answered as Live would answer them: launching and
 * stopping clips and scenes, mute, solo, volume, pan and sends, and a native
 * effect loaded onto a track, and — given `resolvePreset`, which names the
 * device a preset file stands for — a preset loaded from the browser (an
 * instrument onto a new or pinned track, an effect onto a chain). The
 * harnesses leave it off: their captures must
 * be the same frame every run, and their scenarios assert on exactly what
 * the mock answers today.
 *
 * @param {{
 *   scene?: object,
 *   log?: (message: string) => void,
 *   onInbound?: ((address: string, args: unknown[]) => void) | null,
 *   live?: boolean,
 *   resolvePreset?: ((path: string) => { name: string, like: string, role?: string, effect?: boolean } | null) | null
 * }} [options]
 */
export function createMockEngine({ scene, log = () => {}, onInbound = null, live = false, resolvePreset = null } = {}) {
	const resolved = scene ?? buildDefaultScene();
	const version = resolved.version ?? PROTOCOL_VERSION;
	// `let`: a pad load is a structural change and advances it, exactly as
	// the surface's composite does.
	let generation = resolved.generation ?? 1;
	// Every Drum Rack's pads and chains (issue #491), by rack path. Mutated
	// by a pad load, so a later subscribe sees the grown chain.
	const padRacks = resolved.padRacks ?? {};
	// `/bridge/ax_helper [state, detail]` — the bridge's, not the surface's.
	const axHelper = {
		state: resolved.axHelper?.state ?? 'ready',
		detail: resolved.axHelper?.detail ?? ''
	};
	// `/bridge/features [json]` — the bridge's switches, also not the
	// surface's. A scene captured before they existed names none and gets the
	// rig's, so it draws what it always drew.
	const featuresJson = JSON.stringify(resolved.features ?? DEFAULT_FEATURES);
	const totalmixSwitch = (resolved.features ?? DEFAULT_FEATURES).totalmix;
	const totalmixAnswering = Boolean(totalmixSwitch?.enabled && totalmixSwitch?.available);
	const parsePadPath = (path) => {
		const m = typeof path === 'string' ? /^(.+)\/pads\/(\d{1,3})$/.exec(path) : null;
		return m && padRacks[m[1]] ? { rackPath: m[1], note: Number(m[2]) } : null;
	};

	const timers = new Set();
	let connectionCount = 0;

	// The setlist page's rack (ADR-519), names from the rig's Battlehooch set.
	const setlistMock = {
		song: 1,
		sound: 0,
		// The rig's effect racks as read on 2026-11-08: [label, x key, y key].
		pads: [
			['Stutter', '3/1', '3/2'], ['Wobble', '3/3', '3/4'], ['Trem', '3/5', '3/6'], ['Shape', '3/7', '3/8'],
			['Phaser', '4/1', '4/2'], ['Chorus', '4/3', '4/4'], ['LoPass', '4/5', '4/6'], ['HiPass', '4/7', '4/8'],
			['Ring/Redux', '5/1', '5/2'], ['Pitch', '5/3', '5/4'], ['Dist/Amp', '5/5', '5/6'], ['Comb', '5/7', '5/8'],
			['Delay', '6/1', '6/2'], ['Reverb', '6/3', '6/4']
		],
		loaded: {
			'1/1': 64, '3/1': 127, '3/2': 0, '3/3': 0, '3/4': 0, '3/5': 64, '3/6': 0, '3/7': 64, '3/8': 125,
			'4/1': 0, '4/2': 0, '4/3': 0, '4/4': 0, '4/5': 127, '4/6': 11.6, '4/7': 0, '4/8': 0,
			'5/1': 0, '5/2': 0, '5/3': 0, '5/4': 0, '5/5': 0, '5/6': 0, '5/7': 23.2, '5/8': 0,
			'6/1': 0, '6/2': 0, '6/3': 0, '6/4': 0
		},
		values: {},
		sets: [
			{ name: 'Joke', sounds: ['Lead', 'Organ', 'Keys'] },
			{ name: 'Pickin Fields', sounds: ['Theremin', 'Organ', 'church organ'] },
			{ name: 'Somersaults', sounds: ['Intro', 'Intro Bass', 'Noise', 'Sweep', 'organ', 'Bass'] }
		]
	};

	setlistMock.values = { ...setlistMock.loaded };

	const send = (ws, address, args = []) => {
		if (ws.readyState !== ws.OPEN) return;
		ws.send(JSON.stringify({ address, args }));
	};

	/**
	 * The value a `property/subscribe` cold-read answers with, or
	 * `undefined` for "no answer". Per device beats per name beats the
	 * synthetic defaults; `null` is a legitimate per-device answer (the
	 * surface's `nil`), which is why this is an own-property check and
	 * not a `??` chain.
	 */
	const has = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
	const propertyAnswer = (devicePath, propertyName) => {
		const perDevice = resolved.deviceProperties?.[devicePath];
		if (has(perDevice, propertyName)) return perDevice[propertyName];
		if (has(resolved.properties, propertyName)) return resolved.properties[propertyName];
		return PROPERTY_DEFAULTS[propertyName];
	};

	/**
	 * The §5.5 cold-start tree — one message since protocol 3.6.0.
	 * `scope` is the empty string: this is a whole-song bundle.
	 */
	const sendStateFull = (ws, reason) => {
		send(ws, '/looping/v3/state/full/tree', [
			reason,
			generation,
			SCENE_ETAG,
			'',
			...resolved.treeArgs
		]);
		log(`state/full sent (reason=${reason}, args=${resolved.treeArgs.length}, etag=${SCENE_ETAG})`);
	};

	/**
	 * A deterministic little MIDI phrase for a clip, so a session cell
	 * has something to draw. Derived from the clipPath, never random:
	 * a `--diff` compares captures byte for byte, so the
	 * same set must produce the same notes on every run.
	 *
	 * Packed the way `ClipNotesComponent._pack_notes_blob` does it —
	 * float32 LE `[pitch, start_beats, duration_beats, velocity]`, the
	 * velocity negated for a muted note (ADR-444) — and shipped as the
	 * Buffer-shaped JSON the bridge puts on the wire. Typed arrays rather than
	 * Node's `Buffer`, so the browser demo packs the same bytes.
	 */
	const notesBlobFor = (clipPath, lengthBeats) => {
		let seed = 0;
		for (let i = 0; i < clipPath.length; i++) seed = (seed * 31 + clipPath.charCodeAt(i)) >>> 0;
		const bars = Math.max(1, Math.round(lengthBeats));
		const count = Math.min(16, bars * 2);
		const bytes = new Uint8Array(count * 16);
		const buf = new DataView(bytes.buffer);
		for (let i = 0; i < count; i++) {
			// A walking line inside one octave, eighth notes, alternating
			// velocity — enough shape that lanes read as music, not noise.
			const step = (seed >>> (i % 8)) & 0x7;
			const pitch = 48 + step * 2 + (i % 3);
			const start = (i * lengthBeats) / count;
			const dur = Math.max(0.25, lengthBeats / count / 1.5);
			const vel = i % 2 === 0 ? 100 : 72;
			// Every fifth note is muted, so each MIDI thumbnail shows a
			// ghost note or two. The sign is the mute bit (ADR-444).
			const muted = i % 5 === 3;
			buf.setFloat32(i * 16, pitch, true);
			buf.setFloat32(i * 16 + 4, start, true);
			buf.setFloat32(i * 16 + 8, dur, true);
			buf.setFloat32(i * 16 + 12, muted ? -vel : vel, true);
		}
		return { count, blob: { type: 'Buffer', data: [...bytes] } };
	};

	/**
	 * `playing_slot` for every track the scene says is playing or
	 * recording. Without it the grid demotes those slots to a plain
	 * chip — `deriveSlotCellState` treats a transport state from the
	 * snapshot as stale unless the live channel confirms it — so the
	 * playing ring and the strip's playhead never appear under the mock,
	 * which is exactly the state a session view most needs to show.
	 */
	const sendPlayingSlots = (ws) => {
		for (const { devicePath, mute, pitch } of resolved.permuteSteps ?? []) {
			send(ws, '/looping/v3/permute/step', [devicePath, 'mute', mute]);
			send(ws, '/looping/v3/permute/step', [devicePath, 'pitch', pitch]);
		}
		// One still frame per Tone Shaper, as its device would send through the
		// bridge; the view draws nothing of the spectrum or the curve without.
		for (const { devicePath, levels, gains } of resolved.toneShaperFrames ?? []) {
			send(ws, '/toneshaper/frame', [devicePath, ...levels, ...gains]);
		}
		for (const { trackPath, slotIdx, isAudio, lengthBeats, status } of resolved.playing ?? []) {
			send(ws, '/looping/v3/track/playing_slot', [
				trackPath,
				slotIdx,
				isAudio ? 1 : 0,
				'',
				lengthBeats,
				0,
				lengthBeats,
				1,
				status,
				// The file's span in clip time. The scene's loops cover their
				// whole take, so it is the loop.
				0,
				lengthBeats
			]);
		}
	};

	/**
	 * The pad-scoped bundle (§2.2, reason `pad-chain`): the four-arg
	 * header with the pad path as scope, then the D/P records of the
	 * effects on that pad's chain. Sent on every `vm.padChain.<note>`
	 * cold read and again after a load into that pad.
	 */
	const sendPadChain = (ws, rackPath, note) => {
		const rack = padRacks[rackPath];
		if (!rack) return;
		const padPath = `${rackPath}/pads/${note}`;
		const records = padChainRecords(rackPath, note, rack);
		send(ws, '/looping/v3/state/full/tree', ['pad-chain', generation, SCENE_ETAG, padPath, ...records]);
		log(`pad-chain sent for ${padPath} (${(rack.chains[note] ?? []).length} effect(s), gen ${generation})`);
	};


	// ---- live mode (ADR-502) -------------------------------------------
	//
	// The scene's tempo and song position start the clock; it runs from the
	// moment the engine is made, so every client hears the same song.
	const tempo = Number(resolved.session?.['/looping/session/tempo']?.[0]) || 120;
	const songStart = Number(resolved.session?.['/looping/v3/session/song_time']?.[0]) || 0;
	const clockStart = Date.now();
	const songTime = () => songStart + ((Date.now() - clockStart) / 60_000) * tempo;
	// What each track plays, from the scene's `playing` list, which a launch
	// or a stop edits in place (the next client's accept replays it).
	const playing = (resolved.playing ??= []);
	const playingOn = (trackPath) => playing.find((p) => p.trackPath === trackPath);
	const SLOT_PATH = /^(tracks\/\d+)\/slots\/(\d+)$/;

	const sendPlayingSlot = (ws, entry) => {
		const { trackPath, slotIdx, isAudio, lengthBeats, status } = entry;
		send(ws, '/looping/v3/track/playing_slot', [
			trackPath, slotIdx, isAudio ? 1 : 0, '', lengthBeats, 0, lengthBeats, 1, status, 0, lengthBeats
		]);
		sendPlayhead(ws, entry);
	};
	const sendPlayhead = (ws, { trackPath, slotIdx, lengthBeats, status }) => {
		if (status !== 1) return;
		send(ws, '/looping/v3/track/playhead', [trackPath, slotIdx, songTime() % lengthBeats, status]);
	};

	/** Launch the clip in `slotPath`, if there is one. Returns whether it launched. */
	const launchSlot = (ws, slotPath) => {
		const m = SLOT_PATH.exec(slotPath);
		const lengthBeats = m ? resolved.clipLengths?.[`${slotPath}/clip`] : undefined;
		if (!m || typeof lengthBeats !== 'number') return false;
		const [, trackPath, slot] = m;
		const entry = { trackPath, slotIdx: Number(slot), isAudio: !!resolved.audioClips?.[`${slotPath}/clip`], lengthBeats, status: 1 };
		const at = playing.findIndex((p) => p.trackPath === trackPath);
		if (at >= 0) playing[at] = entry;
		else playing.push(entry);
		sendPlayingSlot(ws, entry);
		return true;
	};
	const stopTrack = (ws, trackPath) => {
		const entry = playingOn(trackPath);
		if (!entry || entry.status === 0) return;
		entry.status = 0;
		sendPlayingSlot(ws, entry);
	};
	/**
	 * Meters for the playing set: a level per playing, audible track that
	 * pulses on the beat at the scene's tempo (each track a little off the
	 * others, so the strips don't move as one), scaled by the track's volume,
	 * and the Main meter riding the loudest. Muted, stopped and solo-silenced
	 * tracks fall to zero. Invented, as everything here is, but it moves the
	 * way a playing set's meters move.
	 */
	const meterLevels = () => {
		const args = resolved.treeArgs;
		const tracks = new Map();
		for (let k = 0; k < args.length; k++) {
			if (args[k] === 'T' && /^tracks\/\d+$/.test(String(args[k + 1]))) {
				tracks.set(String(args[k + 1]), { mute: args[k + 4] === 1, solo: args[k + 5] === 1, volume: Number(args[k + 10]) || 0 });
			}
		}
		const anySolo = [...tracks.values()].some((t) => t.solo);
		const beat = songTime();
		const levels = [];
		let i = 0;
		for (const [trackPath, t] of tracks) {
			const entry = playingOn(trackPath);
			const audible = entry?.status === 1 && !t.mute && (!anySolo || t.solo);
			let left = 0;
			let right = 0;
			if (audible) {
				const phase = (beat + i * 0.13) % 1;
				const pulse = 0.55 + 0.4 * Math.exp(-phase * 5) + 0.05 * Math.sin(beat * 7.3 + i);
				const gain = Math.min(1, t.volume / 0.85);
				left = Math.min(1, pulse * gain * 0.92);
				right = Math.min(1, pulse * gain * (0.86 + 0.06 * Math.sin(beat * 3.1 + i)));
			}
			levels.push([trackPath, left, right]);
			i += 1;
		}
		return levels;
	};
	const trackPaths = () => [...new Set(Object.keys(resolved.clipLengths ?? {}).map((c) => c.split('/slots/')[0]))];

	/**
	 * The writes live mode answers. Returns true when it handled `address`;
	 * anything else falls through to the harness's dispatch below.
	 */
	const handleLive = (ws, address, args) => {
		switch (address) {
			case '/looping/v3/clip/launch': {
				const [slotPath] = args;
				if (typeof slotPath === 'string' && !launchSlot(ws, slotPath)) log(`clip/launch ${slotPath}: empty slot`);
				return true;
			}
			case '/looping/v3/clip/stop': {
				const [trackPath] = args;
				if (typeof trackPath === 'string') stopTrack(ws, trackPath);
				return true;
			}
			case '/looping/v3/scene/launch': {
				const m = typeof args[0] === 'string' ? /^scenes\/(\d+)$/.exec(args[0]) : null;
				if (m) for (const t of trackPaths()) launchSlot(ws, `${t}/slots/${m[1]}`);
				return true;
			}
			case '/looping/v3/scene/stop': {
				for (const p of playing) stopTrack(ws, p.trackPath);
				return true;
			}
			// The mixer writes are their own echo (§2.11: one address each
			// way, the same args), as the surface's listeners make them. Mute,
			// solo and volume are also written into the track's T record, so
			// a structural re-send (a loaded effect) keeps them.
			case '/looping/v3/track/mute':
			case '/looping/v3/track/solo':
			case '/looping/v3/track/volume': {
				const [trackPath, value] = args;
				const field = { mute: 4, solo: 5, volume: 10 }[address.split('/').pop()];
				const at = resolved.treeArgs.findIndex((v, k) => v === 'T' && resolved.treeArgs[k + 1] === trackPath);
				if (at >= 0 && typeof value === 'number') resolved.treeArgs[at + field] = value;
				send(ws, address, args);
				return true;
			}
			case '/looping/v3/track/name': {
				const [trackPath, name] = args;
				const at = resolved.treeArgs.findIndex((v, k) => v === 'T' && resolved.treeArgs[k + 1] === trackPath);
				if (at >= 0 && typeof name === 'string') resolved.treeArgs[at + 2] = name;
				send(ws, address, args);
				return true;
			}
			case '/looping/v3/track/pan':
			case '/looping/v3/track/send':
			case '/looping/v3/master/volume':
				send(ws, address, args);
				return true;
			case '/looping/v3/device/load': {
				// A native effect onto a track (`native:<class>`, the tile's
				// name in `rel`). A pad load is the harness's, below; a file
				// (a rack, a plug-in, a Max device) needs Live's browser, so it
				// fails the way the surface fails a preset it cannot find.
				const [trackPath, devicePath, filePath, source, rel] = args;
				if (parsePadPath(devicePath)) return false;
				const native = typeof source === 'string' && source.startsWith('native:');
				const preset = native ? null : resolvePreset?.(String(rel || filePath || ''));
				if ((!native && !preset?.effect) || typeof trackPath !== 'string' || !/^tracks\/\d+$/.test(trackPath)) {
					send(ws, '/looping/v3/error', [address, 'load-failed', String(filePath || source || ''), 'not-in-demo']);
					return true;
				}
				const className = native ? source.slice('native:'.length) : undefined;
				const name = native ? (typeof rel === 'string' && rel) || className : preset.name;
				const added = appendTrackDevice(resolved, trackPath, name, className, preset?.like);
				generation += 1;
				sendStateFull(ws, 'structural');
				send(ws, '/looping/v3/device/appointed', [added]);
				log(`device/load ${name} (${className}) → ${added}`);
				return true;
			}
			case '/looping/v3/track/prepare_for_preset': {
				// [requestId, trackType, presetPath, targetTrackPath?, source?, rel?]
				// An instrument from the browser: onto the pinned track (its
				// instrument swapped), else onto a new one at the end, as the
				// surface's `new`/auto modes leave it. Empty preset and no
				// source: an empty track (New Audio / New MIDI).
				const [requestId, trackType, presetPath, target, source, rel] = args;
				const nack = (code, detail) => send(ws, `${address}/nack`, [String(requestId), code, detail]);
				if (typeof requestId !== 'string') return true;
				const kind = trackType === 'audio' ? 'audio' : 'midi';
				const ref = String(rel || presetPath || '');
				const native = typeof source === 'string' && source.startsWith('native:');
				const preset = native
					? { name: String(rel || source.slice('native:'.length)), like: source.slice('native:'.length) }
					: ref
						? resolvePreset?.(ref)
						: null;
				if (ref && !preset) {
					nack('load-failed', 'not-in-demo');
					return true;
				}
				const pinned = typeof target === 'string' && /^tracks\/\d+$/.test(target) ? target : '';
				let trackPath;
				let created = 1;
				if (pinned && preset) {
					replaceInstrument(resolved, pinned, preset);
					trackPath = pinned;
					created = 0;
				} else {
					// A preset reuses the empty track the browser made, as the
					// surface does; an empty request always makes a new one.
					if (preset && takeEmptyLastTrack(resolved, kind)) created = 0;
					trackPath = appendTrack(resolved, {
						name: preset?.name ?? (kind === 'audio' ? 'Audio' : 'MIDI'),
						kind,
						role: preset?.role ?? '',
						preset: preset ? ref : '',
						instrument: preset
					});
				}
				generation += 1;
				send(ws, `${address}/ack`, [requestId, trackPath, created]);
				sendStateFull(ws, 'structural');
				send(ws, '/looping/v3/selected_track', [trackPath]);
				if (preset) send(ws, '/looping/v3/device/appointed', [`${trackPath}/devices/0`]);
				log(`prepare_for_preset ${preset?.name ?? '(empty)'} → ${trackPath}`);
				return true;
			}
			default:
				return false;
		}
	};

	/**
	 * A client arrived. Sends what the bridge sends on connect, starts the
	 * liveness beats, and returns `receive(raw)` for each frame the client
	 * sends and `close()` for when it goes.
	 */
	function connect(ws) {
		connectionCount += 1;
		log('client connected');
		// The pads this client holds a `vm.padChain.<note>` row on — the
		// ones whose bundle a load into them must re-send.
		const padSubs = new Set();
		const ticks = [];

		// Launch-mode beacon, sent once per client on connect exactly as
		// the real bridge does.
		send(ws, '/bridge/server_mode', ['dev']);
		// The AX helper's state, as the bridge announces it on connect
		// (ADR-439). From the SCENE, not a literal: hardcoded `ready` made the
		// Drum Rack pill's not-ready branch — `ax-helper-down` / `ax-untrusted`,
		// the states a rig without the helper installed is actually in —
		// unreachable from the harness. Defaults to ready, so every existing
		// scene and capture behaves exactly as before.
		send(ws, '/bridge/ax_helper', [axHelper.state, axHelper.detail]);
		// The feature switches, on connect as the real bridge sends them
		// (general-release audit §7b). The UI draws nothing for a feature
		// until this arrives, so without it every capture would lose the
		// TotalMix strip.
		send(ws, '/bridge/features', [featuresJson]);

		const ping = setInterval(() => send(ws, '/bridge/ping', [Date.now()]), PING_INTERVAL_MS);
		const beat = setInterval(
			() => send(ws, '/looping/v3/bridge/heartbeat', [0, Date.now()]),
			SURFACE_HEARTBEAT_MS
		);
		timers.add(ping);
		timers.add(beat);
		// Live mode: the song plays. Song time at the surface's 10 Hz, and a
		// playhead for every playing clip with it.
		if (live) {
			const tick = setInterval(() => {
				send(ws, '/looping/v3/session/song_time', [songTime()]);
				for (const entry of playing) sendPlayhead(ws, entry);
			}, LIVE_TICK_MS);
			timers.add(tick);
			ticks.push(tick);
			// Meters: every track's, then Main's. A silent track is sent once
			// at zero and then left alone, so its meter falls and stays.
			const lastZero = new Set();
			const meter = setInterval(() => {
				let mainL = 0;
				let mainR = 0;
				for (const [trackPath, left, right] of meterLevels()) {
					if (left === 0 && right === 0) {
						if (lastZero.has(trackPath)) continue;
						lastZero.add(trackPath);
					} else lastZero.delete(trackPath);
					send(ws, '/looping/v3/track/meter', [trackPath, left, right]);
					mainL = Math.max(mainL, left);
					mainR = Math.max(mainR, right);
				}
				send(ws, '/looping/v3/master/meter', [mainL, mainR]);
			}, METER_TICK_MS);
			timers.add(meter);
			ticks.push(meter);
		}

		function receive(raw) {
			let msg;
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (!msg?.address) return;

			// The UI coalesces every send() in one event-loop turn into a
			// `/bridge/batch` envelope (see api/connection/outboundBatcher.ts).
			// The real bridge unpacks it in WebSocketServer.handleBatch; this
			// mock must too, or every batched UI write lands in the
			// `unhandled` default and is silently dropped while the shot
			// still renders a plausible-looking screenshot. Caught exactly
			// that way: `npm run shot` logged `unhandled /bridge/batch`.
			if (msg.address === '/bridge/batch') {
				for (const inner of Array.isArray(msg.messages) ? msg.messages : []) {
					// Nested envelopes are refused rather than recursed, same
					// as the real bridge — nothing legitimately nests them.
					if (inner?.address && inner.address !== '/bridge/batch') {
						handleInbound(ws, inner);
					}
				}
				return;
			}
			handleInbound(ws, msg);
		}

		/** Dispatch one already-unwrapped inbound message. */
		function handleInbound(ws, msg) {
			const { address, args = [] } = msg ?? {};
			if (!address) return;
			onInbound?.(address, args);
			if (live && handleLive(ws, address, args)) return;

			switch (address) {
				case '/looping/v3/setlist/param':
					setlistMock.values[args[0]] = args[1];
					return;
				case '/looping/v3/setlist/get':
				case '/looping/v3/setlist/select_song':
				case '/looping/v3/setlist/select_sound': {
					if (address.endsWith('select_song')) {
						setlistMock.song = args[0];
						setlistMock.sound = 0;
						setlistMock.values = { ...setlistMock.loaded };
					} else if (address.endsWith('select_sound')) {
						setlistMock.song = Math.max(setlistMock.song, 0);
						setlistMock.sound = args[0];
						setlistMock.values = { ...setlistMock.loaded };
					}
					const shown = setlistMock.sets[Math.max(setlistMock.song, 0)];
					send(ws, '/looping/v3/setlist/state', [
						JSON.stringify({
							found: true,
							songs: setlistMock.sets.map((set) => set.name),
							song: setlistMock.song,
							sounds: shown.sounds,
							sound: setlistMock.sound,
							output: { key: '1/1', value: setlistMock.values['1/1'] },
							soundPads: [
								{ label: 'Delay Time', x: { key: 's/1', value: 52 }, y: { key: 's/2', value: 66 } },
								{ label: 'HiPass', x: { key: 's/3', value: 0 }, y: { key: 's/4', value: 0 } }
							],
							pads: setlistMock.pads.map(([label, x, y]) => ({
								label,
								x: { key: x, value: setlistMock.values[x] },
								y: { key: y, value: setlistMock.values[y] }
							}))
						})
					]);
					return;
				}
				case '/looping/v3/handshake/hello': {
					const offered = args.map(String);
					if (!offered.includes(version)) {
						send(ws, '/looping/v3/error', [
							address,
							'handshake-version-mismatch',
							'',
							`UI: ${offered.join(',')}, Mock: ${version}`
						]);
						log(`handshake rejected — UI offered ${offered.join(',')}, scene is ${version}`);
						return;
					}
					send(ws, '/looping/v3/handshake/accept', [version, 'mock-session', generation]);
					for (const [addr, values] of Object.entries(resolved.session ?? {})) {
						// Monitor levels only come from a mixer the bridge has
						// heard: switched off, or on and not answering, the real
						// bridge has none to send.
						if (addr.startsWith('/looping/v3/totalmix') && !totalmixAnswering) continue;
						send(ws, addr, values);
					}
					sendStateFull(ws, 'accept');
					sendPlayingSlots(ws);
					return;
				}

				case '/looping/v3/state/resync':
					sendStateFull(ws, 'resync');
					sendPlayingSlots(ws);
					return;

				case '/looping/v3/clip/sample/get': {
					// [requestId, clipPath] → /looping/v3/clip/sample.
					// This reply is what tells a cell whether to draw a
					// waveform or note lanes — a slot with no answer draws
					// NOTHING, which is why the grid looked contentless
					// under the mock. MIDI tracks answer isAudioClip=0 and
					// go on to pull notes; audio tracks answer with the
					// scene's file for that slot.
					//
					// That used to be the empty string — there is no real
					// file to read peaks from here — but an empty path is
					// *provisional* to every reader of this reply, and
					// `useClipSwap` bails on one before the clip view's
					// swap pill can mount at all (ADR-440). The waveform
					// still does not paint, because the path names no file
					// on this machine; the pill now does.
					const [requestId, clipPath] = args;
					if (typeof requestId !== 'string' || typeof clipPath !== 'string') return;
					const file = resolved.audioClips?.[clipPath];
					send(ws, '/looping/v3/clip/sample', [
						requestId,
						clipPath,
						file ? 1 : 0,
						typeof file === 'string' ? file : '',
						// The file's span: unknown here, which is what the
						// real surface answers for a take it can't read.
						0,
						0
					]);
					return;
				}

				case '/looping/v3/clip/notes/get': {
					// [requestId, clipPath] → /looping/v3/clip/notes
					const [requestId, clipPath] = args;
					if (typeof requestId !== 'string' || typeof clipPath !== 'string') return;
					const lengthBeats = resolved.clipLengths?.[clipPath] ?? 8;
					const { count, blob } = notesBlobFor(clipPath, lengthBeats);
					send(ws, '/looping/v3/clip/notes', [requestId, clipPath, count, blob]);
					return;
				}

				case '/looping/v3/clip/notes/rich/get': {
					// [requestId, clipPath] → rich/begin · chunk · end — the note
					// editor's channel (the pencil). The same phrase as
					// `clip/notes/get`, repacked as `<iffffi>` (note_id, pitch,
					// start, duration, velocity, mute) in one chunk, with the
					// surface's FNV-1a checksum as its `0x%08x` string. Without it the editor sits on
					// "Loading notes…" in every shot.
					const [requestId, clipPath] = args;
					if (typeof requestId !== 'string' || typeof clipPath !== 'string') return;
					const lengthBeats = resolved.clipLengths?.[clipPath] ?? 8;
					const { count, blob } = notesBlobFor(clipPath, lengthBeats);
					const src = new DataView(Uint8Array.from(blob.data).buffer);
					const rich = new Uint8Array(count * 24);
					const out = new DataView(rich.buffer);
					for (let i = 0; i < count; i++) {
						const vel = src.getFloat32(i * 16 + 12, true);
						out.setInt32(i * 24, i + 1, true);
						out.setFloat32(i * 24 + 4, src.getFloat32(i * 16, true), true);
						out.setFloat32(i * 24 + 8, src.getFloat32(i * 16 + 4, true), true);
						out.setFloat32(i * 24 + 12, src.getFloat32(i * 16 + 8, true), true);
						out.setFloat32(i * 24 + 16, Math.abs(vel), true);
						out.setInt32(i * 24 + 20, vel < 0 ? 1 : 0, true);
					}
					let h = 0x811c9dc5;
					for (const byte of rich) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
					const chunks = count > 0 ? 1 : 0;
					send(ws, '/looping/v3/clip/notes/rich/begin', [requestId, clipPath, count, chunks]);
					if (chunks) {
						send(ws, '/looping/v3/clip/notes/rich/chunk', [requestId, 0, { type: 'Buffer', data: [...rich] }]);
						send(ws, '/looping/v3/clip/notes/rich/end', [requestId, `0x${(h & 0x7fffffff).toString(16).padStart(8, '0')}`]);
					}
					return;
				}

				case '/looping/v3/property/subscribe': {
					// [devicePath, propertyName] → one `property/value` cold-read
					// (§2.6: subscribe is its own cold-read). A scene may carry
					// per-device `deviceProperties` (two kits, two censuses) and
					// per-name `properties`; the synthetic defaults answer the
					// rest. Unknown names stay unanswered, which leaves the view
					// at its `?? default` rest state, exactly as a surface that
					// has no member for the function would.
					const [devicePath, propertyName] = args;
					if (typeof devicePath !== 'string' || typeof propertyName !== 'string') return;
					// The two pad-chain rows (issue #491) answer from the rack's
					// pad table rather than the property tables: presence for
					// the whole rack, and — for one pad — its entry plus the
					// records themselves as a pad-scoped bundle.
					const rack = padRacks[devicePath];
					if (rack && propertyName === 'vm.padFx') {
						send(ws, '/looping/v3/property/value', [devicePath, propertyName, vmPadFx(rack)]);
						return;
					}
					const chainRow = rack && /^vm\.padChain\.(\d{1,3})$/.exec(propertyName);
					if (chainRow) {
						const note = Number(chainRow[1]);
						padSubs.add(`${devicePath}/pads/${note}`);
						send(ws, '/looping/v3/property/value', [devicePath, propertyName, padChainEntry(rack, note)]);
						sendPadChain(ws, devicePath, note);
						return;
					}
					const value = propertyAnswer(devicePath, propertyName);
					if (value === undefined) {
						log(`unhandled property subscribe ${propertyName}`);
						return;
					}
					send(ws, '/looping/v3/property/value', [devicePath, propertyName, value]);
					return;
				}

				case '/looping/v3/property/unsubscribe': {
					const [devicePath, propertyName] = args;
					const chainRow = typeof propertyName === 'string' && /^vm\.padChain\.(\d{1,3})$/.exec(propertyName);
					if (chainRow) padSubs.delete(`${devicePath}/pads/${Number(chainRow[1])}`);
					return;
				}

				case '/looping/v3/device/select': {
					// [devicePath] — the blue hand moves there, and the surface
					// reports it the way Live's listener makes it report.
					const [devicePath] = args;
					send(ws, '/looping/v3/device/appointed', [typeof devicePath === 'string' ? devicePath : '']);
					return;
				}

				case '/looping/v3/device/move': {
					// [devicePath, index] — the chain overview's drag. The track's
					// device records are reordered and renumbered, and the tree is
					// re-sent at the next generation, as Live's structural
					// republish would.
					const [devicePath, index] = args;
					const m = typeof devicePath === 'string' ? /^(tracks\/\d+)\/devices\/(\d+)$/.exec(devicePath) : null;
					if (!m || typeof index !== 'number') {
						log(`unhandled ${address} ${devicePath}`);
						return;
					}
					moveTrackDevice(resolved.treeArgs, m[1], Number(m[2]), index);
					generation += 1;
					sendStateFull(ws, 'structural');
					log(`device/move ${devicePath} → index ${index}`);
					return;
				}

				case '/looping/v3/device/load': {
					// [trackPath, devicePath, presetPath] — answered only when
					// `devicePath` is a pad on one of the scene's Drum Racks
					// (issue #491). The preset's device joins the end of that
					// pad's chain and the surface's composite follows: the
					// generation advances (a pathless `state/invalidate`),
					// presence is re-emitted, and the pad's bundle is re-sent
					// to a client holding its row. A track-level load still
					// sits unanswered — that needs Live.
					// A native device (3.12.0) names its class and the name it
					// takes instead of a file; the device is named for the tile,
					// which the class table maps back to its class.
					const [, devicePath, filePath, source, rel] = args;
					const native = typeof source === 'string' && source.startsWith('native:');
					const presetPath = native ? rel : filePath;
					const pad = parsePadPath(devicePath);
					if (!pad || typeof presetPath !== 'string') {
						log(`unhandled ${address}${typeof devicePath === 'string' && devicePath ? ` into ${devicePath}` : ''}`);
						return;
					}
					// A plug-in preset (`AuPluginDevice`) goes through
					// Live's browser on the surface, and the mock has none: it
					// answers the scoped `load-failed` the surface sends for a
					// preset the browser cannot find, so a recipe can photograph
					// the tile falling back from loading to ghost for that pad
					// alone (2026-09-12). Native devices insert as before.
					const presetName = presetPath.split('/').pop()?.replace(/\.(adv|adg|aupreset|amxd)$/i, '') ?? '';
					if (deviceClassName(presetName) === 'AuPluginDevice') {
						send(ws, '/looping/v3/error', [address, 'load-failed', presetPath, `not-in-browser;scope=${devicePath}`]);
						log(`device/load into ${devicePath}: ${presetName} is a plug-in preset — load-failed (scoped)`);
						return;
					}
					const rack = padRacks[pad.rackPath];
					const added = appendPadDevice(rack, pad.note, presetPath);
					generation += 1;
					send(ws, '/looping/v3/state/invalidate', [generation, 'pad-chain']);
					send(ws, '/looping/v3/property/value', [pad.rackPath, 'vm.padFx', vmPadFx(rack)]);
					if (padSubs.has(devicePath)) sendPadChain(ws, pad.rackPath, pad.note);
					log(`device/load into ${devicePath}: ${added.name} (${added.className}) at chain index ${added.index}`);
					return;
				}

				case '/looping/v3/property/set': {
					// [devicePath, propertyName, value, generation] → echo as a
					// value event, the same holding role the param echo plays.
					const [devicePath, propertyName, value] = args;
					if (typeof devicePath === 'string' && typeof propertyName === 'string' && value !== undefined) {
						send(ws, '/looping/v3/property/value', [devicePath, propertyName, value]);
						// A Hybrid's new IR category: Live re-sends the category's
						// file names (its `ir_file_list` listener), measured.
						const files = propertyName === 'ir_category_index' ? HYBRID_IR_LISTS.files[Math.round(Number(value))] : null;
						if (files) send(ws, '/looping/v3/property/value', [devicePath, 'ir_file_list', JSON.stringify(files)]);
					}
					return;
				}

				case '/looping/v3/track/select': {
					// [trackPath] → `selected_track [trackPath]`, the surface's
					// echo of Live's selection. Without it a strip tap under the
					// mock selected nothing, so no shot could reach a second
					// track's instrument view.
					const [trackPath] = args;
					if (typeof trackPath !== 'string') return;
					send(ws, '/looping/v3/selected_track', [trackPath]);
					return;
				}

				case '/looping/v3/param/set': {
					// [paramPath, value, generation] → echo as a value event
					// so an interactive session's knobs stay where you put
					// them instead of snapping back on the next repaint.
					const [paramPath, value] = args;
					if (typeof paramPath === 'string' && typeof value === 'number') {
						send(ws, '/looping/v3/param/value', [paramPath, value]);
					}
					return;
				}

				case '/looping/v3/session/foot_switch/learn':
				case '/looping/v3/session/foot_switch/enabled': {
					// The rig's switch from the scene, with the write applied: a
					// learn start answers `listening` (a real surface would then
					// wait for the pedal), a cancel `idle`, and enabled echoes.
					const [v] = args;
					const on = v === 1;
					const learning = address.endsWith('/learn');
					send(ws, '/looping/v3/session/foot_switch', [
						learning ? 1 : on ? 1 : 0, 10, 23, 'momentary',
						learning && on ? 'listening' : 'idle', 1
					]);
					return;
				}

				case '/looping/v3/session/key_follow': {
					// ADR-447: the toggle echoes, the way the surface's settings do.
					const [v] = args;
					send(ws, '/looping/v3/session/key_follow', [v === 1 ? 1 : 0]);
					return;
				}

				case '/looping/v3/session/scale/detect': {
					// ADR-446: the rig's own test set as a canned answer, so the
					// picker's result strip can be shot. apply=1 also echoes the
					// three session writes the surface makes.
					const [apply] = args;
					send(ws, '/looping/v3/session/scale/detected', [
						0, 'Minor', 'sure', 67, 5, 'Dorian', 1453,
						'harmonic cycle 16 beats | pitch classes present: C D D# F G G# A# | '
						+ 'collections that fit: D# Major, C Minor, F Dorian, A# Mixolydian, G# Lydian, G Phrygian, D Locrian | '
						+ 'bass downbeats C(8) D#(4) C(4) D#(4), first note C (2), lowest C (1) | keys chord roots C(6) F(3) G(1) C(3) F(3) G(1) | '
						+ 'synth rests F (2 each), longest A# (1) | tonic votes: C 24, F 8, D# 8, G 2, A# 1, G# 0, D 0 | C Minor (sure, gap 67 %), runner-up F Dorian',
						apply === 1 ? 1 : 0
					]);
					if (apply === 1) {
						send(ws, '/looping/v3/session/scale_root', [0]);
						send(ws, '/looping/v3/session/scale_name', ['Minor']);
						send(ws, '/looping/v3/session/scale_mode', [1]);
					}
					return;
				}

				default:
					log(`unhandled ${address}`);
			}
		}

		function close() {
			clearInterval(ping);
			clearInterval(beat);
			timers.delete(ping);
			timers.delete(beat);
			for (const tick of ticks) {
				clearInterval(tick);
				timers.delete(tick);
			}
			log('client disconnected');
		}

		return { receive, close };
	}

	return {
		connect,
		/** How many clients have EVER connected (see `startMockSurface`). */
		clientCount: () => connectionCount,
		/** Stop every client's beats. */
		stop() {
			for (const t of timers) clearInterval(t);
			timers.clear();
		}
	};
}

/**
 * Move a track's top-level device to `to` in `args` (the scene's tree):
 * its D and P records, and every later one's, renumbered.
 */
function moveTrackDevice(args, trackPath, from, to) {
	const prefix = `${trackPath}/devices/`;
	const start = args.findIndex((v, k) => v === 'D' && String(args[k + 1]).startsWith(prefix));
	if (start < 0) return;
	const groups = [];
	let k = start;
	for (;;) {
		const path = String(args[k + 1]);
		if (args[k] === 'D' && path.startsWith(prefix)) {
			groups.push([]);
			groups.at(-1).push(...args.slice(k, k + 4));
			k += 4;
		} else if (args[k] === 'P' && path.startsWith(prefix)) {
			groups.at(-1).push(...args.slice(k, k + 8));
			k += 8;
		} else break;
	}
	const target = Math.max(0, Math.min(groups.length - 1, to));
	const [moved] = groups.splice(from, 1);
	groups.splice(target, 0, moved);
	const renumbered = groups.flatMap((group, i) =>
		group.map((v) => (typeof v === 'string' ? v.replace(/^(tracks\/\d+\/devices\/)\d+(?=\/|$)/, (_, p) => (p === prefix ? `${p}${i}` : _)) : v))
	);
	args.splice(start, k - start, ...renumbered);
}

