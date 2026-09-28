# AX + similarity probes (ADR-439, measured 2026-09-15)

> **Parked, and superseded.** These are the one-off scripts the ADR-439
> measurements were taken with, kept for their recipes. Nothing imports them and
> no gate runs them. For anything new, prefer the shipped routes: the AX helper's
> own `dump` / `read` / `press` verbs through
> `uv run --directory owner/ax-helper python -m looping_ax_helper.client <verb> '<json>'`
> (which needs no Accessibility trust of its own — the helper holds the grant,
> so the Terminal dance below is no longer required), and
> `/api/similar-samples` for the ranking. They print with `console.log` and
> `print` because they are standalone scripts run by hand, not part of the app.
>
> Paths are resolved relative to this file and out of `config/constants.json`
> since 2026-09-16; they used to be six absolute paths from one Mac.

Rig probes behind ADR-439. All read Live's state through the surface's
`/looping/probe/*` family (UDP 11020) and drive Live's UI through macOS
Accessibility. Accessibility trust belongs to the launcher, and shells under
the Claude app are not trusted — run the AX scripts through Terminal:

    cat > run.command <<EOF
    #!/bin/zsh
    cd "$PWD"; uv run --with pyobjc-framework-ApplicationServices \
      --with pyobjc-framework-Cocoa python ax_act.py $(pgrep -x Live) "<press regex[@x,y]|->" "<list regex>" > out.txt 2>&1
    EOF
    chmod +x run.command; open -a Terminal run.command

- `ax_walk.py <regex>` — dump every element under `AXMainWindow` whose role /
  title / description / identifier matches (start from `AXMainWindow`, never
  `AXWindows` — that list is empty when Live is not frontmost).
- `ax_act.py <pid> <press> <list>` — `AXPress` the first element matching
  `press` (append `@x,y` to pick one of several by position), then list
  matches for `list`. The press blocks until Live finishes: its duration is
  the action's cost (kit swap ~0.5 s warm, single pad ~29 ms).
- `swap_timer.js <sample path> <expected name>` — fire `device/load` at pad
  36 of `tracks/1/devices/0` and poll the device name until it flips.
- `name_watch.js [ms]` — timestamp every change of pad 36's device name,
  `_live_ptr` and Decay while something else acts on the pad.
- `wire_send.js <address> '<json args>' [ms]` — one raw OSC message to the
  surface, printing every reply for `ms`.
- `fe_decode.py <out dir>` / `fe_compare.py <base> <live_list.txt>` — decode
  Live's `fe_values` embeddings (64 × float32) and score candidate metrics
  against a list read off Live's own Show Similar Files view (L2 wins).

Identifiers that matter: `TrackView.Device[N].TitleBar.ShowSwapBar`,
`…TitleBar.SimilaritySwapView.SwapNext|SwapPrev` (kit), and for **one pad**
`TrackView.Device[N].Device[K].WaveformDisplay.SimilaritySwapView.Prev|Next`
— the pad's own Drum Sampler, which the helper must `hover` first because
Live draws those arrows only under a pointer.

The rack grid's `…pad_collection_view.Border.SwapBar.Next|Prev|Lock` (one
triple per visible pad; the pads themselves are not AX elements) is **not**
the pad-swap route: pressing it makes Live play the pad, which is why
ADR-439 moved the pad swap onto the Drum Sampler's arrows, where it is
silent. The identifiers stay documented here because they are still what
the tree exposes, and `Lock` has no other route. Full facts: ADR-439 and
the memory notes it references.
