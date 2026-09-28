/**
 * Drum Rack virtual macros — the UI-side vocabulary (ADR-428), in four
 * modules behind one import path (2026-09-10, issue #491 E0):
 *
 * - `wire`       — the property names, the census and its parser, the
 *                  per-pad row names and the value kinds.
 * - `profiles`   — what the census lets a kit do: control states, held
 *                  badges, the kit profile and its rows' functions.
 * - `padLabels`  — the tiles' colours and the labels a whole kit wears.
 * - `padGrid`    — the grid's geometry and the playing clip on it.
 * - `padFx`      — which effects each pad's chain carries (issue #491).
 *
 * Everything is re-exported here, so `$lib/services/drumVirtualMacros`
 * is still the one door.
 */

export * from './wire';
export * from './profiles';
export * from './padLabels';
export * from './padGrid';
export * from './padFx';
