# ADR-503: A Phone Layout of Tabs

## Status
**Proposed** (2026-11-04). Built from a cloud session after a brainstorm of
four phone layouts (tabs, strips pinned under a switch, one track at a time,
a tile mixer); Ben chose tabs. The iPad layout is unchanged.

## Context
An iPhone already pairs with the rig (ADR-491), but on a 393-point screen
the iPad layout is unusable: the browser rail, the chain, the clip buttons
and the strips overlap and the strips run off the edge. The iPad layout is a
stack of equal sections beside two sidebars (ADR-415/416), sized for 1366
points; it does not shrink to a phone.

## Decision
- **A screen at most 599 points wide or 499 tall gets the phone layout**
  (`config/constants.json` `ui.phoneLayout`; `utils/phoneLayout.ts`
  `isPhoneViewport` / `PHONE_MEDIA_QUERY`): an iPhone held either way up, and
  iPad Slide Over. `routes/+page.svelte` decides in the browser after the
  first render, so the server's page (the iPad's) hydrates as before, and a
  rotation or resize can switch it.
- **`layouts/phone/PhoneLayout.svelte`**: the transport on top, a colour
  ribbon of every track, one tab, and a tab bar of **Mix · Clips · Rec ·
  Track · Browse**. Every tab is the iPad's own component, so a strip, a
  clip cell, the chain and the browser behave as they do there:
  - **Mix**: `TrackStrip` per track at full height, 64px columns at an 8px
    gap (five and a sliver on screen), the master last. `rowScrolls` is
    always true, so a sideways start pans the row.
  - **Clips**: `SlotGrid` per track under a name tab in its colour, the stop
    row at the foot, `SceneRail` pinned at the right edge. The tab holds the
    scene window at 4 rows (`sceneWindowStore.setVisibleCountOverride`) while
    mounted, so four scenes are on screen at a time.
  - **Mix and Clips share one scroll position**, at the same column pitch,
    so switching tabs keeps the same tracks in front of you.
  - **Track**: the chain (`DevicesPanelV6`) alone, the whole tab. No
    central view: the phone keeps the track to its chain.
  - **Browse**: `DrillDownBrowser`'s rail fills the tab; a tap opens the
    browser as it always opens, full screen with its own close.
  - **Rec** is the shared `RecordButton`, with the selected track's name
    under it.
- **The ribbon** (`PhoneTrackRibbon`): one segment per visible track in its
  colour with its meter, greyed muted, ringed soloed, outlined selected, and
  a frame over the tracks the strips or columns show. A tap selects the
  track; the tab on screen scrolls to it.
- **The transport is `SessionHeaderV6 compact`**: Play, Tempo, Position (its
  caption the time signature), Click and Overdub on one row. The time
  signature field stays in the master view.
- **The tabs stay mounted**; a hidden one is `display: none`, as the iPad
  hides a section. The browser is parked off the Browse tab in a zero-size
  box instead, because it must open from any tab (the chain's + Effect, the
  swap pill's name) and its overlay is `position: fixed`, which a
  zero-size box does not clip.
- **The browser's mode switch shows icons alone** under the phone layout
  (`[data-phone-layout]`): half a phone's top bar is 40px a segment.
- **Shots**: `npm run shot -- phone` (and `phone-clips`, `phone-track`,
  `phone-browse`, `phone-landscape`). A view may now name its `viewport` and
  `steps`.

## Consequences
- The phone shows everything the iPad does except the group brackets over
  member strips (a folded group still folds from its strip's chevron), the
  New Audio / New MIDI column, the time signature outside the master
  view, and the central views (instrument, clip, master): the Track tab is
  the chain alone.
- The scene rail's names truncate at 64px; scenes still launch from it.
- A phone loads the iPad layout once before switching (the first render is
  the server's). It costs one mount and one unmount on a phone only.

## Tags
`phone`, `layout`, `iphone`, `tabs`, `responsive`
