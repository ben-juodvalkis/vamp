/**
 * Track Formatting Utilities
 * Provides consistent formatting for track-related data
 */

import { memoize } from '../performance/memoize';

/**
 * Abbreviate track names for display in limited space
 * Memoized for performance
 */
export const abbreviateTrackName = memoize((name: string, maxLength: number = 8): string => {
    // Remove quotation marks from track names
    name = name.replace(/["']/g, '');

    if (name.length <= maxLength) return name;

    const commonWords: Record<string, string> = {
        'Bass': 'Bs',
        'Drum': 'Dr',
        'Guitar': 'Gtr',
        'Vocal': 'Voc',
        'Lead': 'Ld',
        'Rhythm': 'Rhy',
        'Synth': 'Syn',
        'Pad': 'Pd',
        'Track': 'Tk',
        'Master': 'Mstr',
        'Return': 'Rtn',
        'Audio': 'Aud',
        'MIDI': 'Mid'
    };

    let abbreviated = name;
    for (const [full, short] of Object.entries(commonWords)) {
        abbreviated = abbreviated.replace(new RegExp(full, 'gi'), short);
    }

    if (abbreviated.length <= maxLength) return abbreviated;
    return abbreviated.substring(0, maxLength - 1) + '…';
}, { maxSize: 200 });

/**
 * Convert RGB integer to hex color string
 * Memoized for performance
 */
export const rgbToHex = memoize((rgbValue: number): string => {
    const hex = rgbValue.toString(16).padStart(6, '0');
    return `#${hex}`;
}, { maxSize: 100 });

/**
 * Convert hex color to RGB integer
 */
export function hexToRgb(hex: string): number {
    // Remove # if present
    hex = hex.replace('#', '');
    return parseInt(hex, 16);
}

/* ============================================================================
 * trackInk() — track-color normalizer (§2.5)
 *
 * Live's raw track hexes are luminance-chaotic (pastels vanish on near-black;
 * neons scream). trackInk() clamps each hex into a calibrated OKLCH envelope —
 * HUE IS NEVER ALTERED — so every track reads at the same instrument-grade
 * weight. It returns a HEX STRING, which is canvas-safe everywhere: canvases
 * cannot resolve CSS var() or oklch relative-color, so this MUST be JS-side.
 *
 * ONE output string per track becomes BOTH the `--track-color` CSS var on the
 * strip AND the JS canvas `fillStyle`. Memoized per hex.
 *
 * The clamp envelope is exported as a tunable constant. If the on-device
 * performer sign-off (§2.5 gate) wants a different feel, tune THAT — not any
 * per-component recipe.
 * ========================================================================== */

export interface TrackInkEnvelope {
    lMin: number;
    lMax: number;
    cMin: number;
    cMax: number;
}

/**
 * The one envelope. Hybrid paints track colours as SOLID FILLS with black text,
 * so dark and light share it — the fill is the same object on both ladders, as
 * it is in Live. (The retired GRATICULE skin had a per-polarity pair instead;
 * see Looping's `documentation/archive/graticule-skin.md`.)
 */
export const TRACK_INK: TrackInkEnvelope = { lMin: 0.66, lMax: 0.80, cMin: 0.11, cMax: 0.19 };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

// sRGB <-> linear
function srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// linear sRGB -> OKLab (Björn Ottosson)
function linearToOklab(r: number, g: number, b: number): [number, number, number] {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    return [
        0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
    ];
}

// OKLab -> linear sRGB
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.703418614 * m + 1.707614701 * s
    ];
}

function toHex2(c: number): string {
    return Math.round(clamp01(c) * 255)
        .toString(16)
        .padStart(2, '0');
}

/**
 * Parse a color string into OKLCH components.
 *
 * Accepts `#rgb` / `#rrggbb` (leading `#` optional) and `rgb()` / `rgba()`
 * (device color schemes author colors that way). Alpha is dropped: inks are
 * opaque; callers layer alpha via color-mix. Returns `null` for anything
 * unparseable so callers can pass junk (`var(...)`, keywords) through untouched.
 */
function parseInkInput(color: string): { L: number; C: number; H: number } | null {
    const rgbMatch = color.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i);

    let h = rgbMatch
        ? [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
              .map((c) => Math.max(0, Math.min(255, Math.round(parseFloat(c)))).toString(16).padStart(2, '0'))
              .join('')
        : color.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;

    const rs = srgbToLinear(parseInt(h.slice(0, 2), 16) / 255);
    const gs = srgbToLinear(parseInt(h.slice(2, 4), 16) / 255);
    const bs = srgbToLinear(parseInt(h.slice(4, 6), 16) / 255);

    const [L, a, b] = linearToOklab(rs, gs, bs);
    return { L, C: Math.hypot(a, b), H: Math.atan2(b, a) }; // H radians — hue NEVER altered
}

/** OKLCH → gamut-clipped `#rrggbb`. */
function emitInkHex(L: number, C: number, H: number): string {
    const [lr, lg, lb] = oklabToLinear(L, Math.cos(H) * C, Math.sin(H) * C);
    return `#${toHex2(linearToSrgb(lr))}${toHex2(linearToSrgb(lg))}${toHex2(linearToSrgb(lb))}`;
}

const trackInkClamp = memoize(
    (hex: string): string => {
        const p = parseInkInput(hex);
        if (!p) return hex; // pass through junk untouched
        return emitInkHex(
            clamp(p.L, TRACK_INK.lMin, TRACK_INK.lMax),
            clamp(p.C, TRACK_INK.cMin, TRACK_INK.cMax),
            p.H
        );
    },
    { maxSize: 200 }
);

/**
 * Normalize a Live track hex into the ink envelope (hue preserved).
 * @param hex `#rrggbb` (a leading `#` is optional) or `rgb()`/`rgba()`
 * @returns a `#rrggbb` hex string
 *
 * The optional second argument is the theme polarity. It is ACCEPTED AND
 * IGNORED: the envelope is shared across dark and light (see TRACK_INK). It
 * stays in the signature because ~100 call sites pass `paintMode()` /
 * `paintModeReactive()`, and because those reads are what make the ink twins
 * recompute on a runtime theme flip.
 */
export function trackInk(hex: string, _mode: 'dark' | 'light' = 'dark'): string {
    return trackInkClamp(hex);
}

/* ============================================================================
 * deviceInk() — device-scheme ink (ADR-400): like trackInk, but
 * NEUTRAL-PRESERVING.
 *
 * trackInk's chroma floor (cMin 0.14) deliberately colorizes greys — right for
 * Live track colors, wrong for the grey `utility` device family: boosting a
 * slate grey lands it at OKLCH hue ~257, directly on the reserved --act-pitch
 * signal hue (a gain tile would read as a pitch signal). Near-neutral inputs
 * (C < 0.05) get their lightness clamped into the envelope with chroma capped
 * at 0.03; chromatic inputs delegate to trackInk. Junk passes through, same
 * contract as trackInk.
 * ========================================================================== */

/** Inputs below this OKLCH chroma are treated as deliberate neutrals. */
const DEVICE_INK_NEUTRAL_GATE = 0.05;
/** Neutral outputs keep at most this chroma (a whisper of the surface hue). */
const DEVICE_INK_NEUTRAL_CAP = 0.03;

/** Device-scheme ink (neutral-preserving). */
export function deviceInk(color: string, _mode: 'dark' | 'light' = 'dark'): string {
    const p = parseInkInput(color);
    if (!p) return color; // pass through junk untouched
    // Neutral device inks (the grey utility family) stay neutral; chromatic
    // ones take the track-ink fill envelope.
    if (p.C >= DEVICE_INK_NEUTRAL_GATE) return trackInkClamp(color);
    return emitInkHex(
        clamp(p.L, TRACK_INK.lMin, TRACK_INK.lMax),
        Math.min(p.C, DEVICE_INK_NEUTRAL_CAP),
        p.H
    );
}

/**
 * Get a readable color name from RGB value
 */
export function getColorName(rgbValue: number): string {
    const colors: Record<number, string> = {
        0xFF0000: 'Red',
        0x00FF00: 'Green',
        0x0000FF: 'Blue',
        0xFFFF00: 'Yellow',
        0xFF00FF: 'Magenta',
        0x00FFFF: 'Cyan',
        0xFF8800: 'Orange',
        0x8800FF: 'Purple',
        0x808080: 'Gray'
    };

    return colors[rgbValue] || 'Custom';
}

/**
 * Format track type for display
 */
export function formatTrackType(type: string): string {
    const types: Record<string, string> = {
        'audio': 'Audio',
        'midi': 'MIDI',
        'return': 'Return',
        'master': 'Master',
        'group': 'Group'
    };

    return types[type.toLowerCase()] || type;
}

/**
 * Get track icon based on type
 */
export function getTrackIcon(type: string): string {
    const icons: Record<string, string> = {
        'audio': '🎵',
        'midi': '🎹',
        'return': '↩️',
        'master': '🎛️',
        'group': '📁'
    };

    return icons[type.toLowerCase()] || '🎵';
}