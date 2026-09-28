# ADR-436: A Gesture Keeps Its Pad — Lifting a Held Pad Mid-Edit Does Not Snap to the Kit

## Status
**Accepted** (2026-09-15). Builds on ADR-428 (the pad grid, hold-to-scope,
tap-to-latch, the per-pad rows), ADR-430 (the FX grid and the pane under a
scope), ADR-432 (the Move hold, which shares the same `holds` map) and
ADR-435 (the pad's Permute, which follows the same scope). Interface only:
no wire address, no surface change, no version bump.

## Context

Per-pad editing is a hold. A finger on a pad tile — or a Move pad held
past 300 ms, which lands in the same map under a reserved pointer id —
scopes the Drum Rack view's controls, the FX grid, the pane and the
Permute to that pad, and lifting returns them to the kit. Everything that
writes reads the scope **per frame**, which is what makes the hold feel
live.

It is also what broke the two-handed gesture the whole design is for. The
user asked the question on 2026-09-14, reading the code rather than the
rig: *hold a pad to select it, start moving a parameter, then let go of
the pad while the other finger is still down — does it stay on the pad?*

It did not. `scopeNote` went null on the lift and the very next drag frame
took the other branch, in four different ways:

| Dragging | On the lift | What happened |
|---|---|---|
| a virtual-macro control (`useDrumVm.writeRow`) | `writeScoped` returns `false` | the next frame wrote `vm.<fn>` — **the whole kit, at the pad's value**. A snare at Decay 0.2 under a kit at 0.8 took every pad to 0.2 on one more pixel of travel |
| an **active** FX-grid tile (`useFxGridSlot`) | `scopeKey` → `''` | the write moved the **track's** top-level device instead of the pad's copy |
| a **ghost** FX-grid tile | `scopeKey` → `''` | `loadFxGridDevice(slot, '')` — the effect **loaded onto the track**, after the rack |
| the pane, or the pad's Permute | `dropPaneIfUnscoped` fires | the pane unmounted and the control **vanished under the finger** |

The control's displayed value jumped from the pad's to the kit's at the
same moment, so the number moved under the hand as well.

Nothing pinned the scope for the life of a gesture — the pattern
`sceneWindowStore.beginDrag` has held for scene scrolling since ADR-415.

## Decision

**A write gesture keeps the target it started with.** When the last hold
on a device lifts *while a finger is down on something that is not a pad*,
the scope is **pinned** — the same notes, for reads and writes alike —
until that finger lifts too.

- **The pin is momentary, not a latch.** It dies with the finger that
  earned it and the kit is the target again. The alternative — converting
  the lift into a latch — was rejected: it leaves a scope on screen the
  performer did not ask for, and a latch in this system is a deliberate
  tap on the glass.
- **Nothing changes under the hand.** `heldNotes` falls back to the pin,
  so the tile stays lit, the controls keep the pad's ink and its values,
  the pane stays open and the pad's rows stay subscribed. The gesture
  looks like what it is still doing.
- **One rule, one place.** The pin lives in `drumPadScope`, which is
  already the single source every writer reads (`writeScoped`,
  `activeDrumRackScope` → the FX grid, the pane, `sequencerStore`). All
  four failures above are fixed by the same three lines in `heldNotes`;
  no control, view or store learned anything new. The alternative —
  threading `onDragStart` / `onDragEnd` from `dragAction` through
  `DeviceSlider`, `DeviceXY`, every profile row, every effect view that
  can appear in the pane and the Permute view — is the "sixteen call
  sites" shape `deviceViewRouter` was created to retire.

### Mechanics

- **`glassPointers`** — every pointer id currently down, from window
  listeners in the **capture** phase, so a down is counted before any
  component sees it and an up before the pad tile's own handler runs (a
  control that stops propagation, or unmounts under the finger, cannot
  cost us the release). A pad tile's own finger is counted like any other
  and discounted because it is in `holds`: what makes a pointer an
  *editing* one is that it is not holding a pad.
- **`pinnedScopes`** — devicePath → the notes pinned, a `SvelteMap` for
  the same reason `holds` is one.
- **Taken at the FIRST lift**, with the scope as it stood *including* the
  pad going, and not overwritten: a two-pad edit keeps both pads, and so
  keeps the multi-pad delta, for the rest of the gesture.
- **A tap is exempt.** It either latches — a scope of its own — or
  deliberately unlatches, and neither is a gesture interrupted. Only a
  *hold* release pins.
- **Superseded by a pad pressed again**, which drops the pin rather than
  releasing it, so the per-gesture delta memory (`padLocal`) carries into
  the new hold.
- **Deferred cleanups.** `padLocal` and the pane are kept for the pin's
  lifetime and run when it drops — the pane is free, since
  `dropPaneIfUnscoped` reads the pinned scope anyway.
- **It cannot get stuck.** The pin dies with the last editing pointer, on
  `pointercancel`, on `window.blur` (`clearPointers`, for an up that never
  arrives when the app goes to the background mid-drag), on the
  `track-changed` `clear()`, and on `retainLatched` when a hot-swapped kit
  no longer has the pad — the same rule the latch has always taken. A
  scope no gesture on the glass can clear is the one failure this store
  has always refused to allow.

A Move hold released while a finger is on a control pins exactly the same
way: the release arrives as OSC, the editing finger is on the glass, and
the store needs no second code path.

## Consequences

- The two-handed gesture the pad grid exists for now works: hold, grab,
  let go of the pad, keep moving. This was **not** reachable before —
  every per-pad edit had to keep the pad down for the whole drag, or be
  latched with a tap first.
- A pad lifted with a finger resting anywhere else on the glass — a track
  strip, a transport button — also pins, until that finger lifts. That is
  the rule as stated rather than an exception to it, and it is why the
  pin's exits are as many as they are.
- Deliberately unlatching a pad mid-drag still returns to the kit
  immediately, because a tap is exempt.
- The window now carries three always-on pointer listeners. They read an
  id and nothing else; the full multitouch suite is green with them.

## Validation

- Interface: `npm run test:run` — 2,268 passed, 2 skipped;
  `drumPadScope.test.ts` gains **twelve** cases (the pin is taken and
  writes the pad's row; it lets go with the control finger and the kit is
  the target again; no pin with no finger on anything; taken at the first
  lift behind a second pad; exempt from a tap; superseded by a press; the
  delta memory survives; the pane is held and dropped with it; a Move hold
  pins; `pointercancel` and `clearPointers` release it; a hot-swapped kit
  prunes it; `clear()` takes the pointer count too).
  `npm run build` green; `svelte-check` at the 56-error baseline.
- **Browser, both directions** — `npm run multitouch -- --scenario
  pad-hold-survives-the-lift`, the new scenario. Two real CDP contacts:
  one holds pad 54 past 300 ms, the other drags Trnsp; the pad lifts
  mid-drag and the drag continues. It asserts the writes stay
  `vm.pad.54.pitch` across the lift, that the tile still reads `pad-held`,
  and that a fresh drag after the hand lifts writes `vm.pitch` again.
  Measured against the tree **without** the fix, it fails exactly as the
  report predicted — `wanted ["vm.pad.54.pitch"], got ["vm.pitch"]` — and
  passes with it. This is the half a unit test cannot reach: the pin is
  fed by window listeners in the capture phase, and whether those see a
  real release in the right order is a property of the browser.
- Full multitouch suite: **25/25** on Chromium.
- Rig: not exercised this run — there is no surface half to restart, and
  the browser scenario covers the wiring end to end.

## Tags

`drum-rack`, `pad-scope`, `gesture`, `multitouch`, `interface`
