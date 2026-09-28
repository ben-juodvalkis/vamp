/**
 * Group tracks, through Live's own UI, from a hold-and-tap gesture.
 *
 * Live's LOM cannot group at all: no create-group call, no track move, and
 * `group_track` / `is_foldable` / `is_grouped` are read-only. Everything here
 * drives Live's real Accessibility surface instead, and every technique is
 * one this project measured before trusting it (ADR-439 research,
 * 2026-09-19/20):
 *   - Selecting rows by writing the header outline's AXSelectedRows
 *     (`select`) does not reliably move Live's selection at all — 0 of 8 in
 *     a controlled rerun.
 *   - `system_click` (a real click through the global HID event stream, not
 *     CGEventPostToPid, which Live ignores outright) DOES move Live's real
 *     selection — a plain click selects, Cmd-held ADDS to the selection,
 *     Cmd-held again on an already-selected row REMOVES it (ordinary Cocoa
 *     toggle behaviour). Not perfectly reliable: about 2 in 5 single clicks
 *     silently did nothing in one measured session, hence the retry-and-
 *     verify wrapper below.
 *   - The context menu's "Group Tracks" is reliable but visibly pops a menu
 *     over Live's window — unwanted while the performer is working from the
 *     iPad. `system_key` posts the real ⌘G shortcut instead, through the
 *     same global event stream: confirmed to trigger grouping with no menu
 *     ever appearing, and reliable every time it was tried.
 *   - Live's "Group Tracks" always NESTS when the selection touches an
 *     existing group (measured both ways: selecting a member, or the
 *     group's own header row, alongside a new track). There is no
 *     selection shape that merges it flat.
 *   - Adding a track to an existing group therefore does **not** go through
 *     "Group Tracks" at all: it drags the new track's header directly onto
 *     the group's own rows (`system_drag`), Live's native way to move a
 *     track's position or its group membership — confirmed on the rig,
 *     2026-09-20, dropping onto the group's own last member row: the track
 *     landed as a new flat member and the group kept its own identity (same
 *     AX row, same name) throughout. **This replaced an ungroup-then-
 *     regroup dance** that dissolved the existing group and built a fresh
 *     one via ⌘G — which worked, but a dissolved-and-recreated group is a
 *     *different* Group Track object, and anything on the ORIGINAL group's
 *     own chain (a bus compressor, sends) does not travel to the new one.
 *     A drag never touches the group at all, so whatever is on its chain is
 *     simply untouched. Creating a **brand-new** group (nothing tapped
 *     already belongs to one) is unaffected by any of this — that path
 *     still builds a fresh selection and presses ⌘G, since there is no
 *     existing group's chain to protect.
 *
 * **One shot, not a gesture (2026-09-20 rewrite).** The first version had a
 * `start` / `tap` / `commit` / `cancel` wire protocol matching the UI's
 * hold-and-tap gesture one step at a time — a real Cmd-click landed on every
 * tap, live, while the button was still held. That made each tap a real
 * Accessibility round trip racing whatever the *next* tap or a `commit`/
 * `cancel` did to the same shared gesture record, and it crashed on the rig
 * with nothing exotic in play: `commit` nulls the record at the top of its
 * own function, before its awaits, precisely so a fresh gesture can start
 * while it finishes — and a `tap` already past its own "is there a gesture"
 * check but still awaiting `dumpRows()` read that record out from under
 * itself and threw on the next line. Tapping tracks is now purely a UI-side
 * decision (`groupGestureStore`, no wire calls at all); this module gets
 * called exactly once, with the finished member list, when the gesture ends.
 * That also removes the *reason* a merge needs `dumpRows()` was flagged
 * flaky against a live-updating tree: nothing here runs until the tapping is
 * over, so the tree it reads is not still changing under the read.
 */

const GROUP_ADDRESS = '/looping/v3/track/group';
const GROUP_REPLY_ADDRESS = '/looping/v3/track/group/reply';

/**
 * Live refuses to reposition a track that is "currently recording" -- a
 * real modal dialog, not a wire error, that fires whenever the tapped
 * tracks actually need to move (a non-contiguous new group, or a drag into
 * an existing one). Under `npm run ipad`'s auto-capture, `record_mode` is
 * on for the whole time the transport plays, so this used to make the
 * gesture silently do nothing mid-take. Ben's call (2026-09-21): only when
 * a reposition is actually about to happen, ask the surface to turn
 * record_mode off, do it, turn record_mode back on (`RecordSuspendComponent`,
 * the Python surface's half). Grouping tracks that already sit together
 * needs no reposition at all -- Live's own Group Tracks wraps a contiguous
 * selection in place -- so the bracket is skipped there entirely: no
 * recording gap to pay for a dialog that could never have fired.
 */
const RECORD_SUSPEND_ADDRESS = '/looping/v3/track/group/record_suspend';
const RECORD_SUSPEND_ACK_ADDRESS = '/looping/v3/track/group/record_suspend/ack';
const RECORD_RESUME_ADDRESS = '/looping/v3/track/group/record_resume';
const RECORD_RESUME_ACK_ADDRESS = '/looping/v3/track/group/record_resume/ack';
const RECORD_SURFACE_REPLIES = new Set([RECORD_SUSPEND_ACK_ADDRESS, RECORD_RESUME_ACK_ADDRESS]);
/** How long the surface gets to answer a suspend/resume before this gives
 * up and proceeds anyway -- this bracket is a nicety, never a blocker. */
const RECORD_SURFACE_TIMEOUT_MS = 2000;

/** A `system_click` is retried this many times before the gesture gives up. */
const CLICK_RETRIES = 3;
/** How long Live is given to reflect a click before the retry reads back. */
const CLICK_VERIFY_SETTLE_MS = 150;
/** Same idea, sized for a `system_drag`: a structural insert (one track
 * gaining a new sibling under a group) is a bigger rebuild than a selection
 * change, though nowhere near the size of the ungroup-and-rebuild-everything
 * this replaced. */
const DRAG_RETRIES = 3;
const DRAG_VERIFY_SETTLE_MS = 250;

const GROUP_KEY = { key: 'g', modifiers: ['cmd'] };

class GroupError extends Error {
    constructor(code, detail = '') {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'GroupError';
        this.code = code;
        this.detail = detail;
    }
}

/**
 * Live writes state into a header's title: "Guitar" becomes "Guitar, Armed"
 * when the track is armed (measured on the rig, 2026-09-19). So the name the
 * UI holds is a prefix of the row's title, not always the whole of it.
 */
function titleNamesTrack(rowTitle, trackName) {
    const title = String(rowTitle || '');
    const name = String(trackName || '');
    if (!name) return true;   // the client did not say; nothing to check against
    return title === name || title.startsWith(`${name}, `);
}

/**
 * The enclosing group's OWN header row -- a clickable identifier, not just
 * the bare prefix -- or null when the row is not inside a group.
 * `SessionView.GroupTrack[0].Track[1].TitleBar` -> `SessionView.GroupTrack[0].TitleBar`.
 * The group's own header row maps to itself (harmless: it means "this row
 * belongs to its own group", which is exactly the overlap `group` checks for
 * when a member IS the group header rather than a track inside it).
 */
function groupIdentifierOf(rowIdentifier) {
    const match = /^(.*GroupTrack(?:\[\d+\])?)\./.exec(String(rowIdentifier || ''));
    return match ? `${match[1]}.TitleBar` : null;
}

function rawTarget(identifier) {
    return { role: 'AXRow', identifier, root: 'main' };
}

/**
 * Live's own top-level track order, top to bottom -- plain tracks and
 * group headers, in the order `dumpRows()` returns them (the AX tree walk
 * mirrors visual order for the session grid). Excludes a group's nested
 * member rows (they have no position of their own; the group moves as one
 * block) and the Return/Main rail, which Live never interleaves with the
 * session track order.
 */
function topLevelOrder(rows) {
    return rows
        .filter((r) => /^SessionView\.(Track|GroupTrack)\[\d+\]\.TitleBar$/.test(r.identifier))
        .map((r) => r.identifier);
}

/**
 * Whether `identifiers` already occupy one unbroken run of `order`, with
 * no untouched track sitting between any two of them. An identifier
 * `order` doesn't contain answers `false` (can't tell -- pay the cost
 * rather than guess). This is the gate for the whole record-suspend
 * bracket: Live only needs to reposition a track when the selection isn't
 * already sitting together, so a contiguous selection can never trip the
 * "currently recording" dialog and the bracket would just cost a
 * pointless gap in whatever a recording track is capturing.
 */
function isContiguous(order, identifiers) {
    const positions = identifiers
        .map((id) => order.indexOf(id))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
    if (positions.length !== identifiers.length) return false;
    return positions[positions.length - 1] - positions[0] + 1 === positions.length;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} deps
 * @param {{request: Function}} deps.axHelper
 * @param {object} deps.logger
 * @param {(address: string, args: Array<string|number>) => void} [deps.sendToSurface] -
 *   only used for the record-suspend bracket; omitted (tests, or a config
 *   with the wire not built) means the bracket never engages and every
 *   gesture runs exactly as it did before this feature existed.
 * @param {number} [deps.recordSurfaceTimeoutMs]
 */
function createLiveGroupTracks({ axHelper, logger, sendToSurface = null, recordSurfaceTimeoutMs = RECORD_SURFACE_TIMEOUT_MS }) {
    const pendingRecord = new Map();
    let recordSeq = 0;

    /** Surface → bridge. True when the message was one of ours (never
     * relayed to the UI). Mirrors `drumSwapSimilar.js`'s `onSurfaceMessage`. */
    function onSurfaceMessage(message) {
        if (!RECORD_SURFACE_REPLIES.has(message.address)) return false;
        const args = message.args || [];
        const waiter = pendingRecord.get(String(args[0]));
        if (waiter && waiter.replyAddress === message.address) {
            pendingRecord.delete(String(args[0]));
            clearTimeout(waiter.timer);
            waiter.resolve(args);
        }
        return true;
    }

    function askSurfaceForRecord(address, replyAddress) {
        recordSeq += 1;
        const id = `group-record-${process.pid}-${recordSeq}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pendingRecord.delete(id);
                logger.warn('Group: record suspend/resume surface hop timed out', { address });
                resolve(null);
            }, recordSurfaceTimeoutMs);
            pendingRecord.set(id, { resolve, timer, replyAddress });
            try {
                sendToSurface(address, [id]);
            } catch (err) {
                clearTimeout(timer);
                pendingRecord.delete(id);
                logger.warn('Group: could not reach the surface for record suspend/resume', {
                    address, error: err.message
                });
                resolve(null);
            }
        });
    }

    /**
     * Brackets `fn` with a record_mode suspend/resume, but only when
     * `needed` is true (the tracks about to move are not already
     * contiguous) and the surface wire is actually built. A suspend the
     * surface never answers (timeout, or no reply channel at all) degrades
     * to "assume it was off" -- `fn` still runs, at worst hitting the same
     * dialog this feature exists to avoid, never blocked on this optional
     * safety net. `fn` runs exactly once either way.
     */
    async function withRecordSuspendedIfNeeded(needed, fn) {
        if (!needed || !sendToSurface) return fn();
        const suspendAck = await askSurfaceForRecord(RECORD_SUSPEND_ADDRESS, RECORD_SUSPEND_ACK_ADDRESS);
        const wasOn = Boolean(suspendAck && Number(suspendAck[1]) === 1);
        try {
            return await fn();
        } finally {
            if (wasOn) {
                await askSurfaceForRecord(RECORD_RESUME_ADDRESS, RECORD_RESUME_ACK_ADDRESS);
            }
        }
    }

    async function selectedRowCount() {
        const read = await axHelper.request('read', {
            target: 'tracks.headers',
            attributes: ['AXSelectedRows']
        });
        const raw = String(read.attributes?.AXSelectedRows ?? '');
        return (raw.match(/AXUIElement/g) || []).length;
    }

    /**
     * Every track header row, by title — top-level or nested inside a group.
     * Rows are addressed by index elsewhere in this codebase
     * (`SessionView.Track[N].TitleBar`), but grouping and folding both
     * reshuffle those indices, so a member is found by name instead.
     */
    async function dumpRows() {
        const dump = await axHelper.request('dump', {
            root: 'main',
            match: 'TitleBar',
            limit: 120,
            depth: 10
        });
        return (dump.nodes || []).filter((n) => n.role === 'AXRow');
    }

    function rowFor(rows, trackName) {
        const row = rows.find((r) => titleNamesTrack(r.title, trackName));
        if (!row) return null;
        return { identifier: row.identifier, title: row.title, groupIdentifier: groupIdentifierOf(row.identifier) };
    }

    /** The group whose members include every one of `memberNames` -- found
     * by content, not by trusting an index or Live's current selection,
     * the same discipline every other row lookup here already follows.
     * A superset match (not exact) because the merge path can fold in
     * former members `group()`'s own caller never named. */
    function findGroupRow(rows, memberNames) {
        const headers = rows.filter((r) => groupIdentifierOf(r.identifier) === r.identifier);
        for (const header of headers) {
            const prefix = `${header.identifier.replace(/\.TitleBar$/, '')}.`;
            const childTitles = rows.filter((r) => r.identifier.startsWith(prefix)).map((r) => r.title);
            if (memberNames.every((name) => childTitles.some((title) => titleNamesTrack(title, name)))) {
                return { identifier: header.identifier, title: header.title };
            }
        }
        return null;
    }

    /** Click, then read back the real selection count Live now reports —
     * `system_click` is measured to silently do nothing on some attempts, so
     * every click here is verified, not trusted. */
    async function clickAndVerify(identifier, modifiers, expectedCount) {
        let last = -1;
        for (let attempt = 0; attempt < CLICK_RETRIES; attempt++) {
            await axHelper.request('system_click', { target: rawTarget(identifier), modifiers });
            await delay(CLICK_VERIFY_SETTLE_MS);
            last = await selectedRowCount();
            if (last === expectedCount) return;
        }
        throw new GroupError(
            'click-did-not-register',
            `${identifier} holds ${last} selected rows after asking for ${expectedCount}, over ${CLICK_RETRIES} tries`
        );
    }

    /**
     * Drag `trackName`'s row onto the group's own rows -- Live's native way
     * to add a track to an existing group without dissolving it -- and
     * confirm it actually landed inside, the same read-back-and-retry
     * discipline `clickAndVerify` has for clicks. Drops onto the group's
     * current LAST member row each attempt (re-read fresh every time, since
     * a landed drag shifts what "last" means for the next one), falling
     * back to the group's own header when it currently has no visible
     * members. Already-inside is treated as success with no drag at all --
     * a retry that actually landed last time, or a caller re-checking one
     * that was already there.
     */
    async function dragIntoGroupAndVerify(trackName, groupIdentifier) {
        for (let attempt = 0; attempt < DRAG_RETRIES; attempt++) {
            const rows = await dumpRows();
            const source = rowFor(rows, trackName);
            if (!source) {
                throw new GroupError('track-row-mismatch', `no header row named "${trackName}"`);
            }
            if (source.groupIdentifier === groupIdentifier) return;
            const prefix = `${groupIdentifier.replace(/\.TitleBar$/, '')}.`;
            const currentMembers = rows.filter((r) => r.identifier.startsWith(prefix));
            const dropIdentifier = currentMembers.length > 0
                ? currentMembers[currentMembers.length - 1].identifier
                : groupIdentifier;
            await axHelper.request('system_drag', {
                from: { target: rawTarget(source.identifier) },
                to: { target: rawTarget(dropIdentifier) }
            });
            await delay(DRAG_VERIFY_SETTLE_MS);
            const after = await dumpRows();
            const landed = rowFor(after, trackName);
            if (landed && landed.groupIdentifier === groupIdentifier) return;
        }
        throw new GroupError(
            'drag-did-not-register',
            `"${trackName}" is not inside ${groupIdentifier} after ${DRAG_RETRIES} drag attempts`
        );
    }

    /**
     * Group `members` ([{path, name}], anchor first) — the whole gesture in
     * one call.
     *
     * If the members touch an existing group, nothing is grouped in the
     * Group-Tracks sense at all: every member not already inside that group
     * is dragged onto it (`dragIntoGroupAndVerify`), one at a time, and the
     * group itself — its own identity and whatever is on its own device
     * chain — is never touched. Otherwise this is a brand-new group: builds
     * Live's real selection fresh (a plain click on the first member, then
     * a Cmd-click per remaining member) and presses ⌘G.
     *
     * Ends by re-selecting a track explicitly, so every client's
     * `selected_track` listener echo follows and lands somewhere definite
     * rather than wherever the last click/drag happened to leave it —
     * best-effort in both cases, since the grouping itself already
     * succeeded by that point, so failing to also select something is a
     * warning, not a reason to report the whole gesture as failed. Adding
     * to an existing group lands back on the **anchor** — the track the
     * performer had highlighted before they ever held Group — since folding
     * a track into an existing bus is meant to keep working on that track,
     * not jump the view to the group's own one. A brand-new group has no
     * such anchor to return to (the whole selection just became one new
     * track), so that path lands on the **group** itself instead.
     *
     * Rejects `already-grouped` when every member already belongs to the
     * one group touched (nothing to add), or `multi-group-merge-unsupported`
     * when the members span more than one existing group.
     */
    async function group(members) {
        if (!Array.isArray(members) || members.length === 0) {
            throw new GroupError('no-members', 'no tracks to group');
        }
        const rows = await dumpRows();
        const resolved = members.map((m) => rowFor(rows, m.name));
        const missing = members.find((_, i) => !resolved[i]);
        if (missing) {
            throw new GroupError('track-row-mismatch', `no header row named "${missing.name}"`);
        }
        const involvedGroups = new Set(resolved.map((r) => r.groupIdentifier).filter(Boolean));
        if (involvedGroups.size > 1) {
            throw new GroupError('multi-group-merge-unsupported', 'the tapped tracks span more than one existing group');
        }

        if (involvedGroups.size === 1) {
            const [groupIdentifier] = involvedGroups;
            // A member IS the group's own header row (its strip was tapped)
            // or already lives inside it -- neither names anything new to
            // add. What is left is every genuinely new track.
            const newMembers = members
                .map((m, i) => ({ name: m.name, row: resolved[i] }))
                .filter(({ row }) => row.identifier !== groupIdentifier && row.groupIdentifier !== groupIdentifier);
            if (newMembers.length === 0) {
                throw new GroupError('already-grouped', `${members[0].name} is already in a group`);
            }
            const newMemberNames = newMembers.map((m) => m.name);

            // Same gate as the new-group path below: if the group and every
            // new member already sit together as one run, nothing here is
            // presumed to need the bracket. Not independently measured for
            // the drag path specifically (only the ⌘G case was confirmed
            // live, 2026-09-21) -- applying the same rule rather than a
            // second, unverified one for drag.
            const touched = [groupIdentifier, ...newMembers.map((m) => m.row.identifier)];
            const needsRecordGuard = !isContiguous(topLevelOrder(rows), touched);

            await withRecordSuspendedIfNeeded(needsRecordGuard, async () => {
                for (const name of newMemberNames) {
                    await dragIntoGroupAndVerify(name, groupIdentifier);
                }
            });
            logger.info('Added to group', { group: groupIdentifier, added: newMemberNames, needsRecordGuard });

            // Land back on the anchor -- the track the performer had
            // highlighted before they ever held Group -- not the group
            // itself. Folding a track into an existing bus is meant to keep
            // working on that track, not jump the view over to the group's
            // own (typically bus-only) one. Re-resolved fresh by name rather
            // than reusing a remembered identifier: the anchor may have just
            // been one of the dragged tracks, so its identifier changed.
            try {
                const afterDrags = await dumpRows();
                const anchorRow = rowFor(afterDrags, members[0].name);
                if (anchorRow) await clickAndVerify(anchorRow.identifier, [], 1);
                else logger.warn('Group: could not find the anchor track to re-select it');
            } catch (err) {
                logger.warn('Group: added but could not re-select the anchor', { detail: err.detail || err.message });
            }
            return;
        }

        await clickAndVerify(resolved[0].identifier, [], 1);
        for (let i = 1; i < resolved.length; i++) {
            await clickAndVerify(resolved[i].identifier, ['cmd'], i + 1);
        }

        // Live's own Group Tracks wraps an already-contiguous selection in
        // place -- no reposition, so record_mode being on can't block it.
        // It only needs to shuffle tracks together (and can hit the
        // "currently recording" dialog) when the selection is scattered.
        // Ben's call, 2026-09-21 -- not yet independently measured against
        // a real in-progress recording (that needs an actual take running
        // to observe), so treat this rule itself as worth confirming live.
        const needsRecordGuard = !isContiguous(topLevelOrder(rows), resolved.map((r) => r.identifier));
        await withRecordSuspendedIfNeeded(needsRecordGuard, () => axHelper.request('system_key', GROUP_KEY));
        logger.info('Grouped tracks', { members: members.map((m) => m.name), needsRecordGuard });

        // Ableton already selects the new group as a side effect of ⌘G in
        // the common case, but that is Live's own convenience, not a
        // contract, so this re-selects it explicitly -- found by membership
        // (not trusted from wherever the last Cmd-click left the selection)
        // since this is a genuinely new Group Track with no identifier of
        // its own yet known. Best-effort, same reasoning as the merge path.
        try {
            const afterGroup = await dumpRows();
            const groupRow = findGroupRow(afterGroup, members.map((m) => m.name));
            if (groupRow) await clickAndVerify(groupRow.identifier, [], 1);
            else logger.warn('Group: could not find the new group\'s own row to select it');
        } catch (err) {
            logger.warn('Group: created but could not select it', { detail: err.detail || err.message });
        }
    }

    function reply(ws, openState, requestId, ok, code = '', detail = '') {
        if (ws.readyState === openState) {
            ws.send(JSON.stringify({
                address: GROUP_REPLY_ADDRESS,
                args: [String(requestId ?? ''), ok ? 1 : 0, code, detail]
            }));
        }
    }

    function handleGroup(ws, message, openState = 1) {
        const [requestId, membersJson] = message.args || [];
        return Promise.resolve()
            .then(() => {
                let members;
                try {
                    members = JSON.parse(String(membersJson ?? ''));
                } catch {
                    throw new GroupError('bad-request', 'members must be JSON');
                }
                return group(members);
            })
            .then(() => reply(ws, openState, requestId, true))
            .catch((err) => {
                const code = err.code || 'group-failed';
                const detail = err.detail || err.message || String(err);
                logger.warn('Group gesture failed', { code, detail });
                reply(ws, openState, requestId, false, code, detail);
            });
    }

    return { handleGroup, onSurfaceMessage };
}

module.exports = {
    createLiveGroupTracks,
    GroupError,
    GROUP_ADDRESS,
    GROUP_REPLY_ADDRESS,
    RECORD_SUSPEND_ADDRESS,
    RECORD_SUSPEND_ACK_ADDRESS,
    RECORD_RESUME_ADDRESS,
    RECORD_RESUME_ACK_ADDRESS
};
