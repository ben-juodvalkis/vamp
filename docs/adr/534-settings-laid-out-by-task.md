# ADR-534: Settings Laid Out by Task

## Status
**Accepted** (2026-11-13), on the `settings-glow-up` branch. The page only:
nothing on the wire, the bridge or the surface changed, so it takes effect
on the next page load with no Live restart.

## Context
Ben asked for a full audit of the Settings page ("it's kind of a mess"),
and was happy for things to be moved around. A screenshot of every state
found:

- **General was a catch-all.** Auto-Arm, Auto Rec, the theme, REC's input
  picker and the foot switch, in four groups. "Auto Rec" (the
  arrangement, on Play) and "REC records" (the REC button) both said
  "rec", two groups apart, and meant different things.
- **Connection answered three questions**: is Live answering, what to type
  on the iPad, which devices are paired, plus a six-row list of features
  (most of them Off on a general edition).
- **Sections had no titles.** Only the sidebar's highlight said where you
  were.
- **Learn looked like text**, not a button: a plain row under the foot
  switch's.
- **Grooves listed the ticked grooves twice**, in "In the Groove view" and
  in their own group, with nothing to say why.
- **Setup's last step** (the iPad address) was a group title, drawn
  unlike the four steps above it.
- **The effects folder setting** sat between the Places count and the
  folders it does not belong to.
- **Each section carried its own copy** of the filter, the folding group
  header and the drawn checkbox.

## Decision
- **Sections by task, in three sidebar groups:**
  - **Play**
    - **Recording**: the REC button (Track or Input, and the input picker,
      ADR-533), then Automatic (Auto Rec, Auto-Arm).
    - **Controllers**: the foot switch and its Learn, and Move's knobs
      while the Max patch is on.
  - **Browse**
    - **Library**: the Places, with the effects folder as a group of its
      own above them. Its id and address stay `places`. The first group
      is "In the sidebar" (Ben's naming).
    - **Grooves**
  - **System**
    - **Connection**: Live's state as one card with a large word, the iPad
      address with a Copy button where the page may use the clipboard, and
      the paired devices.
    - **Integrations**: the features, those needing attention first, with
      the count in the lead.
  - **Setup** stays ahead of them on a first run.
- **The theme moves to the sidebar's foot**, three choices always in
  reach, rather than taking a section with one row.
- **The head is one toolbar**: the page's name over the sidebar, the
  section's name over the section, and Close (a square ✕) or Set up later
  and Finish setup on the right. Every section opens with a one-line lead
  saying what it is for.
- **Narrow windows show a list or one section.** Under 760px (the Mac's
  half-width window, a phone) the page shows either the list of sections
  (rows with chevrons, the theme at the foot) or one section with a back
  button, iOS's way. This replaces a row of tabs, which did not fit seven.
- **REC's input is two dropdowns** (Ben: "a bunch of buttons" before),
  with Stereo | Mono between them.
  - The device is a native `<select>`.
  - The channel's dropdown is drawn by the page (`ChannelMenu.svelte`):
    each of its rows carries that input's live level, and its closed
    button the picked one's. Safari's own picker shows text only and
    freezes while open, so it could not.
- **Smaller fixes**:
  - Learn draws its action (Learn, Cancel, Try again) as a button on the
    right of its row, pulsing while it listens.
  - The Groove view's own group numbers its tiles.
  - Setup draws the iPad as its fifth step, numbers the steps that are
    not done yet, tags the optional ones, and shows a progress bar.
  - Input meters and the "heard" dots are Live's green.
- **One stylesheet** (`settings/settings.css`) holds the shell and the
  grammar every section shares, under the flat grammar's rules: no
  shadow, mixed-case labels, Live's orange for ON and its blue for the
  selected section.
- **Old addresses still land.** `#settings/general` opens Recording,
  `#settings/features` opens Integrations, and `#settings/library` opens
  Library. Error messages that named "Settings → Places" or "Settings →
  Capture" name Library and Recording.

## Consequences
- The foot switch's first-run step opens Controllers ("Open
  Controllers"), and Places' opens Library.
- A section of one or two rows (Recording on Track, Controllers without
  the Max patch) leaves the column mostly empty. That was preferred to
  merging unrelated settings again.
- The screenshot tour can now open Settings by hash: the gear's press
  action ignores a DOM `click()`, so every gear-opened state had timed out.
  The tour also takes a state's own `viewport`, `theme` and `layout: false`.

## Tags
`settings`, `onboarding`, `ia`, `phone`, `flat-grammar`
