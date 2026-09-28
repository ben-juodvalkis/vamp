/**
 * The bridge's "Group" gesture, against a fake AX helper that plays Live:
 * `system_click` actually moves a simulated selection (plain replaces, Cmd
 * toggles), `system_drag` actually relocates a row into a group's children
 * (mirroring the real, rig-measured behavior: the group keeps its own
 * identity throughout, never dissolved), `read` on `tracks.headers` reports
 * the real selection size, and `dump` answers the fake's own live tree.
 * Every assertion goes through that simulated Live state, the same
 * discipline the real code uses against the real one — never trusting a
 * verb's own "ok" alone.
 *
 * One call per gesture (2026-09-20 rewrite) — see the module docstring for
 * why the earlier four-address (`start`/`tap`/`commit`/`cancel`) version was
 * replaced: it clicked every tapped track into Live's real selection live,
 * racing whatever the next tap or a concurrent commit/cancel did to the same
 * shared gesture record, and it crashed on the rig with nothing exotic in
 * play. The toggle-a-tap-back-out behavior now lives entirely client-side
 * (`groupGestureStore.test.ts`) — this module never sees an individual tap.
 *
 * **Drag replaced ungroup-then-regroup for a merge (2026-09-20, same day)**
 * — confirmed live on the rig: dragging a flat track onto an existing
 * group's own rows adds it as a new member with the group's identity (same
 * AX row, same name) completely unchanged, where the earlier ungroup/⌘G
 * dance dissolved the existing Group Track and built a fresh one, losing
 * anything on the original's own device chain (a bus compressor, sends).
 */

import { describe, it, expect, vi } from 'vitest';

import * as mod from '../../../../bridge/handlers/liveGroupTracks.js';

type Modifiers = Array<'cmd' | 'shift'>;
type Row = { identifier: string; title: string };
type Ws = { readyState: number; send: (s: string) => void };
type Member = { path: string; name: string };

const {
	createLiveGroupTracks,
	GROUP_REPLY_ADDRESS,
	RECORD_SUSPEND_ADDRESS,
	RECORD_SUSPEND_ACK_ADDRESS,
	RECORD_RESUME_ADDRESS,
	RECORD_RESUME_ACK_ADDRESS
} = mod as unknown as {
	createLiveGroupTracks: (deps: Record<string, unknown>) => {
		handleGroup(ws: Ws, message: { args: unknown[] }): Promise<void>;
		onSurfaceMessage(message: { address: string; args: unknown[] }): boolean;
	};
	GROUP_REPLY_ADDRESS: string;
	RECORD_SUSPEND_ADDRESS: string;
	RECORD_SUSPEND_ACK_ADDRESS: string;
	RECORD_RESUME_ADDRESS: string;
	RECORD_RESUME_ACK_ADDRESS: string;
};

const silent = { info() {}, warn() {}, error() {}, debug() {} };

class FakeAxError extends Error {
	code: string;
	detail: string;
	constructor(code: string, detail = '') {
		super(`${code}: ${detail}`);
		this.code = code;
		this.detail = detail;
	}
}

const FOUR_FLAT_ROWS: Row[] = [
	{ identifier: 'SessionView.Track[0].TitleBar', title: 'Shaker' },
	{ identifier: 'SessionView.Track[1].TitleBar', title: 'Drive 2' },
	{ identifier: 'SessionView.Track[2].TitleBar', title: 'Guitar' },
	{ identifier: 'SessionView.Track[3].TitleBar', title: 'Memphis Studio + Plymouth' }
];

/** The tree with Shaker + Drive 2 already grouped into "1-Group". */
const ONE_EXISTING_GROUP: Row[] = [
	{ identifier: 'SessionView.GroupTrack[0].TitleBar', title: '1-Group' },
	{ identifier: 'SessionView.GroupTrack[0].Track[0].TitleBar', title: 'Shaker' },
	{ identifier: 'SessionView.GroupTrack[0].Track[1].TitleBar', title: 'Drive 2' },
	{ identifier: 'SessionView.Track[1].TitleBar', title: 'Guitar' },
	{ identifier: 'SessionView.Track[2].TitleBar', title: 'Memphis Studio + Plymouth' }
];

/** Guitar sits two slots below the group, with Bass -- untouched by this
 * gesture -- sitting between them. Merging Guitar in is NOT a same-place
 * wrap: Live has to reorder past Bass. */
const GROUP_WITH_GAP_BEFORE_TARGET: Row[] = [
	{ identifier: 'SessionView.GroupTrack[0].TitleBar', title: '1-Group' },
	{ identifier: 'SessionView.GroupTrack[0].Track[0].TitleBar', title: 'Shaker' },
	{ identifier: 'SessionView.Track[1].TitleBar', title: 'Bass' },
	{ identifier: 'SessionView.Track[2].TitleBar', title: 'Guitar' }
];

/** Mirrors the real module's private `groupIdentifierOf` -- the fake needs
 * its own copy to know which group a `system_drag`'s `to` target names. */
function groupIdentifierOf(identifier: string): string | null {
	const match = /^(.*GroupTrack(?:\[\d+\])?)\./.exec(identifier);
	return match ? `${match[1]}.TitleBar` : null;
}

interface RigOptions {
	dumpRows?: Row[];
	/** identifiers whose FIRST system_click silently does nothing, like a
	 * measured miss — the second attempt (and later reads) behave normally. */
	missOnceFor?: Set<string>;
	/** identifiers whose system_click NEVER registers, exhausting retries. */
	missAlwaysFor?: Set<string>;
	/** identifiers whose FIRST system_drag silently does nothing. */
	dragMissOnceFor?: Set<string>;
	/** identifiers whose system_drag NEVER registers, exhausting retries. */
	dragMissAlwaysFor?: Set<string>;
	failVerb?: string;
	failCode?: string;
	/** Wires a fake surface for the record-suspend bracket. Omitted (the
	 * default) matches every pre-existing test: no `sendToSurface` at all,
	 * so the bracket never engages regardless of contiguity. */
	withSurface?: boolean;
	/** What a simulated `record_suspend` reports it found `record_mode` at. */
	recordModeOn?: boolean;
	/** `sendToSurface` throws synchronously, like a closed UDP port. */
	surfaceUnreachable?: boolean;
}

function rig(options: RigOptions = {}) {
	const calls: Array<[string, Record<string, unknown>]> = [];
	/** A single ordered log spanning both AX-helper verbs and surface hops --
	 * `calls`/`surfaceCalls` alone can't show interleaving, since they're two
	 * separate arrays with no shared clock. Only 'system_key' and
	 * 'system_drag' are tagged (the two record-suspend-bracketed actions). */
	const timeline: string[] = [];
	let selected = new Set<string>();
	const missedClicks = new Set<string>();
	const missedDrags = new Set<string>();
	let rows: Row[] = (options.dumpRows ?? FOUR_FLAT_ROWS).map((r) => ({ ...r }));
	let nextGroupNumber = rows.filter((r) => r.identifier === groupIdentifierOf(r.identifier)).length + 1;

	/** Move `sourceIdentifier`'s row to become the last child of the group
	 * `groupIdentifier` names -- the fake's stand-in for what the rig
	 * measured a real drag onto a group's rows to do. The row's own
	 * identifier changes (it is a path under the group now); its title
	 * does not, since Live never renamed anything the drag touched. */
	function moveRowIntoGroup(sourceIdentifier: string, groupIdentifier: string) {
		const sourceIdx = rows.findIndex((r) => r.identifier === sourceIdentifier);
		if (sourceIdx === -1) return;
		const [source] = rows.splice(sourceIdx, 1);
		const headerIdx = rows.findIndex((r) => r.identifier === groupIdentifier);
		if (headerIdx === -1) {
			rows.splice(sourceIdx, 0, source); // group vanished somehow; put it back rather than lose it
			return;
		}
		const prefix = `${groupIdentifier.replace(/\.TitleBar$/, '')}.`;
		let insertAt = headerIdx + 1;
		while (insertAt < rows.length && rows[insertAt].identifier.startsWith(prefix)) insertAt += 1;
		const memberCount = insertAt - (headerIdx + 1);
		rows.splice(insertAt, 0, { identifier: `${prefix}Track[${memberCount}].TitleBar`, title: source.title });
	}

	/** Replace every currently-selected row with one new flat Group Track
	 * at the position of the first one -- the fake's stand-in for what a
	 * real ⌘G does to a flat selection touching no existing group. */
	function createGroupFromSelection() {
		const selectedIds = new Set(selected);
		const firstIdx = rows.findIndex((r) => selectedIds.has(r.identifier));
		if (firstIdx === -1) return;
		const members = rows.filter((r) => selectedIds.has(r.identifier));
		rows = rows.filter((r) => !selectedIds.has(r.identifier));
		const groupIdentifier = `SessionView.GroupTrack[${nextGroupNumber - 1}].TitleBar`;
		const prefix = `${groupIdentifier.replace(/\.TitleBar$/, '')}.`;
		const groupRows = [
			{ identifier: groupIdentifier, title: `${nextGroupNumber}-Group` },
			...members.map((m, i) => ({ identifier: `${prefix}Track[${i}].TitleBar`, title: m.title }))
		];
		nextGroupNumber += 1;
		rows.splice(firstIdx, 0, ...groupRows);
	}

	const axHelper = {
		request: vi.fn(async (verb: string, args: Record<string, unknown>) => {
			calls.push([verb, args]);
			if (verb === options.failVerb) throw new FakeAxError(options.failCode || 'ax-action-failed', 'no');

			if (verb === 'read') {
				const count = selected.size;
				const raw = `(\n${Array.from({ length: count }, () => '    "<AXUIElement 0x1> {pid=1}"').join(',\n')}\n)`;
				return { attributes: { AXSelectedRows: raw } };
			}
			if (verb === 'dump') {
				return { nodes: rows.map((r) => ({ ...r, role: 'AXRow' })) };
			}
			if (verb === 'system_click') {
				const target = args.target as { identifier: string };
				const modifiers = (args.modifiers as Modifiers) || [];
				const id = target.identifier;
				if (options.missAlwaysFor?.has(id)) {
					return {}; // the measured failure mode: nothing changes, no error, ever
				}
				if (options.missOnceFor?.has(id) && !missedClicks.has(id)) {
					missedClicks.add(id);
					return {}; // the measured failure mode: nothing changes, no error
				}
				if (modifiers.includes('cmd')) {
					if (selected.has(id)) selected.delete(id);
					else selected.add(id);
				} else {
					selected = new Set([id]);
				}
				return {};
			}
			if (verb === 'system_drag') {
				const fromId = (args.from as { target: { identifier: string } }).target.identifier;
				const toId = (args.to as { target: { identifier: string } }).target.identifier;
				if (options.dragMissAlwaysFor?.has(fromId)) {
					return {}; // the measured click failure mode, extended to a drag: nothing moves, no error
				}
				if (options.dragMissOnceFor?.has(fromId) && !missedDrags.has(fromId)) {
					missedDrags.add(fromId);
					return {};
				}
				const groupIdentifier = groupIdentifierOf(toId) ?? toId;
				moveRowIntoGroup(fromId, groupIdentifier);
				timeline.push('system_drag');
				return {};
			}
			if (verb === 'system_key') {
				createGroupFromSelection(); // only GROUP_KEY (plain ⌘G) travels this way now
				timeline.push('system_key');
				return {};
			}
			return {};
		})
	};

	const surfaceCalls: Array<[string, ...unknown[]]> = [];
	let groupHandlersRef: { onSurfaceMessage: (m: { address: string; args: unknown[] }) => boolean } | null = null;
	const sendToSurface = options.withSurface
		? (address: string, args: unknown[]) => {
			surfaceCalls.push([address, ...args]);
			if (options.surfaceUnreachable) throw new Error('python surface port is not open');
			const [id] = args;
			if (address === RECORD_SUSPEND_ADDRESS) timeline.push('record_suspend');
			else if (address === RECORD_RESUME_ADDRESS) timeline.push('record_resume');
			queueMicrotask(() => {
				if (address === RECORD_SUSPEND_ADDRESS) {
					groupHandlersRef!.onSurfaceMessage({
						address: RECORD_SUSPEND_ACK_ADDRESS,
						args: [id, options.recordModeOn ? 1 : 0]
					});
				} else if (address === RECORD_RESUME_ADDRESS) {
					groupHandlersRef!.onSurfaceMessage({ address: RECORD_RESUME_ACK_ADDRESS, args: [id] });
				}
			});
		}
		: undefined;

	const groupHandlers = createLiveGroupTracks({ axHelper, logger: silent, sendToSurface });
	groupHandlersRef = groupHandlers;
	const replies: unknown[][] = [];
	const ws: Ws = {
		readyState: 1,
		send: (raw: string) => {
			const message = JSON.parse(raw);
			expect(message.address).toBe(GROUP_REPLY_ADDRESS);
			replies.push(message.args);
		}
	};

	return {
		calls, replies, ws, surfaceCalls, timeline,
		rows: () => rows,
		group: (id: string, members: Member[]) =>
			groupHandlers.handleGroup(ws, { args: [id, JSON.stringify(members)] }),
		groupRaw: (id: string, membersJson: string) =>
			groupHandlers.handleGroup(ws, { args: [id, membersJson] }),
		systemClicks: () => calls.filter(([v]) => v === 'system_click'),
		systemDrags: () => calls.filter(([v]) => v === 'system_drag'),
		systemKeys: () => calls.filter(([v]) => v === 'system_key'),
		recordSuspends: () => surfaceCalls.filter(([a]) => a === RECORD_SUSPEND_ADDRESS),
		recordResumes: () => surfaceCalls.filter(([a]) => a === RECORD_RESUME_ADDRESS)
	};
}

const shaker: Member = { path: 'tracks/0', name: 'Shaker' };
const drive2: Member = { path: 'tracks/1', name: 'Drive 2' };
const guitar: Member = { path: 'tracks/2', name: 'Guitar' };
const memphis: Member = { path: 'tracks/3', name: 'Memphis Studio + Plymouth' };
const oneGroup: Member = { path: 'tracks/0', name: '1-Group' };

describe('bridge: group -- a brand-new group (nothing tapped touches an existing one)', () => {
	it('a lone member: one plain click to confirm the selection, then the real ⌘G', async () => {
		const r = rig();
		await r.group('c1', [shaker]);
		// The build-the-selection clicks, before whatever the post-⌘G
		// re-select tacks on at the end (covered by its own test below).
		expect(r.systemClicks().map(([, args]) => args).slice(0, 1)).toEqual([
			{ target: { role: 'AXRow', identifier: 'SessionView.Track[0].TitleBar', root: 'main' }, modifiers: [] }
		]);
		expect(r.systemKeys()).toEqual([['system_key', { key: 'g', modifiers: ['cmd'] }]]);
		expect(r.replies).toEqual([['c1', 1, '', '']]);
	});

	it('builds the whole selection fresh -- plain click first member, Cmd-click the rest -- then the real ⌘G', async () => {
		const r = rig();
		await r.group('c1', [shaker, drive2]);

		expect(r.systemClicks().map(([, args]) => args).slice(0, 2)).toEqual([
			{ target: { role: 'AXRow', identifier: 'SessionView.Track[0].TitleBar', root: 'main' }, modifiers: [] },
			{ target: { role: 'AXRow', identifier: 'SessionView.Track[1].TitleBar', root: 'main' }, modifiers: ['cmd'] }
		]);
		expect(r.systemKeys()).toEqual([['system_key', { key: 'g', modifiers: ['cmd'] }]]);
		expect(r.replies).toEqual([['c1', 1, '', '']]);
	});

	it('re-selects the new group after creating it, so it ends up the selected track', async () => {
		const r = rig();
		await r.group('c1', [shaker, drive2]);

		expect(r.replies).toEqual([['c1', 1, '', '']]);
		// The fake's own ⌘G handler built a real "1-Group" from the selection;
		// the last click must be its header, plain (a real select, not
		// another member added to it).
		const clicks = r.systemClicks().map(([, args]) => args);
		expect(clicks.at(-1)).toEqual({
			target: { role: 'AXRow', identifier: 'SessionView.GroupTrack[0].TitleBar', root: 'main' },
			modifiers: []
		});
	});

	it('retries a click that silently misses, and succeeds once it registers', async () => {
		const r = rig({ missOnceFor: new Set(['SessionView.Track[1].TitleBar']) });
		await r.group('c1', [shaker, drive2]);
		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.systemClicks().filter(([, a]) => (a.target as { identifier: string }).identifier === 'SessionView.Track[1].TitleBar')).toHaveLength(2); // one miss, one that took
	});

	it('gives up after repeated misses with a named error', async () => {
		const r = rig({ missAlwaysFor: new Set(['SessionView.Track[1].TitleBar']) });
		await r.group('c1', [shaker, drive2]);
		expect(r.replies[0]).toEqual(['c1', 0, 'click-did-not-register', expect.any(String)]);
	});

	it('refuses an empty member list', async () => {
		const r = rig();
		await r.group('c1', []);
		expect(r.replies[0]).toEqual(['c1', 0, 'no-members', expect.any(String)]);
	});

	it('refuses malformed JSON rather than throwing past the reply', async () => {
		const r = rig();
		await r.groupRaw('c1', 'not json');
		expect(r.replies[0]).toEqual(['c1', 0, 'bad-request', expect.any(String)]);
	});

	it('refuses a member name with no matching header row', async () => {
		const r = rig();
		await r.group('c1', [shaker, { path: 'tracks/9', name: 'Nonexistent Track' }]);
		expect(r.replies[0]).toEqual(['c1', 0, 'track-row-mismatch', expect.any(String)]);
	});

	it('reports a helper that is down rather than half-grouping', async () => {
		const r = rig({ failVerb: 'system_key' });
		await r.group('c1', [shaker]);
		expect(r.replies[0][1]).toBe(0);
	});

	it('two calls in a row never interfere -- there is no shared gesture state to race', async () => {
		const r = rig();
		await Promise.all([r.group('c1', [shaker]), r.group('c2', [drive2])]);
		expect(r.replies.map((a) => a[1])).toEqual([1, 1]);
	});
});

describe('bridge: group -- adding to an existing group (drag, never ungroup)', () => {
	it('drags the one new track onto the group and never opens a menu or ungroups anything', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP });
		// Shaker anchors the gesture and is already in "1-Group"; Guitar, a
		// flat track, is the one new member.
		await r.group('c1', [shaker, guitar]);

		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.calls.some(([v]) => v === 'show_menu' || v === 'pick')).toBe(false); // no menu, ever
		expect(r.systemKeys()).toEqual([]); // no ⌘G either -- the group already exists
		expect(r.systemDrags().map(([, args]) => args)).toEqual([{
			from: { target: { role: 'AXRow', identifier: 'SessionView.Track[1].TitleBar', root: 'main' } },
			to: { target: { role: 'AXRow', identifier: 'SessionView.GroupTrack[0].Track[1].TitleBar', root: 'main' } } // the group's current last member (Drive 2)
		}]);

		// The group survived as the exact same object -- same identifier,
		// same name -- with Guitar now one of its children.
		const rows = r.rows();
		expect(rows.find((row) => row.identifier === 'SessionView.GroupTrack[0].TitleBar')?.title).toBe('1-Group');
		expect(rows.some((row) => row.identifier.startsWith('SessionView.GroupTrack[0].') && row.title === 'Guitar')).toBe(true);

		// The final click lands back on the anchor (Shaker) -- not the group
		// -- so folding a track into an existing bus doesn't yank the view
		// away from whatever the performer was already looking at.
		const lastClick = r.systemClicks().at(-1);
		expect(lastClick?.[1]).toEqual({ target: { role: 'AXRow', identifier: 'SessionView.GroupTrack[0].Track[0].TitleBar', root: 'main' }, modifiers: [] });
	});

	it('drags every new tapped track in, one at a time, each onto the group\'s then-current last member', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP });
		await r.group('c1', [shaker, guitar, memphis]);

		expect(r.replies).toEqual([['c1', 1, '', '']]);
		const drags = r.systemDrags().map(([, args]) => args as { from: { target: { identifier: string } }; to: { target: { identifier: string } } });
		expect(drags).toHaveLength(2);
		expect(drags[0].from.target.identifier).toBe('SessionView.Track[1].TitleBar'); // Guitar, first tapped
		expect(drags[0].to.target.identifier).toBe('SessionView.GroupTrack[0].Track[1].TitleBar'); // Drive 2, the last member before Guitar lands
		expect(drags[1].from.target.identifier).toBe('SessionView.Track[2].TitleBar'); // Memphis -- re-resolved fresh by name, from a fresh dump
		expect(drags[1].to.target.identifier).toBe('SessionView.GroupTrack[0].Track[2].TitleBar'); // Guitar, now the last member

		const rows = r.rows();
		const memberTitles = rows
			.filter((row) => row.identifier.startsWith('SessionView.GroupTrack[0].') && row.identifier !== 'SessionView.GroupTrack[0].TitleBar')
			.map((row) => row.title);
		expect(memberTitles).toEqual(['Shaker', 'Drive 2', 'Guitar', 'Memphis Studio + Plymouth']);
	});

	it('tapping the group\'s own strip names nothing new by itself, and lands back on the dragged-in anchor', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP });
		// Anchor on Guitar (flat), tap the group's own header row -- the
		// group itself is not a new member, but it IS the one being added to.
		// This is the exact "highlight a track, hold Group, tap the existing
		// group, let go" gesture.
		await r.group('c1', [guitar, oneGroup]);

		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.systemDrags().map(([, args]) => args)).toEqual([{
			from: { target: { role: 'AXRow', identifier: 'SessionView.Track[1].TitleBar', root: 'main' } },
			to: { target: { role: 'AXRow', identifier: 'SessionView.GroupTrack[0].Track[1].TitleBar', root: 'main' } }
		}]);
		// Guitar was the anchor AND the one just dragged in -- the final
		// click must find it at its NEW, post-drag identifier, not its old
		// flat one, and select it rather than the group.
		const lastClick = r.systemClicks().at(-1);
		expect(lastClick?.[1]).toEqual({ target: { role: 'AXRow', identifier: 'SessionView.GroupTrack[0].Track[2].TitleBar', root: 'main' }, modifiers: [] });
	});

	it('retries a drag that silently misses, and succeeds once it registers', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP, dragMissOnceFor: new Set(['SessionView.Track[1].TitleBar']) });
		await r.group('c1', [shaker, guitar]);
		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.systemDrags()).toHaveLength(2); // one miss, one that took
	});

	it('gives up after repeated drag misses with a named error', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP, dragMissAlwaysFor: new Set(['SessionView.Track[1].TitleBar']) });
		await r.group('c1', [shaker, guitar]);
		expect(r.replies[0]).toEqual(['c1', 0, 'drag-did-not-register', expect.any(String)]);
	});

	it('reports a helper that is down mid-merge rather than half-dragging', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP, failVerb: 'system_drag' });
		await r.group('c1', [shaker, guitar]);
		expect(r.replies[0][1]).toBe(0);
	});

	it('refuses to merge across two different existing groups', async () => {
		const twoGroups: Row[] = [
			{ identifier: 'SessionView.GroupTrack[0].TitleBar', title: '1-Group' },
			{ identifier: 'SessionView.GroupTrack[0].Track[0].TitleBar', title: 'Shaker' },
			{ identifier: 'SessionView.GroupTrack[1].TitleBar', title: '2-Group' },
			{ identifier: 'SessionView.GroupTrack[1].Track[0].TitleBar', title: 'Guitar' }
		];
		const r = rig({ dumpRows: twoGroups });
		await r.group('c1', [shaker, guitar]);
		expect(r.replies[0]).toEqual(['c1', 0, 'multi-group-merge-unsupported', expect.any(String)]);
		expect(r.systemDrags()).toEqual([]); // refused before touching anything
	});

	it('refuses a no-op: just the anchor, and it is already grouped', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP });
		await r.group('c1', [shaker]); // already in "1-Group"
		expect(r.replies[0]).toEqual(['c1', 0, 'already-grouped', expect.any(String)]);
		expect(r.systemDrags()).toEqual([]);
		expect(r.systemKeys()).toEqual([]); // never touched Live
	});

	it('refuses a no-op when every tapped track is already inside the one group touched', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP });
		await r.group('c1', [shaker, drive2]); // both already members
		expect(r.replies[0]).toEqual(['c1', 0, 'already-grouped', expect.any(String)]);
		expect(r.systemDrags()).toEqual([]);
	});
});

describe('bridge: group -- borrowing the record button for a reposition (2026-09-21)', () => {
	it('never asks the surface at all when nothing is wired up (matches every test above)', async () => {
		// FOUR_FLAT_ROWS with [shaker, guitar] is NOT contiguous (Drive 2 sits
		// between them at position 1) -- if the surface wiring were somehow
		// engaging anyway, this is exactly the case that would trip it.
		const r = rig();
		await r.group('c1', [shaker, guitar]);
		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.surfaceCalls).toEqual([]);
	});

	it('a contiguous new-group selection never suspends record, even with the surface wired', async () => {
		const r = rig({ withSurface: true, recordModeOn: true });
		await r.group('c1', [shaker, drive2]); // positions 0,1 -- already together
		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.recordSuspends()).toEqual([]);
		expect(r.recordResumes()).toEqual([]);
	});

	it('a scattered new-group selection suspends record before ⌘G and resumes after, when record was on', async () => {
		// Shaker (0) and Guitar (2) -- Drive 2 sits between them.
		const r = rig({ withSurface: true, recordModeOn: true });
		await r.group('c1', [shaker, guitar]);
		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.recordSuspends()).toHaveLength(1);
		expect(r.recordResumes()).toHaveLength(1);
		// Order matters: suspended before the ⌘G, resumed after.
		expect(r.timeline).toEqual(['record_suspend', 'system_key', 'record_resume']);
	});

	it('does not resume when the surface reports record was already off', async () => {
		const r = rig({ withSurface: true, recordModeOn: false });
		await r.group('c1', [shaker, guitar]); // scattered -- suspend is still asked
		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.recordSuspends()).toHaveLength(1);
		expect(r.recordResumes()).toEqual([]); // nothing to put back
	});

	it('a contiguous merge (new member already sits next to the group) never suspends record', async () => {
		const r = rig({ dumpRows: ONE_EXISTING_GROUP, withSurface: true, recordModeOn: true });
		await r.group('c1', [shaker, guitar]); // Guitar sits immediately after the group
		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.recordSuspends()).toEqual([]);
	});

	it('a merge with an untouched track sitting between the group and the new member suspends record', async () => {
		const r = rig({ dumpRows: GROUP_WITH_GAP_BEFORE_TARGET, withSurface: true, recordModeOn: true });
		await r.group('c1', [shaker, guitar]); // Bass sits between the group and Guitar
		expect(r.replies).toEqual([['c1', 1, '', '']]);
		expect(r.recordSuspends()).toHaveLength(1);
		expect(r.recordResumes()).toHaveLength(1);
		expect(r.timeline).toEqual(['record_suspend', 'system_drag', 'record_resume']);
	});

	it('a surface that never answers the suspend still lets the gesture finish, never resuming', async () => {
		const r = rig({ withSurface: true, surfaceUnreachable: true });
		await r.group('c1', [shaker, guitar]); // scattered
		expect(r.replies).toEqual([['c1', 1, '', '']]); // the gesture itself is unaffected
		expect(r.systemKeys()).toHaveLength(1); // ⌘G still ran
		expect(r.recordResumes()).toEqual([]); // never claimed it suspended anything
	});
});
