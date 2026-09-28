# ADR-350: LOM identity comparisons must use `_safe_int_id`, not `is`

## Status
**Accepted**

## Context

The atomic track-prepare endpoint shipped on `claude/fix-track-creation-bugs-Kq5Sa`
(see `docs-archive/TRACK_CREATION_REDESIGN.md`) was supposed to make reuse-vs-create
a server-authoritative decision: `TrackPrepareComponent._decide` reads
`song.view.selected_track`, finds its index in `song.tracks`, and reuses
that track if it's the right type and has no clips.

In live validation against Ableton Live 12.4b16 the reuse branch never
fired. Every prepare call created a new track, even when the user was
sitting on an empty same-type track. The bug was hidden from the
20-test unit suite because the test stubs use plain `StubTrack` objects
where `is` comparison happens to work.

The cause was in `_selected_track_index`:

```python
selected = view.selected_track
for i, t in enumerate(tracks):
    if t is selected:
        return i
return None
```

Live's `ableton.v3.control_surface` framework wraps raw LOM objects and
**hands out a fresh Python wrapper per attribute read**. The wrapper
returned by `view.selected_track` is not the same Python object as any
wrapper in `list(song.tracks)`, even when both refer to the same
underlying LOM track. `t is selected` always returns False, the helper
returns `None`, and `_decide` takes its `selected_index in (None, 0)`
branch — creating instead of reusing.

This isn't a new gotcha: `ExclusiveArmComponent._same_track`
(`components/ExclusiveArmComponent.py:284-301`) already handled it,
and `path_resolver._same_lom_handle` does too. The
`TrackPrepareComponent` shipped with the brittle `is` check anyway.

## Decision

**LOM object identity is `_live_ptr`-based, never Python-object-identity.**
Any code that needs to ask "is this the same Live object?" must compare
through `_safe_int_id` (`components/LOMListeners.py:1342`), which
returns the v3 wrapper's `_live_ptr` (or the raw LOM `.id` for
unwrapped objects).

`TrackPrepareComponent._selected_track_index` was switched to:

```python
sel_id = _safe_int_id(selected)
if sel_id is not None:
    for i, t in enumerate(tracks):
        if _safe_int_id(t) == sel_id:
            return i
# fall back to `is` for test stubs that don't define _live_ptr
```

A regression test
(`test_reuses_when_selected_is_fresh_wrapper_with_matching_live_ptr`)
constructs a `StubTrack` whose `_live_ptr` matches a different
wrapper instance, asserting that the component still picks reuse.
This test would have caught the production bug on day one if it had
existed when the redesign landed.

Diagnostic logging in `_decide` was kept (one line per decision,
INFO level) so that any future "should have reused but didn't"
report is one Live-Log grep away from a definitive answer.

## Consequences

**Positive:**
- The track-prepare redesign now actually reuses tracks. The
  duplicate-track symptom the redesign was built to fix is gone.
- Future LOM-touching components have a worked example
  (`_safe_int_id` + the regression-test pattern) of how to write
  identity comparisons that survive contact with real Live.
- The surface/CLAUDE.md note ("LOM identity is `_live_ptr`-based")
  makes this discoverable without reading three files.

**Negative:**
- Test stubs with no `_live_ptr` attribute now go through an extra
  `_safe_int_id` import + None check before falling back to `is`.
  Negligible cost; the alternative (forcing every stub to fake
  `_live_ptr`) would be more invasive.
- The 20 pre-existing `TrackPrepareComponent` tests continue to pass
  via the identity fallback, which means they don't enforce the
  `_live_ptr` path. The new regression test is the one that does.
  Acceptable: pinning the failure mode is what matters; making every
  test exercise the production code path would mean rewriting the
  stubs.

## Tags

`lom`, `track-prepare`, `python-surface`, `fresh-wrapper`, `regression-test`
