# ADR-427: One Pointer Primitive — `use:press` and `use:drag`

## Status
**Accepted** (2026-09-03). **Amended the same day**, three times, all from playing it:
[Addendum 1](#addendum-1-mute-fires-at-finger-down-after-all) reverses
the mute timing decision below,
[Addendum 2](#addendum-2-the-wait-becomes-conditional-on-its-own-reason)
makes the wait conditional, and
[Addendum 3](#addendum-3-mute-becomes-momentary-like-solo) gives mute
Solo's momentary hold.

## Context

This is a live-performance instrument. The operator plays it with two
hands on an iPad Pro 12.9" running the interface as a fullscreen PWA.
Two-handed gestures are the normal case, not an edge case: mute two
tracks at once, hold a Solo while tapping a clip, drag a loop brace with
one hand while the other works the transport.

None of that worked reliably — not because of one bug, but because the
app spoke **four different input dialects**, two of which cannot support
simultaneous fingers.

| Dialect | Where it lived | Multitouch-safe? |
|---|---|---|
| Pointer events + `setPointerCapture` per node | device sliders, XY pads, orb, EQ, MIDI wheel, sequencer grid, Permute, clip editor, `parameters/actions/dragAction.ts` | **Yes** — capture binds one `pointerId` to one element, so N elements take N fingers |
| Pointer events + window listeners filtered by `pointerId` | `useStripGestures`, TrackStrip's Solo, TotalMixStrip, TracksPanelV6 | **Yes**, and deliberately so |
| Touch events reading `touches[0]` | 17 sites | **No** — tracks the wrong finger |
| `onclick` | 106 sites app-wide; 12 on the performance surface | **No** — iOS synthesizes at most one click per gesture |

### `touches[0]` is a wrong-value bug, not a dead control

`event.touches[0]` is *the first finger currently on the glass*, not *the
finger that started this drag*. So a loop brace being dragged while the
other hand held any other control did not merely ignore the second
finger — it started following it. The brace jumped to the other hand's
position and wrote that to Live.

That is why this tier outranked the more-used `onclick` sites in
severity, even though a performer meets it less often: a dead control is
visible, a wrong value is not.

### The specific trap that broke mute

`.header-name` — the mute target in `TrackStrip.svelte` — computed
**`touch-action: auto`**. Nothing set it, and `touch-action` is not an
inherited property, so the `manipulation` declared on `html, body` in
`app.css` never reached it. Inside a horizontally-scrolling panel, `auto`
hands the gesture to the browser, which is then free to suppress the
click.

Measured on the running artifact, not inferred, and the scene rail's step
buttons turned out to compute `auto` for the same reason.

The general lesson: **on iOS, `touch-action` decides whether your pointer
events survive at all.** Any control whose CSS and whose handler are
authored in different places will eventually drift apart exactly like
that one did.

### Prior art

[ADR-364](364-browser-multitouch-secondary-preset-tap.md) describes this
class of bug and its fix — record the starting touch's `identifier` and
match against it instead of indexing `[0]`. **The implementation it
documents no longer exists**: `UnifiedGestureBrowser` and
`BrowserInteractionController` were replaced by
`browser/DrillDownBrowser.v6.svelte`, which uses the pointer dialect.
`getEventCoordinates`, `primaryTouchId` and `findNewTouches` are gone.
Read ADR-364 for the problem statement and the vocabulary; do not go
looking for the code.

## Decision

### The invariant

> Every interaction is owned by exactly one pointer, identified by its
> `pointerId`, from the moment it starts to the moment it ends. No
> handler ever asks "where is the finger" — only "where is *my* finger."

Corollaries, all now enforced:

- No `touches[0]` or `changedTouches[0]` anywhere.
- No module-scope mutable interaction state. Per-node or per-component only.
- Every `pointermove` / `pointerup` / `pointercancel` handler filters by
  the `pointerId` it claimed on `pointerdown`.
- `click` is not an input primitive on the performance surface.
- Every interactive control declares its own `touch-action`.

### One primitive, as Svelte actions

`$lib/actions/` exports two actions and the two pure state machines
behind them:

```
pressMachine.ts   discrete press, per pointerId — down / hold / release
                  with an explicit reason (up, cancel, teardown, slop)
dragMachine.ts    continuous drag, per pointerId — slop threshold and
                  axis commit
press.ts          use:press
drag.ts           use:drag
```

**Actions rather than composables or copied handlers**, for three
structural reasons:

1. An action attaches to a DOM node, so its state is per-node
   *automatically*. The invariant is enforced by the structure, not by
   discipline.
2. An action owns its own teardown. That kills a bug class this repo had
   already been bitten by: a strip unmounting mid-press used to leave a
   track soloed with no finger on it and nothing left to undo it
   (`TracksPanelV6` keys its strips by track index, so folding a group or
   removing an empty track destroys the component under the hand).
3. An action can set `touch-action` on the node it attaches to, so the
   CSS policy and the JS handler cannot drift apart. This is the fix for
   the `.header-name` trap, applied structurally rather than one control
   at a time.

Both machines are **pure**: no DOM, no `window`, no timers, no
`performance.now()`. Every input carries its own `now`, and the hold
threshold is crossed by an explicit `tick()`. Two reasons:

- Multitouch scenarios become table tests. "Finger A goes down on strip
  1, finger B goes down on strip 2, A releases" is three calls and one
  array comparison.
- The synthetic harness runs its preview **hidden**, where
  `requestAnimationFrame` never fires and `setTimeout` is throttled. A
  machine that owned its own clock could not be driven there at all.

Both key their open interactions in a `Map<pointerId, …>`, so the
concurrent case is the same code path as the single-finger one rather
than a second branch. `multiPointer` defaults to **false** — a second
finger on the same button is a fumble, not a second press — and
independence *between* controls comes from each node owning its own
machine, not from that flag.

### Capture vs window listeners

Both are correct, and the choice is per control:

- **`setPointerCapture`** where the target is a single stable element.
  The browser routes the pointer for you.
- **Window listeners + explicit `pointerId` filtering** where the element
  can unmount or re-render mid-gesture. `useStripGestures`'s header
  comment records why capture is wrong there: capturing on a reactive
  component whose subtree re-renders mid-drag drops `pointerup` on
  desktop Chrome, and the drag then never releases.

`window` is the default, because on this surface most elements can go
away under a finger.

### The one hard call: mute's timing

Mute fired on `click` specifically so that a horizontal pan starting on
the name scrolls the row instead of muting the track. That behaviour had
to survive. Three options:

| Option | Latency | Row pan from the name | Cost |
|---|---|---|---|
| Fire on `pointerup`, abandon on `pointercancel`, `touch-action: pan-x` | ~100ms | kept | the wait itself — **chosen first, then reversed; see Addendum 1** |
| **Fire on `pointerdown` with `touch-action: none`, like Solo** | zero | **lost** | the name band stops scrolling the row — **chosen** |
| Down-toggle and revert on cancel (Solo's exact model) | zero | kept | every row pan starting on a name mutes then unmutes the track — an **audible** blip mid-performance |

Solo escapes the third row's cost only because its `touch-action: none`
means it is never cancelled. Mute cannot have that *and* keep the pan;
the third row is the one option that must never be taken here, because a
dropout on a playing track mid-set is worse than either thing it buys.

### Scope: four tiers, three of them done

1. **Track strip slice** — mute, Solo, stop, group fold. Landed.
2. **Rest of the performance surface** — scene rail, master strip,
   transport header, mini session grid, right sidebar, error banner.
   Landed.
3. **The `touches[0]` sites** — 17 of them, six components. Landed.
4. **Central views and the browser** — 80 `onclick`s in `central/views/`
   device panels. **Deliberately not done.** These are one-at-a-time
   editing UIs: a click is honest there, nobody edits two device
   parameters with two hands, and the browser already uses the pointer
   dialect. Migrating them is volume without benefit, and it would touch
   views the mock stack cannot exercise. The lint gate's scope is drawn
   at exactly this line.

## Consequences

### Positive

- Two-handed performance works, and is *tested*: 13 synthetic multitouch
  scenarios drive real Chromium touch input against the real components
  and assert on what reached the surface.
- Two behaviours improved rather than merely surviving the port. A master
  volume drag no longer also selects the master on release (the `onclick`
  fired on every release, drag included, so moving the fader switched the
  central view out from under you). A drag inside the right-hand clip
  rail no longer switches the central view when it ends — that file's own
  comment claimed it did not, but a click bubbles, so it always did.
- One implementation of the slop threshold and the axis commit.
  `useStripGestures` keeps its public shape, its header comment and all
  41 of its tests; only the rules moved out from under it.
- Eight `$effect` blocks that each added and removed four window
  listeners are gone, along with the passive/non-passive `touchmove`
  dance. `touch-action: none` on the node says the same thing once.
- `utils/documentDrag.ts` and its two test files are deleted: its whole
  job was bookkeeping for document-level mouse/touch drag listeners, and
  it had no callers left.
- Two fewer a11y warnings: `use:press` carries the keyboard path that
  each `onclick` needed a hand-written `onkeydown` beside it for.

### Negative

- `<Card>` is a component, so the master strip takes the action through
  its `ref` in an `$effect` rather than a `use:` directive. Same action
  and same guarantees, but a second binding idiom exists and will be
  copied.
- The gate's scope boundary is a judgement, not a principle. A control
  that moves from `central/views/` onto the performance surface carries
  its `onclick` past the gate unless someone notices.
- `use:press` on a container whose children run their own gestures (the
  right sidebar) works because a press abandons past its slop — which is
  correct, but it is a coincidence of thresholds rather than a
  declaration of intent.
- The harness proves the *app's logic* is per-pointer. It cannot prove
  *Safari delivers the events*: iOS click synthesis and iOS gesture
  arbitration are only observable on the device. Those two claims must be
  reported separately, and the multitouch section of the manual test
  checklist is the other half.

## Validation

- **Unit** — 1949 passing overall, including 47 over the two machines
  (`src/__tests__/unit/actions/`), covering per-pointer independence,
  release-out-of-order, cancel semantics, teardown mid-press, hold
  thresholds, and the foreign-pointer case. 19 more over the lint gate's
  masking. Full suite 1949 passing.
- **Synthetic multitouch** — `npm run multitouch`, 24/24 on Chromium.
  Fingers are dispatched through CDP `Input.dispatchTouchEvent`, so they
  enter Chromium's real input pipeline: real hit-testing, real pointer
  ids, real `touch-action` arbitration. Page-script `PointerEvent`s would
  have been simpler and would also have passed against the code this
  replaced.
- **A second engine** — `npm run multitouch:webkit`, 6/6 of the tap-only
  scenarios on Playwright's WebKit, 18 skipped. WebKit's
  `page.touchscreen.tap()` is trusted touch input — `pointerdown` /
  `pointerup` with `pointerType: 'touch'`, for every `touch-action`
  value, in a scroller or not — so this proves every migrated control
  answers a real touch on an engine that is not Chromium. WebKit has no
  multi-finger input at all (CDP is Chromium-only, `page.touchscreen`
  exposes `tap` and nothing else), so the concurrency scenarios are
  **skipped, not passed**.
- **The nets were tested against a deliberate regression**, mute reverted
  to `onclick`. `check:touch` fails, and the `touch-action` assertion in
  `tap-mutes` fails on both engines. The tap itself does *not* fail:
  WebKit synthesizes a click from a trusted tap exactly as it does on any
  website, so the outcome assertions alone would have passed. The
  declaration is what catches it, which is why every tap scenario asserts
  the computed `touch-action` before it asserts the wire.
- **The gate, run against `main`** — reproduces the audit exactly: all 17
  `touches[0]` sites at their listed lines, all 12 performance-surface
  `onclick`s, and correctly skips the one that lives inside a comment.
- **Visual** — `npm run shot -- <view> --diff` with `--fixture-data
  --reduced-motion` on both sides: `full` and `session` both 0/5,595,136
  px differ, max channel delta 0. The refactor is visually inert.
- **Build** — `npm run build` green; `svelte-check` unchanged at the
  repo's standing 57 errors.
- **iPad** — not claimed. Neither engine is iOS Safari, which layers its
  own gesture recognizers — double-tap zoom, scroll momentum, the
  touch-delay heuristics — on top of WebKit. See
  `docs/reference/manual-test-checklist.md` §13.

## Addendum 1: mute fires at finger-down after all

*2026-09-03, same day, after playing it on the instrument.*

The first row of the table above shipped and felt wrong immediately —
"solo feels more snappy, maybe" — so it was measured on the mock stack,
with a simulated 90ms human tap:

```
mute → wire:  103.3 ms after touch-down
solo → wire:    0   ms
```

No round trip was involved: `setTrackMute` already applies to the v3
store before it emits, so the 103ms was purely the wait for the finger to
lift, on the single most-used control on the surface.

**What the release-wait actually bought, in full: one thing.** A
horizontal pan of the strips row that *begins on a track name* scrolls
the row instead of muting. It was never a confirm gate, a debounce, or a
safety. Weighed against 100ms on every mute, it does not survive.

So mute takes row 2: `fireOn: 'down'`, `touch-action: none`, `slop: 0` —
Solo's exact model minus the momentary hold (mute has no momentary
behaviour, so there is no revert on cancel; a press the system interrupts
still read as a press). Measured after: **-1.1 ms**, i.e. the write leaves
in the same task as the `pointerdown`.

**What it costs, plainly:** a row pan can no longer *begin* on the name
band. It still begins anywhere on the Card above it — Clip and Permute
are two thirds of every strip and keep `touch-action: pan-x`, so the row
pans natively from the large part of the strip. What is given up is the
bottom third, which under the flipped layout is the band nearest the
hands. That band was already half non-pannable: Solo has sat in it with
`touch-action: none` since ADR-414.

**The rule this generalizes to**, and the reason the rest of the surface
did not move with it:

> Fire at finger-down wherever the control sets `touch-action: none`
> **and** has no drag meaning of its own, and nothing beneath it does
> either. Otherwise fire on release.

- The per-track **stop** cell and the **group fold** arm keep `pan-x` and
  keep firing on release: there the wait genuinely buys the pan, and
  Live quantizes a clip stop anyway, so the latency is inaudible.
- The **master card** keeps firing on release for a different reason
  entirely — it has a volume drag underneath it, and a down-fire would
  re-select the master on every fader move. So does the right sidebar's
  show-clip region, which has the loop and quantize drags inside it.
- **Transport, metronome and the scene steps** already set
  `touch-action: none` and would be free to move; they were left on
  release because nobody reported them and a live instrument is not the
  place for unrequested changes. One flag each if that changes.

The harness's `two-mutes` scenario now asserts both mutes are on the wire
*before either finger lifts*, and `pan-abandons-mute` was replaced by
`row-pans-from-the-card`, which pins the pan surface that survives.

## Addendum 2: the wait becomes conditional on its own reason

*2026-09-03, proposed by the performer: "what if we only do the release
wait if there are so many tracks that scrolling is even possible?"*

Addendum 1 traded the row pan from the name band for zero latency.
Addendum 2 gets both, by noticing that the trade only exists sometimes.

Measured on the running artifact at 1366×1024: the tracks panel is
**1062px** wide, `--track-min-w` is 64px with a 16px gap, so **13 tracks
fit before the row overflows**. Below fourteen tracks the strips row is
not a scroller at all — and a wait that protects a pan which cannot
happen is pure latency.

So `TracksPanelV6` — which owns the scroller — observes it and hands
every strip a `rowScrolls` flag:

|  | `touch-action` | mute fires |
|---|---|---|
| row cannot scroll (≤13 tracks) | `none` | at finger-down |
| row can scroll (14+) | `pan-x` | on release |

Observed rather than read at press time: `scrollWidth` forces layout, and
the touch path is the one place not to do that. The effect re-runs on
every roster change as well as on resize, because the row element does
not exist until there is a track — a first run that captured a null row
would observe only the panel, whose size does not change when tracks
arrive.

**A bug reported here in an earlier draft did not exist.** While
measuring, `document.querySelector('[data-debug="tracks-panel"]')` was
found to report `scrollWidth === clientWidth` at 18 tracks, which read as
"the rightmost strips cannot be scrolled to". That attribute is on an
outer wrapper in `+page.svelte` as well as on the scroller itself, and
the wrapper is what the query returned. The real `.tracks-panel` overflows
and scrolls correctly, verified by writing `scrollLeft` and reading it
back. A `min-width: min-content` "fix" was written, A/B tested against
its own removal, found to change nothing, and reverted. Measure the right
artifact.

## Addendum 3: mute becomes momentary, like Solo

*2026-09-03: "can the mutes also be similar to the solo buttons where
they become momentary if I hold them for long enough?"*

Yes, and on both branches of addendum 2. Tap latches; hold past
`MOMENTARY_HOLD_MS` (300) and the release puts the captured pre-press
state back. `shouldRestoreOnRelease` is now shared, so
`TrackStrip/utils/soloPress.ts` became `momentaryPress.ts` and
`SOLO_HOLD_MS` became `MOMENTARY_HOLD_MS` — a file named for Solo that
mute also depends on is exactly the drift this ADR exists to remove.

One rule for both, deliberately: they are the two state toggles a
performer holds, they sit next to each other in the same band, and a hold
that means "momentary" on one and nothing on the other is a distinction
the hand cannot keep.

The interesting half is the scrollable branch, where mute fires on
release and so cannot toggle at finger-down. **It toggles at the hold
threshold instead.** By 300ms with the finger still down and no
`pointercancel`, the press is definitively not a pan — the browser
decided long before that — so firing then is safe where firing at down
was not. The cost is that momentary starts 300ms in rather than
instantly on a 14+ track set; a tap is unchanged. `use:press` already
suppresses `onPress` for a press that reported a hold, so the two paths
cannot both fire.

Restore happens on **every** ending of a held press, cancel and teardown
included: an interrupted momentary must not stay latched. A press that
never reached the threshold has nothing to restore.

## Tags
`gesture`, `multitouch`, `ipad`, `pointer-events`, `touch-action`,
`actions`, `track-strip`, `performance-surface`, `lint-gate`
