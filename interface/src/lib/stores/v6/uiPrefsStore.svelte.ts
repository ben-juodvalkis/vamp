/**
 * UI preferences store (Svelte 5 runes) — small, persistent display
 * toggles that shape the performance surface but carry no Live state.
 * Everything here survives reloads via localStorage, same guarded
 * read/write pattern as browserModeStore.
 *
 * There is no Solo-button switch (2026-10-01): two fingers on a strip's
 * fader solo it, so the button and its `showSoloButtons` pref are gone.
 * An old install's stored key is simply never read again.
 *
 * **Fixed, not preferences (Ben, 2026-09-26): `showCentralView`,
 * `flipLayout`, `showDrumPads` and `showDeviceBand`.** Each was a switch
 * in the Sections card (VIEW, FLIP, PADS, INST), all four default on, and
 * nobody wants the layouts their OFF bought. The switches, the setters
 * and the storage keys are gone; the getters stay and read `true`, so the
 * layout code that branches on them is unchanged. The other branch of
 * each is unreachable now, and marked where it lives: grep for
 * `UNREACHABLE since 2026-09-26`. Ben's call: keep the branches and these
 * getters for now rather than delete them. An old install's stored `'0'`
 * is ignored.
 *
 * The main area's section toggles (ADR-416) — `sessionMode` and
 * `showFxGrid` — are independent booleans, one per optional section. The
 * track strips and the central view are always on; each toggle adds or
 * removes a whole section, and the visible sections split the height
 * evenly. Nothing swaps places: a section is either in the stack or it
 * isn't.
 *
 * `sessionMode` — the clip grid section (the strips' second row, ADR-415).
 * Off by default, so a fresh install lands on the familiar three
 * sections: strips, central view, FX grid.
 *
 * `showFxGrid` — default ON for that same reason. It reads inverted from
 * storage (`'0'` means off) because the default is on, unlike the other
 * prefs here.
 *
 * `showCentralView` — the central view section. Always on.
 *
 * `flipLayout` — mirrors the main-area stack top-to-bottom (ADR-421).
 * Always on. The section order is FX grid · central view · clip
 * grid · track strips, so the strips — the row your hands actually live
 * on — sit against the bottom edge of the iPad where the hands are,
 * instead of at the top under the reach. It is a pure ORDER flip, done
 * with `flex-direction: column-reverse` at four containers: none of
 * ADR-415/416's flex shares, gaps or measured pitches change, so every
 * alignment they buy holds without re-deriving anything.
 *
 * The flip is not applied to CONTENT order — scene rows still read
 * downward, and the clip grid's stop row stays at the foot of its
 * section (which under the flip puts it directly above the strips it
 * stops). Only chrome that has a "top" and a "bottom" moves: each track
 * strip's title band goes to the foot of its card, and a group's bracket arm grows
 * out of the BOTTOM of its strip so arm and title still read as one
 * block.
 *
 * `showTransportHeader` — the slim transport strip across the top.
 * Independent of the section toggles on purpose: a performer may want the
 * tempo and metronome readout without the clip grid, or vice versa.
 *
 * `showDeviceBand` — the third section of every track strip's card: the
 * head of that track's device chain (the instrument on a MIDI track, the
 * first device on an audio one), its headline parameter, and a rail of
 * the whole chain. Tapping it selects the track and opens that device's
 * central view, the way Clip and Permute open theirs. Always on.
 *
 * `showDrumPads` — the pad column beside the Drum Rack view's controls
 * (2026-09-08). Always on: hold-to-scope is the grid's only door, so
 * without it there was no per-pad editing at all (the FX grid's Pitch
 * slider included, since it obeys the same hold).
 */

const SESSION_MODE_STORAGE_KEY = 'uiPrefsStore.sessionMode';
const SHOW_FX_GRID_STORAGE_KEY = 'uiPrefsStore.showFxGrid';
const SHOW_TRANSPORT_HEADER_STORAGE_KEY = 'uiPrefsStore.showTransportHeader';

function readStringFromStorage(key: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStringToStorage(key: string, value: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, value);
	} catch {
		/* ignore quota / disabled storage */
	}
}

function readBoolFromStorage(key: string): boolean {
	return readStringFromStorage(key) === '1';
}

/**
 * For prefs that default ON: only an explicit `'0'` turns them off, so an
 * absent or corrupt value lands on the familiar layout rather than a
 * surprising one.
 */
function readBoolFromStorageDefaultOn(key: string): boolean {
	return readStringFromStorage(key) !== '0';
}

function createUiPrefsStore() {
	let sessionMode = $state(readBoolFromStorage(SESSION_MODE_STORAGE_KEY));
	let showFxGrid = $state(readBoolFromStorageDefaultOn(SHOW_FX_GRID_STORAGE_KEY));
	let showTransportHeader = $state(readBoolFromStorage(SHOW_TRANSPORT_HEADER_STORAGE_KEY));

	return {
		get sessionMode(): boolean {
			return sessionMode;
		},
		set sessionMode(value: boolean) {
			sessionMode = value;
			writeStringToStorage(SESSION_MODE_STORAGE_KEY, value ? '1' : '0');
		},
		toggleSessionMode() {
			this.sessionMode = !sessionMode;
		},

		/** The central view section. Fixed on (see the header). */
		get showCentralView(): boolean {
			return true;
		},

		get showFxGrid(): boolean {
			return showFxGrid;
		},
		set showFxGrid(value: boolean) {
			showFxGrid = value;
			writeStringToStorage(SHOW_FX_GRID_STORAGE_KEY, value ? '1' : '0');
		},
		toggleFxGrid() {
			this.showFxGrid = !showFxGrid;
		},

		/**
		 * Should the clip central view draw its mini session column?
		 *
		 * The mini is the SELECTED track's clip slots — the same cells
		 * the full grid draws — in the leading column of that view's
		 * control rail. It is **not a preference**: it is simply where
		 * the clips live when the full grid is not up. It had a switch
		 * of its own once, which only ever bought the performer a
		 * layout with no clips visible at all, so it is now purely the
		 * complement of `sessionMode`.
		 *
		 * With CLIPS on the mini would repeat a column already drawn
		 * under its own strip, and both would be driving the one shared
		 * scene window — hence the negation rather than "always".
		 *
		 * Kept as a named getter rather than inlining `!sessionMode` at
		 * the call sites: it is a different QUESTION from "is the clip
		 * grid up", the sceneWindowStore ownership rule below depends on
		 * it being exactly one place, and it stays testable without a
		 * layout.
		 *
		 * Deliberately says nothing about which central view is
		 * selected. That decides whether the HOST is on screen, and the
		 * host already answers it by rendering or not — folding it in
		 * here would make the getter claim to mean "is it visible",
		 * which it cannot know (the view showing can be Reverb).
		 *
		 * Note the sceneWindowStore consequence: `SceneRail` owns the
		 * window's clamp effect and is mounted only in session mode, so
		 * whichever scene viewport is up has to own it. `MiniSessionGrid`
		 * runs the same effects, and `!sessionMode` is what guarantees
		 * the two are never mounted together.
		 */
		get miniSessionActive(): boolean {
			return !sessionMode;
		},

		/**
		 * How many sections the main-area stack is currently showing
		 * (ADR-416). The track strips and the central view are always on;
		 * CLIPS and FX each add one more. Range 2..4.
		 *
		 * This is the layout's own arithmetic, so it lives with the flags
		 * that drive it rather than being re-counted by every consumer.
		 * `sceneWindowStore` reads it to size the scene window: the
		 * sections split the height evenly, so the count IS how tall the
		 * clip grid's section is, and the grid can show more scenes when
		 * fewer sections share the screen.
		 *
		 * Deliberately ignores `showTransportHeader` — that is a fixed
		 * ~72px off the top, a few percent of the height, not a section.
		 */
		get visibleSectionCount(): number {
			return (
				1 +
				(sessionMode ? 1 : 0) +
				1 +
				(showFxGrid ? 1 : 0)
			);
		},

		get showTransportHeader(): boolean {
			return showTransportHeader;
		},
		set showTransportHeader(value: boolean) {
			showTransportHeader = value;
			writeStringToStorage(SHOW_TRANSPORT_HEADER_STORAGE_KEY, value ? '1' : '0');
		},
		toggleTransportHeader() {
			this.showTransportHeader = !showTransportHeader;
		},

		/** The stack flipped: strips along the bottom edge (ADR-421). Fixed on. */
		get flipLayout(): boolean {
			return true;
		},

		/** The Drum Rack view's pad column. Fixed on. */
		get showDrumPads(): boolean {
			return true;
		},

		/** The track strip's device band (INST). Fixed on. */
		get showDeviceBand(): boolean {
			return true;
		}
	};
}

export const uiPrefsStore = createUiPrefsStore();
