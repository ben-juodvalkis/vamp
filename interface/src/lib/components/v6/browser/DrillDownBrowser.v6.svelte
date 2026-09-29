<!--
  DrillDownBrowser — full-screen, one-layer-per-tap instrument/preset browser.

  Replaces the Miller-column GestureBrowser interaction with a drill-down flow:
  category grid → folder rows → preset grid, one screen at a time, with a
  persistent breadcrumb for orientation and fast-travel back up.

  Reuses the existing browser plumbing wholesale — only the *interaction* is new:
    - open/close + lock via `browserModeStore` (isPersistent / isLocked)
    - `currentPath` + `loadedPresetPath` via `browserNavigationStore`
    - the adapters' `getFolders` / `getPresets` / `getRandomPreset`
    - `loadPresetWithVariant` + `TrackPrepManager` for the load path
    - `createRevealController` for reveal-then-close after a load

  Interaction decisions (locked with the user):
    - One layer per screen — folders, or a leaf's presets; a level holding both
      shows its folders first and its own presets after them — `screenKind`.
    - Cross-column drag is dropped; hold-a-folder → random preset is kept
      (now 500ms under the house rising fill — see HOLD_TO_RANDOM_MS), and a
      grouped screen's section headers take the same hold for a random preset
      from their own section (`sectionPress`).
    - Key/scale mode delegates to the existing scale send helpers inline.
-->
<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { Lock, LockOpen, X } from 'lucide-svelte';

	import { send } from '$lib/api/simpleClient';
	import {
		V3_SESSION_SCALE_ROOT_ADDRESS,
		V3_SESSION_SCALE_NAME_ADDRESS,
		V3_SESSION_SCALE_MODE_ADDRESS,
		V3_SESSION_SCALE_DETECT_ADDRESS,
		V3_SESSION_KEY_FOLLOW_ADDRESS
	} from '$lib/api/handlers/v3Session';
	import {
		getPlacesIndex,
		isPlaceVendorId,
		placeVendorId,
		type PlaceInfo,
		type PlacesAdapter,
		type Preset
	} from '$lib/services/adapters';
	import { presetSiblings } from '$lib/services/presetSwapCatalog';
	import {
		canLoad,
		groupCounts,
		groupOfKind,
		isSampleLike,
		loadsAsInstrument,
		type KindGroup
	} from '$lib/utils/placeKinds';
	import { browserModeStore, type BrowseMode } from '$lib/stores/v6/browserModeStore.svelte';
	import {
		browserNavigationStore,
		rememberedPathKey
	} from '$lib/stores/v6/browserNavigationStore.svelte';
	import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
	import { recentInstrumentsStore } from '$lib/stores/v6/recentInstrumentsStore.svelte';
	import { session, clearScaleDetected } from '$lib/stores/session.svelte';
	import { ROOT_NOTES, SCALE_NAMES, getScaleIndex } from '$lib/data/scales';
	import { logger } from '$lib/utils/logger';
	import { PLACES_CHANGED_EVENT, warmPlacesCache } from '$lib/services/placesLive';
	import { trackInk } from '$lib/utils/formatters/trackFormatters';
	import { paintModeReactive } from '$lib/utils/paintMode.svelte';
	import { press, type PressOptions, type PressReleaseInfo } from '$lib/actions';
	import RecordButton from '$lib/components/v6/controls/RecordButton.svelte';

	import { TrackPrepManager, loadPresetWithVariant, replaceAudioClip } from './utils/presetLoader';
	import { findVendorById, findVendorByVendorId, type BrowserVendor } from './utils/vendorModel';
	import { v3ErrorBannerStore } from '$lib/stores/v6/v3ErrorBannerStore.svelte';
	import { presetLandingStore } from '$lib/stores/v6/presetLandingStore.svelte';
	import {
		screenKind,
		buildCrumbs,
		pathForCrumb,
		computeGridLayout,
		computeGroupedGridLayout,
		computeVisibleWindow,
		computeGroupedVisibleWindow,
		groupPresetsByOrigin,
		packGroupedSections,
		replaceLanding,
		railBands,
		keepRecent,
		windowsEqual,
		groupedWindowsEqual,
		type VirtualWindow,
		type GroupedVirtualWindow
	} from './utils/drillDownModel';
	import BrowserPresetWaveform from './BrowserPresetWaveform.svelte';
	import { isAudioThumbnailType } from '$lib/utils/waveformThumbnail';

	import constants from '$config/constants.json';

	const SPECIAL_COLORS = constants.vendors.special as Record<string, { color: string }>;
	const TYPE_COLORS = constants.vendors.types as Record<string, { color: string }>;
	const DEFAULT_TYPE_COLOR = '#c0c0c0';

	// ADR-401: gate audio-sample waveform tiles. Per-tile the render is further
	// gated on an audio file extension, so instrument tiles never draw.
	const audioWaveformsEnabled =
		(constants.ui?.browser as { audioWaveforms?: boolean })?.audioWaveforms !== false;

	// Long-press to random-pick a folder. At 200ms this was a tap/press
	// discriminator wearing a charge ring, because 200ms of progress bar is a
	// flicker. At 500ms it is long enough to READ as a gate, so it takes the
	// same rising `.hold-fill` ClipCentralView's Delete / Replace Inst / Dup Trk
	// holds wear — one hold idiom across the app instead of two.
	const HOLD_TO_RANDOM_MS = 500;

	// How long the picked folder tile wears the preset's name — AND, on the
	// random path only, how long the browser stays up before closing.
	//
	// That is not a walk-back of the optimistic close. Two different waits:
	// waiting on LIVE is dead weight (the answer is already committed, and the
	// track strip reports it), but waiting on the USER is not — a random pick is
	// the one gesture whose result you cannot know in advance, and the tile under
	// your finger is where you're already looking. Tapping a preset tile still
	// closes instantly: you picked it, you know what it was.
	//
	// One constant for both so the tile's reveal and the close can't drift apart.
	const PRESET_REVEAL_MS = 750;
	// ADR-446: how long "Listening…" waits for the surface's answer to Detect
	// before giving up — a silent surface must not leave the button lying.
	const DETECT_TIMEOUT_MS = 3000;

	// ── The rail's model ──
	// Recent, then one button per Place (below). Audio is NOT a category — it is
	// the switch's axis: MIDI browses a Place's presets, Simpler and Audio its
	// samples and clips.

	const recentVendor: BrowserVendor = {
		id: 'recent',
		name: 'Recent',
		color: SPECIAL_COLORS.recent?.color || '#9d4edd',
		vendorId: 'recent-instruments',
		trackType: 'midi'
	};
	// Scale/Key mode is NOT a category tile — it's a separate picker triggered
	// externally via `browserModeStore.isScalePersistent` (from SystemCentralView),
	// mirroring the old browser. The Key Place (keyboards/pianos) is an ordinary
	// rail button.
	// ── The Places (browser-places plan) ──
	// The rail is Recent + one button per Place in Live's sidebar (under
	// `paths.sidebarRoot`, in Live's order, from `places/index.json`) — the only
	// browser since the cutover (2026-09-24), when the type catalogs and their
	// rail were removed. The header is the Instrument/Simpler/Clip switch — what
	// you'll do with a pick: play it (an instrument, or a sample on a Simpler) or
	// let it play (a clip in a Session slot). Instrument shows a Place's presets,
	// Simpler its samples and audio clips, Clip those plus its MIDI clips.
	let placeVendors = $state<BrowserVendor[]>([]);
	/** Each Place's index entry, keyed by its rail id (`place:drum`). */
	let placeInfo = $state<Record<string, PlaceInfo>>({});
	/**
	 * The kinds a Place shows under the switch: its presets (Instrument), its
	 * audio (Simpler), or its audio and MIDI clips (Clip). A MIDI clip has no
	 * audio for a Simpler, so only Clip lists it.
	 */
	const PRESET_GROUPS: KindGroup[] = ['instruments', 'kits', 'effects'];
	const AUDIO_GROUPS: KindGroup[] = ['samples', 'clips'];
	const CLIP_GROUPS: KindGroup[] = [...AUDIO_GROUPS, 'midi-clips'];
	const groupsForMode = (mode: BrowseMode): KindGroup[] =>
		mode === 'midi' ? PRESET_GROUPS : mode === 'simpler' ? AUDIO_GROUPS : CLIP_GROUPS;
	const placeKindGroups = $derived(groupsForMode(browserModeStore.browseMode));
	/**
	 * Set when a Place opens, or its switch flips, among samples: the Place's
	 * root then holds only its Samples folder, which the level loader opens
	 * directly — the old Simpler/Audio landed among the samples in one tap.
	 */
	let openLoneFolder = false;
	/**
	 * Whether the pane on screen was loaded among a Place's samples (the
	 * switch's Simpler or Audio half). Set when a level commits, so a replace
	 * that flips the switch can still tell what the performer was looking at.
	 */
	let paneAmongSamples = $state(false);

	const vendors = $derived.by(() => {
		const list = [...placeVendors];
		if (recentInstrumentsStore.hasItems) list.push(recentVendor);
		return list;
	});

	// ── Source axis (the switch's MIDI half vs its Simpler/Audio half) ──
	// Persisted in browserModeStore.
	const isAudioSource = $derived(browserModeStore.isAudioSource);
	// Replace-audio-clip mode: opened from ClipCentralView to swap the sample in
	// an existing audio clip's slot. The next audio pick replaces that slot
	// (clip-into-slot) instead of creating a new track/clip.
	const isReplacingAudioClip = $derived(browserModeStore.isReplacingAudioClip());
	// Replace-instrument mode: opened from ClipCentralView to swap a MIDI track's
	// instrument in place (pinned via replaceInstrumentTargetPath). MIDI-only — the
	// top bar shows a "Replace inst" pill instead of the browse switch so the mode
	// can't be flipped to a sample source (which would ignore the pin + spawn a track).
	const isReplacingInstrument = $derived(browserModeStore.isReplacingInstrument);
	// A Place browses a catalog (drill-in prep, the header's switch); Recent is a
	// list and carries neither.
	const isPlaceVendor = (v: BrowserVendor) => placeVendors.some((p) => p.id === v.id);

	// ── UI state ──
	let isExpanded = $state(false);
	const trackPrepManager = new TrackPrepManager();

	// Current-screen data (loaded from the adapter for `currentPath`).
	let folders = $state<string[]>([]);
	let folderColors = $state<Record<string, string>>({});
	let presets = $state<Preset[]>([]);
	let loading = $state(false);
	let navToken = 0; // guards against out-of-order async loads
	// The rail button whose level is on screen. A load for another button clears
	// the pane first, so reopening the browser on Inst never flashes the Drum
	// level left from the last open while Inst's catalog is fetched.
	let shownButtonId: string | null = null;
	// How many Places' catalogs stay in memory (`keepRecent`), most recent first.
	const PLACES_KEPT_IN_MEMORY = 3;
	let keptVendors: string[] = [];
	// Set by `selectCategory` when it restores a remembered location; consumed by
	// the next `loadCurrentLevel` to verify that location still exists.
	let pendingRestoreKey: string | null = null;

	// ── Derived from stores ──
	const selectedCategory = $derived(browserNavigationStore.selectedCategory);
	// `selectedVendorId` is the rail *button* (e.g. 'place:drum') — drives the
	// rail highlight + breadcrumb name. `selectedVendor` is the vendorId the
	// adapter/state key on; for every button today the two are the same id.
	const selectedVendorId = $derived(browserNavigationStore.selectedVendorId);
	const selectedVendor = $derived(browserNavigationStore.currentVendorId);
	const vendorState = $derived(browserNavigationStore.getCurrentVendorState(selectedVendor));
	const currentPath = $derived(vendorState?.currentPath ?? []);
	const activeColor = $derived(
		trackInk(findVendorById(vendors, selectedVendorId)?.color ?? '#888888', paintModeReactive())
	);
	const isScale = $derived(selectedCategory === 'scale');

	// ── Top-bar browse switch (Instrument | Simpler | Clip; ids midi | simpler | audio) ──
	// MIDI = a Place's presets (MIDI track), Simpler = a sample onto an Empty
	// Simpler (MIDI track), Audio = a sample as a clip (audio track). Only the
	// Places carry the switch — Recent and Scale don't.
	const browseMode = $derived(browserModeStore.browseMode);
	const currentIsPlace = $derived(isPlaceVendorId(selectedVendorId));
	const showSourceSwitch = $derived(isExpanded && !isScale && currentIsPlace);
	// A Place's index counts say which segments of the switch it can fill,
	// before any catalog is read: a Place with no samples greys Simpler (and
	// Clip, unless it has MIDI clips), and one with no presets greys Instrument.
	const placeHas = (vendorId: string | null, groups: KindGroup[]) => {
		const counts = groupCounts(vendorId ? placeInfo[vendorId]?.kinds : undefined);
		return groups.some((g) => (counts[g] ?? 0) > 0);
	};
	const simplerUnavailableForCurrent = $derived(!placeHas(selectedVendorId, AUDIO_GROUPS));
	const clipUnavailableForCurrent = $derived(!placeHas(selectedVendorId, CLIP_GROUPS));
	const midiUnavailableForCurrent = $derived(!placeHas(selectedVendorId, PRESET_GROUPS));

	const screen = $derived(screenKind(!!selectedVendorId, folders, presets.length));
	const crumbs = $derived(
		buildCrumbs(findVendorById(vendors, selectedVendorId)?.name ?? null, currentPath)
	);

	// ── Adaptive tile grid (shared by folders + presets) ──
	// Measure the stage, then compute the column count / tile height that gives
	// the most comfortable, roughly-square tap targets for the current item
	// count (see computeGridLayout). One system for both grids.
	let stageWidth = $state(0);
	let stageHeight = $state(0);
	// Tile gap and stage padding, on the app's interior ladder: 16 frames a
	// panel, 8 separates tiles inside one, 4 separates rows inside a tile.
	// BOTH are published as custom properties on the component root
	// (--grid-gap / --grid-pad) and read back by the CSS, so the solver and
	// the stylesheet cannot drift — the packed-band row below is only correct
	// while its gap is EXACTLY the tile gap.
	const GRID_GAP = 8;
	const GRID_PADDING = 16;
	// Grouped preset sections (recovered origin folders): header band height and
	// the extra air between sections. Mirrored into CSS via --header-h /
	// --section-gap so the solver and the stylesheet can't drift apart.
	const SECTION_HEADER_H = 44;
	const SECTION_GAP = 16;
	// The hold key of a mixed level's preset header — a path separator no
	// folder name can contain, so it never lights a folder tile's charge.
	const HERE_KEY = '/here';

	// Re-cluster a depth-cap-flattened preset list into its original subfolders
	// (from each preset's surviving physical `path`). Only meaningful with 2+
	// sections — a normal (unflattened) leaf comes back as one loose bucket and
	// renders as the plain grid, unchanged.
	const presetGroups = $derived(
		screen === 'presets' ? groupPresetsByOrigin(presets, currentPath) : []
	);
	const useGroupedPresets = $derived(presetGroups.length > 1);

	// Coalesce small sections onto shared rows so a 1–2 tile section doesn't strand
	// a whole line (ADR-403 revised). Packing uses the solver's chosen column count
	// (below) and never changes tile geometry — a packed band is exactly one tile
	// row tall, so it maps 1:1 onto a windowing section and ADR-404 keeps working.
	const presetBands = $derived.by(() =>
		useGroupedPresets ? packGroupedSections(presetGroups, gridLayout.columns) : []
	);

	// Comfort constraints for the grid solvers: tiles grow to FILL the stage and
	// only scroll once filling would shrink them below the floors. Wider-than-tall
	// reads well, so the target aspect stays at 1.5 for both.
	//
	// FOLDERS keep the roomy floors — folder counts are bounded by catalog
	// structure, so those grids almost always fill the stage anyway and the big
	// slabs are the primary navigation target.
	const FOLDER_COMFORT = { gap: GRID_GAP, minTile: 150, minTileHeight: 110, targetAspect: 1.5 };
	// PRESETS use a denser floor: a leaf can hold thousands of patches, and the
	// scarce resource is how many you can scan at once, not how big each one is.
	// ~112×78 still clears the 44px touch target with room to spare, and roughly
	// doubles the tiles onscreen vs the folder floors (more columns AND more rows).
	const PRESET_COMFORT = { gap: GRID_GAP, minTile: 112, minTileHeight: 78, targetAspect: 1.5 };

	const gridLayout = $derived.by(() => {
		const count = isScale
			? 0
			: screen === 'folders'
				? folders.length
				: screen === 'mixed'
					? folders.length + presets.length
					: presets.length;
		if (!count || stageWidth <= 0 || stageHeight <= 0) {
			return { columns: 2, rows: 1, scrolls: false, tileWidth: 0, tileHeight: 0 };
		}
		const width = stageWidth - GRID_PADDING * 2;
		const height = stageHeight - GRID_PADDING * 2;
		if (screen === 'mixed') {
			// Folders, then the level's own presets under one header: two
			// sections on ONE ruler, at the preset grid's density, so a folder
			// tile and a preset tile are the same size and share columns.
			return computeGroupedGridLayout({
				width,
				height,
				groups: [folders.length, presets.length],
				headerCount: 1,
				headerHeight: SECTION_HEADER_H,
				sectionGap: SECTION_GAP,
				...PRESET_COMFORT
			});
		}
		if (screen === 'presets' && useGroupedPresets) {
			// Sectioned layout: same solver scoring, but rows round up per section
			// and headers consume fixed chrome — so grouped tiles keep exactly the
			// plain grid's comfortable proportions (identical cols + height once
			// the content scrolls, which a flattened folder always does).
			return computeGroupedGridLayout({
				width,
				height,
				groups: presetGroups.map((g) => g.presets.length),
				headerCount: presetGroups.filter((g) => g.folder !== null).length,
				headerHeight: SECTION_HEADER_H,
				sectionGap: SECTION_GAP,
				...PRESET_COMFORT
			});
		}
		return computeGridLayout({
			width,
			height,
			count,
			...(screen === 'presets' ? PRESET_COMFORT : FOLDER_COMFORT)
		});
	});

	// Measure the stage so the grid layout can adapt to its real size.
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
	$effect(() => {
		if (!stageEl) return;
		const measure = () => {
			stageWidth = stageEl!.clientWidth;
			stageHeight = stageEl!.clientHeight;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(stageEl);
		return () => ro.disconnect();
	});

	// ── Row windowing (ADR-404) ──
	// Only the preset rows intersecting the viewport (± overscan) are in the DOM;
	// grid padding stands in for the rest, so a multi-thousand-sample flat leaf
	// scrolls like a short one. Geometry is exact (uniform --tile-h rows from the
	// solver), so the window is pure arithmetic — computeVisibleWindow /
	// computeGroupedVisibleWindow in drillDownModel. Folder grids stay unwindowed
	// (their counts are bounded by catalog structure, not library size).
	const OVERSCAN_ROWS = 3;
	let presetGridEl = $state<HTMLDivElement | undefined>(undefined);
	let groupedScrollEl = $state<HTMLDivElement | undefined>(undefined);
	let presetWindow = $state<VirtualWindow>({ start: 0, end: 0, topPad: 0, bottomPad: 0 });
	let groupedWindow = $state<GroupedVirtualWindow>({ sections: [], topPad: 0, bottomPad: 0 });

	function updateWindows() {
		if (screen === 'mixed') {
			// Two windowing sections: the folders (headerless, the grid pad on
			// top, like the loose bucket) and the presets under their header.
			// Windowed like any grouped screen — a level can hold hundreds of
			// samples beside one subfolder (FX › Nature › Animals › Birds: 218).
			const next = computeGroupedVisibleWindow({
				scrollTop: groupedScrollEl?.scrollTop ?? 0,
				viewportHeight: stageHeight,
				sections: [
					{ count: folders.length, headerHeight: 0, leadPad: GRID_PADDING },
					{ count: presets.length, headerHeight: SECTION_HEADER_H }
				],
				columns: gridLayout.columns,
				tileHeight: gridLayout.tileHeight,
				gap: GRID_GAP,
				sectionGap: SECTION_GAP,
				overscanRows: OVERSCAN_ROWS
			});
			if (!groupedWindowsEqual(next, untrack(() => groupedWindow))) groupedWindow = next;
			return;
		}
		if (screen !== 'presets') return;
		if (useGroupedPresets) {
			const next = computeGroupedVisibleWindow({
				scrollTop: groupedScrollEl?.scrollTop ?? 0,
				// .grouped-layer has no padding — the scroller spans the full stage.
				viewportHeight: stageHeight,
				// One windowing section per row-BAND (a packed band is one tile row,
				// so ceil(count/cols)===1 and it renders whole; big bands window as
				// before). A band shows a header if any of its sections is named.
				sections: presetBands.map((b) => {
					const named = b.groups.some((g) => g.folder !== null);
					return {
						count: b.count,
						headerHeight: named ? SECTION_HEADER_H : 0,
						// A headerless band (the loose bucket alone) keeps the grid pad
						// as its top breathing room (the inline pad replaces the CSS one).
						leadPad: named ? 0 : GRID_PADDING
					};
				}),
				columns: gridLayout.columns,
				tileHeight: gridLayout.tileHeight,
				gap: GRID_GAP,
				sectionGap: SECTION_GAP,
				overscanRows: OVERSCAN_ROWS
			});
			// untrack: the compare must not make the recompute-effect depend on the
			// window it writes (one wasted re-run per commit otherwise).
			if (!groupedWindowsEqual(next, untrack(() => groupedWindow))) groupedWindow = next;
		} else {
			const next = computeVisibleWindow({
				scrollTop: presetGridEl?.scrollTop ?? 0,
				// The grid is height:100% inside the .layer's padding.
				viewportHeight: stageHeight - GRID_PADDING * 2,
				count: presets.length,
				columns: gridLayout.columns,
				tileHeight: gridLayout.tileHeight,
				gap: GRID_GAP,
				overscanRows: OVERSCAN_ROWS
			});
			if (!windowsEqual(next, untrack(() => presetWindow))) presetWindow = next;
		}
	}

	// Scroll → recompute at most once per frame. State only changes when the
	// window actually crosses a row boundary, so plain scrolling re-renders nothing.
	let windowRaf = 0;
	function scheduleWindowUpdate() {
		if (windowRaf) return;
		windowRaf = requestAnimationFrame(() => {
			windowRaf = 0;
			updateWindows();
		});
	}

	// Recompute whenever the inputs change (level load, resize/layout change,
	// scroller mount). updateWindows reads all of them, so this effect tracks them.
	$effect(() => {
		updateWindows();
	});

	const windowedPresets = $derived(presets.slice(presetWindow.start, presetWindow.end));
	// Window sections joined back to their groups. Guarded lookup: the window is
	// corrected by the effect one flush AFTER presetGroups changes, so a stale
	// index must degrade to "skip" (never a crash) for that single frame.
	const windowedGroups = $derived(
		groupedWindow.sections
			.map((sw) => ({ sw, band: presetBands[sw.section] }))
			.filter((x) => x.band !== undefined)
	);

	// ── Data loading for the current path ──
	async function loadCurrentLevel() {
		// Fires on every vendor/path change (see the $effect below), so this is
		// the one place that catches all navigation away from a revealed tile.
		clearPickReveal();
		clearCharge();
		if (!selectedVendor || !vendorState?.adapter) {
			folders = [];
			presets = [];
			return;
		}
		const adapter = vendorState.adapter;
		const path = vendorState.currentPath;
		const color = browserNavigationStore.selectedVendorColor ?? undefined;
		// A Place reads through the switch: its presets, or its samples and
		// clips. Set on every load, so the adapter always filters by the mode
		// this level was asked for.
		const amongSamples = isPlaceVendorId(selectedVendor) && placeKindGroups !== PRESET_GROUPS;
		if (isPlaceVendorId(selectedVendor)) {
			(adapter as PlacesAdapter).setKindFilter?.(placeKindGroups);
		}
		const token = ++navToken;
		loading = true;
		if (selectedVendorId !== shownButtonId) {
			folders = [];
			folderColors = {};
			presets = [];
			shownButtonId = selectedVendorId;
		}
		try {
			// Fetch everything first, then commit to $state atomically behind a
			// SINGLE staleness check — so a newer navigation firing mid-fetch can
			// never leave a partial (stale folders + new presets) render on screen.
			const nextFolders = await adapter.getFolders(selectedVendor, path, color);
			const nextColors = adapter.getFolderColors
				? await adapter.getFolderColors(selectedVendor, path).catch(() => ({}))
				: {};
			// Every level's own presets, beside its folders too: a level holding
			// both shows them after its folders (`screenKind`'s `mixed`).
			// Uncapped on purpose (ADR-404): the adapters' default limit of 200 was
			// silently hiding everything past it in a big flat sample folder. Row
			// windowing bounds the DOM, so the full listing is safe to hold.
			const nextPresets = await adapter.getPresets(selectedVendor, path, Infinity);
			if (token !== navToken) return; // superseded by a newer navigation
			const restoreKey = pendingRestoreKey;
			pendingRestoreKey = null;
			// A remembered location is only as good as the catalog it was recorded
			// against — a regenerated/moved preset tree can strand it. An empty level
			// is the tell (a real folder always has folders or presets under it), so
			// drop the memory and fall back to the category root rather than
			// stranding the performer on a dead breadcrumb.
			if (restoreKey && path.length > 0 && nextFolders.length === 0 && nextPresets.length === 0) {
				logger.debug('Remembered browser path no longer resolves — falling back to root', {
					component: 'DrillDownBrowser',
					path: path.join('/')
				});
				browserNavigationStore.forgetPath(restoreKey);
				if (vendorState) vendorState.currentPath = []; // re-fires the effect at the root
				return;
			}
			// Among samples a Place's root holds just its Samples folder: open it,
			// as the old Simpler/Audio opened the samples themselves.
			const openLone = openLoneFolder;
			openLoneFolder = false;
			if (
				openLone &&
				vendorState &&
				isPlaceVendorId(selectedVendor) &&
				path.length === 0 &&
				nextFolders.length === 1 &&
				nextPresets.length === 0
			) {
				vendorState.currentPath = [nextFolders[0]]; // re-fires the effect one level down
				rememberCurrentPath();
				return;
			}
			folders = nextFolders;
			folderColors = nextColors;
			presets = nextPresets;
			paneAmongSamples = amongSamples;
		} catch (err) {
			if (token !== navToken) return;
			pendingRestoreKey = null;
			logger.error('Drill-down level load failed', { component: 'DrillDownBrowser', err });
			folders = [];
			presets = [];
		} finally {
			if (token === navToken) loading = false;
		}
	}

	// Reload whenever the vendor or path changes while open.
	$effect(() => {
		// Track deps: the vendorId, the rail *button* id, and the path.
		const _v = selectedVendor;
		const _b = selectedVendorId;
		const _p = currentPath.join('/');
		// The switch changes what a Place's level holds without moving the path.
		const _k = placeKindGroups;
		if (isExpanded && !isScale && _v) {
			loadCurrentLevel();
		}
	});

	// ── Category selection ──
	// Key this rail button's remembered location. Reads the store getter rather
	// than the `isAudioSource` derived — this runs imperatively right after
	// `tapRailCategory` may have written `sourceMode`, and we want that value.
	function pathMemoryKey(buttonId: string): string {
		// A Place remembers a spot among its presets and one among its samples.
		return rememberedPathKey(buttonId, browserModeStore.isAudioSource);
	}

	// Record where we are for the open button, so a later open-from-closed tap on
	// it resumes here. Called from every navigation that moves `currentPath`.
	function rememberCurrentPath() {
		if (!selectedVendorId || !vendorState) return;
		browserNavigationStore.rememberPath(pathMemoryKey(selectedVendorId), vendorState.currentPath);
	}

	// `restore: true` resumes this button's remembered location instead of
	// starting at the Place's root. `tapRailCategory` passes it for every tap
	// except the one on the Place that's already open on screen — that tap is the
	// "take me back to the top" gesture and keeps resetting.
	//
	// `at` overrides both: land on THIS path and remember it as this button's
	// location. Only `revealReplaceTarget` passes it — a replace opens on the
	// track's own patch, which is a location the catalog named rather than one
	// the performer walked (ADR-441).
	function selectCategory(
		vendor: BrowserVendor,
		{ restore = false, at = null }: { restore?: boolean; at?: string[] | null } = {}
	) {
		// The last few Places stay in memory, so a return to one draws at once;
		// the one that falls out is dropped.
		const kept = keepRecent(keptVendors, vendor.vendorId, PLACES_KEPT_IN_MEMORY);
		keptVendors = kept.list;
		for (const id of kept.evicted) browserNavigationStore.clearVendorCache(id);
		// The switch carries across Places, so samples can be swept from one to
		// the next — unless this Place has nothing for the current segment, where
		// it would show an empty screen. Then it flips to one it can fill:
		// Simpler → Clip (a Place of MIDI clips only) → Instrument; Instrument →
		// the last audio segment, or Clip when that is Simpler with nothing to
		// play. Never mid-replace: the replace chose its half (an instrument for
		// Replace Inst, a sample for a clip), and `tapRailCategory` keeps such a
		// Place from opening at all.
		if (isPlaceVendorId(vendor.vendorId)) {
			const amongSamples = browserModeStore.browseMode !== 'midi';
			const replacing = browserModeStore.isReplacingInstrument || browserModeStore.isReplacingAudioClip();
			const fits = placeHas(vendor.id, groupsForMode(browserModeStore.browseMode));
			if (!replacing && !fits && amongSamples) {
				if (placeHas(vendor.id, CLIP_GROUPS)) browserModeStore.setBrowseMode('audio');
				else if (placeHas(vendor.id, PRESET_GROUPS)) browserModeStore.setBrowseMode('midi');
			} else if (!replacing && !fits && placeHas(vendor.id, CLIP_GROUPS)) {
				browserModeStore.sourceMode = 'audio';
				if (!placeHas(vendor.id, AUDIO_GROUPS)) browserModeStore.setBrowseMode('audio');
			}
			openLoneFolder = browserModeStore.browseMode !== 'midi';
		}
		browserNavigationStore.selectedCategory = 'vendor';
		browserNavigationStore.selectedVendorId = vendor.id;
		browserNavigationStore.currentVendorId = vendor.vendorId;

		const state = browserNavigationStore.getOrCreateVendorState(vendor.vendorId);
		state.vendorColor = vendor.color;

		const key = pathMemoryKey(vendor.id);
		const resumePath = at ?? (restore ? browserNavigationStore.getRememberedPath(key) : []);
		state.currentPath = resumePath;
		// Landing somewhere IS this button's new location, whether the performer
		// walked there or a replace put them there. The reset arm is a navigation
		// too: jumping back to the root makes the root the remembered location, so
		// the next open doesn't resurrect the depth you just backed out of. It can
		// only ever clear the memory of the Place you were looking at — switching
		// Places restores.
		if (at) browserNavigationStore.rememberPath(key, at);
		else if (!restore) browserNavigationStore.rememberPath(key, []);
		// Only a *restored* path needs verifying. A path the performer just walked
		// into is known-good by construction, and so is `at` — the catalog it came
		// from is the same file the adapter is about to read this level out of.
		pendingRestoreKey = !at && resumePath.length > 0 ? key : null;

		if (resumePath.length > 0) {
			// Landing back inside a folder is the same commitment as drilling into
			// one, so prep the landing-pad track exactly as enterFolder would
			// (ADR-397) — otherwise a resumed browser is the one place you can stand
			// on a preset grid with no fresh track waiting. preprepForCurrentMode
			// does its own reset().
			preprepForCurrentMode();
			return;
		}
		// No prep on a bare Place tap — tapping a Place to browse its folders
		// shouldn't spawn a track. Mark ready so a load straight off a folder-less
		// root still preps on demand; the real landing-pad prep fires on the
		// first drill (enterFolder) or a browse-switch tap (setBrowseMode).
		trackPrepManager.reset();
		trackPrepManager.skipPrepAndMarkReady();
	}

	// Prep a landing-pad track for the current browse mode. Called on the first
	// drill into a Place (enterFolder) and on every browse-switch tap
	// (setBrowseMode) — prep liberally; Python's create-or-reuse reuses an
	// existing empty track and only creates a fresh one once the prepped track has
	// been dirtied (instrument + clip), so redundant calls are cheap and a
	// locked-open browser gets a fresh track for each new instrument. Always
	// leaves trackPrepManager in a valid state (prepping, or skipped-and-ready).
	//
	// MIDI / Simpler both prep a MIDI track and reuse it cleanly (the instrument
	// load and loadCaptureIntoSimpler each re-prep an empty MIDI track → REUSE).
	// AUDIO is deliberately NOT pre-prepped: Live's Browser always makes its own
	// track for an .alc clip (TrackPrepareComponent._handle_alc_prepare), so a
	// pre-prepped empty audio track would strand an auto-armed track beside it.
	// Audio keeps prepping at load time instead.
	function preprepForCurrentMode() {
		trackPrepManager.reset();
		// Replace modes pin the load to an exact track (instrument swap in place /
		// clip-into-slot) — no landing-pad prep; mark ready so the load path
		// targets the pinned track directly.
		if (browserModeStore.isReplacingInstrument || browserModeStore.isReplacingAudioClip()) {
			trackPrepManager.skipPrepAndMarkReady();
			return;
		}
		// Read the store getter (not the derived) — this runs imperatively right
		// after a setBrowseMode() / sourceMode mutation, so we want the just-written value.
		const landsAsAudio = browserModeStore.browseMode === 'audio';
		if (landsAsAudio) {
			// Audio: no up-front prep; the load path creates its own track.
			trackPrepManager.skipPrepAndMarkReady();
		} else {
			trackPrepManager
				.prepareTrack('instrument')
				.catch((err) => logger.error('Track prep failed', { component: 'DrillDownBrowser', err }));
		}
	}

	// ── Folder drill-down ──
	function enterFolder(name: string) {
		if (!vendorState) return;
		const wasAtRoot = vendorState.currentPath.length === 0;
		vendorState.currentPath = [...vendorState.currentPath, name];
		rememberCurrentPath();
		// Drilling from a Place's root commits the track kind — prep a landing-pad
		// track now (Places only; Recent keeps its per-entry load-time prep).
		// Re-preps on each fresh descent from root, so a locked-open browser gets a
		// new track after the previous one was loaded + recorded onto.
		if (wasAtRoot && currentIsPlace) {
			preprepForCurrentMode();
		}
	}

	function goToCrumb(index: number) {
		if (!vendorState) return;
		vendorState.currentPath = pathForCrumb(vendorState.currentPath, index);
		rememberCurrentPath();
	}
	// (Up-navigation is handled entirely by the breadcrumb; the title-bar arrow
	// closes the browser via handleClose.)

	// ── Track prep helper (mirrors the orchestrator's ensureTrackPrepared) ──
	async function ensureTrackPrepared() {
		// If the up-front prep from selectCategory is already in flight or
		// done, await THAT — don't kick off a second prepare. A second
		// prepare races the deferred audio-track create and spawns a
		// duplicate track (the boolean isPrepared() lags the in-flight
		// window, so checking it alone isn't enough).
		if (trackPrepManager.hasPendingOrReadyPrep()) {
			await trackPrepManager.awaitPrep();
			return;
		}
		const vendor = findVendorByVendorId(vendors, selectedVendor);
		if (vendor?.trackType) {
			await trackPrepManager.prepareTrack(vendor.trackType as any);
		}
	}

	// Replace-audio-clip intercept. When the browser was opened from a clip's
	// "replace" gesture, a picked audio sample swaps the sample in that exact
	// slot (clip-into-slot) instead of creating a new track — no track prep, no
	// load-as branch (a slot always holds a clip). Only fires while browsing
	// audio; returns true when it handled the pick.
	async function tryReplaceAudioClip(preset: Preset): Promise<boolean> {
		if (!isReplacingAudioClip) return false;
		// A Place holds presets too, and a preset can never go into a clip's slot:
		// only a sample or a clip replaces one.
		if (!isSampleLike(preset.kind)) return false;
		const target = browserModeStore.getAudioClipReplaceTarget();
		if (!target) return false;
		await replaceAudioClip(preset, target.trackIndex, target.clipIndex);
		browserModeStore.clearAudioClipReplaceTarget();
		handlePostLoad();
		return true;
	}

	// ── Shared load tail (tap a card, or a folder's random pick) ──
	// Both entry points commit a chosen preset identically: same captured
	// browser state, same prep reuse, same optimistic close. Only their error
	// handling differs.
	async function commitPresetLoad(preset: Preset, closeDelayMs = 0) {
		// EVERY browser-state read happens up here, ahead of the close below.
		// `handlePostLoad` drops the replace-instrument pin and the audio-clip
		// target, so anything read after it would miss the very swap this load
		// was opened to perform. The old shape could afford to read replace mode
		// mid-function because the close sat 750ms downstream of the load; it
		// doesn't any more, and this ordering is the thing holding that together.
		const replacing = browserModeStore.isReplacingInstrument;
		const replaceTarget = replacing
			? browserModeStore.replaceInstrumentTargetPath || undefined
			: undefined;
		const loadTarget = browserModeStore.audioLoadTarget;
		const vendorId = selectedVendor || undefined;

		// OPTIMISTIC CLOSE. The gesture has committed, so hand the screen back
		// now instead of holding the browser open across Live's round trip.
		// Three things make this safe rather than merely faster:
		//   - Nothing is cancelled. The browser is a sidebar that COLLAPSES; it
		//     never unmounts, so the awaits below run to completion behind a
		//     closed browser exactly as they did behind an open one.
		//   - The claim is honest. Track prep succeeds essentially always — the
		//     8s timeout is for pathological cases — so asserting "loaded" up
		//     front is true in practice, and false only where we now say so out
		//     loud (see the catch blocks' error banner).
		//   - The confirmation still arrives, just elsewhere: the target track
		//     pulses and takes the preset's name when the load actually lands
		//     (`presetLandingStore`), which outlives the browser closing.
		// Replace mode needs no special case — the pin's *value* is captured
		// above, so dropping the pin here can't misdirect the load.
		//
		// Hand the strip the pick on the way out, so the confirmation is already
		// on screen when the browser goes. This only works where the target track
		// EXISTS: replace mode's pinned track, or the landing pad pre-prepped
		// when you drilled in from a Place's root. A load that creates its own
		// track (the switch's Audio, prep-skipped) has no strip to mark yet, so it
		// stays quiet until the ack names one — a gap we can't honestly fill.
		const prepped = trackPrepManager.getTrackIndex();
		const pendingTrack =
			replaceTarget ?? (prepped !== undefined ? `tracks/${prepped}` : null);
		if (pendingTrack) presetLandingStore.markPending(pendingTrack, preset.name);

		handlePostLoad(closeDelayMs);

		// Reuse the up-front prep from selectCategory — do NOT reset()
		// and re-prepare. A second empty prepare races the deferred
		// audio-track create (audio creates finalize a tick later so
		// selection hasn't landed yet), which spawns a duplicate track.
		// ensureTrackPrepared() no-ops when already prepared.
		await ensureTrackPrepared();
		await loadPresetWithVariant(
			preset,
			vendorId,
			trackPrepManager.getTrackIndex(),
			replaceTarget,
			loadTarget
		);
		trackPrepManager.markAsUsed();
	}

	// ── Preset load (tap a leaf card) ──
	async function loadPreset(preset: Preset) {
		browserNavigationStore.loadedPresetPath = preset.path;
		try {
			if (await tryReplaceAudioClip(preset)) return;
			await commitPresetLoad(preset);
		} catch (err) {
			logger.error('Preset load failed', { component: 'DrillDownBrowser', err });
			// Retire the optimistic strip BEFORE the banner: leaving a track
			// mid-load next to a banner saying it failed is the one genuinely
			// confusing state this design can produce.
			presetLandingStore.clear();
			reportLoadFailure(preset.name, err);
			// Usually already closed (commitPresetLoad closes before it awaits);
			// this catches the throw that beat the close — a failing
			// tryReplaceAudioClip, which runs first. handleClose is idempotent.
			if (!browserModeStore.isLocked) handleClose();
		}
	}

	// ── Random pick from a folder (long-press a folder tile or a section header) ──
	async function loadRandomFromFolder(
		folderName: string,
		token: number,
		pick: Promise<Preset | null>
	) {
		// Tile state belongs to the NEWEST press (see `pressToken`); the load
		// itself goes through either way, because this folder was genuinely held
		// past the fire and a random pick is what that asks for.
		const owns = () => token === pressToken;
		try {
			// Already rolled at pointerdown, and usually already resolved and
			// showing on the tile. Awaiting it here rather than rolling again is
			// what guarantees the name you read is the preset you get; on a cold
			// catalog this is where the wait actually happens.
			const preset = await pick;
			if (!preset) {
				if (owns()) clearCharge();
				logger.warn('No preset found for random pick', { component: 'DrillDownBrowser', folderName });
				return;
			}
			browserNavigationStore.loadedPresetPath = preset.path;
			// Name the pick on the tile or header you're still holding. The folder
			// screen has no preset card to light up; a section header does, and
			// `loadedPresetPath` above is what lights it.
			if (owns()) showPickOn(folderName, preset.name);
			if (await tryReplaceAudioClip(preset)) return;
			// Linger just long enough to read the name on the tile.
			await commitPresetLoad(preset, PRESET_REVEAL_MS);
		} catch (err) {
			if (owns()) {
				clearCharge();
				clearPickReveal();
			}
			logger.error('Random pick failed', { component: 'DrillDownBrowser', err });
			presetLandingStore.clear();
			// Names the FOLDER, not a preset: getRandomPreset can throw before a
			// pick exists, and "Strings didn't load" is the honest report either
			// way — you asked the folder for something and got nothing.
			reportLoadFailure(folderName, err);
			if (!browserModeStore.isLocked) handleClose();
		}
	}

	// ── Scale mode ──
	// A key picked by hand is a key to keep (ADR-447). The surface turns
	// Follow off itself when a `scale_root` / `scale_name` write arrives from
	// any client, before the write — so a pick locks the key without this
	// component saying so, and a pick of the key already set locks too.
	function selectRootNote(index: number) {
		send(V3_SESSION_SCALE_ROOT_ADDRESS, [index]);
		send(V3_SESSION_SCALE_MODE_ADDRESS, [1]);
	}
	function selectScaleName(scaleName: string) {
		send(V3_SESSION_SCALE_NAME_ADDRESS, [scaleName]);
		send(V3_SESSION_SCALE_MODE_ADDRESS, [1]);
	}
	// Root and scale together — the runner-up chip: one write each, one mode.
	function applyKey(root: number, scaleName: string) {
		send(V3_SESSION_SCALE_ROOT_ADDRESS, [root]);
		send(V3_SESSION_SCALE_NAME_ADDRESS, [scaleName]);
		send(V3_SESSION_SCALE_MODE_ADDRESS, [1]);
	}
	// Follow / Locked. Turning Follow back on makes the surface detect at once.
	function toggleFollow() {
		send(V3_SESSION_KEY_FOLLOW_ADDRESS, [session.keyFollowEnabled ? 0 : 1]);
	}

	// ADR-446: ask the surface for the key of what is launched and set it at
	// once — the same three writes a pick makes (root, scale, scale mode on).
	// The answer lands in `session.scaleDetected`; the strip above the roots
	// shows the key, the band and the runner-up, with the vote ladder as its
	// tooltip. `detectSentAt` tells a fresh answer from the last one, and a
	// silent surface stops the "Listening" state after three seconds rather
	// than leaving the button lying.
	let detectSentAt = $state(0);
	// The vote ladder rides the strip's tooltip on the Mac; the iPad has no
	// tooltips, so a tap on the heading unfolds it under the strip.
	let showReasons = $state(false);
	let detectTimer: ReturnType<typeof setTimeout> | null = null;
	const detected = $derived(session.scaleDetected);
	const detectPending = $derived(detectSentAt > 0 && (!detected || detected.at < detectSentAt));
	const detectedTitle = $derived(detected ? detected.reasons.split(' | ').join('\n') : '');
	// "set" is a claim about NOW: shown only while Live's key is still the one
	// the detection wrote, not after a hand pick or a new set moved it.
	const detectedIsCurrent = $derived(
		!!detected &&
			detected.applied &&
			session.rootNote === detected.root &&
			session.scaleName === getScaleIndex(detected.scale)
	);
	function detectKey() {
		detectSentAt = Date.now();
		if (detectTimer) clearTimeout(detectTimer);
		detectTimer = setTimeout(() => {
			detectTimer = null;
			detectSentAt = 0;
		}, DETECT_TIMEOUT_MS);
		send(V3_SESSION_SCALE_DETECT_ADDRESS, [1]);
	}
	function clearDetectPending() {
		if (detectTimer) {
			clearTimeout(detectTimer);
			detectTimer = null;
		}
		detectSentAt = 0;
	}
	function applyRunnerUp() {
		if (!detected || detected.runnerRoot < 0 || !detected.runnerScale) return;
		applyKey(detected.runnerRoot, detected.runnerScale);
	}

	// ── Post-load: close now, unless locked ──
	// The browser used to sit open for PRESET_REVEAL_MS after a pick so you could
	// read what had loaded, on top of however long Live took to answer. Both
	// waits are gone: the pick's confirmation moved to the track strip, which can
	// report it after the browser is shut, so there is nothing left for an open
	// browser to tell you that the session view won't.
	//
	// LOCKED is deliberately untouched. Locked means "I'm auditioning, stay out
	// of my way" — that mode wants results in place, and optimism has nothing to
	// offer it because nothing was going to close anyway.
	function handlePostLoad(delayMs = 0) {
		if (browserModeStore.isLocked) return;
		clearPostLoadClose();
		if (delayMs <= 0) {
			handleClose();
			return;
		}
		// Held open only long enough to read the pick. The LOAD is already in
		// flight — this delays the browser's exit, never the work.
		postLoadCloseTimer = setTimeout(() => {
			postLoadCloseTimer = null;
			handleClose();
		}, delayMs);
	}

	let postLoadCloseTimer: ReturnType<typeof setTimeout> | null = null;
	function clearPostLoadClose() {
		if (postLoadCloseTimer !== null) {
			clearTimeout(postLoadCloseTimer);
			postLoadCloseTimer = null;
		}
	}

	// A load that fails after the optimistic close has no browser left to report
	// in, so it reports globally — `V3ErrorBanner` is the one surface that
	// outlives the close (fixed toast, 6s auto-dismiss).
	//
	// This is load-bearing, not a nicety. Failure used to announce itself by
	// ABSENCE: a nack closed the browser instantly while a success held it open
	// for 750ms, so "vanished without naming anything" *was* the error message.
	// The moment both outcomes close instantly that signal dies, and a failed
	// load becomes indistinguishable from a good one. Optimism is allowed to skip
	// the wait; it is not allowed to skip the bad news.
	function reportLoadFailure(what: string, err: unknown) {
		v3ErrorBannerStore.show(
			'preset-load-failed',
			what,
			err instanceof Error ? err.message : String(err)
		);
	}

	// ── Open / close ──
	function handleClose() {
		clearPostLoadClose();
		isExpanded = false;
		// ADR-446: a detection is a moment, not a setting — the next open starts clean.
		clearScaleDetected();
		clearDetectPending();
		showReasons = false;
		browserModeStore.isPersistent = false;
		browserModeStore.isScalePersistent = false;
		browserModeStore.exitReplaceMode();
		browserModeStore.clearAudioClipReplaceTarget();
	}

	function handleLockToggle() {
		if (browserModeStore.isLocked) {
			browserModeStore.isLocked = false;
			handleClose();
		} else {
			browserModeStore.isLocked = true;
		}
	}

	// ── Long-press bookkeeping for folder rows ──
	//
	// Two pieces of feedback hang off this. At 500ms the hold is long enough to
	// be read as a gauge, so it wears the same rising fill as ClipCentralView's
	// 800ms gates rather than the charge ring it needed back when it was 200ms:
	//
	//   charge — `chargingFolder` marks the tile under an active press, which
	//            mounts a `.hold-fill` that climbs it over exactly
	//            HOLD_TO_RANDOM_MS and lands full at the instant the timer
	//            fires. The class stays on past the fire (the fill is
	//            `forwards`) so the tile holds the filled look through the async
	//            pick rather than dropping back for a frame.
	//   pick   — `pickedFolder`/`pickedName` turn the held tile into the reveal
	//            surface for PRESET_REVEAL_MS: it takes the preset grammar and
	//            its label becomes the preset that actually got loaded. This is
	//            the payoff of the whole gesture — a random pick is the one
	//            choice you can't know in advance — so the browser now waits out
	//            this window before closing on the random path (and only there;
	//            see `handlePostLoad`).
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let pressFired = false;
	let chargingFolder = $state<string | null>(null);
	/**
	 * The speculative pick's name, shown on the tile WHILE the bar is still
	 * climbing. This is what turns the 500ms from a wait into a decision: you
	 * read what you're about to get and can still back out by lifting off.
	 * Null until the pick resolves — on a cold catalog that can be after the
	 * fire, in which case the tile simply goes straight to `.picked`.
	 */
	let chargingName = $state<string | null>(null);
	/**
	 * The speculative pick's TILE, for a section-header press: the tiles are on
	 * screen under the header, so the pick lights its own tile while the bar
	 * climbs. That is the readable half on iPad — the finger holding the header
	 * covers the header's label. A folder-tile press never sets it (a folder
	 * screen has no preset tiles).
	 */
	let chargingPresetPath = $state<string | null>(null);
	let pickedFolder = $state<string | null>(null);
	let pickedName = $state<string | null>(null);
	let pickRevealTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * Bumped on every press. `getRandomPreset` awaits a possibly-cold catalog
	 * fetch (`/data/{type}.json` on first use of a type), so a press can resolve
	 * long after the finger moved on: hold A past the fire, release, press B,
	 * and A's late resolution would otherwise wipe B's charge and label B's
	 * screen with A's pick. Same guard `loadCurrentLevel` uses (`navToken`),
	 * for the same reason.
	 */
	let pressToken = 0;
	/** Handle for the re-arm frame below, so teardown can drop it like the timers. */
	let chargeRaf = 0;

	/** Retire the charge — the fill unmounts and the tile takes its own name back. */
	function clearCharge() {
		chargingFolder = null;
		chargingName = null;
		chargingPresetPath = null;
	}

	/** Retire the pick reveal — the tile goes back to being a folder. */
	function clearPickReveal() {
		if (pickRevealTimer) { clearTimeout(pickRevealTimer); pickRevealTimer = null; }
		pickedFolder = null;
		pickedName = null;
	}

	/**
	 * Show `preset` on `folder`'s tile for the reveal window.
	 *
	 * The revert timer runs even though the unlocked browser auto-closes at the
	 * same moment: locked, nothing closes, and without it the tile would sit
	 * there labelled with a preset name indefinitely.
	 */
	function showPickOn(folder: string, presetName: string) {
		if (pickRevealTimer) clearTimeout(pickRevealTimer);
		pickedFolder = folder;
		pickedName = presetName;
		pickRevealTimer = setTimeout(() => {
			// The charge outlives the finger (see `endFolderPress`) and `.picked`
			// has been covering it; when the reveal goes, take it with us or the
			// tile is left looking charged forever.
			clearCharge();
			clearPickReveal();
		}, PRESET_REVEAL_MS);
	}

	/**
	 * Roll the random pick NOW, at pointerdown, so its name can appear while the
	 * hold is still filling. The gesture commits this exact preset when the timer
	 * fires — it does not re-roll — or discards it if the finger lifts early.
	 *
	 * Speculative on every folder press, including the taps that just drill in.
	 * That costs one `/data/{type}.json` read, which a drill needs anyway and
	 * which is cached from then on.
	 */
	function pickRandomFor(folderName: string, token: number): Promise<Preset | null> {
		if (!selectedVendor || !vendorState?.adapter) return Promise.resolve(null);
		const folderPath = [...vendorState.currentPath, folderName];
		const pick = vendorState.adapter.getRandomPreset(selectedVendor, folderPath);
		// Label-only branch. Attaching a handler here also keeps an aborted press
		// (nothing ever awaits `pick`) from surfacing as an unhandled rejection;
		// the REAL error still reaches `loadRandomFromFolder`, which awaits `pick`
		// itself and owns the banner.
		pick
			.then((preset) => {
				if (preset && token === pressToken && chargingFolder === folderName) {
					chargingName = preset.name;
				}
			})
			.catch(() => {});
		return pick;
	}

	/** Mount the charge on `name`'s tile or header, for the press `token`. */
	function armCharge(name: string, token: number) {
		if (chargingFolder === name) {
			// Re-pressing a tile that is STILL charging — its previous press fired
			// and that pick is either in flight or on screen. Assigning the value
			// it already holds toggles no class, and a `forwards` fill parked at
			// its end state never replays, so the bar would not rebuild. Drop it
			// and re-arm on the next frame. ONLY this path pays that frame; an
			// ordinary press still charges on the same tick.
			chargingFolder = null;
			cancelAnimationFrame(chargeRaf);
			chargeRaf = requestAnimationFrame(() => {
				chargeRaf = 0;
				if (token === pressToken) chargingFolder = name;
			});
		} else {
			chargingFolder = name;
		}
	}

	function startFolderPress(name: string) {
		pressFired = false;
		clearTimeout(pressTimer!);
		// A fresh press retires the previous reveal — only ever one tile at a time.
		clearPickReveal();
		const token = ++pressToken;
		chargingName = null;
		chargingPresetPath = null;
		armCharge(name, token);
		// Rolled here, committed at the fire — the name on the tile and the preset
		// that loads are the same object, never two rolls.
		const pick = pickRandomFor(name, token);
		pressTimer = setTimeout(() => {
			pressFired = true;
			loadRandomFromFolder(name, token, pick);
		}, HOLD_TO_RANDOM_MS);
	}
	function endFolderPress(name: string) {
		clearTimeout(pressTimer!);
		pressTimer = null;
		// Only drop the charge when the press ended BEFORE the fire. Past it the
		// charged look has to hold through the async pick — releasing the moment
		// the ring completes is the NORMAL way to use this gesture (the ring
		// filling is the cue to let go), and `getRandomPreset` may still be
		// awaiting a cold catalog fetch. Clearing here would flash the tile back
		// to its resting outline before the reveal lands. `.picked` outranks
		// `.charging` in the cascade (same specificity, declared after), so the
		// reveal shows through the charge rather than fighting it, and the
		// reveal's own expiry retires both.
		if (!pressFired) {
			// Lifted off before the fire — an abort. The speculative pick is
			// discarded unused, which is the whole point of showing its name
			// during the climb.
			clearCharge();
			enterFolder(name);
		}
	}
	function cancelFolderPress() {
		clearTimeout(pressTimer!);
		pressTimer = null;
		// Same rule as `endFolderPress`: only drop the charge if the press never
		// fired. Past the fire the pick is committed and WILL land (this doesn't
		// bump `pressToken`, so it still owns the tile), and clearing here would
		// empty the tile exactly as the release path used to. A finger drifting
		// off a tile edge mid-hold — ordinary on iPad — is not an abort of
		// anything. Checked before `pressFired` is forced true below.
		if (!pressFired) clearCharge();
		pressFired = true; // suppress the trailing tap
	}

	// ── Long-press a section header → random preset from that section ──
	//
	// The folder tile's gesture, on the headers of a grouped (depth-flattened)
	// preset screen: same 500ms fill, same reveal, same close. Two differences,
	// both forced by where a section lives:
	//
	//   - The pick is rolled from the section's own presets, not asked of the
	//     adapter. Past the depth cap the section's folder is not a node in the
	//     catalog tree at all, and `getRandomPreset` falls back to the PARENT
	//     when a path doesn't resolve — so asking it would quietly pick from
	//     the whole flattened screen rather than the section held. The section
	//     is already in memory, so the roll is synchronous and never cold.
	//   - It runs on `use:press` (ADR-427) rather than the folder tile's
	//     hand-rolled handlers: `onHold` is the fire, a release before it (or a
	//     pan the browser claims, or 12px of travel) is the abort. A tap on a
	//     header does nothing, as before.
	//
	// Keyed by folder name, sharing `chargingFolder` / `pickedFolder` with the
	// folder tiles: the two never share a screen (`screenKind`), and a
	// section's name is unique on its screen (`groupPresetsByOrigin` merges
	// case-insensitively).

	/** The roll each held header is carrying, from its `onDown` to its `onHold`. */
	const sectionPicks = new Map<string, { token: number; preset: Preset }>();

	function startSectionPress(folder: string, sectionPresets: Preset[]) {
		// A Places section can hold greyed tiles (a plug-in not installed, an
		// effect) that a tap cannot load, so a roll cannot land on one either.
		// Every type-catalog preset passes, so this is the old roll there.
		const pool = sectionPresets.filter((p) => canLoad(p.kind, p.installed));
		if (pool.length === 0) return;
		clearPickReveal();
		const token = ++pressToken;
		const preset = pool[Math.floor(Math.random() * pool.length)];
		sectionPicks.set(folder, { token, preset });
		chargingName = preset.name;
		chargingPresetPath = preset.path;
		armCharge(folder, token);
	}

	function fireSectionPress(folder: string) {
		const pick = sectionPicks.get(folder);
		if (!pick) return;
		void loadRandomFromFolder(folder, pick.token, Promise.resolve(pick.preset));
	}

	function endSectionPress(folder: string, info: PressReleaseInfo) {
		const pick = sectionPicks.get(folder);
		sectionPicks.delete(folder);
		// Past the fire the charge outlives the finger, exactly as on a folder
		// tile — the reveal's own expiry retires it. Before the fire this is an
		// abort, and the speculative pick is discarded unused.
		if (!info.held && pick && pick.token === pressToken) clearCharge();
	}

	function sectionPress(folder: string, sectionPresets: Preset[]): PressOptions {
		return {
			holdMs: HOLD_TO_RANDOM_MS,
			onDown: () => startSectionPress(folder, sectionPresets),
			onHold: () => fireSectionPress(folder),
			onRelease: (info) => endSectionPress(folder, info)
		};
	}

	// ── Lifecycle ──
	/**
	 * The rail from the Mac's Places index (`/api/places/index.json`). A
	 * machine with nothing ticked in Settings has an empty list, and the rail
	 * shows Recent alone. On a refresh (the Mac said the catalog changed:
	 * `placesLive`) every button keeps its folder position and the level on
	 * screen is read again from the new catalog.
	 */
	async function loadRail(refresh: boolean) {
		try {
			const index = await getPlacesIndex();
			placeVendors = index.places.map((p) => ({
				id: placeVendorId(p.id),
				name: p.name,
				// A Place's role colors its button (`vendors.types[role]`).
				color: (p.role && TYPE_COLORS[p.role]?.color) || DEFAULT_TYPE_COLOR,
				vendorId: placeVendorId(p.id),
				trackType: 'midi'
			}));
			placeInfo = Object.fromEntries(index.places.map((p) => [placeVendorId(p.id), p]));
			// Every Place's files into Safari's cache while nothing is happening,
			// so a first open mid-set is a parse, not a transfer (§9).
			void warmPlacesCache(index.places);
			if (refresh) {
				browserNavigationStore.refreshVendorStates(placeVendors);
				if (selectedVendor && selectedVendor !== 'recent-instruments' && !placeVendors.some((v) => v.id === selectedVendor)) {
					// The open Place was unticked: back to the rail.
					browserNavigationStore.currentVendorId = null;
					browserNavigationStore.selectedVendorId = null;
				}
				await loadCurrentLevel();
			} else {
				browserNavigationStore.initializeVendorStates(placeVendors);
			}
		} catch (error) {
			logger.warn('No Places catalog from the Mac yet', {
				component: 'DrillDownBrowser',
				error: String(error)
			});
		}
	}

	onMount(() => {
		void loadRail(false);
		const onChanged = () => void loadRail(true);
		window.addEventListener(PLACES_CHANGED_EVENT, onChanged);
		return () => window.removeEventListener(PLACES_CHANGED_EVENT, onChanged);
	});

	// External open triggers via browserModeStore (BottomControls / SystemCentralView).
	let wasPersistent = false;
	$effect(() => {
		const nowPersistent = browserModeStore.isPersistent;
		if (nowPersistent !== wasPersistent) {
			if (nowPersistent) isExpanded = true;
			else {
				isExpanded = false;
			}
			wasPersistent = nowPersistent;
		}
	});
	let wasScalePersistent = false;
	$effect(() => {
		const nowScale = browserModeStore.isScalePersistent;
		if (nowScale !== wasScalePersistent) {
			if (nowScale) {
				isExpanded = true;
				browserNavigationStore.selectedCategory = 'scale';
				browserNavigationStore.selectedVendorId = null;
			}
			wasScalePersistent = nowScale;
		}
	});

	// ── A replace opens on the track's own patch (ADR-441) ──
	// Keyed on the ARMING of replace mode, not on the browser expanding: a locked
	// browser is already persistent when the pill fires, and that open deserves
	// the same landing as any other.
	let wasReplacingInstrument = false;
	// Guards a slow catalog read against a newer open, exactly as `navToken`
	// guards `loadCurrentLevel` and `pressToken` the random pick.
	let revealToken = 0;
	$effect(() => {
		const nowReplacing = browserModeStore.isReplacingInstrument;
		if (nowReplacing === wasReplacingInstrument) return;
		wasReplacingInstrument = nowReplacing;
		// Read before the switch's flip reloads the level: what the performer
		// was looking at when the replace armed.
		if (nowReplacing) void revealReplaceTarget(browserModeStore.replaceInstrumentPresetPath, paneAmongSamples);
	});

	/**
	 * Land the browser on `presetPath`'s catalog folder, with that preset's tile
	 * marked as the one on the track.
	 *
	 * Deliberately NOT awaited by the opener. The lookup can be a cold multi-MB
	 * `/data/places/<id>.json`, and holding the browser shut behind it would make the
	 * Replace Inst hold feel like it missed. The browser expands immediately
	 * where it was and re-skins when the folder resolves — the same trade the
	 * folder long-press makes with its speculative pick.
	 */
	async function revealReplaceTarget(presetPath: string | null, wasAmongSamples: boolean) {
		const token = ++revealToken;
		const found = presetPath
			? await presetSiblings(presetPath).catch((err) => {
					logger.warn('Replace-open: catalog lookup failed', {
						component: 'DrillDownBrowser',
						presetPath,
						err: String(err)
					});
					return null;
				})
			: null;
		if (token !== revealToken) return;
		// The mode can be dropped while we look — a different track selected, or
		// the browser closed. Re-skinning a browser that is no longer replacing
		// would move the performer for no reason.
		if (!browserModeStore.isReplacingInstrument) return;

		const landing = replaceLanding({
			found,
			// The catalog answers with a Place's rail id.
			knownTypeIds: placeVendors.map((v) => v.id),
			openButtonId: selectedVendorId,
			openShowsSamples: wasAmongSamples
		});
		if (landing.kind === 'none') {
			logger.debug('Replace-open: nowhere to land, leaving the browser as it is', {
				component: 'DrillDownBrowser',
				presetPath,
				typeId: found?.typeId ?? null
			});
			return;
		}
		const vendor = findVendorById(vendors, landing.vendorId);
		if (!vendor) return;
		if (landing.kind === 'reskin') {
			// No folder to land on (no record on the track, a path no Place holds)
			// — but the pane was among samples, and `openForReplace` has flipped
			// the switch to MIDI under it. The level reloads at the same path with
			// the preset filter, which in a samples folder is an empty screen; the
			// Place's remembered spot among its presets is where to go instead.
			selectCategory(vendor, { restore: true });
			return;
		}
		// `loadedPresetPath` is matched against a tile's RELATIVE `path`.
		browserNavigationStore.loadedPresetPath = found!.presets[found!.index]?.path ?? null;
		selectCategory(vendor, { at: landing.path });
	}

	// Selecting a different track cancels an armed replace-instrument.
	//
	// The pin is a track path frozen when the Replace Inst long-press fired, not
	// a live read of the selection — so once the performer moves to another
	// track it means nothing, and a locked browser (which deliberately keeps the
	// pin across loads so you can audition instruments in place) would otherwise
	// keep swapping onto the track they left behind. Cancelling here reverts the
	// status pill to the browse switch, so the mode change is visible.
	//
	// A replace load itself resolves to the pinned track and echoes its
	// selection, which matches the pin and leaves the mode armed.
	$effect(() => {
		const selected = selectedTrackStore.selectedTrackPath;
		if (!browserModeStore.isReplacingInstrument) return;
		const pinned = browserModeStore.replaceInstrumentTargetPath;
		if (pinned && selected && selected !== pinned) {
			logger.debug('Selection left the replace-instrument target — cancelling replace mode', {
				component: 'DrillDownBrowser',
				pinned,
				selected
			});
			browserModeStore.exitReplaceMode();
		}
	});

	onDestroy(() => {
		if (pickRevealTimer) { clearTimeout(pickRevealTimer); pickRevealTimer = null; }
		clearDetectPending();
		if (chargeRaf) cancelAnimationFrame(chargeRaf);
		clearPostLoadClose();
		clearTimeout(pressTimer!);
		// Guarded: onDestroy also runs during SSR, where cAF doesn't exist (and
		// windowRaf is always 0 there — nothing schedules frames server-side).
		if (windowRaf) cancelAnimationFrame(windowRaf);
		browserNavigationStore.clearAllCaches();
	});

	// Tap a rail category button: open + select, or toggle-close if it's the
	// one already open at the root. No-op when greyed (audio mode, no samples).
	function tapRailCategory(vendor: BrowserVendor) {
		const isSameOpen = isExpanded && !isScale && selectedVendorId === vendor.id;
		if (isSameOpen && currentPath.length === 0) {
			handleClose();
			return;
		}
		// Restarting at the root is the gesture for the Place you're LOOKING at —
		// tapping the open Place's slab means "take me back up" (the one case left
		// here, since the same-Place-at-root tap closed above). Every other tap is
		// an open: from a closed browser, from the scale picker, or from a
		// different Place whose tree isn't on screen to be reset. Those resume that
		// button's last location instead of making you re-walk the tree.
		const restore = !isSameOpen;
		// A replace chose its half of the switch (a sample for a clip, an
		// instrument for Replace Inst) and shows its pill in the switch's place,
		// so a Place with nothing of that half would open on a dead end: ignore
		// the tap instead. The browse mode otherwise persists across opens
		// (ADR-397) and a Place settles it in `selectCategory`.
		if (isPlaceVendorId(vendor.vendorId)) {
			if (browserModeStore.isReplacingAudioClip() && !placeHas(vendor.id, AUDIO_GROUPS)) return;
			if (browserModeStore.isReplacingInstrument && !placeHas(vendor.id, PRESET_GROUPS)) return;
		}
		isExpanded = true;
		browserModeStore.isPersistent = true;
		selectCategory(vendor, { restore });
	}

	// Top-bar three-way switch — MIDI (instrument presets), Simpler (a sample onto
	// a fresh Simpler on a MIDI track), or Audio (a sample as a clip on an audio
	// track). The choice persists and preps its track right away (ADR-397). The
	// two audio segments are guarded by `disabled` when the open type has no
	// samples, so no empty-pane fallback is needed here.
	function setBrowseMode(mode: BrowseMode) {
		if (browseMode === mode) return;
		if (mode === 'simpler' && simplerUnavailableForCurrent) return;
		if (mode === 'audio' && clipUnavailableForCurrent) return;
		if (mode === 'midi' && midiUnavailableForCurrent) return;
		const wasAudio = isAudioSource;
		browserModeStore.setBrowseMode(mode);
		// Leaving audio (→ MIDI) abandons an in-progress clip replace (you can't
		// replace an audio clip with an instrument) — drop the target so it can't
		// fire unexpectedly on a later audio pick.
		if (mode === 'midi') {
			browserModeStore.clearAudioClipReplaceTarget();
		}
		const cur = findVendorById(vendors, selectedVendorId);
		if (!(isExpanded && !isScale && cur && isPlaceVendor(cur))) return;
		if (wasAudio !== (mode !== 'midi')) {
			// presets ↔ samples: the content changes — re-skin from the Place's
			// root. (Simpler ↔ Audio skips this: same samples, keeps your place.)
			selectCategory(cur);
		}
		// A switch tap commits a mode, so prep its landing-pad track now (MIDI /
		// Simpler → a MIDI track; Audio → none). Redundant with a later drill's
		// prep, but reuse keeps that cheap.
		preprepForCurrentMode();
	}

	// (Scale/Key mode has no rail button — faithful to the old UI. It's opened
	// externally via browserModeStore.isScalePersistent from SystemCentralView,
	// handled by the effect below.)

	const railRecent = $derived(vendors.find((v) => v.id === 'recent'));

	// The rail (browser-places plan §2): Recent — `null` marks its slot, since it
	// shows as a placeholder until something has loaded — then every Place in
	// Live's sidebar order, split across three bands by `railBands`, Record
	// leading the first. With today's seven Places that is Record · Recent · Drum
	// / Perc · Bass · FX / Inst · Key · Synth, each band aligned with a main
	// content row. No Places catalog: Recent alone.
	const placeRail = $derived(railBands<BrowserVendor | null>([null, ...placeVendors]));
</script>

<!-- One preset tile — shared by the plain grid and the grouped sections so the
     markup (waveform thumbnail, variant badge, loaded state) lives once.
     While a section header charges, its speculative pick wears the loaded ring
     instead of the tile actually loaded: one ring on screen, on the preset the
     hold is about to load. A lift before the fire hands it back.

     A Places catalog item can also be something a tap must not load
     (browser-places plan §2): a plug-in preset whose plug-in is not installed,
     or an effect, which never loads as an instrument. Those are GREYED, not
     hidden — visible, and saying why — and a plug-in preset names its plug-in
     under its own name. None of this applies to a type-catalog item, which
     carries neither field. -->
{#snippet presetTile(p: Preset)}
	{@const notInstalled = p.installed === false}
	{@const effect = groupOfKind(p.kind) === 'effects'}
	<!-- The line under the name: the plug-in, else why a greyed tile is greyed —
	     on its face, since the iPad shows no tooltips. -->
	{@const subLabel = notInstalled ? 'Not installed' : (p.plugin ?? (effect ? 'Effect' : null))}
	<button
		class="card preset-tile"
		class:loaded={(chargingPresetPath ?? browserNavigationStore.loadedPresetPath) === p.path}
		class:unavailable={notInstalled || effect}
		class:has-plugin={!!subLabel}
		style="--k: {p.vendorColor || activeColor};"
		disabled={notInstalled || effect}
		title={notInstalled
			? `${p.plugin ?? 'This plug-in'} is not installed`
			: effect
				? 'An effect preset — it does not load as an instrument'
				: undefined}
		onclick={() => loadPreset(p)}
	>
		{#if audioWaveformsEnabled && isAudioThumbnailType(p.type)}
			<BrowserPresetWaveform preset={p} />
		{/if}
		<span class="tile-name">{p.name}</span>
		{#if subLabel}
			<span class="tile-plugin">{subLabel}</span>
		{/if}
	</button>
{/snippet}

<!-- The rail's first slot: Record, or the close X while the browser is open. -->
{#snippet recordSlot()}
	<div class="record-button-container">
		{#if isExpanded}
			<button
				class="close-x"
				onpointerdown={(e) => { e.preventDefault(); e.stopPropagation(); }}
				onpointerup={(e) => { e.preventDefault(); e.stopPropagation(); }}
				onclick={handleClose}
				aria-label="Close browser"
			>
				<X size={40} strokeWidth={2.5} />
			</button>
		{:else}
			<RecordButton prepareOnHold shape="rect" />
		{/if}
	</div>
{/snippet}

<!-- One rail button (a Place, or Recent). -->
{#snippet railButton(v: BrowserVendor)}
	<button
		class="selection-button category-button"
		class:selected={isExpanded && !isScale && selectedVendorId === v.id}
		style="--category-color: {trackInk(v.color, paintModeReactive())};"
		onpointerdown={() => tapRailCategory(v)}
	>
		<span class="category-name">{v.name}</span>
	</button>
{/snippet}

<!-- A section's header — the full-width band's and a packed cell's. Hold it and
     a random preset from the section loads (`sectionPress`), wearing the folder
     tile's charge: the same rising fill, the name swapped for the pick while the
     bar climbs and through the reveal. The count means nothing beside a preset's
     name, so it steps aside while one shows. -->
{#snippet folderTile(name: string)}
	<button
		class="card folder-tile"
		class:charging={chargingFolder === name}
		class:picked={pickedFolder === name}
		style="--k: {folderColors[name] || activeColor};"
		onpointerdown={() => startFolderPress(name)}
		onpointerup={() => endFolderPress(name)}
		onpointerleave={cancelFolderPress}
		onpointercancel={cancelFolderPress}
	>
		{#if chargingFolder === name}
			<!-- Same rising fill as ClipCentralView's hold gates,
			     duration bound inline to the timer that fires so the
			     bar cannot finish early or late. -->
			<div
				class="hold-fill"
				aria-hidden="true"
				style="animation-duration: {HOLD_TO_RANDOM_MS}ms;"
			></div>
		{/if}
		<!-- Three labels, most-committed first: the post-fire
		     reveal, then the speculative pick showing while the
		     bar climbs, then the folder's own name. -->
		<span class="tile-name"
			>{pickedFolder === name && pickedName
				? pickedName
				: chargingFolder === name && chargingName
					? chargingName
					: name}</span
		>
	</button>
{/snippet}

<!-- `folder` keys the hold's charge and reveal; `label` is what the header
     reads when that is not the key (a mixed level's presets, keyed apart from
     every folder name on the same screen). -->
{#snippet sectionHead(folder: string, sectionPresets: Preset[], label: string = folder)}
	{@const pick =
		pickedFolder === folder && pickedName
			? pickedName
			: chargingFolder === folder && chargingName
				? chargingName
				: null}
	<h3
		class="section-head"
		class:charging={chargingFolder === folder}
		class:picked={pickedFolder === folder}
		style="--k: {sectionPresets[0]?.vendorColor || activeColor};"
		use:press={sectionPress(folder, sectionPresets)}
	>
		{#if chargingFolder === folder}
			<span
				class="hold-fill"
				aria-hidden="true"
				style="animation-duration: {HOLD_TO_RANDOM_MS}ms;"
			></span>
		{/if}
		<span class="section-name">{pick ?? label}</span>
		{#if pick === null}
			<span class="section-count">{sectionPresets.length}</span>
		{/if}
		<span class="section-rule"></span>
	</h3>
{/snippet}

<div
	class="drill-browser"
	class:expanded={isExpanded}
	role="application"
	aria-label="Instrument browser"
	style="--accent: {activeColor}; --grid-pad: {GRID_PADDING}px; --grid-gap: {GRID_GAP}px;"
>
	<!-- Persistent category rail (always visible, both collapsed and open):
	     three bands whatever the count — Recent + the Places split across them
	     by `railBands`, Record leading the first (browser-places plan §2) —
	     aligned to the main content rows, matte-slab styling. Tapping a slab
	     opens + drills into that Place. -->
	<div class="vendor-buttons places-rail" aria-label="Instrument categories">
		{#each placeRail as band, b (b)}
			<div class="button-group">
				{#if b === 0}{@render recordSlot()}{/if}
				{#each band as v (v?.id ?? 'recent')}
					{#if v === null}
						{#if railRecent}
							{@const isSel = isExpanded && selectedVendorId === 'recent'}
							<button
								class="selection-button category-button"
								class:selected={isSel}
								style="--category-color: {trackInk(railRecent.color, paintModeReactive())};"
								onpointerdown={() => tapRailCategory(railRecent)}
							>
								<span class="category-name">{railRecent.name}</span>
							</button>
						{:else}
							<div class="selection-button category-button placeholder">
								<span class="category-name">Recent</span>
							</div>
						{/if}
					{:else}
						{@render railButton(v)}
					{/if}
				{/each}
			</div>
		{/each}
	</div>

	{#if isExpanded}
		<!-- Right pane: breadcrumb bar + the one-layer-at-a-time stage -->
		<div class="pane">
			<div class="bar">
				<div class="crumbs">
					{#each crumbs as c, i (c.index)}
						{#if i > 0}<span class="sep">/</span>{/if}
						<button
							class="crumb"
							class:root={c.index === -1}
							class:here={c.index === currentPath.length - 1}
							onclick={() => goToCrumb(c.index)}
						>
							{c.label}
						</button>
					{/each}
					{#if isScale}
						<span class="crumb root here">Key</span>
					{/if}
				</div>

				<!-- Replace modes: the next pick swaps in place (clip-into-slot, or the
				     instrument on the pinned track), so the browse switch doesn't apply
				     and must stay hidden — flipping to a sample source would ignore the
				     pin and spawn a new track. Show a status pill instead. -->
				<div class="bar-controls">
					{#if isReplacingAudioClip}
						<div class="replace-pill" aria-label="Replacing audio clip">Replace clip</div>
					{:else if isReplacingInstrument}
						<div class="replace-pill" aria-label="Replacing instrument">Replace inst</div>
					{:else if showSourceSwitch}
						<!-- Three-way browse switch (Places only), by what you'll do
						     with a pick: Instrument = a Place's presets (MIDI track),
						     Simpler = a sample onto a fresh Simpler (MIDI track),
						     Clip = a sample or clip into a Session slot. Internal ids
						     stay midi | simpler | audio. A segment disables when the
						     open Place has nothing it lists. -->
						<div class="seg-switch" role="group" aria-label="Browse mode">
							<button
								class="seg"
								class:on={browseMode === 'midi'}
								disabled={midiUnavailableForCurrent}
								onclick={() => setBrowseMode('midi')}
							>
								Instrument
							</button>
							<button
								class="seg"
								class:on={browseMode === 'simpler'}
								disabled={simplerUnavailableForCurrent}
								onclick={() => setBrowseMode('simpler')}
							>
								Simpler
							</button>
							<button
								class="seg"
								class:on={browseMode === 'audio'}
								disabled={clipUnavailableForCurrent}
								onclick={() => setBrowseMode('audio')}
							>
								Clip
							</button>
						</div>
					{/if}

					{#if isScale}
						<div class="key-controls">
							<button
								class="follow-btn"
								class:on={session.keyFollowEnabled}
								onclick={toggleFollow}
								aria-pressed={session.keyFollowEnabled}
								aria-label={session.keyFollowEnabled
									? 'The key follows the loops. Tap to lock it.'
									: 'The key is locked. Tap to let it follow the loops.'}
							>
								{session.keyFollowEnabled ? 'Following' : 'Locked'}
							</button>
							<button
								class="detect-btn"
								class:pending={detectPending}
								onclick={detectKey}
								aria-label="Detect the key of the launched clips and set it"
							>
								{detectPending ? 'Listening…' : 'Detect key'}
							</button>
						</div>
					{/if}

					<button
						class="icon-btn lock"
						class:on={browserModeStore.isLocked}
						onclick={handleLockToggle}
						aria-label="Lock browser open"
					>
						{#if browserModeStore.isLocked}<Lock size={26} />{:else}<LockOpen size={26} />{/if}
					</button>
				</div>
			</div>

			<div class="stage" bind:this={stageEl}>
				{#if isScale}
					<!-- Key mode: root notes then scale names -->
					<div class="layer scale">
						{#if detected}
							<!-- ADR-446: what the surface heard. The tooltip is the audit
							     trail — every vote that decided it, one per line. -->
							<div class="scale-section detected-section" title={detectedTitle}>
								<button
									class="scale-heading reasons-toggle"
									onclick={() => (showReasons = !showReasons)}
									aria-expanded={showReasons}
									aria-label="Detected key; tap to show why"
								>
									Detected {showReasons ? '▾' : '▸'}
								</button>
								<div class="detected-row">
									{#if detected.band === 'no-key'}
										<span class="detected-key none">No key</span>
										<span class="detected-band">{detected.reasons.split(' | ').pop()}</span>
									{:else}
										<span class="detected-key">{ROOT_NOTES[detected.root]} {detected.scale}</span>
										<span class="detected-band {detected.band}">{detected.band}{detectedIsCurrent ? ' · set' : ''}</span>
										{#if detected.runnerRoot >= 0}
											<button class="runner-up" onclick={applyRunnerUp}>
												or {ROOT_NOTES[detected.runnerRoot]} {detected.runnerScale}
											</button>
										{/if}
									{/if}
								</div>
								{#if showReasons}
									<ul class="reasons">
										<!-- Keyed by position: two clips can say the same line, and the list is
										     replaced whole on every answer. -->
										{#each detected.reasons.split(' | ') as line, i (i)}
											<li>{line}</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
						<div class="scale-section roots-section">
							<div class="scale-heading">Root</div>
							<div class="roots">
								{#each ROOT_NOTES as note, i}
									<button
										class="root-key"
										class:selected={session.rootNote === i}
										onclick={() => selectRootNote(i)}
									>{note}</button>
								{/each}
							</div>
						</div>
						<div class="scale-section scales-section">
							<div class="scale-heading">Scale</div>
							<div class="scale-grid">
								{#each SCALE_NAMES as name}
									<button
										class="scale-key"
										class:selected={session.scaleName === getScaleIndex(name)}
										onclick={() => selectScaleName(name)}
									>{name}</button>
								{/each}
							</div>
						</div>
					</div>
				{:else if !selectedVendorId}
					<!-- No category chosen yet: prompt (rail is how you pick) -->
					<div class="layer prompt">
						<span>Pick a category from the rail to start browsing.</span>
					</div>
				{:else if screen === 'folders'}
					<!-- Folder tiles — adaptive grid -->
					<div class="layer">
						<div
							class="adaptive-grid"
							class:scrolls={gridLayout.scrolls}
							style="--cols: {gridLayout.columns}; --tile-h: {gridLayout.tileHeight}px;"
						>
							{#each folders as name (name)}
								{@render folderTile(name)}
							{/each}
						</div>
						{#if !loading && folders.length === 0}
							<div class="empty">Nothing here.</div>
						{/if}
					</div>
				{:else if screen === 'mixed'}
					<!-- A level holding folders AND presets of its own: the folders
					     first, then the presets under one header, on one ruler in one
					     scroller — the grouped screen's machinery, with the folder
					     block as its headerless first section. -->
					<div
						class="layer grouped-layer"
						style="--header-h: {SECTION_HEADER_H}px; --section-gap: {SECTION_GAP}px;"
					>
						{#key `${selectedVendor}:${currentPath.join('/')}`}
						<div class="grouped-scroll" bind:this={groupedScrollEl} onscroll={scheduleWindowUpdate}>
							{#if groupedWindow.topPad > 0}
								<div class="window-spacer" style="height: {groupedWindow.topPad}px"></div>
							{/if}
							{#each groupedWindow.sections as sw (sw.section)}
								<section class="preset-section" class:loose={sw.section === 0}>
									{#if sw.section === 1}
										{@render sectionHead(HERE_KEY, presets, paneAmongSamples ? 'Samples' : 'Presets')}
									{/if}
									<div
										class="adaptive-grid sectioned"
										style="--cols: {gridLayout.columns}; --tile-h: {gridLayout.tileHeight}px; padding-top: {sw.topPad}px; padding-bottom: {sw.bottomPad}px;"
									>
										{#if sw.section === 0}
											{#each folders.slice(sw.start, sw.end) as name (name)}
												{@render folderTile(name)}
											{/each}
										{:else}
											{#each presets.slice(sw.start, sw.end) as p (p.path)}
												{@render presetTile(p)}
											{/each}
										{/if}
									</div>
								</section>
							{/each}
							{#if groupedWindow.bottomPad > 0}
								<div class="window-spacer" style="height: {groupedWindow.bottomPad}px"></div>
							{/if}
						</div>
						{/key}
					</div>
				{:else if useGroupedPresets}
					<!-- Flattened presets, re-grouped under their original folders
					     (recovered from each preset's path — see groupPresetsByOrigin).
					     One scroll surface; each section is a grid at EXACTLY the plain
					     grid's tile geometry, under a calm sticky folder header. -->
					<div
						class="layer grouped-layer"
						style="--header-h: {SECTION_HEADER_H}px; --section-gap: {SECTION_GAP}px;"
					>
						<!-- Keyed on the navigated location so a fresh folder always opens
						     scrolled to the top (the DOM — and its scrollTop — is rebuilt). -->
						{#key `${selectedVendor}:${currentPath.join('/')}`}
						<div class="grouped-scroll" bind:this={groupedScrollEl} onscroll={scheduleWindowUpdate}>
							<!-- ADR-404 row windowing: sections/rows outside the viewport
							     collapse into spacers + grid padding, scroll geometry stays
							     pixel-identical to the full render. The bottom spacer only
							     renders when sections are actually skipped below, so the
							     final section's :last-child margin reset still applies when
							     it IS the last child. -->
							{#if groupedWindow.topPad > 0}
								<div class="window-spacer" style="height: {groupedWindow.topPad}px"></div>
							{/if}
							{#each windowedGroups as { sw, band } (band.groups.map((g) => g.folder ?? '·').join('|'))}
								{#if band.kind === 'full'}
									{@const group = band.groups[0]}
									<!-- Big section: its own full-width row, windowed as before. -->
									<section class="preset-section" class:loose={group.folder === null}>
										{#if group.folder !== null}
											{@render sectionHead(group.folder, group.presets)}
										{/if}
										<div
											class="adaptive-grid sectioned"
											style="--cols: {gridLayout.columns}; --tile-h: {gridLayout.tileHeight}px; padding-top: {sw.topPad}px; padding-bottom: {sw.bottomPad}px;"
										>
											{#each group.presets.slice(sw.start, sw.end) as p (p.path)}
												{@render presetTile(p)}
											{/each}
										</div>
									</section>
								{:else}
									<!-- Packed band: small sections share one tile row, side by
									     side, each keeping its own header. Tiles stay the SAME
									     size (fixed --tile-w px columns); the band is one tile row
									     tall so it renders whole (no per-row windowing needed). -->
									<section
										class="preset-section band-row"
										style="--tile-h: {gridLayout.tileHeight}px; --tile-w: {gridLayout.tileWidth}px;"
									>
										{#each band.groups as group (group.folder ?? '·')}
											<div
												class="band-cell"
												class:loose={group.folder === null}
												style="--n: {group.presets.length};"
											>
												{#if group.folder !== null}
													{@render sectionHead(group.folder, group.presets)}
												{/if}
												<div class="adaptive-grid sectioned packed">
													{#each group.presets as p (p.path)}
														{@render presetTile(p)}
													{/each}
												</div>
											</div>
										{/each}
									</section>
								{/if}
							{/each}
							{#if groupedWindow.bottomPad > 0}
								<div class="window-spacer" style="height: {groupedWindow.bottomPad}px"></div>
							{/if}
						</div>
						{/key}
					</div>
				{:else}
					<!-- Preset tiles — same adaptive grid -->
					<div class="layer">
						{#if !loading && presets.length === 0}
							<div class="empty">No presets in this folder.</div>
						{:else}
							<!-- ADR-404 row windowing: only the viewport's rows (± overscan)
							     render; the inline padding stands in for the skipped rows.
							     The pads live on an inner, height-auto grid INSIDE the
							     scroller — padding on the height-constrained scroller itself
							     would grow its border-box instead of creating scroll room
							     (same scroller-outside/pads-inside shape as .grouped-scroll).
							     Keyed like the grouped scroller so a fresh folder always opens
							     at the top — an in-place leaf→leaf swap would otherwise keep
							     the old (clamped) scrollTop. Simpler↔Audio keeps its place:
							     that switch changes neither vendor nor path (PR #457 review). -->
							{#key `${selectedVendor}:${currentPath.join('/')}`}
							<div class="preset-scroll" bind:this={presetGridEl} onscroll={scheduleWindowUpdate}>
								<div
									class="adaptive-grid windowed"
									style="--cols: {gridLayout.columns}; --tile-h: {gridLayout.tileHeight}px; padding-top: {presetWindow.topPad}px; padding-bottom: {presetWindow.bottomPad}px;"
								>
									{#each windowedPresets as p (p.path)}
										{@render presetTile(p)}
									{/each}
								</div>
							</div>
							{/key}
						{/if}
					</div>
				{/if}

				{#if loading}
					<div class="loading-bar" aria-hidden="true"></div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.drill-browser {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: row;
		color: var(--foreground, #eef0f4);
	}
	/* Kill the ~300ms iPad Safari tap delay (double-tap-zoom detection) on every
	   interactive element, so opening/drilling feels instant to the touch. */
	.drill-browser button { touch-action: manipulation; }

	/* Expanded: fill the viewport exactly (inset: 0), then honor the SAME insets
	   the main layout uses as PADDING *inside* the box — safe-area top, 16px
	   sides, 0 bottom. Doing it as padding (not offset + bottom:0) keeps the box
	   within the viewport so the rail never hangs off the bottom edge on iPad,
	   where env(safe-area-inset-top) is non-zero. */
	.drill-browser.expanded {
		position: fixed;
		inset: 0;
		padding: env(safe-area-inset-top) 16px 0 16px;
		z-index: 1000;
		box-sizing: border-box;
		background: var(--browser-bg-primary, #16181d);
		overflow: hidden;
	}
	/* Inner surface (rail + pane) carries the card border/radius so the padded
	   safe-area gutter stays transparent, matching the main layout. */
	.drill-browser.expanded .vendor-buttons,
	.drill-browser.expanded .pane {
		min-height: 0;
	}

	/* ── Persistent category rail (ported verbatim from VendorButtonGrid) ── */
	.vendor-buttons {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
		gap: var(--spacing-lg); /* Same gap as main content rows */
		padding: 0;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}
	.vendor-buttons::-webkit-scrollbar { display: none; }
	/* When open, the rail keeps EXACTLY the closed --sidebar-width so buttons
	   don't visibly shrink on open. The divider + gap live on the pane instead,
	   not as rail padding (which would eat into the button width). */
	.drill-browser.expanded .vendor-buttons {
		width: var(--sidebar-width, 120px);
	}

	/* Button group — each group aligns with a main content row */
	.button-group {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		flex: 1;
		min-height: 0;
	}
	.button-group .selection-button {
		flex: 1;
		min-height: 0;
	}
	/* The Places rail's floor for touch (browser-places plan §2): buttons share
	   their band's height down to the touch floor and no further; past it the
	   band scrolls. Only a rail of many Places ever reaches it — at today's
	   eight buttons neither rule changes a pixel. */
	.vendor-buttons.places-rail .button-group {
		overflow-y: auto;
		scrollbar-width: none;
	}
	.vendor-buttons.places-rail .button-group::-webkit-scrollbar {
		display: none;
	}
	.vendor-buttons.places-rail .button-group .selection-button {
		min-height: var(--height-touch, 44px);
	}

	/* Category slab: transparent/near-black fill, colored ink hairline + colored
	   name (the identity is carried by the outline + text, not a fill wash).
	   NO blur, NO drop-shadow. */
	.selection-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		/* Small floor only — height comes from `flex: 1` inside each group so the
		   rail always fits its container (no viewport-coupled 10dvh that could
		   overflow a shorter, safe-area-padded box). */
		min-height: 36px;
		padding: var(--spacing-sm) var(--spacing-xs);
		background: transparent;
		border: 1px solid color-mix(in oklab, var(--category-color, var(--line)) 55%, transparent);
		border-radius: var(--radius-md);
		color: var(--browser-text-primary);
		text-align: center;
		font-size: var(--text-xl);
		font-weight: var(--font-weight-semibold);
		letter-spacing: -0.01em;
		transition: background-color var(--t-fast) var(--ease-precise),
			border-color var(--t-fast) var(--ease-precise),
			box-shadow var(--t-fast) var(--ease-precise);
		cursor: pointer;
		line-height: 1.2;
		word-break: break-word;
		hyphens: auto;
		overflow: hidden;
	}
	.category-button {
		justify-content: center;
		position: relative;
		overflow: hidden;
	}
	.category-name {
		color: var(--category-color, var(--foreground));
		z-index: 1;
		/* Sized to fit the longest single-word label ("Recent") on one line at
		   the 120px rail width — avoids the mid-word wrap. */
		font-size: var(--text-2xl);
		font-weight: var(--font-weight-bold);
		text-transform: uppercase;
		letter-spacing: 0.02em;
		pointer-events: none;
	}
	.selection-button:hover { border-color: var(--category-color); }
	/* Selected = 2px vendor-ink outline + ring + glow over a near-transparent
	   fill (identity stays in the outline, not a color wash). */
	.selection-button.selected {
		background: color-mix(in oklab, var(--category-color) 8%, transparent);
		border-width: 2px;
		border-color: var(--category-color);
		box-shadow: 0 0 0 1px var(--category-color),
			0 0 12px color-mix(in oklab, var(--category-color) 50%, transparent);
		font-weight: var(--font-weight-bold);
	}
	.selection-button.selected .category-name {
		color: color-mix(in oklab, var(--category-color) 75%, white);
		font-weight: var(--font-weight-bold);
	}
	/* One full share of the group, as it was before the section switches
	   briefly took half of it. */
	.record-button-container {
		flex: 1 1 0;
		min-height: 0;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.selection-button.placeholder {
		opacity: 0.3;
		pointer-events: none;
	}

	/* Big red X that replaces the Record button while the browser is open — the
	   one-tap close, in the top rail slot. No circle/border: just the glyph. */
	.close-x {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: #ff3b30;
		cursor: pointer;
		touch-action: manipulation;
		transition: color 0.12s, transform 0.1s;
	}
	.close-x:hover { color: #ff5b52; }
	.close-x:active { transform: scale(0.9); }

	/* ── Right pane ───────────────────────────────────────────── */
	.pane {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		/* Gap + divider between the fixed-width rail and the content pane, kept
		   off the rail so rail buttons stay the full --sidebar-width. The air
		   INSIDE the divider is the stage's own --grid-pad and nothing else:
		   a padding-left here stacked on top of it, putting the grid 32px off
		   the divider while its right edge kept only 16, so the whole grid sat
		   visibly right of centre inside its own box. */
		margin-left: var(--spacing-lg);
		border-left: 1px solid var(--line);
	}

	/* Top bar */
	.bar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		/* 12px above and below the 56px control row — the same 81px bar the
		   old 48px lock made with 16px, so the stage keeps its height. */
		padding: var(--spacing-md) var(--spacing-lg);
		border-bottom: 1px solid var(--browser-border, #2a2e37);
		background: var(--browser-bg-secondary, #1d2027);
	}
	/* The browse switch (or a replace pill) and the lock take the bar's right
	   half, on four equal cells: three for the switch's segments, one for the
	   lock. The lock is pinned to its column, so it holds its place when
	   nothing fills the first three (Recent, Key). The breadcrumb gets the
	   left half and clips as it always has. */
	.bar-controls {
		flex: 0 0 50%;
		height: var(--height-comfortable);
		display: grid;
		grid-template-columns: 3fr 1fr;
		gap: var(--spacing-sm);
	}
	.icon-btn {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		border-radius: 12px;
		border: 1px solid var(--browser-border, #2a2e37);
		background: var(--browser-bg-primary, #16181d);
		color: var(--foreground, #eef0f4);
		cursor: pointer;
	}
	.icon-btn:active { transform: scale(0.94); }
	.icon-btn.lock { grid-column: 2; }
	.icon-btn.lock.on {
		background: var(--accent);
		border-color: var(--accent);
		color: #0c0d10;
	}

	/* Segmented switch — the top-bar three-way browse switch (Instrument | Simpler | Clip; ids midi | simpler | audio). */
	.seg-switch {
		grid-column: 1;
		display: flex;
		border: 1px solid var(--browser-border, #2a2e37);
		border-radius: 12px;
		overflow: hidden;
		background: var(--browser-bg-primary, #16181d);
	}
	.seg-switch .seg {
		flex: 1 1 0;
		min-width: 0;
		border: none;
		background: none;
		color: var(--muted-foreground, #9aa1ad);
		font-size: var(--text-lg);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0 var(--spacing-sm);
		cursor: pointer;
	}
	.seg-switch .seg:active { transform: scale(0.96); }
	.seg-switch .seg.on {
		background: var(--accent);
		color: #0c0d10;
	}
	.seg-switch .seg:disabled {
		opacity: 0.35;
		cursor: default;
	}
	/* Replace-clip status pill (shown in place of the browse switch). */
	.replace-pill {
		grid-column: 1;
		display: grid;
		place-items: center;
		padding: 0 var(--spacing-lg);
		border-radius: 12px;
		background: var(--accent);
		color: #0c0d10;
		font-size: var(--text-lg);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.crumbs {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		overflow: hidden;
	}
	.crumb {
		flex: 0 0 auto;
		border: none;
		background: none;
		color: var(--muted-foreground, #8a8f9c);
		font-size: 16px;
		font-weight: 550;
		padding: var(--spacing-xs);
		white-space: nowrap;
		cursor: pointer;
	}
	.crumb.root { color: var(--accent); font-weight: 700; }
	.crumb.here { color: var(--foreground, #eef0f4); }
	.crumb:active { color: var(--foreground, #eef0f4); }
	.sep { color: var(--browser-border, #4b5563); font-size: 14px; }

	/* ── Stage + layers ───────────────────────────────────────── */
	.stage { flex: 1 1 auto; position: relative; overflow: hidden; }
	.layer {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		/* --grid-pad is set from GRID_PADDING on the component root — the ADR-404
		   window math derives the scroll viewport from it, so JS and CSS can't
		   drift (same pattern as --header-h / --section-gap). */
		padding: var(--grid-pad, 16px);
		/* No enter animation — the browser and each layer appear instantly. */
	}

	/* ── Adaptive tile grid (shared by folders + presets) ─────────
	   Column count + tile height come from computeGridLayout (JS), passed in as
	   --cols / --tile-h. When the content fits, tiles fill the stage; when there
	   are too many, `.scrolls` lets the grid scroll at the computed tile height. */
	.adaptive-grid {
		display: grid;
		grid-template-columns: repeat(var(--cols, 3), 1fr);
		grid-auto-rows: var(--tile-h, 160px);
		gap: var(--grid-gap, 8px);
		align-content: start;
		height: 100%;
		min-height: 0;
		scrollbar-width: none;
	}
	.adaptive-grid.scrolls { overflow-y: auto; }
	.adaptive-grid::-webkit-scrollbar { display: none; }

	/* ── Windowed preset scroller (ADR-404) ─────────────────────────
	   The preset grid's scroll container. The grid inside is height:auto and
	   carries the window pads — pads must NOT sit on the height-constrained
	   scroller (border-box would floor its height at the padding total instead
	   of creating scroll room). Folder grids keep the plain .scrolls path. */
	.preset-scroll {
		height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
		/* The window's padding swaps mid-scroll; browser scroll anchoring would
		   "correct" scrollTop against those swaps and fight the windowing. */
		overflow-anchor: none;
	}
	.preset-scroll::-webkit-scrollbar { display: none; }
	.adaptive-grid.windowed { height: auto; }

	/* ── Grouped preset sections (recovered origin folders) ────────────
	   One scroll surface for the whole screen; each section is a grid at the
	   SAME --cols/--tile-h as the plain grid (geometry from
	   computeGroupedGridLayout), so tiles are indistinguishable from the plain
	   view — just organized. The layer's own padding moves inside the scroller
	   so sticky headers can pin flush to the stage top. */
	.grouped-layer {
		padding: 0;
		overflow: hidden;
	}
	.grouped-scroll {
		height: 100%;
		overflow-y: auto;
		padding: 0 var(--grid-pad, 16px) var(--grid-pad, 16px);
		scrollbar-width: none;
		overflow-anchor: none; /* see .preset-scroll */
	}
	.grouped-scroll::-webkit-scrollbar { display: none; }
	/* .window-spacer (ADR-404, whole off-window sections) is sized entirely by
	   its inline height — no rule needed. */
	.preset-section { margin-bottom: var(--section-gap, 16px); }
	.preset-section:last-child { margin-bottom: 0; }
	/* Sections size to their own rows; the scroller scrolls, not the grid. */
	.adaptive-grid.sectioned { height: auto; }
	/* The loose bucket (headerless, always leading when present) starts at the
	   grid padding. Scoped by class, not :first-child — a named section that
	   happens to render first must sit flush under its header like every other
	   named section (review finding on PR #456). */
	.preset-section.loose > .adaptive-grid.sectioned { padding-top: var(--grid-pad, 16px); }

	/* ── Packed band (ADR-403 revised) ──────────────────────────────
	   Several small sections share one tile row. The band is a flex row of
	   cells; each cell is a section (its header + a mini-grid sized to its own
	   tiles at the EXACT shared tile width). align-items:start so a headerless
	   cell (the loose bucket) still lines its tiles up with headed cells — a
	   fixed header band keeps row 0 at the same y across cells. */
	.band-row {
		display: flex;
		flex-wrap: nowrap;
		align-items: flex-start;
		/* Gap between packed cells MUST equal the tile gap, not the larger
		   section gap — so every tile across every row lands on the same column
		   pitch and columns line up between a full row and the packed rows
		   below. Same --grid-gap the tiles use, so it cannot fall out of step. */
		gap: var(--grid-gap, 8px);
	}
	.band-cell {
		flex: 0 0 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	/* Packed cell grids size to their content: fixed-width columns (the shared
	   tile width) rather than 1fr, so the cell is exactly as wide as its tiles
	   and the band packs left-to-right. One row tall by construction. */
	.adaptive-grid.sectioned.packed {
		grid-template-columns: repeat(var(--n, 1), var(--tile-w, 150px));
		grid-auto-rows: var(--tile-h, 160px);
		width: max-content;
	}
	/* Reserve the header band even on the headerless (loose) cell so every cell's
	   first tile row sits at the same height across the band. */
	.band-cell.loose > .adaptive-grid.sectioned.packed { margin-top: var(--header-h, 44px); }

	/* Packed-cell headers: a packed cell is only as wide as its tiles (often one
	   tile), too narrow for longer folder names. Let the name WRAP (up to 2 lines)
	   instead of truncating; the header grows to fit and the tile grid follows. The
	   full-width (non-packed) header keeps its single-line + hairline treatment. */
	.band-cell > .section-head {
		/* Not sticky inside a short one-row band — but still positioned, so a
		   hold's fill anchors to the header rather than escaping to the band. */
		position: relative;
		height: auto;
		min-height: var(--header-h, 44px);
		align-items: flex-end; /* label sits on the header's baseline row */
		padding-bottom: 4px;
	}
	.band-cell .section-name {
		white-space: normal;
		overflow: visible;
		text-overflow: clip;
		max-width: none;
		display: -webkit-box;
		-webkit-line-clamp: 2;  /* cap at two lines, then ellipsize */
		line-clamp: 2;
		-webkit-box-orient: vertical;
		line-height: 1.15;
	}
	.band-cell .section-rule { display: none; } /* no cross-carry rule in a narrow cell */

	/* Folder header: calm, native-feeling section label — quiet ink + count +
	   a hairline that carries the eye across, pinned while its section scrolls.
	   Fully opaque so tiles pass cleanly underneath; no color wash (the tiles
	   carry the color, the header just names the place). */
	.section-head {
		position: sticky;
		top: 0;
		z-index: 2;
		height: var(--header-h, 44px);
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin: 0;
		padding: var(--spacing-xs) 2px 0;
		background: var(--browser-bg-primary, #16181d);
	}
	.section-name {
		flex: 0 0 auto;
		font-size: 15px;
		font-weight: 700;
		letter-spacing: 0.01em;
		color: color-mix(in oklab, var(--foreground, #eef0f4) 88%, transparent);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 70%;
	}
	.section-count {
		flex: 0 0 auto;
		font-size: 12px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground, #8a8f9c);
	}
	.section-rule {
		flex: 1 1 auto;
		height: 1px;
		background: var(--line, #2a2e37);
		opacity: 0.7;
	}

	/* HOLD → a random preset from the section (`sectionPress`): the folder
	   tile's rising fill, climbing the header behind its labels over exactly
	   HOLD_TO_RANDOM_MS. The header is already a positioned box (sticky, or
	   relative in a packed cell), so the fill anchors to it. */
	.section-head .hold-fill {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 0%;
		z-index: 0;
		pointer-events: none;
		background: color-mix(in oklab, var(--k) 55%, transparent);
		animation: folderHoldProgress linear forwards;
	}
	.section-head > :not(.hold-fill) {
		position: relative;
		z-index: 1;
	}
	/* REVEAL — the header takes the preset grammar for the reveal window, its
	   label the preset that loaded. The hairline would read as a strike-through
	   on the filled band, so it steps aside with the count. */
	.section-head.picked .hold-fill {
		background: color-mix(in oklab, var(--k) 55%, var(--browser-bg-secondary, #1d2027));
	}
	.section-head.picked .section-name {
		color: color-mix(in oklab, var(--k) 12%, white);
	}
	.section-head.picked .section-rule {
		visibility: hidden;
	}

	/* Tile / card — two distinct treatments so folders vs presets read at a glance:
	     • FOLDER = a container you drill into. Styled exactly like the rail category
	       slabs: transparent fill, colored hairline outline, colored ink label. The
	       color codes the folder without a fill wash — "keep going" affordance.
	     • PRESET = a thing you load. Filled solid with its color so it reads as the
	       terminal, tappable object, with a contrast-safe label.
	   Both share the base box (size, radius, centering, container-query label). */
	.card {
		container-type: size;
		position: relative;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--spacing-lg);
		border-radius: 16px;
		cursor: pointer;
		text-align: center;
		overflow: hidden;
		transition: background-color 0.12s, border-color 0.12s, box-shadow 0.12s;
	}
	.card:active {
		transform: scale(0.98);
		box-shadow: 0 0 0 1px var(--k), 0 0 16px color-mix(in oklab, var(--k) 45%, transparent);
	}

	/* FOLDER — mirror of the rail category slab (transparent + colored outline/ink) */
	.folder-tile {
		background: transparent;
		border: 1px solid color-mix(in oklab, var(--k) 55%, transparent);
		color: var(--k);
	}
	.folder-tile:hover { border-color: var(--k); }

	/* CHARGE — a rising fill, exactly ClipCentralView's hold-gate idiom, now that
	   the window (500ms) is long enough to read as a bar rather than a flicker.
	   It grows bottom-to-top over the hold window (duration bound inline from
	   HOLD_TO_RANDOM_MS) and lands full on the fire, so the motion cannot drift
	   from the timer that ends it. `forwards` holds the
	   filled look through the async pick until `.picked` takes over.

	   The tile keeps a thin ring alongside it — the fill says HOW FAR, the ring
	   says WHICH TILE, which still matters when a finger has drifted off the one
	   it started on. `.card` is already `position: relative; overflow: hidden`,
	   so the fill clips to the tile's radius without further scaffolding. */
	.folder-tile.charging {
		border-color: var(--k);
	}
	.folder-tile .hold-fill {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 0%;
		z-index: 0;
		pointer-events: none;
		background: color-mix(in oklab, var(--k) 55%, transparent);
		animation: folderHoldProgress linear forwards;
	}
	@keyframes folderHoldProgress {
		from { height: 0%; }
		to   { height: 100%; }
	}
	/* The label rides above the rising fill rather than being swallowed by it. */
	.folder-tile .tile-name {
		position: relative;
		z-index: 1;
	}

	/* SNAP + REVEAL — the tile flips to the preset grammar (solid fill, light
	   ink) and its label becomes the preset that loaded. The snap is a glow
	   decay only: animating transform here would fight `.card:active`'s scale
	   for the rest of the hold, and the finger is usually still down. */
	.folder-tile.picked {
		background: color-mix(in oklab, var(--k) 55%, var(--browser-bg-secondary, #1d2027));
		border-color: var(--k);
		color: color-mix(in oklab, var(--k) 12%, white);
		animation: folderSnap 200ms ease-out forwards;
	}
	@keyframes folderSnap {
		from {
			box-shadow: 0 0 0 3px var(--k),
				0 0 34px color-mix(in oklab, var(--k) 85%, transparent);
		}
		to {
			box-shadow: 0 0 0 1px var(--k),
				0 0 14px color-mix(in oklab, var(--k) 40%, transparent);
		}
	}

	/* Reduced motion keeps the mark, drops the ramp — same bargain the loading
	   bar and the session grid strike. */
	@media (prefers-reduced-motion: reduce) {
		/* Keep the mark, drop the ramp: the tile reads as held without a bar
		   travelling up it. */
		.folder-tile .hold-fill,
		.section-head .hold-fill {
			animation: none;
			height: 100%;
			background: color-mix(in oklab, var(--k) 30%, transparent);
		}
		.folder-tile.picked { animation: none; }
	}

	/* PRESET — solid ~55% color fill; label picks the contrasting end so it stays
	   legible against the fill. */
	.preset-tile {
		background: color-mix(in oklab, var(--k) 55%, var(--browser-bg-secondary, #1d2027));
		border: 2px solid var(--k);
		color: color-mix(in oklab, var(--k) 12%, white);
		/* Denser than the folder slabs (see PRESET_COMFORT): the tiles are small
		   enough that 14px of padding would eat a whole line of the name. */
		padding: var(--spacing-sm);
	}
	/* A mixed level's folders sit on the preset ruler, at preset size — so they
	   take the preset tile's padding too, or a long name loses a line to it. */
	.adaptive-grid.sectioned .folder-tile { padding: var(--spacing-sm); }
	.preset-tile:hover { background: color-mix(in oklab, var(--k) 68%, var(--browser-bg-secondary, #1d2027)); }
	.preset-tile.loaded {
		box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--k) 30%, white),
			0 0 16px color-mix(in oklab, var(--k) 65%, transparent);
	}
	/* ADR-401: the waveform thumbnail (BrowserPresetWaveform) sits at z-index:0
	   behind the tile content; lift the labels above it. */
	.preset-tile .tile-name,
	.preset-tile .tile-plugin {
		position: relative;
		z-index: 1;
	}
	/* A plug-in preset names its plug-in under its own name (browser-places
	   plan §2), small and quiet: the name is what you are choosing between.
	   Only those tiles stack name over label — a tile is a centred flex ROW,
	   and every other tile keeps it. */
	.preset-tile.has-plugin {
		flex-direction: column;
	}
	.preset-tile .tile-plugin {
		display: block;
		margin-top: 2px;
		font-size: 0.72rem;
		font-weight: 500;
		opacity: 0.75;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	/* Greyed, not hidden: a plug-in that is not installed, or an effect preset
	   (which never loads as an instrument). Visible, saying why in its title,
	   and dead to a tap — it is disabled. */
	.preset-tile.unavailable {
		filter: grayscale(1);
		opacity: 0.4;
		cursor: default;
	}

	.tile-name {
		font-weight: 700;
		line-height: 1.12;
		letter-spacing: -0.01em;
		text-wrap: balance;
		/* Scales with the tile: cqw = 1% of the tile's width. The floor is sized to
		   the densest preset tile (PRESET_COMFORT) so names shrink with the grid
		   instead of overflowing it; the cap keeps big folder tiles from getting
		   oversized. */
		font-size: clamp(max(var(--type-min), calc(14.72 * var(--fluid-px))), 15cqw, 2.6rem);
	}
	.folder-tile .tile-name { font-weight: 800; letter-spacing: -0.02em; }

	/* Scale grid keeps a simple responsive auto-fill (fixed 32-item list). */
	.scale-grid {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		grid-auto-rows: minmax(96px, 1fr);
		gap: var(--grid-gap, 8px);
		align-content: start;
		scrollbar-width: none;
	}
	.scale-grid::-webkit-scrollbar { display: none; }

	/* Scale mode: root grid on top, scale grid fills the rest */
	.scale { display: flex; flex-direction: column; gap: var(--spacing-lg); }
	.scales-section { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
	.scale-heading { font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-foreground, #8a8f9c); font-weight: 650; margin-bottom: var(--spacing-sm); }
	/* Roots in two rows of six (matches the request; also gives bigger tap targets
	   than the old single row of twelve). */
	.roots { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--spacing-sm); }

	/* ADR-446: the Detect button sits where the browse switch would (column 1
	   of the bar controls) — in Key mode that column is otherwise empty. */
	.key-controls {
		grid-column: 1;
		justify-self: start;
		height: 100%;
		display: flex;
		gap: var(--spacing-sm);
	}
	.follow-btn,
	.detect-btn {
		height: 100%;
		padding: 0 var(--spacing-lg);
		border-radius: 12px;
		border: 1px solid var(--browser-border, #2a2e37);
		background: var(--browser-bg-primary, #16181d);
		color: var(--foreground, #eef0f4);
		font-size: var(--text-lg);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		cursor: pointer;
	}
	.follow-btn:active,
	.detect-btn:active { transform: scale(0.96); }
	.follow-btn.on { background: var(--accent); border-color: var(--accent); color: #0c0d10; }
	.reasons-toggle { background: none; border: 0; padding: 0; text-align: left; cursor: pointer; }
	.reasons { margin: var(--spacing-sm) 0 0; padding-left: 1.2em; color: var(--muted-foreground, #8a8f9c); font-size: 14px; line-height: 1.5; }
	.detect-btn.pending { color: var(--accent); border-color: var(--accent); }
	.detected-row { display: flex; align-items: baseline; gap: var(--spacing-md); flex-wrap: wrap; }
	.detected-key { font-size: 24px; font-weight: var(--font-weight-semibold); color: var(--foreground, #eef0f4); }
	.detected-key.none { color: var(--muted-foreground, #8a8f9c); }
	.detected-band { font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted-foreground, #8a8f9c); }
	.detected-band.sure { color: var(--accent); }
	.detected-band.unsure { color: var(--destructive, #e5484d); }
	.runner-up {
		padding: 4px 12px;
		border-radius: 999px;
		border: 1px solid var(--browser-border, #2a2e37);
		background: transparent;
		color: var(--foreground, #eef0f4);
		font-size: 14px;
		cursor: pointer;
	}
	.runner-up:active { transform: scale(0.96); }

	/* Root notes and scale names share ONE key style so they read identically:
	   neutral dark chip when unselected, solid-orange accent chip when selected. */
	.root-key,
	.scale-key {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 64px;
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: 14px;
		border: 1px solid var(--browser-border, #2a2e37);
		background: var(--browser-bg-secondary, #1d2027);
		color: var(--foreground, #eef0f4);
		font-size: 22px;
		font-weight: 700;
		line-height: 1.15;
		text-wrap: balance;
		cursor: pointer;
		transition: background-color 0.12s, border-color 0.12s, box-shadow 0.12s, color 0.12s;
	}
	/* Scale names are longer than the single-glyph roots — a touch smaller so they
	   fit the chip without wrapping awkwardly. */
	.scale-key { font-size: 18px; }
	.root-key:active,
	.scale-key:active { transform: scale(0.96); }
	/* Selected — filled in the scale accent (orange) with a glow, so the current
	   root / scale reads at a glance. Identical for both. */
	.root-key.selected,
	.scale-key.selected {
		background: #ff9500;
		border-color: #ff9500;
		color: #1a1206;
		box-shadow: 0 0 0 1px #ff9500, 0 0 14px color-mix(in oklab, #ff9500 55%, transparent);
	}

	/* Prompt / empty / loading */
	.prompt {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		color: var(--muted-foreground, #5b606d);
		font-size: 18px;
		padding: var(--spacing-2xl);
	}
	.empty { padding: var(--spacing-2xl); text-align: center; color: var(--muted-foreground, #5b606d); font-size: 16px; }
	.loading-bar {
		position: absolute;
		left: 0;
		top: 0;
		height: 2px;
		width: 100%;
		background: linear-gradient(90deg, transparent, var(--accent), transparent);
		animation: sweep 1s linear infinite;
	}
	@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
	@media (prefers-reduced-motion: reduce) { .loading-bar { animation: none; opacity: 0.5; } }
	/* ---- Live skin: the rail reads like Live's browser sidebar — flat
	   SurfaceBackground rows, 1px dark border, light-grey normal-case
	   labels, the selected row in SelectionBackground with dark text.
	   The category colour survives as a 4px swatch on the leading edge
	   (Live's clip-colour chip idiom) instead of tinting the whole slab. */
	:global([data-grammar="flat"]) .selection-button {
		background: var(--card);
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		box-shadow: none;
		padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) calc(var(--spacing-sm) + 4px);
	}
	:global([data-grammar="flat"]) .category-button::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: var(--category-color, transparent);
		pointer-events: none;
	}
	:global([data-grammar="flat"]) .category-name {
		color: var(--foreground);
		/* 18px on the 120px rail; a narrower rail (a smaller screen) scales
		   it down so "Recent" still fits on one line. */
		font-size: min(var(--text-lg), calc(var(--sidebar-width) * 0.17));
		font-weight: var(--font-weight-medium);
		text-transform: none;
		letter-spacing: 0;
	}
	:global([data-grammar="flat"]) .selection-button:hover {
		border-color: var(--line-strong);
		background: var(--popover);
	}
	:global([data-grammar="flat"]) .selection-button.selected {
		background: var(--flat-selection);
		border: 1px solid var(--line-strong);
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .selection-button.selected .category-name {
		color: var(--flat-selection-fg);
		font-weight: var(--font-weight-medium);
	}
	/* Placeholder (no such category yet) = Live's disabled text on the same
	   field, not a 30% ghost. */
	:global([data-grammar="flat"]) .selection-button.placeholder {
		opacity: 1;
	}
	:global([data-grammar="flat"]) .selection-button.placeholder .category-name {
		color: var(--flat-disabled-fg);
	}

	/* ---- Live skin: the EXPANDED browser (bar, crumbs, tiles, sections,
	   scale picker). Same grammar as the rail above: flat SurfaceBackground
	   fields with 1px dark borders and 2px radii; no glow, wash, gradient
	   or tracking; ON = ChosenDefault orange with dark text; the picked
	   tile wears SelectionBackground; a folder's colour becomes a 4px
	   leading swatch (Live's clip-colour chip) and a preset's colour is a
	   solid clip fill with ClipText on it. Everything below is scoped to
	   the flat grammar — the GRATICULE render is untouched. */

	/* Close X: the rec red of the active palette (ChosenRecord), no
	   separate hover tint. */
	:global([data-grammar="flat"]) .close-x,
	:global([data-grammar="flat"]) .close-x:hover {
		color: var(--act-rec);
	}

	/* Top bar controls: lock + segmented browse switch + replace pill are
	   flat control fields; the ON fill keeps the vendor accent (--accent
	   is inlined per category) but carries ClipText, not the hard-coded
	   #0c0d10. */
	:global([data-grammar="flat"]) .icon-btn {
		border-radius: 2px;
		border-color: var(--line-strong);
		background: var(--surface-well);
		color: var(--foreground);
	}
	:global([data-grammar="flat"]) .icon-btn.lock.on {
		color: var(--flat-clip-text);
	}
	:global([data-grammar="flat"]) .seg-switch {
		border-radius: 2px;
		border-color: var(--line-strong);
		background: var(--surface-well);
	}
	:global([data-grammar="flat"]) .seg-switch .seg {
		color: var(--foreground);
		font-weight: var(--font-weight-medium);
		text-transform: none;
		letter-spacing: 0;
	}
	:global([data-grammar="flat"]) .seg-switch .seg.on {
		color: var(--flat-clip-text);
	}
	/* Wide segments on one flat field read as a single slab; the edge line
	   between them says where one choice ends. */
	:global([data-grammar="flat"]) .seg-switch .seg + .seg {
		border-left: 1px solid var(--line-strong);
	}
	/* Disabled segments: Live's disabled text on the same field, not a
	   35% ghost. */
	:global([data-grammar="flat"]) .seg-switch .seg:disabled {
		opacity: 1;
		color: var(--flat-disabled-fg);
	}
	:global([data-grammar="flat"]) .replace-pill {
		border-radius: 2px;
		color: var(--flat-clip-text);
		font-weight: var(--font-weight-medium);
		text-transform: none;
		letter-spacing: 0;
	}

	/* Breadcrumb: the root crumb keeps its emphasis at the flat grammar's
	   bold (600, from the token — never the 700 literal); the separator on
	   the visible grey ladder (the browser-border token is near-invisible on
	   Live's dark bar). */
	:global([data-grammar="flat"]) .crumb.root {
		font-weight: var(--font-weight-bold);
	}
	:global([data-grammar="flat"]) .sep {
		color: var(--fg-tertiary);
	}

	/* Section (column) heads: SurfaceHighlight band, plain foreground name,
	   regular weight, no tracking; the carry rule is a solid SurfaceArea
	   hairline. */
	:global([data-grammar="flat"]) .section-head {
		background: var(--secondary);
	}
	:global([data-grammar="flat"]) .section-name {
		color: var(--foreground);
		font-weight: var(--font-weight-medium);
		letter-spacing: 0;
	}
	:global([data-grammar="flat"]) .section-count {
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .section-rule {
		background: var(--line);
		opacity: 1;
	}
	/* The header's hold: the folder tile's opaque flat fill, mixed into the
	   header's own SurfaceHighlight band; the reveal lands on the flat PRESET
	   tile exactly — solid --k, ClipText label. */
	:global([data-grammar="flat"]) .section-head .hold-fill {
		background: color-mix(in oklab, var(--k) 70%, var(--secondary));
	}
	:global([data-grammar="flat"]) .section-head.picked .hold-fill {
		background: var(--k);
	}
	:global([data-grammar="flat"]) .section-head.picked .section-name {
		color: var(--flat-clip-text);
	}

	/* Tiles: square, no press glow (the scale press stays). */
	:global([data-grammar="flat"]) .card {
		border-radius: 2px;
	}
	:global([data-grammar="flat"]) .card:active {
		box-shadow: none;
	}
	:global([data-grammar="flat"]) .tile-name {
		font-weight: var(--font-weight-medium);
		letter-spacing: 0;
	}
	/* FOLDER — mirror of the flat rail slab: SurfaceBackground field, dark
	   1px frame, foreground label, the folder colour as a 4px leading
	   swatch (--k) instead of a coloured outline/ink. */
	:global([data-grammar="flat"]) .folder-tile {
		background: var(--card);
		border: 1px solid var(--line-strong);
		color: var(--foreground);
		padding-left: calc(var(--spacing-lg) + 4px); /* tile padding + the swatch */
	}
	:global([data-grammar="flat"]) .folder-tile::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: var(--k);
		pointer-events: none;
	}
	:global([data-grammar="flat"]) .folder-tile:hover {
		background: var(--secondary);
		border-color: var(--line-strong);
	}
	/* Flat's charge used to be a fake fill — the whole tile easing 35% toward its
	   colour, stopping short so it couldn't be mistaken for the picked state.
	   The real rising fill supersedes it: same reading, now with a height that
	   says how far along the hold is. Flat's fill is opaque rather than mixed,
	   matching how flat paints every other filled surface. */
	:global([data-grammar="flat"]) .folder-tile .hold-fill {
		background: color-mix(in oklab, var(--k) 70%, var(--card));
	}
	/* The pick lands on the flat PRESET tile exactly (solid --k, clip border and
	   ink) plus the `--flat-selection` inset that flat already uses to mark the
	   loaded preset — same grammar the reveal wears in GRATICULE, said in flat's
	   vocabulary rather than with a glow it doesn't own. */
	:global([data-grammar="flat"]) .folder-tile.picked {
		background: var(--k);
		border: 1px solid var(--flat-clip-border);
		color: var(--flat-clip-text);
		box-shadow: inset 0 0 0 2px var(--flat-selection);
		animation: none;
	}
	/* The 4px leading swatch is --k on a --k field once picked — drop it rather
	   than leave an invisible notch in the fill. */
	:global([data-grammar="flat"]) .folder-tile.picked::before {
		display: none;
	}
	:global([data-grammar="flat"]) .folder-tile .tile-name {
		font-weight: var(--font-weight-medium);
		letter-spacing: 0;
	}
	/* PRESET — a solid clip: full --k fill, ClipBorder frame, ClipText
	   label + badge (no 55% wash, no white-tinted label). The loaded tile
	   wears a crisp SelectionBackground ring, no glow. */
	:global([data-grammar="flat"]) .preset-tile,
	:global([data-grammar="flat"]) .preset-tile:hover {
		background: var(--k);
		border: 1px solid var(--flat-clip-border);
		color: var(--flat-clip-text);
	}
	:global([data-grammar="flat"]) .preset-tile.loaded {
		box-shadow: inset 0 0 0 2px var(--flat-selection);
	}
	/* A tile a tap cannot load (a plug-in not installed, an effect): Live's
	   disabled text on the well, as the flat switches do — not a ghost. */
	:global([data-grammar="flat"]) .preset-tile.unavailable,
	:global([data-grammar="flat"]) .preset-tile.unavailable:hover {
		filter: none;
		opacity: 1;
		background: var(--surface-well);
		border-color: var(--line-strong);
		color: var(--flat-disabled-fg);
	}
	/* Scale picker: control fields; the selected root / scale is the one
	   ON colour (ChosenDefault) with dark text — no orange literal, no
	   glow. Heading in normal case, no tracking. */
	:global([data-grammar="flat"]) .scale-heading {
		text-transform: none;
		letter-spacing: 0;
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .root-key,
	:global([data-grammar="flat"]) .scale-key {
		border-radius: 2px;
		border-color: var(--line-strong);
		background: var(--surface-well);
		color: var(--foreground);
		font-weight: var(--font-weight-medium);
	}
	:global([data-grammar="flat"]) .root-key.selected,
	:global([data-grammar="flat"]) .scale-key.selected {
		background: var(--phosphor);
		border-color: var(--phosphor);
		color: var(--flat-on-fg);
		box-shadow: none;
	}
	/* Light: the ON fill sits at ~1:1 luminance against the light ladder,
	   so the frame stays dark. */
	:global(.light[data-grammar="flat"]) .root-key.selected,
	:global(.light[data-grammar="flat"]) .scale-key.selected {
		border-color: var(--line-strong);
	}

	/* Loading sweep: a solid accent bar, no gradient. */
	:global([data-grammar="flat"]) .loading-bar {
		background: var(--accent);
	}
</style>
