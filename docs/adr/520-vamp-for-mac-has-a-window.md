# ADR-520: Vamp for Mac Has a Window, and Settings… Opens Settings

## Status
**Accepted** (2026-11-09). Builds on ADR-488 (Vamp for Mac) and ADR-490
(Vamp for Mac runs Vamp). Vamp for Mac and the interface only; no Live
restart.

## Context
Vamp for Mac was a menu-bar agent with no window. Opened from the Dock it
started Vamp and showed nothing but an icon in the menu bar, so someone who
is not Ben could not tell it had worked. The interface's Settings (the
first-run checklist, Places, Connection) was reachable only from a gear
inside the master track's central view, and onboarding is meant to open
"on the Mac first" (general-release README, decision 5), where nothing
opened it. Ben asked whether the app should have a UI, then whether
Settings should be easier to reach than that gear; his call (2026-11-09):
"great lets do it" to a window showing the same interface, with a
Settings… item.

## Decision
- **Vamp for Mac has one window: the interface itself**, in a web view on
  `http://localhost:<padLink.pagePort>/`, the page server the app starts.
  No second UI: everything in it is the iPad's interface. Until the page
  server answers, the window says the menu's status line ("Vamp:
  starting…") and loads the page once it does; a failed load waits for the
  page server again.
- **It opens** when the app is opened by hand (the Dock, Launchpad,
  Finder), again on a click of the running app's icon, and from the menu's
  **Open Vamp**. Not at login (`keyAELaunchedAsLogInItem`) and not under
  `npm run ipad` / `npm run dev` (`VAMP_FROM_NPM=1`), where a browser has
  the interface already.
- **Settings… (⌘,)**, in the menu-bar menu and in the app menu while the
  window is open, brings the window up on Settings. The page opens
  Settings on `#settings` or `#settings/<section>` (setup, general, places,
  grooves, connection), on load and on any later change, and clears the
  hash so the next Settings… lands again. Any browser can use the address.
  The gear stays.
- **Open, the app is a regular app** (Dock icon, ⌘-Tab, a menu bar);
  closed, it is a menu-bar agent again and the page is torn down with the
  window, so a closed window is not another client of the bridge.
  Quitting is unchanged: Quit in the menu stops Vamp.

## Consequences
- A new user who opens Vamp sees Vamp, and Settings has a door where Mac
  users look for it.
- The Mac window is another client of the bridge beside the iPad, as Safari
  on the Mac always could be.
- The window is drawn at the iPad's 1366×1024 where the screen allows, and
  remembers its frame; a narrow window gets the phone layout (ADR-503).
- The menu-bar app is no longer only a supervisor, which bears on the
  release plan's "the menubar app is owner-only" (2026-09-26); the
  installed app has shipped with the menu since ADR-490's installer, so
  that line is already out of date there.

## Tags
`native-app`, `menubar`, `settings`, `onboarding`
