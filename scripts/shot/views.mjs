/**
 * Named view recipes for the screenshot harness.
 *
 * A view is "which layout do I want to look at", expressed as the
 * localStorage prefs the UI reads at boot plus an optional list of
 * things to click once it's up. Everything here is seeded *before* the
 * first paint, so a shot never captures a layout mid-transition.
 *
 * The pref keys are `uiPrefsStore`'s (see
 * `interface/src/lib/stores/v6/uiPrefsStore.svelte.ts`). Note the
 * default-ON `showFxGrid` reads inverted: only an explicit `'0'` turns it
 * off. The central view, the flipped stack (ADR-421), the Drum Rack's pad
 * column and the strips' device band have no switch since 2026-09-26, so
 * every view captures them on.
 *
 * Add a view here rather than growing shot.mjs's flag surface — a named
 * view is something you can ask for from a phone in three words.
 */

/** iPad Pro 12.9" landscape, the machine this interface is built for. */
export const DEFAULT_VIEWPORT = { width: 1366, height: 1024 };

const P = {
	session: 'uiPrefsStore.sessionMode',
	fx: 'uiPrefsStore.showFxGrid',
	transport: 'uiPrefsStore.showTransportHeader'
};

export const VIEWS = {
	default: {
		description: 'As shipped — strips, central view, FX grid.',
		prefs: {}
	},
	session: {
		description: 'Session mode on: clip grid under the strips (ADR-415/416).',
		prefs: { [P.session]: '1' }
	},
	'session-only': {
		description: 'Strips + clip grid + central view, FX grid off.',
		prefs: { [P.session]: '1', [P.fx]: '0' }
	},
	central: {
		description: 'Strips + central view, FX grid off — the emptiest layout.',
		prefs: { [P.fx]: '0' }
	},
	full: {
		description: 'All four sections plus the transport header.',
		prefs: {
			[P.session]: '1',
			[P.fx]: '1',
			[P.transport]: '1'
		}
	},
	// The feature switches (general-release audit §7b). `features` replaces
	// the scene's bridge snapshot (`/bridge/features`) for the matching ids;
	// these three share one layout, so any two of them diff to the switch
	// alone. The status-strip mirror is not in any capture: its band is
	// `env(safe-area-inset-top)` tall, which is 0 off the iPad.
	header: {
		description: 'Transport header on — the TotalMix faders as the rig draws them.',
		prefs: { [P.transport]: '1' }
	},
	general: {
		description: 'General edition: TotalMix, the Max Utility patch and the expression pedal switched off — no faders, the header re-divides.',
		prefs: { [P.transport]: '1' },
		features: {
			totalmix: { enabled: false, available: false, reason: '' },
			maxUtilityPatch: { enabled: false, available: false, reason: '' },
			expressionPedal: { enabled: false, available: false, reason: '' }
		}
	},
	'totalmix-down': {
		description: 'TotalMix switched on but not answering — the faders greyed out, saying why.',
		prefs: { [P.transport]: '1' },
		features: { totalmix: { enabled: true, available: false, reason: 'TotalMix not answering' } }
	}
};

export function listViews() {
	return Object.entries(VIEWS).map(([name, v]) => ({ name, description: v.description }));
}

export function resolveView(name) {
	const view = VIEWS[name];
	if (!view) {
		const known = Object.keys(VIEWS).join(', ');
		throw new Error(`Unknown view "${name}". Known views: ${known}`);
	}
	return { name, path: '/', ...view };
}

// ---- tours (tour.mjs) ----------------------------------------------------

/*
 * A tour is many states captured in one boot. A state is a view (its prefs
 * and path) plus the steps that reach the screen you want — `performSteps` in
 * screenshot-page.mjs — an optional crop selector, an optional `swap` (a
 * device put in another's place before the mock starts) and an optional
 * `axHelper` (the state the bridge publishes on `/bridge/ax_helper`, which is
 * what the Drum Rack's swap pill is gated on).
 *
 * The selectors lean on the default scene's track order (scene.mjs):
 *   0 Drums   DrumCell kit            6 Lead     Wavetable + Permute
 *   1 Bass    Wavetable + Permute     7 Texture  audio, Simpler
 *   2 Keys    Drift + Permute         8 Jazz     Simpler kit (pad 38 in play)
 *   3 Guitar  audio                   9 Ethnic   nested-rack kit
 *   4 Vox     audio                  10 Autumn   Sampler kit
 *   5 Pad     Drift                  11 FM       Operator + Drum Buss
 * Reorder the scene and these indices move with it.
 */
const selectTrack = (index) => ({ click: `[data-track-index="${index}"] [data-section="clip"]` });
const openPermute = (index) => ({ click: `[data-track-index="${index}"] [data-section="permute"]` });
// The strip's device band: it selects the track AND opens that device's
// central view in one tap (`TrackStrip.selectThenDevice`), so it needs no
// `selectTrack` ahead of it. It replaced the FX grid's instrument slider
// here on 2026-09-15, when that slider left the grid with the ten-column
// cut — the band is the instrument view's door now.
const openInstrument = (index) => ({ click: `[data-track-index="${index}"] [data-section="device"]` });
const openTile = (label) => ({ click: `.device-control:has-text("${label}")` });

const FX_TILES = [
	['Rand Oct', 'random', 'Arpeggiator view (the Rand Oct tile)'],
	['EQ', 'eq', 'EQ Eight'],
	['Filter', 'filter', 'Auto Filter'],
	['Pedal', 'pedal', 'Pedal + Saturator + Digital + Redux'],
	['Drum', 'drum-buss', 'Drum Buss'],
	['Glue', 'squash', 'Glue (the Squash slot) + Compressor'],
	['Gain', 'utility', 'Utility / Gate (the Gain tile)'],
	['Var', 'variation', 'Variation'],
	['Chorus', 'chorus', 'Chorus: Blur, Comb, Phaser'],
	['Auto Pan', 'tremolo', 'Auto Pan Legacy (the Tremolo slot)'],
	['Echo', 'echo', 'Echo'],
	['Reverb', 'reverb', 'Reverb']
];

/** Open Settings from the master strip's gear. */
const SETTINGS_OPEN = [{ click: '[data-debug="master-card"]' }, { click: '[data-debug="settings-gear"]', dom: true }];

export const TOURS = {
	central: {
		description: 'Every central view the default scene reaches, cropped to the central section.',
		crop: '.central-frame',
		states: [
			{ name: 'clip-midi', description: 'Clip view, MIDI track, mini session up' },
			{ name: 'clip-audio', description: 'Clip view, audio track (Guitar)', steps: [selectTrack(3)] },
			{
				name: 'clip-audio-general',
				description: 'Clip view, audio track, AX helper switched off — no Rev and no Group; to Simpler and Dup Trk take their columns',
				features: { axHelper: { enabled: false, available: false, reason: '' } },
				steps: [selectTrack(3)]
			},
			{
				name: 'clip-audio-no-recorder',
				description: 'Clip view, audio track, no recorder device on Return A — REC greyed out, saying why',
				features: { captureRecorder: { enabled: true, available: false, reason: 'No recorder on Return A' } },
				steps: [selectTrack(3)]
			},
			{ name: 'clip-session', view: 'session', description: 'Clip view with CLIPS on — no mini column' },
			// The pencil's note editor: Fold on (its default) and off. With the
			// clip grid off it keeps the mini session column on its left.
			{ name: 'clip-notes', description: 'Note editor (the pencil), Fold on, the mini session column beside it', steps: [{ click: '.editor-toggle' }] },
			{
				name: 'clip-notes-session',
				view: 'session',
				description: 'Note editor with CLIPS on — no mini column, the editor full width',
				steps: [{ click: '.editor-toggle' }]
			},
			// A body tap on a mini slot holding a clip focuses it and opens the
			// editor; the second slot is a stopped clip in the default scene.
			{
				name: 'clip-mini-tap',
				description: 'A tap on a mini slot holding a clip opens the note editor on it',
				steps: [{ click: '.col-mini [data-slot-index="1"]' }]
			},
			{
				name: 'clip-notes-unfolded',
				description: 'Note editor, Fold off',
				steps: [{ click: '.editor-toggle' }, { click: '.edit-chip:has-text("Fold")' }]
			},
			{ name: 'permute', description: 'Permute (Bass)', steps: [openPermute(1)] },
			// Touching Q opens it; the tiles are the Mac's own ticks
			// (`logs/grooves.json`, else the twelve defaults) from Live's Core
			// Library — on a Mac without Live there are none to draw.
			{ name: 'groove', description: 'Groove view (touch Q): the ticked grooves, Random · Velocity · Amount', steps: [{ click: '[aria-label="Quantization amount"]' }] },
			{ name: 'system', description: 'Master track — the System view: Transport, Follow Key, Sections', steps: [{ click: '[data-debug="master-card"]' }] },
			{
				name: 'fx-pedal-general',
				description: 'Pedal view, expression pedal switched off — no Wah column',
				features: { expressionPedal: { enabled: false, available: false, reason: '' } },
				steps: [openTile('Pedal')]
			},
			// Guitar is two hops now: its tile left the grid for the Pedal
			// view's last column (2026-09-15), which is also its only door.
			{
				name: 'fx-guitar',
				description: 'Guitar (via the Pedal view, which carries its tile)',
				steps: [openTile('Pedal'), { click: '.guitar-column .device-control' }]
			},
			{
				name: 'fx-guitar-loaded',
				description: 'Guitar on the Guitar track, where the rack is loaded: the Drive/Fuzz and Tremolo XY pads',
				steps: [selectTrack(3), openTile('Pedal'), { click: '.guitar-column .device-control' }]
			},
			...FX_TILES.map(([label, name, description]) => ({
				name: `fx-${name}`,
				description,
				steps: [openTile(label)],
				// The Gate pad is centred across its view, on purpose.
				...(name === 'utility' ? { layout: { centered: 'x' } } : {})
			})),
			// The Hybrid Reverb on Pad (track 5): the rig's full parameter vector
			// (a Quartz), one state per algorithm the picker's tap leaves it on,
			// each with the drag that shows what that algorithm is about. A
			// slider drag is relative: +dx of its ~196 px moves it dx/196.
			...[
				['Hall', 'Bass Mult raised: the lows below Bass X ring longer', [{ drag: '[aria-label^="Bass Mult"]', by: [36, 0] }]],
				['Quartz', 'Diffusion down: the tail breaks into its echoes', [{ drag: '[aria-label^="Diffusion"]', by: [-170, 0] }]],
				['Shimmer', 'Pitch +12: the energy climbs an octave a pass', []],
				['Tides', 'Rate 1/4: the bands ripple out of step', [{ drag: '[aria-label^="Rate"]', by: [-40, 0] }]],
				['Prism', 'Low Mult up, High Mult down: the lows outlast the highs', [
					{ drag: '[aria-label^="Low Mult"]', by: [60, 0] },
					{ drag: '[aria-label^="High Mult"]', by: [-50, 0] }
				]]
			].map(([algo, what, drags]) => ({
				name: `fx-reverb-${algo.toLowerCase()}`,
				description: `Reverb, ${algo}. ${what}`,
				steps: [selectTrack(5), openTile('Reverb'), { click: `[data-reverb-type="${algo}"]` }, ...drags]
			})),
			// The EQ tab (2026-10-02): the rig's own EQ — Lo Cut at 121 Hz, 18 dB,
			// Hi Shelf at 5 kHz — then shaped by dragging the handles, as a finger
			// would, and the Hi end switched to a cut.
			{
				name: 'fx-reverb-eq',
				description: 'Reverb, EQ tab: the rig’s EQ — Lo Cut 121 Hz 18 dB, the peaks flat, Hi Shelf 5 kHz',
				steps: [selectTrack(5), openTile('Reverb'), { click: '[data-reverb-type="Hall"]' }, { click: '[data-reverb-tab="eq"]' }]
			},
			{
				name: 'fx-reverb-eq-shaped',
				description: 'Reverb, EQ tab: Peak 1 dragged up, Peak 2 down and higher, the Hi end switched to Cut',
				steps: [
					selectTrack(5),
					openTile('Reverb'),
					{ click: '[data-reverb-type="Hall"]' },
					{ click: '[data-reverb-tab="eq"]' },
					{ drag: '[data-eq-band="peak1"]', by: [-20, -45] },
					{ drag: '[data-eq-band="peak2"]', by: [40, 35] },
					{ click: '[data-reverb-own] [data-reverb-switch="43"]' }
				]
			},
			// Convolution: the IR the button loads, drawn from Live's own file
			// (`/api/reverb-ir` reads this Mac's Live app; a Mac without one shows
			// "No picture for this IR"), then shaped by a drag on its pad.
			{
				name: 'fx-reverb-ir-spring',
				description: 'Reverb, Spring: Live’s “Awesome Stereo Spring” IR, unshaped',
				steps: [selectTrack(5), openTile('Reverb'), { click: '[data-reverb-type="Spring"]' }]
			},
			{
				name: 'fx-reverb-ir-plate',
				description: 'Reverb, Plate: Live’s “Classic Plate 1” IR',
				steps: [selectTrack(5), openTile('Reverb'), { click: '[data-reverb-type="Plate"]' }]
			},
			{
				name: 'fx-reverb-ir-shaped',
				description: 'Reverb, Spring, the pad dragged right and down: Attack fades it in, Decay cuts the tail',
				steps: [
					selectTrack(5),
					openTile('Reverb'),
					{ click: '[data-reverb-type="Spring"]' },
					{ drag: '[data-reverb-ir] .xy-container', by: [60, 190] }
				]
			},
			{
				name: 'fx-reverb-ir-short',
				description: 'Reverb, Short (an early-reflections IR) shaped by a drag: the pad fitted to a short IR',
				steps: [
					selectTrack(5),
					openTile('Reverb'),
					{ click: '[data-reverb-type="Short"]' },
					{ drag: '[data-reverb-ir] .xy-container', by: [80, 120] }
				]
			},
			{
				name: 'fx-reverb-ir-size',
				description: 'Reverb, Spring with Size dragged up: the IR stretched over a longer axis',
				steps: [
					selectTrack(5),
					openTile('Reverb'),
					{ click: '[data-reverb-type="Spring"]' },
					{ drag: '[data-reverb-own] [role="slider"][aria-label^="Size"]', by: [60, 0] }
				]
			},
			{
				name: 'fx-reverb-ir-eq',
				description: 'Reverb, Spring on its EQ tab: the same editor and EQ rows as an algorithm’s',
				steps: [selectTrack(5), openTile('Reverb'), { click: '[data-reverb-type="Spring"]' }, { click: '[data-reverb-tab="eq"]' }]
			},
			{
				name: 'fx-reverb-frozen',
				description: 'Reverb, Hall with Freeze on: every band holds to the edge',
				steps: [selectTrack(5), openTile('Reverb'), { click: '[data-reverb-type="Hall"]' }, { click: '[data-reverb-switch="8"]' }]
			},
			{ name: 'drumrack-drumcell', description: 'Drum Rack, DrumCell kit (Drums)', steps: [openInstrument(0)] },
			// The held pads' mixer strip (2026-09-29): Kick latched, its chain
			// mute and volume in a thin column right of the pads.
			{
				name: 'drumrack-pad-mixer',
				description: 'Drum Rack, Kick latched — the pad’s chain mute and volume beside the pads',
				steps: [openInstrument(0), { click: '.pad-tile[data-note="36"]' }]
			},
			// The swap pill's OTHER branch (ADR-439). On a held Drum Sampler pad
			// the pill is gated on the bridge's `/bridge/ax_helper`, and the mock
			// hardcoded `ready`, so the state a rig without `npm run
			// install-ax-helper` is actually in — the pill disabled, the helper's
			// code in place of the pad's name — could not be photographed at all.
			// The tap latches Kick (a DrumCell pad): since 2026-09-27 a kit with
			// nothing scoped steps its preset folder and never asks the helper.
			{
				name: 'drumrack-helper-down',
				description: 'Drum Rack, Kick latched, AX helper down — the pad’s swap pill disabled, naming why',
				steps: [openInstrument(0), { click: '.pad-tile[data-note="36"]' }],
				axHelper: {
					state: 'ax-helper-down',
					detail: 'helper not running (no socket; npm run install-ax-helper)'
				}
			},
			// The one step in this repo that PRESSES the swap pill, and it is a
			// CSS gate rather than a picture. `SwapControl`'s `.swap-name` is
			// `grid-column: 1 / -1`, so it covers the whole pill including both
			// arrows, and only `pointer-events: none` on it lets a press reach
			// the half below. Nothing covered that: the component's own tests
			// press with the keyboard, `check:touch` does not reach `central/`,
			// and `multitouch.mjs` has no swap scenario — delete that one
			// declaration and every assertion still passed, while on the iPad
			// the whole control went dead but for two ~12 px strips.
			// `screenshot-page.mjs`'s `page.click()` does Playwright's real
			// hit-target check, so an intercepted press fails the run rather
			// than quietly photographing an unpressed pill. Kick is latched first
			// because the Drums track records no preset, so its KIT pill is
			// disabled; a latched Drum Sampler pad's pill is live.
			{
				name: 'drumrack-swap-pressed',
				description: 'The swap pill pressed — the hit test SwapControl’s pointer-events split depends on',
				steps: [openInstrument(0), { click: '.pad-tile[data-note="36"]' }, { click: '[data-swap="next"]' }]
			},
			{ name: 'drumrack-simpler-kit', description: 'Drum Rack, Simpler kit (Jazz)', steps: [openInstrument(8)] },
			{
				name: 'drumrack-pad-held',
				description: 'Jazz kit with pad 38 held — the controls take the pad',
				steps: [openInstrument(8), { hold: '.pad-tile[data-note="38"]' }]
			},
			{ name: 'drumrack-rack-macros', description: 'Drum Rack, nested-rack kit (Ethnic)', steps: [openInstrument(9)] },
			{ name: 'drumrack-sampler-kit', description: 'Drum Rack, Sampler kit (Autumn)', steps: [openInstrument(10)] },
			{ name: 'inst-wavetable', description: 'Wavetable (Bass)', steps: [openInstrument(1)] },
			{ name: 'inst-drift', description: 'Drift (Keys)', steps: [openInstrument(2)] },
			// No single-Simpler state: the scene's only Simpler is on Texture, an
			// AUDIO track, and audio tracks draw no instrument tile to open it from.
			{ name: 'inst-operator', description: 'Operator (FM)', steps: [openInstrument(11)] },
			...instrumentSwapStates()
		]
	},
	// The full-page Settings (plan.md §11): the setup that left the System
	// view on 2026-09-26, behind the gear in Transport's corner — General,
	// Places and Connection down a sidebar (tabs under 760px). Cropped to the
	// page itself, which covers the app; the layout check still measures the
	// System view underneath, which is what the gear left. The gear is clicked
	// through the DOM, because at phone width the app's layout draws it off
	// screen. A state's `firstRun: true` has the fixture listing say the Mac
	// has saved nothing, which opens Settings by itself as the checklist. The
	// listing is the rig's own (fixtures/places-list.json): 21 Places, 7
	// ticked, the User Library and 81 Packs.
	settings: {
		description: 'The full-page Settings, opened from the gear in the System view.',
		crop: '[data-debug="settings-page"]',
		states: [
			{
				name: 'settings',
				description: 'Settings → General — Behavior, Appearance, Foot Switch',
				steps: SETTINGS_OPEN
			},
			{
				name: 'settings-general',
				description: 'Settings → General, Max Utility patch switched off — no Move Knob switch',
				features: { maxUtilityPatch: { enabled: false, available: false, reason: '' } },
				steps: SETTINGS_OPEN
			},
			{
				name: 'settings-places',
				description: 'Settings → Places — the ticked ones first, the Packs folded',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="places"]' }]
			},
			{
				name: 'settings-places-packs',
				description: 'Settings → Places, the Packs unfolded and scrolled to',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="places"]' }, { click: '[data-group="packs"] .set-group-toggle' }, { wait: 700 }]
			},
			{
				name: 'settings-places-filter',
				description: 'Settings → Places, filtered to "drum"',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="places"]' }, { fill: '.set-filter input', text: 'drum' }]
			},
			{
				name: 'settings-grooves',
				description: 'Settings → Grooves — Live’s groove files, the Groove view’s first',
				steps: [...SETTINGS_OPEN, { click: '[data-tab="grooves"]' }]
			},
			{
				name: 'settings-connection',
				description: 'Settings → Connection — Live, the iPad address, the features (TotalMix unavailable)',
				features: { totalmix: { enabled: true, available: false, reason: 'TotalMix has not answered on port 7001' } },
				steps: [...SETTINGS_OPEN, { click: '[data-tab="connection"]' }]
			},
			{
				// A first run: the Mac has saved nothing, so Settings opens by itself
				// as the checklist (onboarding.plan.md §7). No steps: the page is
				// already up, over the master strip.
				name: 'settings-first-run',
				description: 'Settings on a first run — the Setup checklist, nothing ticked yet',
				firstRun: true
			},
			{
				name: 'settings-foot-learn',
				description: 'Settings → General, the foot switch learning — "Press your pedal…"',
				steps: [...SETTINGS_OPEN, { click: '[data-debug="foot-switch-learn"]' }]
			}
		]
	}
};

/*
 * Instruments the default scene has no track for, each swapped onto the FM
 * track in Operator's place (`swap`, applied by scene.mjs's `swapDevice`)
 * so the tour reaches — and the layout check measures — every instrument
 * view. A swap without `params` keeps Operator's, so a view that binds by
 * name draws ghosted: those states are for layout, not values. The racks
 * get macro names, because their layout is built from them; the pattern
 * rack needs "Pattern N" as its first macro to be one.
 */
function instrumentSwapStates() {
	const macros = (names) => [
		['Device On', 'Device On', 0, 1, 1, ''],
		...names.map((n, i) => [n, n, 0, 127, 20 + i * 12, ''])
	];
	const swaps = [
		['collision', 'Collision', 'Collision'],
		['electric', 'Electric', 'LoungeLizard'],
		['meld', 'Meld', 'InstrumentMeld'],
		['omnisphere', 'Omnisphere', 'AuPluginDevice'],
		// Filter up: the switch and sliders take the track's ink, not Amp's orange.
		['omnisphere-filter', 'Omnisphere', 'AuPluginDevice', undefined,
			[{ click: '.omni-env-switch .device-segment:last-child' }]],
		// The Sampler as the rig lists it (read off a running Sampler,
		// 2026-09-27): what the view binds by name, at the ranges and values
		// Live reported — Osc and the pitch envelope off, so only their
		// switches are listed. Live, not ghosted, so its shot shows values.
		['sampler', 'Sampler', 'MultiSampler', [
			['Device On', 0, 1, 1], ['Osc On', 0, 1, 0], ['Spread', 0, 100, 0], ['Transpose', -48, 48, 0],
			['Pe On', 0, 1, 0], ['Volume', -36, 36, -12], ['Ve Attack', 0, 1, 0], ['Ve Decay', 0, 1, 0.581],
			['Ve Sustain', 0, 1, 1], ['Ve Release', 0, 1, 0.356], ['F On', 0, 1, 1], ['Filter Freq', 0, 1, 1],
			['Filter Res', 0, 1.25, 0.091]
		].map(([n, min, max, v]) => [n, n, min, max, v, ''])],
		['simpler', 'Simpler', 'OriginalSimpler'],
		['instrument-rack', 'Instrument Rack', 'InstrumentGroupDevice',
			macros(['Cutoff', 'Resonance', 'Attack', 'Release', 'Drive', 'Space', 'Macro 7', 'Macro 8'])],
		// Two macros whose first word is XY play as one pad, placed where
		// the first was — Attack between them stays a slider after it.
		['instrument-rack-xy', 'Instrument Rack', 'InstrumentGroupDevice',
			macros(['XY Cutoff', 'Attack', 'XY Res', 'Release', 'Drive', 'Space', 'Macro 7', 'Macro 8'])],
		// The picker is a fixed 2 x 3 whatever the rack names, so these two
		// differ only in what the sliders beside it do. Both say "Pattern 4":
		// the real rack (Skaka Metronome Rack) has four patterns, and the
		// picker's tab has five states counting auto.
		['pattern-rack', 'Pattern Rack', 'InstrumentGroupDevice',
			macros(['Pattern 4', 'Offset', 'Cutoff', 'Resonance', 'Attack', 'Release', 'Drive', 'Space'])],
		// The real rack's shape: macros 3-16 unnamed, so no sliders and the
		// picker takes the whole view. Offbeat is tapped on so the tour
		// shows it lit.
		['pattern-rack-only', 'Pattern Rack', 'InstrumentGroupDevice',
			macros(['Pattern 4', 'Offset', 'Macro 3', 'Macro 4', 'Macro 5', 'Macro 6', 'Macro 7', 'Macro 8']),
			[{ click: '.offbeat-button' }]]
	];
	return swaps.map(([key, name, className, params, extraSteps = []]) => ({
		name: `inst-${key}`,
		description: `${name}, swapped onto the FM track`,
		swap: { path: 'tracks/11/devices/0', name, className, params },
		steps: [openInstrument(11), ...extraSteps]
	}));
}

export function listTours() {
	return Object.keys(TOURS).map((name) => resolveTour(name));
}

export function resolveTour(name) {
	const tour = TOURS[name];
	if (!tour) {
		const known = Object.keys(TOURS).join(', ');
		throw new Error(`Unknown tour "${name}". Known tours: ${known}`);
	}
	const seen = new Set();
	const states = tour.states.map((state) => {
		if (seen.has(state.name)) throw new Error(`Tour "${name}" names state "${state.name}" twice`);
		seen.add(state.name);
		const view = resolveView(state.view ?? 'default');
		return {
			...state,
			path: view.path,
			prefs: { ...view.prefs, ...(state.prefs ?? {}) },
			...(view.features || state.features
				? { features: { ...(view.features ?? {}), ...(state.features ?? {}) } }
				: {}),
			steps: state.steps ?? [],
			crop: state.crop ?? tour.crop ?? null
		};
	});
	return { name, description: tour.description, states };
}
