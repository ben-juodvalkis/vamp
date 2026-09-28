/**
 * dB ⇄ fader-position maths for the TotalMix monitor strip.
 *
 * Everything upstream of this file speaks dB: the mixer's Global OSC protocol
 * takes and reports dB floats, the Max for Live device drives `live.gain~`
 * objects which are dB-native, and the store holds dB. This module exists
 * only because a *drawn fader* needs a 0..1 fill fraction, and a *drag* needs
 * pixels-to-dB. Those are presentation concerns, so they live here rather
 * than on the wire (ADR-423).
 *
 * The mapping is **linear in dB**, deliberately.
 *
 * RME's own faders use a curved taper — measured on the hardware, 0 dB sits
 * at 0.817 of fader travel and the curve steepens below −6 dB. Reproducing it
 * would make this strip look identical to TotalMix's, and nothing else. It
 * would not make the Ableton Move's encoders agree, because `live.gain~`
 * follows Live's gain law rather than RME's, so exact parity across the three
 * surfaces was never available. Given that, a uniform dB-per-pixel is the
 * better trade: it is one line instead of a 72-point lookup table, and a
 * monitor fader that moves the same amount per pixel everywhere is easier to
 * trust mid-performance than one that accelerates as it gets quieter.
 *
 * The measured RME taper is recorded in ADR-423 if it is ever wanted back.
 */

type TotalMixRange = { minDb: number; maxDb: number; silenceDb: number };

/**
 * The fader's range is the mixer's. It used to be read from the config block
 * at build time; since 2026-09-26 it arrives from the bridge over
 * `/bridge/machine` (`machineStore` calls `setTotalMixRange`), so an iPad
 * build compiles nothing about the mixer in. Until it does — and on a Mac
 * whose `totalmix` switch is off, where nothing on screen is drawn with
 * these — the mixer's own range stands (ADR-423: −65 dB floor, +6 top,
 * −300 off). The three are live bindings: an importer reads the current
 * value on every use.
 */
export let MIN_DB = -65;
export let MAX_DB = 6;
export let SILENCE_DB = -300;

export function setTotalMixRange(range: TotalMixRange): void {
	if (!Number.isFinite(range.minDb) || !Number.isFinite(range.maxDb) || range.maxDb <= range.minDb) return;
	MIN_DB = range.minDb;
	MAX_DB = range.maxDb;
	SILENCE_DB = Number.isFinite(range.silenceDb) ? range.silenceDb : -300;
}

/** Span of the fader in dB — the denominator of every conversion here. */
function dbSpan(): number {
	return MAX_DB - MIN_DB;
}

/**
 * Clamp a dB value into the fader's range.
 *
 * Values at or below `MIN_DB` — including the mixer's −300 "off" — collapse to
 * `MIN_DB` so the fader bottoms out rather than rendering off the end.
 */
export function clampDb(db: number): number {
	if (!Number.isFinite(db)) return MIN_DB;
	if (db <= MIN_DB) return MIN_DB;
	if (db > MAX_DB) return MAX_DB;
	return db;
}

/**
 * dB → 0..1 fill fraction, for drawing the fader.
 *
 * `-Infinity` and the mixer's −300 both land at 0, so a silent channel reads
 * as an empty fader rather than a glitch.
 */
export function dbToFraction(db: number): number {
	return (clampDb(db) - MIN_DB) / dbSpan();
}

/**
 * 0..1 fill fraction → dB. Inverse of `dbToFraction`.
 */
export function fractionToDb(fraction: number): number {
	const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
	return MIN_DB + f * dbSpan();
}

/**
 * The dB value to actually send for a fader sitting at the bottom.
 *
 * `MIN_DB` is −65, which is inaudible but not silent. The mixer's true off is
 * −300, so pulling a monitor fader all the way down should mean *off* — this
 * is the difference between "very quiet" and "nothing", and on a monitor path
 * in front of an audience that distinction is worth being exact about.
 */
export function dbForWire(db: number): number {
	const clamped = clampDb(db);
	return clamped <= MIN_DB ? SILENCE_DB : clamped;
}

/**
 * Format a dB value for display.
 *
 * Anything at or under the floor shows as the audio convention `-∞` rather
 * than a misleading "-65.0".
 */
export function formatDb(db: number | undefined): string {
	if (db === undefined || !Number.isFinite(db as number)) return '–';
	if ((db as number) <= MIN_DB) return '-∞';
	return `${(db as number).toFixed(1)}`;
}
