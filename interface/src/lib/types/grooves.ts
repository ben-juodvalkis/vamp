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
	/** Why it cannot be ticked (a name the pool's naming cannot carry), if so. */
	blocked?: string;
}

export interface GroovesListing {
	/** The `Grooves` folder read, or null when no Live app was found. */
	root: string | null;
	/** The User Library's `Grooves` folder, or null when Live names no User Library. */
	userRoot: string | null;
	files: GrooveFile[];
	/** Ticked names, in tick order: the Groove view's tiles. */
	ticked: string[];
	firstRun: boolean;
}

/** The groups as Live's library has them, in the order Settings lists them. */
export const GROOVE_GROUPS: ReadonlyArray<{ id: string; title: string }> = [
	{ id: 'User', title: 'Your grooves' },
	{ id: 'Swing/Basic', title: 'Swing · Basic' },
	{ id: 'Swing/Logic', title: 'Swing · Logic' },
	{ id: 'Swing/MPC', title: 'Swing · MPC' },
	{ id: 'Swing/SP 1200', title: 'Swing · SP 1200' },
	{ id: 'Swing/Notator', title: 'Swing · Notator' },
	{ id: 'Style', title: 'Style' },
	{ id: 'Percussion', title: 'Percussion' },
	{ id: 'Utility', title: 'Utility' }
];

/**
 * A groove of the user's own — a file in their User Library's `Grooves`
 * folder — is named with this prefix everywhere (the wire, Live's pool), so it
 * can sit beside a Core Library groove of the same name. The surface's
 * `DeviceLoadComponent.USER_GROOVE_PREFIX`.
 */
export const USER_GROOVE_PREFIX = 'User: ';
