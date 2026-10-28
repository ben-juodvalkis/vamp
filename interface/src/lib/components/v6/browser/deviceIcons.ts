/**
 * A glyph per instrument type, heading a browser section of that type (user,
 * 2026-10-28: "each instrument type like Operator, Omnisphere, Drum Rack…
 * visually distinct… some sort of icon for each"). Keyed by the device Live
 * names (`Preset.device`, indexScan.deviceNameOf) or the plug-in
 * (`Preset.plugin`), as `groupPresetsByInstrument` names a section. Each is a
 * few strokes on a 24 × 24 box, drawn in the section's ink: a sketch of what
 * the instrument is, not its logo.
 */

/** Stroked SVG path data on a 24 × 24 box. */
export const DEVICE_ICONS: Readonly<Record<string, string>> = {
	// A pad grid.
	'Drum Rack': 'M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z',
	// One pad, struck.
	'Drum Sampler': 'M5 5h14v14H5zM12 9v6M9 12h6',
	// Eight slots.
	Impulse: 'M4 18V9M6.3 18V6M8.6 18v-7M10.9 18V5M13.1 18v-8M15.4 18V7M17.7 18v-6M20 18V8',
	// Stacked chains.
	'Instrument Rack': 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z',
	// Operators feeding a carrier.
	Operator: 'M4 4h6v6H4zM14 4h6v6h-6zM9 14h6v6H9zM7 10l4 4M17 10l-4 4',
	// Waves in a table, receding.
	Wavetable: 'M3 18c2-5 4-5 6 0s4 5 6 0M6 13c2-5 4-5 6 0s4 5 6 0M9 8c2-5 4-5 6 0s4 5 6 0',
	// A sawtooth.
	Analog: 'M3 17L9 7v10l6-10v10l6-10',
	// A sine and its drifting twin.
	Drift: 'M3 12c3-7 6-7 9 0s6 7 9 0M3 15c3-7 6-7 9 0s6 7 9 0',
	// Two engines melding.
	Meld: 'M9.5 12a5.5 5.5 0 1 0 0.01 0M14.5 12a5.5 5.5 0 1 0 0.01 0',
	// A mallet over a bar.
	Collision: 'M4 19h16M8 8a3 3 0 1 0 0.01 0M10 10l6 6',
	// Keys.
	Electric: 'M3 7h18v11H3zM7.5 7v11M12 7v11M16.5 7v11M6 7v6M10.5 7v6M15 7v6',
	// A plucked string between two bridges.
	Tension: 'M4 6v12M20 6v12M4 12q8-7 16 0',
	// A sample, with its start marker.
	Simpler: 'M6 4v16M3 12h3l1-5 1.5 10 1.5-8 1.5 6 1.5-4 1.5 3 1.5-2H21',
	// Key zones.
	Sampler: 'M3 6h10M8 12h13M3 18h15M3 4v4M13 4v4M8 10v4M21 10v4M3 16v4M18 16v4',
	// Plug-ins: a sphere, and a hardware knob.
	Omnisphere: 'M12 4a8 8 0 1 0 0.01 0M4 12c0 2.2 3.6 4 8 4s8-1.8 8-4-3.6-4-8-4-8 1.8-8 4',
	'Komplete Kontrol': 'M12 5a7 7 0 1 0 0.01 0M12 12l4-4'
};
