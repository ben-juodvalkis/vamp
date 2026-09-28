# ADR-324: Auto-Start Browser Blocker During iPad Setup

**Date:** 2026-03-12
**Status:** Implemented

## Context

During live performance sessions, accidentally opening Safari or Chrome on the Mac can be disruptive — browser notifications, auto-playing content, or simple distraction can interrupt a performance. A separate `browser-blocker` tool exists at `/Users/Shared/DevWork/GitHub/browser-blocker/` that kills Safari and Chrome unless the user solves puzzles to earn a timed browsing window.

Previously, the blocker had to be started manually before each session, which was easy to forget.

## Decision

Auto-start the browser blocker as part of `npm run ipad` by calling `setup.sh start` from the browser-blocker repo during the post-build launch sequence in `scripts/setup-ipad.js`.

### Key design choices:

1. **Fire-and-forget spawn** — the blocker is started with `detached: true` and `stdio: 'ignore'`, matching the pattern used for Ableton, Safari, and Max Utility launches. It runs independently and doesn't block the setup flow.

2. **Launched alongside other apps** — starts in the same post-preview-ready callback as Ableton and Max, keeping all "open these things for a session" logic in one place.

3. **Independent lifecycle** — the blocker manages its own PID files and can be stopped independently via `./setup.sh stop` from the browser-blocker repo. It is not tied to the Looping process tree.

4. **Hardcoded path** — uses an absolute path (`/Users/Shared/DevWork/GitHub/browser-blocker/setup.sh`) rather than adding it to `constants.json`, since this is a local development tool dependency rather than a project configuration value.

## Consequences

- Browser blocker starts automatically when running `npm run ipad`, reducing pre-performance setup steps.
- If the browser-blocker repo is not present at the expected path, the spawn will silently fail without affecting the rest of the setup.
- The blocker must still be stopped manually after a session, or it will continue running until the Mac restarts (unless LaunchAgents are configured).
