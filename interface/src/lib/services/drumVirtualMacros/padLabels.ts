/**
 * Drum Rack pad tiles — what a tile is filled with and what it says: the
 * chain colour and the text that stays readable on it, and the labels a
 * whole kit's pads wear at once (shared words dropped, collisions told
 * apart, kit codes skipped).
 */

import type { VmPad } from './wire';

/** A pad's chain colour as CSS (`#rrggbb`), or null when Live gave it none. */
export function padColorCss(pad: VmPad | null | undefined): string | null {
	if (!pad || pad.color === null) return null;
	return `#${pad.color.toString(16).padStart(6, '0')}`;
}

/** Text the fill's brightness leaves readable: YIQ above the classic 128 is a light colour and takes dark text. */
export const PAD_TEXT_ON_LIGHT = '#141414';

export const PAD_TEXT_ON_DARK = '#f4f4f4';

export function padTextCss(color: number): string {
	const r = (color >> 16) & 0xff;
	const g = (color >> 8) & 0xff;
	const b = color & 0xff;
	const yiq = (r * 299 + g * 587 + b * 114) / 1000;
	return yiq >= 128 ? PAD_TEXT_ON_LIGHT : PAD_TEXT_ON_DARK;
}

/**
 * What a pad tile can fit: the voice word, capped — "Kick Tight Gen
 * Purpose K" → "Kick", "Snare 2 Gen Purpose Kit" → "Snare 2" (a short
 * second token that is a number or a single letter stays: it is what
 * tells two snares apart).
 *
 * Kits name pads two ways round. Ableton's General MIDI-style kits put
 * the voice first; a machine kit puts its code first — ` 606 + 808` on
 * the rig reads "606 Kick", "606 Snare", "808 Clap", and a first-word
 * rule labels every tile "606". So a leading KIT CODE — a token that is
 * all digits, or short and made of capitals and digits ("TR8", "LM2") —
 * is skipped, and so is a first word that every pad in the kit shares
 * (`sharedPrefix`, from `padTilePrefix`). What remains is the voice.
 */
/** A tile wraps to two lines now, so a label may run to this many characters (was 9 when it clipped). */
export const PAD_LABEL_MAX = 16;

/** Words as a tile shows them: a trailing colon or comma is a kit-maker's punctuation, not part of the voice ("Kick:" → Kick). */
function tileWords(name: string): string[] {
	return name
		.trim()
		.split(/\s+/)
		.map((w) => w.replace(/[:,;]+$/, ''))
		.filter(Boolean);
}

export function padTileLabel(name: string, max = PAD_LABEL_MAX, sharedPrefix: string | null = null): string {
	let words = tileWords(name);
	if (words.length === 0) return '';
	if (sharedPrefix && words.length > 1 && words[0].toLowerCase() === sharedPrefix.toLowerCase()) {
		words = words.slice(1);
	}
	while (words.length > 1 && isKitCode(words[0])) words = words.slice(1);
	let label = words[0];
	if (words.length > 1 && /^[0-9]+$|^[A-Za-z]$/.test(words[1]) && `${label} ${words[1]}`.length <= max) {
		label = `${label} ${words[1]}`;
	}
	return label.length > max ? label.slice(0, max) : label;
}

function isKitCode(word: string): boolean {
	return /^[0-9]+$/.test(word) || (word.length <= 4 && /^[A-Z0-9]+$/.test(word) && /[0-9]/.test(word));
}

/**
 * The first word every populated pad of a kit shares ("Acuff" on a kit
 * named "Acuff Kick", "Acuff Snare", …), or null. Two or more pads
 * needed — one pad shares nothing with itself.
 */
export function padTilePrefix(pads: readonly VmPad[]): string | null {
	const firsts = pads
		.map((p) => p.name.trim().split(/\s+/).filter(Boolean))
		.filter((w) => w.length > 1)
		.map((w) => w[0].toLowerCase());
	if (firsts.length < 2) return null;
	const first = firsts[0];
	return firsts.every((w) => w === first) ? first : null;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

/** Live's name for a MIDI note: C-2 is 0, so 36 is C1 and 60 is C3 — what Live prints on an unnamed pad. */
export function noteName(note: number): string {
	return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 2}`;
}

/** A tile's text: the label, and a small second line when the label alone would not tell the pad apart. */
export interface PadTileText {
	label: string;
	sub: string | null;
}

/**
 * Labels for a whole kit at once — redundancy is a property of the kit,
 * not of one name (user, 2026-09-08: a rack whose every chain is named
 * "Chase" read "Chase" sixteen times).
 *
 * Words every pad shares are dropped first — the longest common run of
 * leading words, so "Chase Kick" / "Chase Snare" become Kick / Snare and
 * "Acuff Kit Kick" / "Acuff Kit Snare" lose both. Sixteen pads all named
 * "Chase" keep nothing and show NO label: the colour and the position
 * say which pad it is, and a word repeated sixteen times said nothing
 * (note names as the fallback were built and then hidden at the user's
 * request, 2026-09-08 — `noteName` stays for when they return). Then the
 * usual first-word rule, with leading kit codes skipped. Pads whose
 * first word collides try their second word — "Hat Cl" / "Hat Ped" /
 * "Hat Op" is what tells three hats apart, and it fits. `sub` is always
 * null for now.
 */
export function padTileLabels(pads: readonly VmPad[], max = PAD_LABEL_MAX): Map<number, PadTileText> {
	const words = new Map<number, string[]>();
	for (const p of pads) words.set(p.note, tileWords(p.name));
	const named = [...words.values()].filter((w) => w.length > 0);
	// The shared leading run, case-insensitively.
	let shared = 0;
	if (named.length >= 2) {
		const first = named[0];
		while (shared < first.length && named.every((w) => w.length > shared && w[shared].toLowerCase() === first[shared].toLowerCase())) {
			shared++;
		}
	}
	const rests = new Map<number, string[]>();
	const out = new Map<number, PadTileText>();
	for (const p of pads) {
		const w = words.get(p.note) ?? [];
		let rest = w.length > shared ? w.slice(shared) : [];
		while (rest.length > 1 && isKitCode(rest[0])) rest = rest.slice(1);
		rests.set(p.note, rest);
		out.set(p.note, { label: rest.length ? padTileLabel(rest.join(' '), max) : '', sub: null });
	}
	// Colliding labels take one more word at a time while it fits — "Tom",
	// "Tom" → "Tom Hi", "Tom Hi" → "Tom Hi", "Tom Hi 2" — and stop when
	// nothing collides or nothing more fits.
	for (let take = 2; take <= 4; take++) {
		const counts = new Map<string, number>();
		for (const t of out.values()) if (t.label) counts.set(t.label, (counts.get(t.label) ?? 0) + 1);
		let changed = false;
		for (const [note, text] of out) {
			const rest = rests.get(note) ?? [];
			if (!text.label || (counts.get(text.label) ?? 0) < 2 || rest.length < take) continue;
			const longer = rest.slice(0, take).join(' ');
			if (longer.length <= max && longer !== text.label) {
				text.label = longer;
				changed = true;
			}
		}
		if (!changed) break;
	}
	return out;
}
