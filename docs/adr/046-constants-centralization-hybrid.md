#ADR-046: Constants Centralization with Hybrid Approach

**Status:** Implemented
**Date:** 2025-01-11
**Context:** Configuration Management Across Multi-Language System
**Related:** ADR-028 (Project Constants File)

---

## Context

The Looping project spans multiple languages and environments:
- **Node.js** (OSC bridge, build scripts)
- **TypeScript/SvelteKit** (Interface)
- **Python** (Device automation, shell helpers)
- **Max/MSP** (Live API, observers)

During the constants consolidation effort (extending ADR-028), we discovered that centralizing **all** configuration in `config/constants.json` created import path challenges for the SvelteKit interface code.

### The Problem

**Attempted Solution:**
```typescript
// This doesn't work in SvelteKit/Vite
import constants from '../../../config/constants.json';
```

**Error:**
```
Failed to load url ../../../config/constants.json
Does the file exist?
```

**Root Cause:** Vite has security restrictions on importing files outside the project root (`interface/` directory). While `vite.config.ts` can import from parent directories during build configuration, runtime/source code cannot.

### Alternative Approaches Considered

1. **Vite Alias Configuration**
   - ❌ Complex, non-standard
   - ❌ Requires additional build config
   - ❌ May break on updates

2. **Symlink to interface/**
   - ❌ Platform-specific (Windows compatibility)
   - ❌ Adds complexity to repo
   - ❌ Git tracking issues

3. **Copy to static/**
   - ✅ Already doing for runtime fetches (`trackPoolService.ts`)
   - ❌ Build-time imports still fail
   - ❌ Two sources of truth

4. **Top-Level Await for Fetch**
   - ❌ Can cause module initialization issues
   - ❌ Async imports break downstream code
   - ❌ Not supported in all contexts

5. **Inline Constants with Comments** ✅
   - ✅ Simple, no build complexity
   - ✅ Works everywhere
   - ✅ Clear documentation
   - ✅ Easy to maintain

---

## Decision

**Use a hybrid approach for constants management:**

### 1. `config/constants.json` - Source of Truth

**Used directly by:**
- Node.js scripts (`enhanced-osc-bridge.js`, `setup-ipad.js`)
- Build configuration (`vite.config.ts`)
- Python scripts (with JSON loader)
- TypeScript build scripts (`generate-instruments-json.ts`)

```javascript
// Node.js - Direct import works
const constants = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/constants.json'), 'utf8')
);
```

### 2. Inlined Constants - TypeScript Services

**Used by SvelteKit source code:**
- Service files (`trackResetService.ts`, `sessionResetService.ts`)
- Client code (`simpleClient.ts`)

```typescript
// Inlined with clear documentation
// Constants - matching config/constants.json
// Inlined to avoid Vite import issues with files outside interface/
const EMPTY_TRACK_COLOR = 8421504; // 0x808080 Gray
const DELAY_CLIP_DELETION = 20;
```

### 3. Runtime Fetch - Dynamic Config

**Used for runtime-configurable values:**
- Audio conversion file path (`trackPoolService.ts`)
- Served from `interface/static/config/constants.json`

```typescript
// Runtime fetch from web server
const response = await fetch('/config/constants.json');
const config = await response.json();
CONVERSION_AUDIO_FILE = config.ableton.conversionAudioFile;
```

---

## Implementation

### File Structure

```
/
├── config/
│   └── constants.json              # ⭐ SOURCE OF TRUTH
├── interface/
│   ├── vite.config.ts              # ✅ Direct import (build-time)
│   ├── bridge/
│   │   └── enhanced-osc-bridge.js  # ✅ Direct import (Node.js)
│   ├── src/lib/
│   │   ├── api/
│   │   │   └── simpleClient.ts     # 📝 Inlined constants
│   │   └── services/
│   │       ├── trackResetService.ts    # 📝 Inlined constants
│   │       ├── trackPoolService.ts     # 🔄 Runtime fetch + inlined
│   │       └── sessionResetService.ts  # 📝 Inlined constants
│   └── static/config/
│       └── constants.json          # 📋 Copy for runtime fetch
└── scripts/
    ├── setup-ipad.js               # ✅ Direct import (Node.js)
    └── generate-instruments-json.ts # ✅ Direct import (build script)
```

### Constants Coverage

**Infrastructure (Direct Import):**
```json
{
  "osc": {
    "max4Live": { "localPort": 9001, "remotePort": 9002 },
    "abletonOSC": { "localPort": 11001, "remotePort": 11000 },
    "webSocket": { "port": 8080 }
    // ... all 7 OSC endpoints
  },
  "network": {
    "hostname": "looping-studio",
    "ipad": { "wifi": "192.168.50.147", "usbc": "192.168.100.1" }
  },
  "http": { "interfacePort": 3000 }
}
```

**Services (Inlined):**
```json
{
  "timing": {
    "trackReset": { "clipDeletion": 20, "deviceDeletion": 100, ... },
    "trackPool": { "conversionWait": 1000, "conversionTimeout": 5000, ... },
    "sessionReset": { "trackCreationTimeout": 5000, ... }
  },
  "tracks": { "emptyColor": 8421504, "emptyPrefix": "Empty Slot " },
  "trackPool": { "size": 16, "startIndex": 0 }
}
```

**Runtime Config (Fetch):**
```json
{
  "ableton": {
    "conversionAudioFile": "/Users/Shared/.../sample.wav"
  }
}
```

---

## Benefits

### ✅ Centralized for Infrastructure
- OSC bridge, build tools, scripts all use single source
- Network configuration in one place
- Easy to update when Ableton version changes

### ✅ No Build Complexity
- No Vite aliases or workarounds needed
- Standard SvelteKit/Vite configuration
- Works on all platforms

### ✅ Clear Documentation
- Inlined constants have comments linking to source
- Easy to find and understand
- Grep-able for maintenance

### ✅ Runtime Flexibility
- Dynamic values (like audio file paths) can update without rebuild
- Static values compiled into bundle for performance

### ✅ Cross-Platform Compatible
- No symlinks or platform-specific workarounds
- Works on Mac, Windows, Linux
- iPad receives pre-built bundle with constants

---

## Consequences

### Positive

✅ **Simple Mental Model**
- Infrastructure = direct import
- Services = inlined with comments
- Dynamic = runtime fetch

✅ **No Build Failures**
- Eliminates Vite import path errors
- No special configuration needed

✅ **Maintainable**
- Single source of truth documented
- Comments make relationship clear
- Easy to sync during updates

✅ **Performance**
- Inlined constants = zero runtime overhead
- No async initialization required
- Bundle includes all values

### Negative

⚠️ **Manual Sync Required**
- Must update both `config/constants.json` AND inlined values
- Risk of drift if not careful

⚠️ **Not DRY**
- Values duplicated between JSON and TypeScript
- More code to maintain

⚠️ **Discovery**
- New developers might not know about constants.json
- Need to read comments to understand source

---

## Migration Strategy

### Completed (2025-01-11)

1. ✅ **Expanded `config/constants.json`**
   - Added all OSC ports, network config, timing values
   - Structured by category (osc, network, timing, paths, etc.)

2. ✅ **Updated Infrastructure**
   - `enhanced-osc-bridge.js` - All OSC config
   - `vite.config.ts` - Server port, allowed hosts
   - `setup-ipad.js` - Ableton app name
   - `generate-instruments-json.ts` - Instruments path

3. ✅ **Inlined Service Constants**
   - `simpleClient.ts` - WebSocket, queue config
   - `trackResetService.ts` - Track colors, timing
   - `trackPoolService.ts` - Pool size, timeouts
   - `sessionResetService.ts` - Operation delays

4. ✅ **Copied to Static**
   - `interface/static/config/constants.json` updated
   - Runtime fetch in `trackPoolService.ts` working

### Maintenance Guidelines

**When Updating Constants:**

1. **Update source:** `config/constants.json`
2. **Update inlined copies:** Search for matching values in `.ts` files
3. **Update static copy:** `interface/static/config/constants.json`
4. **Verify comments:** Ensure inline comments reference constants.json

**Search Pattern:**
```bash
# Find inlined constants
grep -r "matching config/constants.json" interface/src/
```

---

## Alternatives Not Chosen

### Option A: Pure Runtime Fetch (All Services)
**Why not:**
- Async initialization complexity
- Performance overhead
- Race conditions on startup

### Option B: Vite Plugin for External Imports
**Why not:**
- Added build complexity
- Non-standard configuration
- Maintenance burden

### Option C: Monorepo with Shared Package
**Why not:**
- Overkill for current project size
- Added tooling complexity
- Not needed for this use case

---

## Future Enhancements

### 1. Build-Time Validation
Add script to verify inlined constants match JSON:

```typescript
// scripts/verify-constants.ts
const json = JSON.parse(fs.readFileSync('config/constants.json'));
const inlined = extractFromTypeScript('interface/src/lib/services/*.ts');
const mismatches = compare(json, inlined);
if (mismatches.length) throw new Error('Constants out of sync!');
```

### 2. Code Generation
Auto-generate TypeScript constants from JSON:

```typescript
// scripts/generate-constants.ts
const constants = JSON.parse(fs.readFileSync('config/constants.json'));
const ts = generateTypeScriptFile(constants);
fs.writeFileSync('interface/src/lib/generated/constants.ts', ts);
```

### 3. TypeScript Definitions
Add type definitions for constants.json:

```typescript
// config/constants.schema.ts
export interface Constants {
  osc: {
    webSocket: { port: number };
    // ...
  };
  // ...
}
```

---

## Testing

### Verification Steps

**Build Test:**
```bash
cd interface
npm run build  # Should succeed without import errors
```

**Runtime Test:**
```bash
npm run dev
# Verify OSC bridge connects on correct ports
# Verify interface loads constants from /config/constants.json
```

**Cross-Platform Test:**
- ✅ Mac (development)
- ✅ iPad (production, served bundle)

---

## References

- **ADR-028:** Project Constants File (original JSON approach)
- **Vite Docs:** [Importing Assets Outside Root](https://vitejs.dev/guide/assets.html)
- **Implementation:** See commits from 2025-01-11

---

**Status:** Implemented
**Decision Date:** 2025-01-11
**Implementation:** Complete
**Next Review:** When considering monorepo or adding 5+ more languages

---

**Last Updated:** 2025-01-11
