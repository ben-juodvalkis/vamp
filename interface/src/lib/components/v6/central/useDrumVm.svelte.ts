/**
 * useDrumVm — one Drum Rack's virtual macros under the current pad scope
 * (issue #491 E0, 2026-09-10).
 *
 * The rule "this function's value and state, for the kit or for the held
 * pad" used to live twice: in the Drum Rack view (`fnValue` / `stateOf` /
 * `writeFn`) and in the FX grid's Pitch slider (`drumScope` /
 * `drumScopeValue` / `writeScoped`), and the pad-scoped effect tiles were
 * about to be the third copy. This is the one place it lives — the move
 * `useFxGridSlot` made for the effect views, applied to the kit.
 *
 * What it answers, all reactive getters or functions over `$derived`
 * state so a consumer's own `$derived` chains through:
 *
 * - `value(fn)` — the scoped pad's own value while a pad is held and its
 *   row has been read, the kit's otherwise (`undefined` before either).
 * - `state(fn)` / `macroState(name)` — `none` for a held pad with no
 *   member for the function (its row reads nil), the census's answer
 *   otherwise (`unknown` until it lands).
 * - `write(fn, value)` — refused while the census says the function is
 *   held everywhere or absent; then the held pads through
 *   `drumPadScope.writeScoped` (the scoped pad absolutely, the rest by
 *   delta), or the kit row when nothing is held.
 *
 * It also owns the property subscriptions a consumer needs, so a view
 * cannot read a row it never opened: the kit rows (every function, the
 * census, Live's selected pad), the rack-macro rows the census names,
 * and the **pad rows** — for Live's selected pad, every held pad and
 * every pad the caller says is on the grid (`padNotes`), for the
 * functions the caller draws (`functions`; the profile's by default).
 * Pre-subscribing the grid's pads is what gives a pressed tile its own
 * values the instant the finger lands rather than a beat later.
 *
 * `$effect`s are created here, so call it during component init, as
 * you would any rune helper.
 */

import { selectedTrackStore } from '$lib/stores/v6/selectedTrackStore.svelte';
import { drumPadScope } from '$lib/stores/v6/drumPadScope.svelte';
import {
	VM,
	VM_PROPERTIES,
	parseVmMembers,
	vmFunctionState,
	vmMacroState,
	vmStateAcceptsWrites,
	vmHeldBadge,
	vmMacroHeldBadge,
	vmMacroCoverageBadge,
	kitProfile,
	profileFunctions,
	vmPadProperty,
	vmMacroProperty,
	type KitProfile,
	type VmFunction,
	type VmMembers,
	type VmPad,
	type VmState
} from '$lib/services/drumVirtualMacros';

export interface DrumVmOptions {
	/**
	 * The kit rows to open — a subset of the fixed functions, for a
	 * consumer that draws one control (the FX grid's Pitch slider opens
	 * `pitch` alone). Defaults to every function. The census and Live's
	 * selected pad are always opened.
	 */
	kitFunctions?: readonly VmFunction[];
	/**
	 * The functions this consumer draws — the pad rows it needs. A fixed
	 * function name or `macro.<name>`. Defaults to the current profile's
	 * (`profileFunctions`).
	 */
	functions?: () => readonly string[];
	/** Pads on screen whose rows are worth having ready before a press (the grid's). */
	padNotes?: () => readonly number[];
}

export interface DrumVmHandle {
	readonly devicePath: string | undefined;
	/** The parsed `vm.members` census, or null before it lands. */
	readonly members: VmMembers | null;
	readonly profile: KitProfile;
	/** The pad racks' macro names in rack order (empty on any kit without nested racks). */
	readonly macroNames: string[];
	/** Live's selected pad (`vm.selectedPad`), or null. */
	readonly selectedNote: number | null;
	/** Every note the controls are scoped to, latch first then press order. */
	readonly heldNotes: number[];
	/** The scoped pad — the last one pressed, or the latch — or null. */
	readonly scopeNote: number | null;
	/** The scoped pad's census entry, or null. */
	readonly scopedPad: VmPad | null;
	/** One pad's raw row: a number, `null` for no member, `undefined` before the cold read. */
	padRaw(note: number, fn: string): number | null | undefined;
	/** What a control shows: the scoped pad's own value once read, else the kit's. */
	value(fn: string): number | undefined;
	state(fn: VmFunction): VmState;
	macroState(name: string): VmState;
	badge(...fns: VmFunction[]): string | null;
	macroBadge(...names: string[]): string | null;
	macroCoverage(...names: string[]): string | null;
	/** Write a fixed function: the held pads, or the kit. Refused when the state takes no writes. */
	write(fn: VmFunction, value: number): void;
	/** Write a rack macro by name (`t` in 0..1), same rule. */
	writeMacro(name: string, t: number): void;
}

function numberOrUndefined(raw: unknown): number | undefined {
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

export function useDrumVm(getDevicePath: () => string | undefined, options: DrumVmOptions = {}): DrumVmHandle {
	const devicePath = $derived(getDevicePath());

	const members = $derived(
		parseVmMembers(devicePath ? selectedTrackStore.propertyValue(devicePath, VM.members) : undefined)
	);
	const profile = $derived(kitProfile(members));
	const macroNames = $derived(members?.macros.map((m) => m.name) ?? []);

	const selectedNote = $derived.by(() => {
		if (!devicePath) return null;
		const raw = numberOrUndefined(selectedTrackStore.propertyValue(devicePath, VM.selectedPad));
		return raw === undefined ? null : Math.round(raw);
	});
	const heldNotes = $derived(devicePath ? drumPadScope.heldNotes(devicePath) : []);
	const scopeNote = $derived(devicePath ? drumPadScope.scopeNote(devicePath) : null);
	const scopedPad = $derived.by(() => {
		if (scopeNote === null) return null;
		return (members?.pads ?? []).find((p) => p.note === scopeNote) ?? null;
	});

	function kitValue(fn: string): number | undefined {
		if (!devicePath) return undefined;
		return numberOrUndefined(selectedTrackStore.propertyValue(devicePath, `vm.${fn}`));
	}

	function padRaw(note: number, fn: string): number | null | undefined {
		if (!devicePath) return undefined;
		return drumPadScope.padValue(devicePath, note, fn);
	}

	function value(fn: string): number | undefined {
		if (scopeNote !== null) {
			const v = padRaw(scopeNote, fn);
			if (typeof v === 'number') return v;
		}
		return kitValue(fn);
	}

	// A held pad with no member for the function (FX on a Simpler pad of a
	// mixed kit, a rack that lacks the macro) ghosts the control for as long
	// as it is held; the kit's own state applies otherwise.
	function state(fn: VmFunction): VmState {
		if (scopeNote !== null && padRaw(scopeNote, fn) === null) return 'none';
		return vmFunctionState(members, fn);
	}
	function macroState(name: string): VmState {
		if (scopeNote !== null && padRaw(scopeNote, `macro.${name}`) === null) return 'none';
		return vmMacroState(members, name);
	}

	// The kit when nothing is held; otherwise the held pads. The control's
	// number is the scoped pad's absolute value; the other held pads move
	// by the same delta from their own values, so their differences
	// survive (the kit's rule, applied to a hand-picked few). An enum lands
	// on every held pad as is. A write to a function that can move nothing
	// is dropped here: the surface would skip every member and still echo
	// the value, and a Trnsp that shows +12 while nothing moved is exactly
	// the failure Milestone 1b exists to remove.
	function writeRow(fn: string, value: number): void {
		if (!devicePath) return;
		if (!drumPadScope.writeScoped(devicePath, fn, value)) {
			selectedTrackStore.setPropertyValue(devicePath, `vm.${fn}`, value);
		}
	}
	function write(fn: VmFunction, value: number): void {
		if (!vmStateAcceptsWrites(state(fn))) return;
		writeRow(fn, value);
	}
	function writeMacro(name: string, t: number): void {
		if (!vmStateAcceptsWrites(macroState(name))) return;
		writeRow(`macro.${name}`, t);
	}

	// ---- subscriptions ------------------------------------------------------

	// The kit rows: every function, the census and Live's selected pad, for
	// as long as the consumer is mounted with a resolved devicePath. The
	// cleanup runs whenever the path changes — a kit swap in place briefly
	// drops the device record, so this re-runs against the new rack.
	$effect(() => {
		if (!devicePath) return;
		const path = devicePath;
		const rows = options.kitFunctions
			? [...options.kitFunctions.map((fn) => VM[fn]), VM.members, VM.selectedPad]
			: [...VM_PROPERTIES, VM.selectedPad];
		const release = rows.map((name) => selectedTrackStore.subscribeProperty(path, name));
		return () => release.forEach((fn) => fn());
	});

	// The rack-macro rows follow the census: open once a nested-rack kit's
	// names are known, closed when they change or the kit goes. Keyed on
	// the joined names so a re-emitted census with the same names (a held
	// count moving) does not churn them.
	const macroKey = $derived(macroNames.join('\u0000'));
	$effect(() => {
		if (!devicePath || !macroKey) return;
		const path = devicePath;
		const release = macroKey
			.split('\u0000')
			.map((name) => selectedTrackStore.subscribeProperty(path, vmMacroProperty(name)));
		return () => release.forEach((fn) => fn());
	});

	// The pad rows: Live's selected pad (so a hold has its values the
	// instant the finger lands), every held pad, and every pad the caller
	// has on screen, for the functions it draws. Keyed on the notes and
	// names so a re-emitted census does not churn them; a hold or release
	// does re-open them, which is the cost of keeping selection in the UI.
	const padRowKey = $derived.by(() => {
		const notes = [...new Set([selectedNote, ...heldNotes, ...(options.padNotes?.() ?? [])])]
			.filter((n): n is number => n !== null)
			.sort((a, b) => a - b);
		if (!notes.length) return '';
		const fns = options.functions?.() ?? profileFunctions(profile, macroNames);
		if (!fns.length) return '';
		return `${notes.join(',')}|${fns.join(',')}`;
	});
	$effect(() => {
		if (!devicePath || !padRowKey) return;
		const path = devicePath;
		const [noteList, fnList] = padRowKey.split('|');
		const notes = noteList.split(',').map(Number);
		const fns = fnList.split(',');
		const release: (() => void)[] = [];
		for (const note of notes) {
			for (const fn of fns) release.push(selectedTrackStore.subscribeProperty(path, vmPadProperty(note, fn)));
		}
		return () => release.forEach((fn) => fn());
	});

	return {
		get devicePath() { return devicePath; },
		get members() { return members; },
		get profile() { return profile; },
		get macroNames() { return macroNames; },
		get selectedNote() { return selectedNote; },
		get heldNotes() { return heldNotes; },
		get scopeNote() { return scopeNote; },
		get scopedPad() { return scopedPad; },
		padRaw,
		value,
		state,
		macroState,
		badge: (...fns: VmFunction[]) => vmHeldBadge(members, ...fns),
		macroBadge: (...names: string[]) => vmMacroHeldBadge(members, ...names),
		macroCoverage: (...names: string[]) => vmMacroCoverageBadge(members, ...names),
		write,
		writeMacro
	};
}
