# ADR-368: Clip Reverse via macOS Accessibility Click

## Status
**Accepted** (2026-05-04)

## Context

Reversing a Session audio clip is the canonical "missing primitive" in Live's scripting surface:

- The LOM exposes no `Clip.reverse()`. Runtime introspection at `tracks/0/slots/0/clip` confirms the full method surface — `crop`, `quantize`, `add_warp_marker`, `gain`, `pitch_coarse`, etc. — and there is nothing reverse-shaped. `dir()` filtered on `reverse|speed|warp|rate|playback|tempo|pitch|gain` returns only warp / pitch / gain accessors.
- `SimplerDevice.reverse()` exists (already wired at `/looping/v3/simpler/reverse`), but converting the clip to a Simpler track is a different operation than reversing the clip in place.
- Live 12's `R` keyboard shortcut and right-click "Reverse Clip(s)" entry **only apply to Arrangement clips**. Session clips have neither — the only Live-internal path is the **"Reverse" button in the Sample box of Clip View**.
- The looping rig is a Session-view performance instrument. Arrangement workflows are not the user's path.

The "Rev" button is implemented inside Live's UI layer. It produces the correct musical result (warp-marker-aware reverse, identical to what the user would get clicking it themselves), but is not surfaced through any of: LOM, OSC, MIDI Remote Scripts, or the AbletonOSC bridge.

### What changed our mind on the Accessibility path

Initial assumption: Live's UI is non-AX (custom render layer, not native AppKit). An early probe returned `count windows → 0`, reinforcing this. **Wrong on both counts.** The actual situation:

1. macOS Accessibility permission must be granted to the **process sending events** (Terminal / iTerm / the bridge's parent), not to Live.
2. AX queries from `System Events` only see windows on the **currently active macOS Space** — Live being on a different Space silently returns zero windows.
3. Once both are satisfied, Live exposes its **full UI tree** to AX. Walking from `process Live → window → first AXGroup` reveals named sections: `Control` (transport), `Browser`, `Session`, `Clip Detail` (75 children including `AXButton` with `description = "Reverse"`), `Device Detail`, `Status`. Controls have stable `description` strings ("Reverse", "Clip Gain", "Warp Mode") suitable as identifiers.

Verified end-to-end: `osascript`-driven click on the Reverse button reverses the focused audio clip with the same musical result as a manual click.

## Decision

Add a UI-only "Reverse" button next to the existing "Simpler" button in `ClipCentralView` audio-clip mode. The bridge intercepts `/cmd/clip/reverse`, runs an `osascript` snippet that walks Live's AX tree and clicks the Reverse button by `description`, and acks via `/cmd/clip/reverse/ack`.

### Architecture

```
iPad UI button → WebSocket → Bridge (Node) → osascript → Live AX click
                                ↓
                       (no Python surface, no LOM)
```

The bridge — not the Python surface — owns this path because:

- Python runs **inside Live's process**; shelling out to `osascript` from the audio host is bad form even when it works (it would block on Live's audio thread, and `subprocess` from inside Live has its own quirks).
- The bridge is a separate Node process on the Mac, the natural place to drive macOS automation.
- This isn't a LOM operation — there's nothing for Python to do.

### AX lookup strategy

Look up controls by **`description` attribute, not by child index**. The Reverse button was at index 60 in one observed state but Clip View's accordion sections (Warping, Pitch, ExtendedProperties) collapse and expand, shifting indexes. The AppleScript uses:

```
tell (first UI element whose role is "AXGroup" and name is "Clip Detail")
  click (first UI element whose role is "AXButton" and description is "Reverse")
end tell
```

The main window is also resolved by `subrole is "AXStandardWindow" and name is not "[totalmix]"` rather than by hardcoded name — Live's window name follows the open `.als` (or "Untitled" for a new set), and a TotalMix audio-driver window can be present alongside Live's.

### Trust model

The endpoint clicks **whatever audio clip Live currently has selected in Clip View**. The UI does not pass a `clipPath`. This matches how `simpler.reverse` already works: selection in the iPad UI mirrors selection in Live via the existing focused-clip echo, so "the clip the user just tapped on" and "the clip Live's Sample box is showing" are the same clip in practice. If the assumption ever drifts, the worst-case is reversing the wrong clip — symmetric and recoverable.

### Preconditions documented (not enforced)

- macOS Accessibility permission granted (one-time OS prompt).
- Live frontmost on the active Space. The user confirmed Live is always on-screen during a session, so we don't add Space-juggling fallbacks.

If those drift, `osascript` returns a stderr describing the failure (e.g. `Can't get window 1 of process "Live"`), the bridge captures it, and the UI receives `/cmd/clip/reverse/ack [0, "<detail>"]`. No silent failure.

## Consequences

- **Positive — the only path to true clip reverse on Session clips.** No LOM workaround (sample-into-Simpler) or destructive workaround (rewrite WAV on disk) was needed. The musical result is identical to a manual click.
- **Positive — opens the door to other UI-only operations.** Live's full Clip Detail group is AX-discoverable. Future endpoints could click "Edit", toggle "Fade", drive "Apply Transformation/Generator" submenus, etc., the same way. ADR captures the lookup pattern (by `description`, not index) for reuse.
- **Negative — depends on macOS Accessibility permission.** First run prompts the user once. The error path is clear (ack carries stderr) and the failure is recoverable, but it's a new install-time step.
- **Negative — depends on Live being on the active Space.** Acceptable for this rig; would not be acceptable for a general-purpose tool.
- **Negative — depends on Live's AX descriptions remaining stable across versions.** "Reverse" has been the button's description in 12.x. If a future Live release renames it, the AppleScript fails noisily (ack stderr), not silently.
- **Neutral — `/cmd/*` namespace.** This is the first `/cmd/clip/*` endpoint; future UI-only clip ops would land alongside it. The `/cmd/*` prefix keeps these distinct from `/looping/v3/*` (Python surface) and the legacy `/shell/*` (retired audio clipboard helper).

## Implementation pointers

- Bridge handler: **`liveAxClick.js` was deleted** (ADR-439). Its job — and the
  AppleScript and the 3 s osascript timeout with it — moved into the Looping AX
  Helper: `WebSocketServer.js` routes `/cmd/clip/reverse` to the helper client,
  which acks `[0, code, detail]` with a named AX code instead of `[0, stderr]`.
- Interception: [interface/bridge/transport/WebSocketServer.js](../../interface/bridge/transport/WebSocketServer.js) `handleMessage` — same pattern as `/bridge/client_log`. Returns early before UDP routing.
- UI service: [interface/src/lib/services/clipOperations.ts](../../interface/src/lib/services/clipOperations.ts) `reverseFocusedAudioClip()`.
- UI button: [interface/src/lib/components/v6/central/views/ClipCentralView.svelte](../../interface/src/lib/components/v6/central/views/ClipCentralView.svelte) audio branch — Simpler / Reverse split left-right inside the right half, amber tint to distinguish from Simpler's emerald.

## Tags

`clip-reverse`, `accessibility`, `osascript`, `ax-click`, `bridge`, `ui-only`, `session-clip`
