# ADR-490: Vamp for Mac Runs Vamp

## Status
**Proposed** (2026-10-27), on branch `bj/native-ipad-app`. Accepted once Ben
has run a session from the icon. No Live restart: the scripts and the
menu-bar app only.

## Context
Starting Vamp meant a Terminal: `npm run ipad`, whose window had to stay
open, plus a status page it opened in Safari for the iPad's address. Ben
asked to "just click an application icon". Vamp for Mac (ADR-488) is
already the menu-bar app on the rig, so it is the natural thing to click.

## Decision
- **Opened from the Dock or Launchpad, Vamp for Mac starts Vamp**: it runs
  `npm run ipad` as its own child, through a login shell for the PATH a
  Terminal has, with `SKIP_MENUBAR=1` (it is the menu bar) and
  `VAMP_MAC_APP=1` (no Safari windows; the menu replaces the status page).
  Output goes to `logs/vamp-mac.log`, opened for appending by both ends.
- **The menu reports and controls it**: "Vamp: running / starting… /
  stopped", Start, Restart, Stop, "Copy iPad Address" (the Mac's `.local`
  name), "Show Log", "Open at Login" (`SMAppService`). The page server's
  answer on `padLink.pagePort` is the health signal, polled every 2 s.
- **Quitting stops what it started**: the child's whole process tree, found
  by parent pid (`proc_listchildpids`), SIGTERM then SIGKILL after 2 s, then
  `scripts/cleanup.sh`. Not by name: Max's Node inherits npm's environment and
  matches the stack's names. Measured: after quitting, no bridge, page
  server or `concurrently`, ports 8081, 8889 and 8890 free, Live and Max
  untouched.
- **An unexpected exit is restarted** after 3 s, at most 3 times in 2
  minutes; past that the menu says it stopped and points at the log.
  `concurrently` still restarts the bridge and page server themselves.
- **Servers already answering are someone else's** (a Terminal's
  `npm run ipad`): the menu says so and offers no Stop. Started by
  `npm run ipad` / `npm run dev` (`VAMP_FROM_NPM=1`, from
  `scripts/launch-menubar.sh`) the app only reports, as before.
- **`npm run ipad` exits when its servers do.** Its status page's server
  used to keep `setup-ipad.js` alive with nothing under it — found when the
  app could not tell a dead Vamp from a running one.
- **`npm run install-mac-app`** builds the Release app into
  `/Applications/Vamp.app` (`~/Applications` until 2026-10-30, which Finder's
  Applications does not list) with its icon and records the checkout it runs
  (`defaults … repoRoot`), since an app opened from the Dock has no working
  directory. Interface and server changes need no reinstall.

- **It keeps itself current** (2026-10-30, Ben: "can we have vamp
  automatically check for any changes when it starts up?"). The installer
  records the fingerprint of the app's own code
  (`scripts/mac-app-fingerprint.sh`: `owner/apps` Mac/, Shared/, project.yml,
  Config/Base.xcconfig). Opened from the Dock, the app recomputes it; if it
  differs it rebuilds and replaces itself (`VAMP_SELF_UPDATE=1
  install-mac-app.sh`), waits for its own process to exit and relaunches the
  new copy, which starts Vamp. A failed rebuild runs the installed copy and
  says so in the log. Interface and server changes were already rebuilt by
  `npm run ipad`'s own fingerprint gate on every start; the iPad app still
  needs Xcode, and the iPad a reload for a new interface. Measured: after an
  edit to `Supervisor.swift`, open → rebuilt in 5 s → relaunched → page
  server up 13 s after the click.
- **The servers start without `NODE_USE_SYSTEM_CA`.** With it set, Node 24.7
  reads the macOS Keychain's certificates on a background thread and can
  segfault there (crash report 2026-10-30: `ReadMacOSKeychainCertificates` →
  `X509_get_subject_name`, a null read); npm then re-raises the signal, and a
  start died with exit 1 after a skipped build. The setting came from the
  environment the app was launched from (Claude Code's), not Ben's shell;
  Vamp makes no outbound TLS, so the app drops it for its child.

## Consequences
- Measured from a Dock-style `open`: the page server answered 42 s after
  the click (an unchanged build is skipped), with Live, the browser
  blocker and the Max patch opened as `npm run ipad` opens them.
- `npm run ipad` and `npm run dev` stay, for development, where the output
  belongs in a terminal.
- The bridge and page server are still Node: the app needs Node installed.
  A copy carried inside the app is the general edition's question, with
  distribution.
- A test shell inside the repo that names the servers is stopped by
  `cleanup.sh` like a leftover server; run checks from elsewhere.

## Tags
`menubar`, `native-app`, `startup`, `supervisor`, `npm-run-ipad`
