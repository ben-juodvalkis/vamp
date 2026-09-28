import { describe, it, expect } from 'vitest';
import {
	abbreviateTrackName,
	rgbToHex,
	hexToRgb,
	getColorName,
	formatTrackType,
	getTrackIcon,
	trackInk,
	deviceInk,
	TRACK_INK
} from '$lib/utils/formatters/trackFormatters';
import {
	DEVICE_FAMILY_INKS,
	CONTROL_COLORS,
	PITCH_COLOR,
	MOD_COLOR
} from '$lib/config/devicePresets';

// Independent sRGB(hex) -> OKLCH extractor for asserting trackInk's envelope
// (uses the standard Ottosson constants; mirrors but does not import the impl).
function hexToOklch(hex: string): { L: number; C: number } {
	const h = hex.replace('#', '');
	const toLin = (n: number) => {
		const c = n / 255;
		return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	};
	const r = toLin(parseInt(h.slice(0, 2), 16));
	const g = toLin(parseInt(h.slice(2, 4), 16));
	const b = toLin(parseInt(h.slice(4, 6), 16));
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return { L, C: Math.hypot(a, bb) };
}

const luminance = (hex: string) => {
	const h = hex.replace('#', '');
	return (
		0.299 * parseInt(h.slice(0, 2), 16) +
		0.587 * parseInt(h.slice(2, 4), 16) +
		0.114 * parseInt(h.slice(4, 6), 16)
	);
};
const maxChannel = (hex: string) => {
	const h = hex.replace('#', '');
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	if (r >= g && r >= b) return 'r';
	if (g >= r && g >= b) return 'g';
	return 'b';
};

describe('trackFormatters', () => {
	describe('abbreviateTrackName', () => {
		it('should return short names unchanged', () => {
			expect(abbreviateTrackName('Bass', 8)).toBe('Bass');
			expect(abbreviateTrackName('Drums', 8)).toBe('Drums');
		});

		it('should abbreviate common words', () => {
			expect(abbreviateTrackName('Bass Track', 8)).toBe('Bs Tk');
			expect(abbreviateTrackName('Drum Machine', 8)).toBe('Dr Mach…');
			expect(abbreviateTrackName('Guitar Lead', 8)).toBe('Gtr Ld');
			expect(abbreviateTrackName('Vocal Main', 8)).toBe('Voc Main');
		});

		it('should truncate with ellipsis when too long', () => {
			expect(abbreviateTrackName('Very Long Track Name', 8)).toBe('Very Lo…');
		});

		it('should remove quotation marks', () => {
			expect(abbreviateTrackName('"Bass"', 8)).toBe('Bass');
			expect(abbreviateTrackName("'Synth'", 8)).toBe('Synth');
		});

		it('should handle case-insensitive abbreviations when needed', () => {
			// Abbreviations only happen when the name is too long
			// 'Bass' (4 chars) <= 8 so it's returned unchanged
			expect(abbreviateTrackName('Bass', 8)).toBe('Bass');
			expect(abbreviateTrackName('BASS', 8)).toBe('BASS');
			// But in context of longer names, abbreviation is case-insensitive
			expect(abbreviateTrackName('Bass Synth Lead', 8)).toBe('Bs Syn …');
			expect(abbreviateTrackName('BASS SYNTH LEAD', 8)).toBe('Bs Syn …');
		});

		it('should use default maxLength of 8', () => {
			expect(abbreviateTrackName('Very Long Track Name')).toBe('Very Lo…');
		});

		it('should handle multiple abbreviations in one name', () => {
			// 'Bass Synth Pad' -> 'Bs Syn Pd' = 9 chars, truncates to 'Bs Syn …' (8 chars)
			expect(abbreviateTrackName('Bass Synth Pad')).toBe('Bs Syn …');
		});

		it('should abbreviate common instrument words', () => {
			// 'Rhythm Guitar' = 13 chars, 'Rhy Gtr' = 7 chars (fits in 8)
			expect(abbreviateTrackName('Rhythm Guitar')).toBe('Rhy Gtr');
			// 'Master Output' = 13 chars, 'Mstr Output' = 11 chars, truncates to 'Mstr Ou…' (8 chars)
			expect(abbreviateTrackName('Master Output')).toBe('Mstr Ou…');
			// 'Return A' = 8 chars, <= 8 so no abbreviation
			expect(abbreviateTrackName('Return A')).toBe('Return A');
			// 'Audio Track' = 11 chars, 'Aud Tk' = 6 chars (fits in 8)
			expect(abbreviateTrackName('Audio Track')).toBe('Aud Tk');
			// 'MIDI Synth' = 10 chars, 'Mid Syn' = 7 chars (fits in 8)
			expect(abbreviateTrackName('MIDI Synth')).toBe('Mid Syn');
		});

		it('should cache results (memoization)', () => {
			// Call twice with same input
			const result1 = abbreviateTrackName('Test Track', 8);
			const result2 = abbreviateTrackName('Test Track', 8);
			expect(result1).toBe(result2);
		});
	});

	describe('rgbToHex', () => {
		it('should convert RGB integer to hex string', () => {
			expect(rgbToHex(0xff0000)).toBe('#ff0000');
			expect(rgbToHex(0x00ff00)).toBe('#00ff00');
			expect(rgbToHex(0x0000ff)).toBe('#0000ff');
		});

		it('should handle black and white', () => {
			expect(rgbToHex(0x000000)).toBe('#000000');
			expect(rgbToHex(0xffffff)).toBe('#ffffff');
		});

		it('should pad with zeros when needed', () => {
			expect(rgbToHex(0x0000ff)).toBe('#0000ff');
			expect(rgbToHex(0x00ff)).toBe('#0000ff');
			expect(rgbToHex(0xff)).toBe('#0000ff');
		});

		it('should handle arbitrary colors', () => {
			expect(rgbToHex(0x808080)).toBe('#808080');
			expect(rgbToHex(0xff8800)).toBe('#ff8800');
		});

		it('should cache results (memoization)', () => {
			const result1 = rgbToHex(0xff0000);
			const result2 = rgbToHex(0xff0000);
			expect(result1).toBe(result2);
		});
	});

	describe('hexToRgb', () => {
		it('should convert hex string to RGB integer', () => {
			expect(hexToRgb('#ff0000')).toBe(0xff0000);
			expect(hexToRgb('#00ff00')).toBe(0x00ff00);
			expect(hexToRgb('#0000ff')).toBe(0x0000ff);
		});

		it('should handle hex without hash', () => {
			expect(hexToRgb('ff0000')).toBe(0xff0000);
			expect(hexToRgb('ffffff')).toBe(0xffffff);
		});

		it('should handle black and white', () => {
			expect(hexToRgb('#000000')).toBe(0);
			expect(hexToRgb('#ffffff')).toBe(0xffffff);
		});

		it('should be inverse of rgbToHex', () => {
			const original = 0xff8800;
			expect(hexToRgb(rgbToHex(original))).toBe(original);
		});
	});

	describe('getColorName', () => {
		it('should return known color names', () => {
			expect(getColorName(0xff0000)).toBe('Red');
			expect(getColorName(0x00ff00)).toBe('Green');
			expect(getColorName(0x0000ff)).toBe('Blue');
			expect(getColorName(0xffff00)).toBe('Yellow');
			expect(getColorName(0xff00ff)).toBe('Magenta');
			expect(getColorName(0x00ffff)).toBe('Cyan');
			expect(getColorName(0xff8800)).toBe('Orange');
			expect(getColorName(0x8800ff)).toBe('Purple');
			expect(getColorName(0x808080)).toBe('Gray');
		});

		it('should return Custom for unknown colors', () => {
			expect(getColorName(0x123456)).toBe('Custom');
			expect(getColorName(0xabcdef)).toBe('Custom');
		});
	});

	describe('formatTrackType', () => {
		it('should format known track types', () => {
			expect(formatTrackType('audio')).toBe('Audio');
			expect(formatTrackType('midi')).toBe('MIDI');
			expect(formatTrackType('return')).toBe('Return');
			expect(formatTrackType('master')).toBe('Master');
			expect(formatTrackType('group')).toBe('Group');
		});

		it('should handle uppercase input', () => {
			expect(formatTrackType('AUDIO')).toBe('Audio');
			expect(formatTrackType('MIDI')).toBe('MIDI');
		});

		it('should handle mixed case input', () => {
			expect(formatTrackType('Audio')).toBe('Audio');
			expect(formatTrackType('MiDi')).toBe('MIDI');
		});

		it('should return original for unknown types', () => {
			expect(formatTrackType('unknown')).toBe('unknown');
			expect(formatTrackType('custom')).toBe('custom');
		});
	});

	describe('getTrackIcon', () => {
		it('should return correct icons for track types', () => {
			expect(getTrackIcon('audio')).toBe('🎵');
			expect(getTrackIcon('midi')).toBe('🎹');
			expect(getTrackIcon('return')).toBe('↩️');
			expect(getTrackIcon('master')).toBe('🎛️');
			expect(getTrackIcon('group')).toBe('📁');
		});

		it('should handle case insensitivity', () => {
			expect(getTrackIcon('AUDIO')).toBe('🎵');
			expect(getTrackIcon('Midi')).toBe('🎹');
		});

		it('should return default icon for unknown types', () => {
			expect(getTrackIcon('unknown')).toBe('🎵');
			expect(getTrackIcon('')).toBe('🎵');
		});
	});

	describe('trackInk', () => {
		const samples = ['#ff0000', '#00ff00', '#0000ff', '#ffcc00', '#80c0ff', '#7a3fa0', '#ffffff', '#101418'];

		it('always returns a valid 6-digit hex', () => {
			for (const s of samples) {
				expect(trackInk(s)).toMatch(/^#[0-9a-f]{6}$/);
				expect(trackInk(s, 'light')).toMatch(/^#[0-9a-f]{6}$/);
			}
		});

		it('clamps lightness into the envelope (in-gamut samples)', () => {
			for (const s of samples) {
				const { L } = hexToOklch(trackInk(s, 'dark'));
				// allow a small gamut-compression slack on the bounds
				expect(L).toBeGreaterThanOrEqual(TRACK_INK.lMin - 0.04);
				expect(L).toBeLessThanOrEqual(TRACK_INK.lMax + 0.04);
			}
		});

		it('never exceeds the max chroma of the envelope (no neons)', () => {
			for (const s of samples) {
				expect(hexToOklch(trackInk(s, 'dark')).C).toBeLessThanOrEqual(TRACK_INK.cMax + 0.02);
				expect(hexToOklch(trackInk(s, 'light')).C).toBeLessThanOrEqual(TRACK_INK.cMax + 0.02);
			}
		});

		it('preserves hue family (dominant channel ordering unchanged)', () => {
			expect(maxChannel(trackInk('#ff2020'))).toBe('r');
			expect(maxChannel(trackInk('#20ff20'))).toBe('g');
			expect(maxChannel(trackInk('#2020ff'))).toBe('b');
		});

		it('tames neons (drops chroma) and enriches pastels (raises chroma)', () => {
			// The §2.5 purpose: pastels gain chroma, neons lose it.
			const neon = '#00ff00'; // chroma well above the envelope max
			expect(hexToOklch(trackInk(neon, 'dark')).C).toBeLessThan(hexToOklch(neon).C);

			const pastel = '#d8c8e8'; // washed-out lavender, chroma below the envelope min
			expect(hexToOklch(trackInk(pastel, 'dark')).C).toBeGreaterThan(hexToOklch(pastel).C);
		});

		// The single-skin contract (Hybrid): track colours are SOLID FILLS with
		// black text, so ONE envelope serves both polarities — the fill is the
		// same object on both ladders, as it is in Live. The retired GRATICULE
		// skin clamped per-polarity and this asserted the paper ink was darker.
		it('is polarity-independent — one envelope for dark and paper', () => {
			for (const s of ['#ff0000', '#00aa55', '#3366ff']) {
				expect(trackInk(s, 'light')).toBe(trackInk(s, 'dark'));
			}
		});

		it('passes malformed input through untouched', () => {
			expect(trackInk('not-a-color')).toBe('not-a-color');
			expect(trackInk('#xyz')).toBe('#xyz');
		});

		it('caches results (memoization)', () => {
			expect(trackInk('#ff8800')).toBe(trackInk('#ff8800'));
		});
	});

	describe('deviceInk', () => {
		it('preserves neutrals — never chroma-boosts a grey onto a signal hue', () => {
			// slate-500: trackInk would boost it to C 0.14 (periwinkle, on the
			// act-pitch hue); deviceInk must keep it a grey.
			for (const grey of ['#64748b', '#a2acb7', '#808080']) {
				expect(hexToOklch(deviceInk(grey, 'dark')).C).toBeLessThanOrEqual(0.03 + 0.005);
				expect(deviceInk(grey, 'dark')).not.toBe(trackInk(grey, 'dark'));
			}
		});

		it('clamps neutral lightness into the envelope', () => {
			const { L } = hexToOklch(deviceInk('#333333', 'dark'));
			expect(L).toBeGreaterThanOrEqual(TRACK_INK.lMin - 0.04);
			const { L: lightL } = hexToOklch(deviceInk('#eeeeee', 'light'));
			expect(lightL).toBeLessThanOrEqual(TRACK_INK.lMax + 0.04);
		});

		it('delegates chromatic input to trackInk (identical output)', () => {
			for (const c of ['#ff8244', '#12b2f4', 'rgb(168, 85, 247)']) {
				expect(deviceInk(c, 'dark')).toBe(trackInk(c, 'dark'));
				expect(deviceInk(c, 'light')).toBe(trackInk(c, 'light'));
			}
		});

		it('passes malformed input through untouched', () => {
			expect(deviceInk('var(--accent-primary)')).toBe('var(--accent-primary)');
			expect(deviceInk('not-a-color')).toBe('not-a-color');
		});

		it('is stable under repeated application (fixed-point chain)', () => {
			for (const c of ['#64748b', '#ff8244', '#12b2f4', '#a2acb7']) {
				const once = deviceInk(c, 'dark');
				expect(deviceInk(once, 'dark')).toBe(once);
			}
		});
	});

	// ADR-400: the device family palette must be authored as EXACT fixed points
	// of the ink chain, so the chokepoint normalization (useFxGridSlot /
	// BaseDeviceControl) and any view-side re-ink are byte no-ops. If this
	// fails after editing DEVICE_FAMILY_INKS, run the new hex through
	// deviceInk(x, 'dark') and author that output instead.
	describe('DEVICE_FAMILY_INKS fixed points', () => {
		it('every family primary and accent survives the dark ink chain unchanged', () => {
			for (const [family, ink] of Object.entries(DEVICE_FAMILY_INKS)) {
				expect(deviceInk(ink.primary, 'dark'), `${family}.primary`).toBe(ink.primary);
				expect(deviceInk(ink.accent, 'dark'), `${family}.accent`).toBe(ink.accent);
			}
		});

		it('shared exports (PITCH/MOD/CONTROL_COLORS) are fixed points too', () => {
			for (const scheme of [PITCH_COLOR, MOD_COLOR, ...CONTROL_COLORS]) {
				expect(deviceInk(scheme.primary, 'dark')).toBe(scheme.primary);
				expect(deviceInk(scheme.accent, 'dark')).toBe(scheme.accent);
			}
		});
	});
});
