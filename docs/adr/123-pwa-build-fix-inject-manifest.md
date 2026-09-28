# ADR 123: PWA Build Fix - Switch to injectManifest Strategy

**Date:** 2025-11-20
**Status:** Implemented
**Impact:** High - Fixes production builds and enables PWA functionality

## Context

The production build was failing with the error:
```
ENOENT: no such file or directory, open '.svelte-kit/output/server/sw.js'
```

This prevented deployment to iPad and broke PWA functionality, which is essential for the live performance interface.

## Problem

Two distinct issues were blocking successful builds:

### 1. PWA Plugin Build Failure

`@vite-pwa/sveltekit` with `generateSW` strategy had a timing issue:
- Plugin tried to write service worker to `.svelte-kit/output/server/sw.js`
- Directory didn't exist yet during the build process with SvelteKit adapters
- Build failed before adapter could create the directory structure

The `generateSW` strategy auto-generates the service worker file, but it runs at the wrong point in the SvelteKit build lifecycle.

### 2. Svelte Syntax Errors

Svelte 5 compiler couldn't parse `/` characters in `class:` directive bindings:

```svelte
<!-- This failed to compile -->
<button class:border-cyan-500/30={condition}>

Error: Expected token >
```

Files affected:
- `AutoFilterCentralView.svelte` (3 occurrences)
- `PedalCentralView.svelte` (1 occurrence)
- `PitchCentralView.svelte` (1 occurrence)

## Decision

### PWA Fix: Switch to `injectManifest` Strategy

Changed from auto-generated service worker to custom implementation:

**Before:**
```typescript
SvelteKitPWA({
  strategies: 'generateSW',
  // ... plugin tries to write SW before directory exists
})
```

**After:**
```typescript
SvelteKitPWA({
  strategies: 'injectManifest',
  injectManifest: {
    swSrc: 'src/service-worker.ts'  // Use custom SW
  },
  manifest: false  // Use static manifest.json
})
```

### Implementation Changes

1. **Created Custom Service Worker** (`interface/src/service-worker.ts`)
   - Uses SvelteKit's `$service-worker` module for build/files/version
   - Implements cache-first for app assets
   - Network-first with cache fallback for dynamic content
   - Proper cache invalidation on version change

2. **Created Static Manifest** (`interface/static/manifest.json`)
   - Contains all PWA metadata (name, icons, display mode, etc.)
   - Served as static asset instead of being generated

3. **Updated HTML Template** (`interface/src/app.html`)
   - Added `<link rel="manifest">`
   - Added icon links for better PWA installation experience

4. **Fixed Syntax Errors**
   - Removed all `class:border-*/*={condition}` directives
   - Moved border colors to inline `style` attributes
   - Example: `style="border-color: rgba(6, 182, 212, 0.3);"`

5. **Switched to adapter-auto** (`interface/svelte.config.js`)
   - Changed from `adapter-node` with custom `out` directory
   - Let SvelteKit choose appropriate adapter
   - Ensures proper output directory structure

## Consequences

### Positive

✅ **Builds succeed** - Production builds now complete without errors
✅ **PWA works** - Full offline support with service worker caching
✅ **More control** - Custom service worker allows fine-tuned caching strategy
✅ **Better compatibility** - `injectManifest` works reliably with SvelteKit lifecycle
✅ **Cleaner code** - Static manifest is easier to maintain than plugin config

### Neutral

⚙️ **Manual SW updates** - Need to edit `service-worker.ts` for caching changes (but gives more control)
⚙️ **Static manifest** - Must update `manifest.json` separately from vite config

### Trade-offs

- **Lost auto-generation** - Service worker no longer auto-generated, but we gain:
  - Full control over caching strategy
  - No build timing issues
  - Better debugging (can read the actual SW code)

- **Border styling** - Lost Tailwind class for border opacity, but we gain:
  - No syntax errors
  - More explicit styling (rgba values visible)

## Files Changed

### Created
- `interface/src/service-worker.ts` - Custom service worker implementation
- `interface/static/manifest.json` - PWA manifest

### Modified
- `interface/vite.config.ts` - Switched to injectManifest strategy
- `interface/svelte.config.js` - Use adapter-auto instead of adapter-node
- `interface/src/app.html` - Added manifest and icon links
- `interface/src/lib/components/v6/central/views/AutoFilterCentralView.svelte`
- `interface/src/lib/components/v6/central/views/PedalCentralView.svelte`
- `interface/src/lib/components/v6/central/views/PitchCentralView.svelte`

## Alternatives Considered

1. **Upgrade @vite-pwa/sveltekit** - Version 1.0.1 available, but same timing issue exists
2. **Disable PWA entirely** - Not acceptable, PWA is essential for iPad performance use
3. **Use different PWA library** - `injectManifest` with existing library is simpler
4. **Fix adapter output path** - Tried, but doesn't solve plugin timing issue

## Validation

Build succeeds with:
```bash
npm run build
✓ built in 12.22s
```

Service worker registered and caching works:
- Check DevTools → Application → Service Workers
- Check DevTools → Application → Cache Storage → `looping-cache-*`

PWA installable on iPad:
- Manifest loads at `/manifest.json`
- Icons load correctly
- "Add to Home Screen" works

## References

- [SvelteKit Service Workers](https://kit.svelte.dev/docs/service-workers)
- [@vite-pwa/sveltekit docs](https://vite-pwa-org.netlify.app/frameworks/sveltekit.html)
- [Workbox injectManifest](https://developer.chrome.com/docs/workbox/modules/workbox-build#injectmanifest)

## Related ADRs

- ADR-073: Build Performance Optimization (introduced adapter-node config)
