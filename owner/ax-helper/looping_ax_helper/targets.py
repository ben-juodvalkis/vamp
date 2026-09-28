"""The controls the bridge depends on, by name (ADR-439).

The helper looks every one of these up when Live appears (the smoke check), so a
Live update that renames a control is a log line at boot, not a dead button on
stage. Identifiers were read off Live 12.4.15b2's tree on the rig, 2026-09-15.

`context` says when a control exists. None means whenever Live's main window
does; anything else is a precondition the bridge establishes first, and the
smoke check reports such a control as "not showing" rather than missing.
"""

from .ax import Target

RACK_IN_VIEW = "the rack's track selected, so TrackView shows the rack"
SWAP_BAR_ON = RACK_IN_VIEW + ", with its swap bar on (device.show_swap_bar)"
PAD_IN_VIEW = RACK_IN_VIEW + ", with a pad selected, so the device view shows that pad's chain"
SAMPLER_HOVERED = PAD_IN_VIEW + ", and a pointer over its waveform (hover on sampler.device)"
# Given a context so a set in Arrangement View is "not showing" at boot rather
# than an error in the smoke log; a call still names it when it is missing.
SESSION_VIEW = "Session View showing, which is where Live's track headers live"

CATALOG = {
    t.name: t
    for t in (
        # Phase 0's harmless press, verified by a Song.tempo read.
        Target("transport.tap_tempo", "AXButton", identifier="Transport.TapTempo"),
        # Clip Detail's Reverse (ADR-368): no identifier of its own.
        Target("clip.detail", "AXGroup", identifier="ClipDetailView"),
        Target(
            "clip.reverse", "AXButton",
            description="Reverse", within="ClipDetailView",
            context="an audio clip shown in Clip View",
        ),
        # Save As (ADR-405).
        Target("menu.save_as", "AXMenuItem", title="Save Live Set As...", root="menubar"),
        # Grouping tracks, which the LOM cannot do at all: no create-group call,
        # no track move, and group_track / is_foldable / is_grouped are all
        # read-only. Live's own Edit menu items, pressed like Save As. They are
        # in the menu bar whatever is selected -- Live disables them instead of
        # removing them, so `enabled` is a live read of "is this selection
        # groupable?" and the caller can ask before it presses (measured
        # 2026-09-19: Group read disabled with the Main track selected).
        Target("menu.group", "AXMenuItem", title="Group", root="menubar"),
        Target("menu.ungroup", "AXMenuItem", title="Ungroup", root="menubar"),
        # ...and the selection those act on. Live's track headers are an
        # AXOutline whose AXRows are the tracks, in the order Session View shows
        # them (tracks, then returns, then Main); the outline's AXSelectedRows
        # is settable, so `select` writes a multi-track selection in one go.
        Target("tracks.headers", "AXOutline", description="Track Headers", context=SESSION_VIEW),
        Target("track.header", "AXRow", identifier="SessionView.Track[{track}].TitleBar",
               context="Session View showing, with a track at that index"),
        # Similar-sample swap (ADR-439 phase 3). {device} is the rack's index
        # among the selected track's top-level devices.
        Target(
            "device.show_swap_bar", "AXCheckBox",
            identifier="TrackView.Device[{device}].TitleBar.ShowSwapBar",
            context=RACK_IN_VIEW,
        ),
        Target(
            "kit.swap_next", "AXButton",
            identifier="TrackView.Device[{device}].TitleBar.SimilaritySwapView.SwapNext",
            context=SWAP_BAR_ON,
        ),
        Target(
            "kit.swap_prev", "AXButton",
            identifier="TrackView.Device[{device}].TitleBar.SimilaritySwapView.SwapPrev",
            context=SWAP_BAR_ON,
        ),
        # The pad grid's per-pad Lock stays addressable. Its Next / Prev are not
        # in the catalog: Live plays the pad when they are pressed (heard on the
        # rig, 2026-09-15), so one pad swaps through its Drum Sampler instead.
        Target(
            "pad.lock", "AXCheckBox",
            identifier="TrackView.Device[{device}].pad_collection_view.Border.SwapBar.Lock",
            repeated=True, context=SWAP_BAR_ON,
        ),
        # One pad's swap: the selected pad's Drum Sampler's own buttons, which
        # swap without playing the pad. {chain} is the Drum Sampler's index among
        # that pad's chain devices. The buttons are in the tree only while a
        # pointer is over the waveform: on a 490x190 Drum Sampler, mouse moves
        # posted to Live ending at (+126, +53) revealed Previous at (+202, +88)
        # and Next at (+216, +88) (measured 2026-09-15).
        Target(
            "sampler.device", "AXGroup",
            identifier="TrackView.Device[{device}].Device[{chain}]",
            context=PAD_IN_VIEW, hover=(0.26, 0.28),
        ),
        Target(
            "sampler.swap_next", "AXButton",
            identifier="TrackView.Device[{device}].Device[{chain}].WaveformDisplay.SimilaritySwapView.Next",
            context=SAMPLER_HOVERED,
        ),
        Target(
            "sampler.swap_prev", "AXButton",
            identifier="TrackView.Device[{device}].Device[{chain}].WaveformDisplay.SimilaritySwapView.Prev",
            context=SAMPLER_HOVERED,
        ),
    )
}
