# ADR-528: The note editor only at full screen

## Status
**Accepted** (2026-11-11). Interface only; no Live restart. Retires the
clip-view-mirror's manual editor toggle (decision 8, M1). Builds on
ADR-525..527.

## Context

The clip view in the stack switched, by a pencil chip in its corner,
between its controls and the note editor (or an audio clip's waveform).
In a band about 330px tall the editor's lanes were too thin to edit on;
Ben judged it "not really helpful" once the full screen drew the
controls and the editor together (ADR-526, ADR-527).

## Decision

- **In the stack the clip view is its controls alone.** The pencil chip
  and `clipEditorStore` are gone.
- **The note editor is drawn only at full screen**, under the controls'
  strip, with its toolbar in that strip and the right sidebar beside it.
  Its toolbar has one layout, two by two; the column beside the roll went
  with the stack's editor.
- **A second Clip tap on the selected track's strip toggles full screen**
  (`TrackStrip.selectThen`), where it toggled the editor: the same tap
  still opens the notes. The first tap only opens the Clip view.

## Consequences

- Editing notes means full screen: the corner icon or the second Clip
  tap. Escape or the icon brings the stack back.
- The demo scenarios that tapped the pencil tap the full-screen icon;
  their captions changed and their recordings are stale until re-shot.

## Tags
`central-view`, `clip-editor`, `layout`, `gesture`
