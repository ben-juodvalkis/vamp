/** Live's groove files as `/api/grooves` lists them (`$lib/server/grooves`). */

export interface GrooveEvent {
	/** Time over the picture's span, 0..1. */
	x: number;
	/** Velocity over 127. */
	v: number;
}

export interface GrooveFile {
	/** The file's name without `.agr`: the groove's identity on the wire. */
	name: string;
	/** Its folder under `Grooves/`, e.g. `Swing/Basic` or `Style`. */
	group: string;
	/** `1/8`, `1/16`, `1/32`…, or null for a file that cannot be read. */
	grid: string | null;
	/** The first 8 note events, or null for a file that cannot be read. */
	events: GrooveEvent[] | null;
}

export interface GroovesListing {
	/** The `Grooves` folder read, or null when no Live app was found. */
	root: string | null;
	files: GrooveFile[];
	/** Ticked names, in tick order: the Groove view's tiles. */
	ticked: string[];
	firstRun: boolean;
}

/** The groups as Live's library has them, in the order Settings lists them. */
export const GROOVE_GROUPS: ReadonlyArray<{ id: string; title: string }> = [
	{ id: 'Swing/Basic', title: 'Swing · Basic' },
	{ id: 'Swing/Logic', title: 'Swing · Logic' },
	{ id: 'Swing/MPC', title: 'Swing · MPC' },
	{ id: 'Swing/SP 1200', title: 'Swing · SP 1200' },
	{ id: 'Swing/Notator', title: 'Swing · Notator' },
	{ id: 'Style', title: 'Style' },
	{ id: 'Percussion', title: 'Percussion' },
	{ id: 'Utility', title: 'Utility' }
];
