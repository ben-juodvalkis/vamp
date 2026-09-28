# ADR-147: iPad Startup Script Optimization

## Status
Accepted

## Context
The `npm run ipad` script was taking longer than necessary to start up. Profiling revealed:

| Script | Before | After |
|--------|--------|-------|
| validate | 0.27s | 0.27s |
| cleanup | **3.50s** | **0.90s** |
| generate-instruments | 1.49s | (parallel) |
| generate:max-config | 1.21s | (parallel) |
| copy-constants | 0.34s | (parallel) |
| copy-track-types | 0.30s | (parallel) |

**Total prep time: ~7.1s → ~4.5s**

Additionally, `setup-ipad-core` was redundantly running cleanup, generate-instruments, copy-constants, and copy-track-types again after `npm run ipad` had already run them.

## Decision

### 1. Parallelize Independent Generators
The four generator/copy scripts have no dependencies on each other, so they can run concurrently:

```json
"ipad": "npm run validate && npm run cleanup && concurrently \"npm run generate-instruments\" \"npm run generate:max-config\" \"npm run copy-constants\" \"npm run copy-track-types\" && node scripts/setup-ipad.js"
```

### 2. Remove Duplicate Work from setup-ipad-core
Since `npm run ipad` already runs the prep scripts, `setup-ipad-core` now only handles the build and server startup:

```json
"setup-ipad-core": "cd interface && npm run build && cd .. && concurrently -n \"BRIDGE,PREVIEW\" -c \"cyan,green\" \"npm run dev:bridge\" \"npm run preview:ipad\""
```

### 3. Optimize cleanup.sh
The cleanup script had two major bottlenecks:

1. **`sleep 2`** - A hardcoded 2-second delay "waiting for cleanup" that wasn't necessary
2. **Sequential `lsof` calls** - 11 port checks running one at a time (~0.15s each)

**Optimizations applied:**
- Removed `sleep 2` entirely
- Run all `lsof` port kills in parallel using background processes (`&`) and `wait`
- Run cache directory deletions in parallel

```bash
# Before: sequential (slow)
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8080 | xargs kill -9 2>/dev/null || true
# ... 9 more

# After: parallel (fast)
(lsof -ti:3000 | xargs kill -9 2>/dev/null || true) &
(lsof -ti:8080 | xargs kill -9 2>/dev/null || true) &
# ... 9 more
wait
```

## Consequences

### Positive
- **~2.6 seconds faster** startup (7.1s → 4.5s for prep phase)
- No duplicate work between `ipad` and `setup-ipad-core`
- Cleanup script now uses >100% CPU (parallel execution) instead of blocking

### Neutral
- Parallel output from generators is interleaved (concurrently handles this with prefixes)

### Negative
- None identified

## Files Changed
- `package.json` - Updated `ipad` and `setup-ipad-core` scripts
- `scripts/cleanup.sh` - Parallelized port kills and cache cleanup, removed sleep
