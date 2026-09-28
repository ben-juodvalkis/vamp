# ADR-416: The Main Area Is a Stack of Toggleable Sections

## Status
**Accepted** — supersedes ADR-415's layout model (its clip grid, scene
rail, shared scroll window and `clip/sample` wire are all unchanged).

## Context

ADR-415 fixed the main area at **three equal thirds** and made session
mode a *swap*: turning it on moved the clip grid into the middle third
and pushed either the FX grid or the central view out of the bottom one,
chosen by an `FX / VIEW` switch (`sessionBottomRow`).

That model held three assumptions that turned out to be costs, not
features:

- **Exactly three panels, always.** The count was baked into
  `.third { flex: 0 0 calc((100% - 2 * gap) / 3) }`. Wanting two panels
  bigger, or all four at once, was unrepresentable.
- **A panel's position depended on the mode.** The central view was the
  middle third in one mode and the bottom third in another. Reading the
  layout meant first knowing which mode you were in.
- **`FX / VIEW` was a chooser for one slot**, so the two panels it named
  were mutually exclusive for no reason other than that the slot was
  single. It was also inert with session mode off, a control that existed
  but did nothing in the default layout.

The sidebar inherited the same pressure. With only three rows to spend,
the scene rail had to be squeezed into half of the middle third,
side-by-side with the groove-quantize slider, both in `compact` variants
at ~56px.

## Decision

**The main area is a stack of up to four sections in a fixed order, each
an equal share of the height, each independently toggleable.**

| # | section | toggle | default |
|---|---------|--------|---------|
| 1 | track strips | — (always on) | on |
| 2 | session clip grid | `sessionMode` | **off** |
| 3 | central view | `showCentralView` | on |
| 4 | FX grid | `showFxGrid` | on |

Nothing swaps places. A toggle adds or removes a whole section and the
survivors re-divide the height — from one section (strips alone, full
height) to four. The default is CLIPS off, which is the same three
sections as before: strips, central view, FX grid.

### Equal at any N, with no arithmetic

Every visible row is `.section { flex: 1 1 0 }`. Flex already divides the
leftover evenly, so "equal" needs no `calc` and no knowledge of how many
sections are showing. ADR-415's `.third` hard-coded three and is gone.

### The tracks panel is worth two sections, exactly

The clip grid is still the **second row inside `TracksPanelV6`**, not a
row of its own — that is ADR-415's load-bearing decision and it stands:
one scroller means one `scrollLeft`, so a clip column physically cannot
drift out from under its strip.

So in session mode that panel must occupy two sections *plus the gap
between them*. That is precisely:

```css
flex: 2 1 var(--spacing-lg);
```

A flex basis is taken off the free space before the grow shares divide
it, so the panel gets `2 × share + one gap` and every other row gets
`share` — which lands on the same section height at **any** section
count, with no per-mode constant. (Session mode off: `flex: 1 1 0`.)

### The sidebar mirrors the stack, one row per section

| section | sidebar row |
|---------|-------------|
| track strips | TotalMix + Master |
| clip grid | scene rail |
| central view | groove quantize |
| FX grid | clip loop brace |

Each sidebar row is gated by the **same flag** as its section, so both
columns always show the same number of rows and therefore the same
number of gaps. Row edges then agree by construction — no measurement,
no shared constant. Verified at 1366×1024: four sections of 244px, both
columns landing on 0–244 / 260–504 / 520–764 / 780–1024, with rail
buttons and grid cells both at 260–500.

A hidden section is `display: none`, **not** a zero-height collapse.
ADR-415's reasoning is unchanged and still load-bearing: a zero-height
flex item still contributes its gap, which would leave one column a 16px
gap taller than the other. The subtree stays mounted either way, so a
hidden panel's component state survives.

This also answers ADR-415's awkwardest compromise. The scene rail gets
the full sidebar width because groove quantize now has a row of its own,
level with the central view it belongs to — the half-width split and
both `compact` variants are deleted rather than tuned.

### Where the switches live

`SessionLayoutToggles` becomes three buttons — **CLIPS / VIEW / FX**,
left-to-right matching top-to-bottom in the stack, so the row of buttons
is a small picture of the layout it controls. All three are always
mounted: a section that is OFF has no other way back.

They host in **the last visible sidebar row that is not the scene rail**
(loop → quantize → master). The exclusion is not cosmetic: the rail
divides its own box by the scene-row count to get its row pitch, so
taking ~48px off it would change that pitch and desync it from the clip
grid it exists to line up with. Every other sidebar control is
proportional and absorbs the trim.

### Opening the clip editor turns the central view ON

Previously this flipped `sessionBottomRow` to `central`. Now it sets
`showCentralView = true`, which is the same intent against the new
model: don't open an editor the performer cannot see. Still edge-
triggered on the open, so hiding the section again while the editor is
open stands, and closing the editor never turns anything back on.

### Two prefs that default ON

`showCentralView` / `showFxGrid` are the first `uiPrefsStore` entries
whose default is on, so they read **inverted** from storage
(`readBoolFromStorageDefaultOn` — only an explicit `'0'` is off). Absent
or corrupt storage therefore lands on the familiar three sections rather
than a blank surface. `sessionBottomRow` and its storage key are
removed; a stale value is simply ignored.

## Consequences

- Every combination is legal, including all three off (strips at full
  height) and all three on (four sections). Nothing is inert in any
  mode — the ADR-415 `FX / VIEW` button did nothing with session mode
  off.
- A panel's position no longer depends on the mode, so "the central view
  is section 3" is true unconditionally.
- The FX grid and the central view can now be on screen together *with*
  the clip grid, which the old single bottom slot forbade.
- Sections get shorter as more are shown — four sections is 244px each
  at 1366×1024 versus 307px for three. That is the trade the toggles
  exist to let the performer make per set.
- The browser rail's three button groups still divide their own column
  into three, so they coincide with the main rows only at N=3. They are
  independent chrome; nothing reads across.
- ADR-415's `.third` rule, `sessionBottomRow`, and the `compact`
  variants of `SceneRail` / `VerticalQuantizeControl` /
  `RightControlsSidebar` are all deleted.

## Related

- ADR-415 — session view: the clip grid, scene rail, shared scroll
  window and `clip/sample` wire, all unchanged by this ADR
- ADR-411 — launch quantization in the System view (the control the
  sidebar's groove slider is often confused with)
- ADR-414 — Solo band, which lives inside the strips' section

## Tags
`layout`, `session-view`, `ui-prefs`, `scene-rail`, `track-strip`
