# ADR 056: Build Fix - Missing OSC Bridge Import

## Status
Accepted

## Context
When running `npm run ipad` (which builds the interface for production), the build was failing with an import error:

```
[vite:load-fallback] Could not load /Users/Shared/DevWork/GitHub/Looping/interface/src/lib/services/oscBridge
(imported by src/lib/components/v6/browser/TopGestureBrowser.svelte)
```

### Root Cause

The `TopGestureBrowser.svelte` component had an incorrect dynamic import path:
```typescript
const { send } = await import('$lib/services/oscBridge');
```

This file doesn't exist. The correct path is `$lib/api/simpleClient`, which is the standard OSC communication module used throughout the rest of the codebase (e.g., in `trackPreparation.ts`).

## Decision

Fixed the import path in `TopGestureBrowser.svelte` to use the correct module:

```typescript
// Before
const { send } = await import('$lib/services/oscBridge');

// After
const { send } = await import('$lib/api/simpleClient');
```

This aligns with the pattern used in all other services (e.g., `trackPreparation.ts`).

## Consequences

### Positive
- Production builds now complete successfully with full PWA support
- Build process is reliable and predictable
- Code uses consistent import paths across the codebase
- **All PWA features retained**: offline support, install to home screen, fullscreen mode, auto-updates, asset caching

### Negative
None - this was a simple bug fix.

## Implementation

### Files Modified
`interface/src/lib/components/v6/browser/TopGestureBrowser.svelte` - Fixed import path on line 497

### Build Output
After the fix, production builds successfully generate:
- `registerSW.js` - Service worker registration
- `manifest.webmanifest` - PWA manifest
- Optimized client and server bundles

## Notes
- The error revealed an inconsistency in module naming during development of the audio clip browser feature
- Consider creating a barrel export (e.g., `$lib/services/osc`) to make the correct import path more discoverable
- PWA features are fully functional and critical for the iPad live performance use case:
  - **Fullscreen mode** eliminates Safari chrome for maximum screen real estate
  - **Install to home screen** provides native app-like experience
  - **Offline support** keeps UI responsive during temporary network issues
  - **Auto-updates** ensure latest version without manual refresh

## References
- Issue: Build failure on `npm run ipad`
- Related: [ADR 018](./018-gesture-browser-architecture.md) - Gesture browser implementation (where the bug was introduced)
