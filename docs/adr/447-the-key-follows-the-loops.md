# ADR-447: The key follows the loops until a hand sets it

## Status
**Accepted** (2026-09-19; extends ADR-446, key detection by votes)

## Context

ADR-446 made the key detectable on demand: a Detect button in the picker,
a hold on the Master strip's key band. Within the hour the operator asked
for the obvious next step: "follow mode should be default. As soon as a
new loop is created we should recalculate and set the key. Choosing a
specific key by the browser or clicking a key lock button in the browser
can turn off follow mode." A looper builds a set one loop at a time; the
key is a fact about the loops that exist, and asking for it after each
one is a tap the performer should not have to remember.

## Decision

**Follow is on by default and persisted** (`key_follow` in
`SessionSettingsComponent`, beside `auto_arm` and the others: same
address shape, `/looping/v3/session/key_follow [0|1]` both ways plus a
`/query`, init-emit and re-emit on accept, `logs/session-settings.json`).
A locked key stays locked across a set load or a Live restart.

**What counts as a new loop.** `KeyDetectComponent` keeps one
`playing_slot_index` listener per regular track (rebound with the
structural-change composite, like the playhead's) and, on the clip a slot
starts playing, an `is_recording` listener. A follow pass is scheduled
when a slot starts playing a MIDI clip, and when a recording clip finishes
recording — the moment its notes exist. A slot stopping schedules
nothing: a stop is not a new loop, and the key a performer built should
not drift because one part dropped out. Passes coalesce: however many
tracks change at one launch quantum, one pass runs about 300 ms later,
off the notification thread, where LOM writes are legal.

**What a pass does.** The same analysis as the Detect button, and the
same broadcast on `…/scale/detected`. It writes only a `sure` or
`plausible` answer, and only when it differs from Live's current key;
`unsure` and `no-key` leave the key alone. The write is the picker's
three (root, scale name, scale mode on) in one undo step.

**What turns Follow off.** Any key the component did not write. It
listens to the song's `scale_information` and compares each change with
the key it last wrote; a different one means a hand — the picker, Live's
control bar, Push — chose, and Follow turns itself off (through the
settings handler, so the toggle persists and echoes). The picker's own
picks also send `key_follow 0` first, so its toggle flips at once rather
than on the echo. Its **Following / Locked** button toggles the setting
directly; turning Follow back on runs a pass immediately. The Behavior
column in Settings carries the same switch, and the Master strip's key
band wears a small lock while the key is locked.

**What Follow does not do.** It never runs continuously, never re-writes
on a stop, and never touches a key it is not sure or fairly sure of. The
on-demand Detect and the band hold still work while Follow is on; their
writes are the component's own and do not turn it off.

## Consequences

- A new loop can change the key while the performer plays. That is the
  ask; the reasons stay in the picker for the doubtful cases, and one
  pick, anywhere, ends it until the toggle says otherwise.
- Follow's writes are undo steps in Live, like the picker's. A Cmd-Z
  after a loop may undo the key before the loop — and the first field test
  (2026-09-19, 11:17) showed the cost: undoing two recordings walked back
  through Follow's write, the key returned to C Major, and Follow read
  that as a hand and locked itself. So a key change back to the key that
  stood **before** Follow's last write is Live's undo, not a hand, and a
  change back to the written key after it is the redo; neither locks. A
  hand choosing exactly the pre-write key from Live's own chooser is
  misread as an undo, the documented cost; the picker's picks lock
  explicitly and are unaffected.
- The analysis reads only what is launched, so the first pass after a set
  load waits for the first launch. A set opened with its key saved keeps
  that key until then.
- `KeyDetectComponent` now owns LOM listeners and needs the structural
  composite and `disconnect`; its `handle_detect` is unchanged.

## Files

- `surface/components/SessionSettingsComponent.py` — the
  toggle; `KeyDetectComponent.py` — the listeners, the pass, the lock
  inference; `LoopingSurface.py` — wiring and the composite entry.
- `interface/src/lib/api/handlers/v3Session.ts`, `stores/session.svelte.ts`
  — the address and the flag; `components/v6/browser/DrillDownBrowser.v6.svelte`
  — Following / Locked, picks lock; `components/v6/central/views/
  SystemCentralView.svelte` — the Behavior switch;
  `components/v6/tracks/MasterTrack.svelte` — the lock in the band.
- Tests: `tests/test_session_settings_component.py`,
  `tests/test_key_detect_component.py`; vitest in `handlers/v3Session.test.ts`
  and `stores/sessionStore.scaleDetected.test.ts`.

## Addendum — what "a new loop" means, and who set the key (2026-09-19, evening)

The first field tests and a code review changed three things the decision
above describes; this is how Follow works now.

**Every change to what is playing is heard.** The component attaches no
listeners of its own any more. `PlayheadComponent` already follows every
track's playing clip — the fresh-recording race included — so it grew a
change hook (`add_change_callback`) that calls the component when it
re-resolves a track's clip (a launch, a stop, a clip appearing or deleted,
a moved loop), when a take ends, and when a clip's notes change. A pass
then diffs what is playing against what the last pass analyzed, clips
keyed by LOM identity: a new clip, a finished take or a re-looped clip is
an **add**; a clip gone, or one whose notes changed in pitch class or
timing, is a **correct**; nothing changed is no pass at all — which is what
Permute's octave and mute steps come to, the comparison being blind to
both. A clip still recording is left out until its take ends. Unchanged
clips are not re-read.

**The write policy** (`key_detect.follow_decision`, pure and tested):

- a key the loops' notes are outside of is replaced by any answer;
- a key that still fits stays after a correct — a part dropping out, an
  overdub, a note edit or a Permute variation never moves it;
- after an add it moves on a `sure` answer, or on a `plausible` one when
  the key is not Follow's own (Live's default, the set's saved key) — so
  the first loop sets the key, and two relative keys do not trade places
  on every loop.

This supersedes "writes only a sure or plausible key that differs" and "a
stop schedules nothing" above.

**Who set the key** is told apart without guessing from key values, which
the first version did and got wrong three ways (a hand picking the
pre-write key read as an undo; a second Cmd-Z through an earlier write read
as a hand; a key Follow wrote before a lock read as its own after):

- `scale_root` / `scale_name` from the wire are a hand. The component owns
  the two addresses, turns Follow off before delegating the write — for any
  client, and for a pick of the key already set, which Live signals with
  nothing. The picker no longer sends its own `key_follow 0` first.
- A key changed inside Live is classified a tick after the notification
  from `song.can_redo`. Measured on the rig: after `song.undo` it reads
  True, inline and a tick later; after `song.redo` that empties the stack,
  False; after a fresh write, False. So a redo waiting is Live's undo or
  redo — any depth — and keeps Follow on; none is a hand and turns it off,
  unless the key is Follow's own (the last redo landing back on it). A pass
  or the verb runs a pending classification first, so no write of Follow's
  lands before a hand's change is read.
- What Follow owns is forgotten whenever it turns off or on.
- Follow runs only while the app's dev server is present
  (`compose_key_follow_gate`, the arm-follows-selection shape): a
  production session in bare Live never has its key rewritten, and a hand
  there does not lock the next performance's Follow either.

The rig's own log from the evening shows one lock at 11:51:55: Live
reported no redo waiting, i.e. a fresh choice, not a Cmd-Z.

**On at every start, not persisted** (the same evening, the operator's
call). The decision above persisted `key_follow` like `auto_arm`. On the rig
a lock read from a key change inside Live then outlived two restarts, and
the set sat on C Major while its loop played a single C#. Follow is now on
at every surface start — a Live restart, a set load — and a lock lasts until
then; an old settings file that still says locked is ignored.

## Tags
`key-follow`, `key-detection`, `session-settings`, `scale`, `playhead`, `undo`, `extends-446`

