# ADR-399: Role-Based Track Coloring with a Gap-Placed Palette

## Status
**Accepted** — supersedes the track-coloring decision of ADR-379 (its recents
persistence part stands).

## Context

ADR-379 colored tracks by **brand** (path segment 0: Ableton/NI/Omni/Audio).
The color audit (`documentation/color-audit.md`, 2026-07-11) found two problems
with the result:

1. **A live set converges on four track colors.** All NI presets look identical
   on stage; "which strip is my drums?" is unreadable mid-performance.
2. **Hue collisions with the GRATICULE signal hues.** 10 of the 14
   `constants.json:vendors` hexes sit within ~15° OKLCH hue of a reserved
   functional ink (`app.css` `--act-*`): drum red H22 vs recording H27, the
   `#00ff00` audio green and inst green H161 bracketing the loop/selection
   phosphor H155, synth H269 vs pitch H262, recent H306 vs quant H300, etc.
   Identity colors squatting on state hues undermines the design system's core
   rule — *if it glows, it's making sound*.

Additionally `vendors.types.perc` was unreachable (no `CATEGORY_SYNONYMS`
entry), and the raw palette's luminance was chaotic (OKLCH L 0.56–0.87), so the
Live set on the laptop looked uncalibrated next to the `trackInk()`-normalized
iPad rendering.

## Decision

### 1. Role-first resolution

`resolveAutoColor()` in `trackColoring.ts` now resolves in this order:

```
1. audio vendorId (audio / audio-clips)        → vendors.special.audio
2. category from presetPath segment 1          → vendors.types.<role>
3. vendorId itself a known type (the rail the
   user was browsing, for unrecognized folders) → vendors.types.<vendorId>
4. fallback: brand from segment 0              → vendors.brands.<Brand>
5. no recolor
```

Brand becomes a browser-card accent (baked `vendorColor`, unchanged) and the
last-resort fallback; the track's hue now answers *what is this loop* —
drums, bass, keys, synth — rather than *which library it came from*.
`perc` gains synonyms (`perc`/`percs`/`percussion`) and is reachable.

### 2. Gap-placed, ink-envelope role palette

The `vendors.types` + `vendors.special.audio` values are re-tuned so every
role hue sits in the free bands **between** the functional hues (≥ ~18–20°
clearance from rec 27 · master 60 · warn 80 · loop 155 · monitor 210 ·
pitch 262 · quant 300), pre-clamped to the `trackInk()` dark envelope
(L 0.70–0.82, C 0.14–0.21):

| Role | Hue | Hex | Nearest functional hue (Δ) |
|---|---|---|---|
| drum | 348 rose | `#f36fb8` | quant 300 (48°) / rec 27 (39°) |
| perc | 45 burnt orange | `#ff8244` | master 60 (15°) — tightest slot, rarest role |
| bass | 235 azure | `#12b2f4` | monitor 210 (25°) / pitch 262 (27°) |
| synth | 281 violet | `#8e90ff` | pitch 262 (19°) / quant 300 (19°) |
| key | 100 gold | `#ceb92d` | warn 80 (20°) |
| fx | 322 magenta | `#d57ce3` | quant 300 (22°) |
| inst | 183 teal | `#00cdb9` | loop 155 (28°) / monitor 210 (27°) |
| audio | 135 chartreuse | `#89ce5f` | loop 155 (20°) — still reads "audio = green" |

Because the palette is pre-clamped, the ints written to Live over
`/looping/v3/track/color` are already calibrated — the Live session view and
the iPad now show the same inks (the audit's R4), and render-side `trackInk()`
remains a no-op safety net for hand-set colors.

`vendors.brands` values are untouched (no catalog regeneration needed — baked
`vendorColor` comes from brands, and type colors are read at runtime).

## Consequences

**Positive:**
- Track color is performance-meaningful again: up to 8 role hues per set
  instead of 4 brand hues, and the rail button the user tapped matches the
  track color it produces.
- No role hue reads as a state: recording/loop/master/quantize signals are
  unambiguous on every track.
- Live and iPad finally agree visually; the browser rail type buttons pick up
  the same calibrated inks automatically (`DrillDownBrowser` reads
  `vendors.types` at runtime).
- Fresh `constants.json.example` copies now include `vendors.types`/`brands`
  (previously missing — `trackColoring.ts` reads them unconditionally).

**Negative:**
- One-time churn: existing sessions keep their brand colors until the next
  preset load on each track (same consequence ADR-379 accepted).
- ADR-379's browser↔session brand coherence is inverted: a preset card's brand
  accent no longer predicts the track color — the *type rail* does. Recents
  cards still show their brand accents (ADR-379 part 2 stands).
- `perc` sits in the tight 27–60 band (Δ15 from master orange); acceptable for
  the rarest role, revisit if it reads ambiguous on stage.
- The `config/trackTypes.json` color fields remain dead (guitar/mic/bass/keys
  bare preps don't auto-color today); wiring role colors into that prep flow
  is follow-up work under the audit's R1/R3.

## Tags
`colors`, `track-coloring`, `graticule`, `design-system`, `browser`
