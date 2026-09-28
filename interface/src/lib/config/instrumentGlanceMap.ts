/**
 * Instrument glance map — which four controls the track strip's device
 * band draws.
 *
 * The band is a miniature of the instrument's central view, the way
 * `MiniSequencer` is a miniature of the Permute view: not the component
 * scaled down (every central view reads `selectedTrackStore`, so it can
 * only ever render the SELECTED track, and twelve strips cannot each
 * mount one) but the same controls, read per track straight off the v3
 * tree.
 *
 * So the entries here are **copied from the views themselves** — the
 * indices each `*CentralView` already uses — rather than invented. When a
 * view's indices change, change them here too, or the strip and the view
 * it opens will disagree about what the instrument is doing. The source
 * for each row is named in its comment.
 *
 * Resolution follows the Simpler view's rule: by NAME off the device's own
 * parameter list when a name is given, with the index as the fallback for
 * a device that lists it differently. The Acuff kit is the standing
 * example — its Simplers put Ve Attack at 21, not 26.
 *
 * `kind: 'auto'` is the rack case and the unknown-device case: take the
 * device's own leading parameters and label them with Live's names. On a
 * rack those ARE the macros, which is exactly what its central view
 * draws; on a plug-in the rig has no view for, it is the best honest
 * guess, and the band says something rather than nothing.
 */

import type { InstrumentType } from '$lib/services/instrumentService';
import { cleanParameterName, isEmptyMacroName } from '$lib/utils/macroLayoutUtils';

/** One control in the band. */
export interface GlanceParam {
	/**
	 * Short label, at most {@link GLANCE_LABEL_MAX} characters — the band
	 * is ~16px per control on a twelve-track strip. Omitted for `auto`
	 * rows, which take Live's own parameter name through
	 * {@link shortParamLabel}.
	 */
	label?: string;
	/** Parameter name to resolve first, when the device lists one. */
	name?: string;
	/** Chain-relative parameter index — the fallback, and the only key for unnamed rows. */
	index?: number;
}

export type InstrumentGlance =
	| { kind: 'params'; params: GlanceParam[] }
	/** The device's own leading parameters, labelled from Live's names. */
	| { kind: 'auto'; from: number; count: number };

/** How many controls the band draws. Four is what fits at strip width. */
export const GLANCE_PARAM_COUNT = 4;

/** Macros 1..4, labelled by Live — the rack case, and the generic fallback. */
const MACROS: InstrumentGlance = { kind: 'auto', from: 1, count: GLANCE_PARAM_COUNT };

export const INSTRUMENT_GLANCE_MAP: Record<InstrumentType, InstrumentGlance> = {
	// DriftCentralView: 1 cutoff, 2 resonance, 21 osc 1 shape, 60 drift.
	drift: {
		kind: 'params',
		params: [
			{ label: 'Cut', index: 1 },
			{ label: 'Res', index: 2 },
			{ label: 'Shp', index: 21 },
			{ label: 'Drft', index: 60 }
		]
	},

	// WavetableCentralView: 4 osc 1 position, 6 osc 1 effect 2, and the
	// amp envelope's attack (39) and release (41).
	wavetable: {
		kind: 'params',
		params: [
			{ label: 'Pos', index: 4 },
			{ label: 'Fx', index: 6 },
			{ label: 'A', index: 39 },
			{ label: 'R', index: 41 }
		]
	},

	// OperatorCentralView: 8 tone, 26 osc-A feedback, 29/34 amp attack and release.
	operator: {
		kind: 'params',
		params: [
			{ label: 'Tone', index: 8 },
			{ label: 'Fb', index: 26 },
			{ label: 'A', index: 29 },
			{ label: 'R', index: 34 }
		]
	},

	// CollisionCentralView: resonator 1 is 41 decay / 45 material,
	// resonator 2 is 78 / 74.
	collision: {
		kind: 'params',
		params: [
			{ label: 'Dec', index: 41 },
			{ label: 'Mat', index: 45 },
			{ label: 'Dec2', index: 78 },
			{ label: 'Mat2', index: 74 }
		]
	},

	// ElectricCentralView: 8 hammer stiffness, 16 hammer noise,
	// 20 fork tine colour, 24 fork tine decay.
	electric: {
		kind: 'params',
		params: [
			{ label: 'Stif', index: 8 },
			{ label: 'Nois', index: 16 },
			{ label: 'Col', index: 20 },
			{ label: 'Dec', index: 24 }
		]
	},

	// MeldCentralView: 8/9 the two macros, 15/16 filter cutoff and resonance.
	meld: {
		kind: 'params',
		params: [
			{ label: 'M1', index: 8 },
			{ label: 'M2', index: 9 },
			{ label: 'Cut', index: 15 },
			{ label: 'Res', index: 16 }
		]
	},

	// SimplerCentralView's own table (SIMPLER_PARAMS / SIMPLER_PARAM_NAMES):
	// name first, index as the fallback.
	simpler: {
		kind: 'params',
		params: [
			{ label: 'Strt', name: 'S Start', index: 3 },
			{ label: 'Len', name: 'S Length', index: 4 },
			{ label: 'A', name: 'Ve Attack', index: 26 },
			{ label: 'R', name: 'Ve Release', index: 29 }
		]
	},

	// SamplerCentralView resolves purely by name (SAMPLER_ROW_PARAM_NAMES in
	// `services/drumVirtualMacros/wire.ts`); the two envelope indices are the
	// verified pair from `instrumentSliderMap`.
	sampler: {
		kind: 'params',
		params: [
			{ label: 'Vol', name: 'O Volume' },
			{ label: 'Crs', name: 'O Coarse' },
			{ label: 'A', name: 'Ve Attack', index: 59 },
			{ label: 'R', name: 'Ve Release', index: 66 }
		]
	},

	// OmnisphereCentralView: 3 filter X, 8 time X, 25 orb angle, 26 orb radius.
	omnisphere: {
		kind: 'params',
		params: [
			{ label: 'Cut', index: 3 },
			{ label: 'Time', index: 8 },
			{ label: 'Ang', index: 25 },
			{ label: 'Orb', index: 26 }
		]
	},

	// KompleteKontrolCentralView draws the plug-in's own 1..8; the band
	// takes the first four and Live's names for them.
	'komplete-kontrol': MACROS,

	// Racks: the macros ARE the view.
	drumrack: MACROS,
	'instrument-rack': MACROS,
	'instrument-rack-pattern': MACROS,

	// No view of their own — the leading parameters, named by Live.
	analog: MACROS,
	plugin: MACROS,
	unknown: MACROS
};

export function getInstrumentGlance(type: InstrumentType | null): InstrumentGlance {
	if (!type) return MACROS;
	return INSTRUMENT_GLANCE_MAP[type] ?? MACROS;
}

/**
 * The widest label a fader can show. A twelve-track strip leaves ~16px a
 * control, which is four characters at the label's size — past that the
 * text is clipped mid-word, and a clipped label is worse than a short
 * one ("Resonance" clipped reads "Resor", which is not a word).
 */
export const GLANCE_LABEL_MAX = 4;

/**
 * Live's parameter name, shortened to fit one fader.
 *
 * "Macro 3" → "M3" — it says nothing anyway, and the digit is the only
 * part that distinguishes it. Anything else: the first word, and where
 * that is still too long, its first {@link GLANCE_LABEL_MAX} characters
 * with the vowels dropped after the first, which keeps a word
 * recognisable at four characters where a plain clip does not ("Release"
 * → "Rlse", not "Rele"; "Filter" → "Fltr").
 *
 * Empty-macro names ('.', '-', bare "Macro N") are the caller's business
 * — {@link isEmptyMacroName} is re-exported here and the band drops
 * those controls entirely.
 */
export function shortParamLabel(name: string): string {
	const cleaned = cleanParameterName(name).trim();
	const macro = cleaned.match(/^Macro\s*(\d+)$/i);
	if (macro) return `M${macro[1]}`;
	const firstWord = (cleaned.split(/\s+/)[0] ?? cleaned).trim();
	if (firstWord.length <= GLANCE_LABEL_MAX) return firstWord;
	const squeezed = firstWord[0] + firstWord.slice(1).replace(/[aeiou]/gi, '');
	return (squeezed.length >= 3 ? squeezed : firstWord).slice(0, GLANCE_LABEL_MAX);
}

export { isEmptyMacroName };
