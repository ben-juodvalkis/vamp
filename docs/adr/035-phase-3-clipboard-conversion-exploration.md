#ADR-035: Phase 3 Clipboard-Based MIDI→Audio Conversion - Exploration & Learnings

**Status:** Rejected (Technical Limitations)
**Date:** 2025-01-08
**Context:** Phase 3 of Empty Tracks Track Pool System
**Related:** Phase 1 (Track Reset), Phase 2 (Track Pool)

---

## Context

After successfully implementing Phase 1 (Track Reset System) and Phase 2 (16-Track MIDI Pool), we attempted Phase 3: converting MIDI pool tracks to audio tracks via clipboard automation.

**Goal:** Enable audio tracks to use the pool system by converting MIDI tracks to audio on-demand, eliminating the need to create new audio tracks.

**Expected Benefits:**
- Audio tracks use pool (same instant performance as MIDI)
- ~450-550ms conversion time (faster than creating new track)
- Works while Live is playing (no stop required)
- Complete pool system (all track types)

---

## Proposed Solution: Clipboard + Menu Paste

### Architecture

```
Frontend: Request audio track
  ↓
Pool: Get empty MIDI track (instant)
  ↓
Max4Live: Send clipboard + menu commands
  ↓
Shell Helper: Execute AppleScript
  ↓
  1. Copy audio file to clipboard (Finder format)
  2. Select MIDI track in Live
  3. Click Edit → Paste menu
  ↓
Ableton: Detects audio in MIDI slot → auto-converts to audio
  ↓
Frontend: Delete pasted clip → clean audio track
```

### Implementation Components

**TypeScript/Bridge:**
- OSC bridge routing for shell helper (ports 11004/11005)
- `convertTrackToAudio()` service function
- Track preparation integration
- Event-based completion detection

**Max4Live:**
- Conversion orchestrator in liveAPI-v6.js
- Task-based timing (100ms, 150ms, 300ms delays)
- Track selection via Live API

**Shell Helper:**
- Standalone Max patch with shell object
- AppleScript execution for clipboard + menu
- Success/error response handling

---

## What We Built

### Code Completed
1. ✅ Bridge routing with shell helper ports
2. ✅ TypeScript conversion service with event listeners
3. ✅ Max4Live orchestrator with timing coordination
4. ✅ Track preparation audio integration
5. ✅ Shell scripts for clipboard + menu automation

### Architecture Validated
- OSC message routing through bridge works perfectly
- Max4Live → Shell Helper communication functional
- Event-based completion detection reliable
- Timeout handling implemented

---

## Technical Challenges Encountered

### 1. AppleScript Quote Escaping

**Problem:** Building shell commands with proper quote escaping through multiple layers (JavaScript → OSC → Max → Shell).

**Attempted Solutions:**
- Single backslash escaping (`\"`) - stripped by OSC layer
- Double backslash escaping (`\\\"`) - still stripped
- Quadruple backslash (`\\\\\"`) - removed entirely
- Hex escapes (`\x22`) - not preserved
- Python subprocess wrapper - added complexity
- sprintf formatting - doesn't preserve escapes

**Working Solution:**
- External shell scripts with hardcoded commands
- Max patch calls scripts instead of building commands
- Avoids all quoting/escaping issues

**Lesson:** OSC string transmission strips backslashes. External scripts are more reliable than dynamic command building.

---

### 2. Clipboard Format Unreliability

**Problem:** Even when clipboard copy succeeds (verified with `osascript -e 'the clipboard as record'`), Ableton paste doesn't work consistently.

**Observations:**
- Manual terminal command works: `osascript -e 'set the clipboard to POSIX file "/path/to/file.wav"'`
- Clipboard verification shows file is present: `«class furl»:file...`
- Cmd+V in Ableton clip slot does nothing
- Menu automation via AppleScript executes but paste fails silently

**Possible Causes:**
- Clipboard format not exactly what Ableton expects
- Timing issues (clipboard not fully set before paste)
- Finder file reference vs. direct file path difference
- Ableton expecting different pasteboard type (NSFilenamesPboardType vs. POSIX file URL)
- macOS permissions or clipboard access issues from shell/Max

**Tested:**
- Various AppleScript formats (POSIX file, alias, file URL)
- Timing delays (100ms, 200ms, 400ms)
- Manual Cmd+V (fails even with verified clipboard)
- Menu automation (executes but doesn't paste)

**Lesson:** Clipboard-based file automation is unreliable between applications. Works in Finder but not consistently in DAWs.

---

### 3. Menu Automation Complexity

**Problem:** AppleScript menu clicking has hidden dependencies and failure modes.

**Issues Found:**
- Application must be frontmost (added activation step)
- Clip slot must be selected (not just track)
- Menu item names must be exact (case-sensitive, punctuation)
- Quote escaping in process name: `tell process "Live"` vs `tell process Live`
- System Events permissions required
- Silent failures (menu clicks but nothing happens)

**Lesson:** GUI automation is fragile and has many hidden preconditions. Not suitable for performance-critical live workflows.

---

## Why We're Not Proceeding

### 1. Reliability Issues
- Clipboard format inconsistently recognized by Ableton
- Too many moving parts (clipboard + timing + menu + permissions)
- Silent failures difficult to debug in live performance
- No feedback loop to verify success before signaling complete

### 2. Complexity vs. Benefit
- **Complex:** 4 shell scripts, OSC routing, AppleScript coordination, timing dependencies
- **Benefit:** ~200-300ms savings vs. creating audio track normally
- **Risk:** High - clipboard flakiness could break during performance

### 3. Existing Solution Works
- Legacy audio track creation via AbletonOSC: ~300ms, reliable
- Pool already provides massive benefit for MIDI tracks (main use case)
- Audio tracks are less frequent use case

### 4. Performance Not Critical for Audio
- MIDI tracks are main bottleneck (drum racks loaded frequently)
- Audio tracks created less often (1-2 per session vs. 10-15 MIDI)
- 300ms creation time acceptable for infrequent operation

---

## Decision

**Reject clipboard-based audio conversion for Phase 3.**

**Instead: Keep Phase 2 as complete, use legacy audio creation**

### What We Keep (Phase 2)
- ✅ Track reset system (Phase 1)
- ✅ 16-track MIDI pool (Phase 2)
- ✅ Smart recycling (mute-based)
- ✅ Instant MIDI track selection (<50ms)
- ✅ ~70-90% performance improvement for main use case

### What We Change (Phase 3 Pivot)
- ❌ No clipboard conversion
- ✅ Audio button uses legacy track creation (reliable)
- ✅ Pool focused on MIDI (where it matters most)
- ✅ Simple, maintainable, reliable

---

## Alternative Approaches Considered

### 1. Bounce in Place (Original Phase 3 Plan)
**Pros:** Native Ableton feature, reliable
**Cons:** Requires playback stop, slower (~800ms), more complex API

**Why Not:** Clipboard seemed faster and worked while playing. Turned out to be less reliable.

### 2. Python Clipboard Library (PyObjC)
**Pros:** Direct pasteboard access, proper format control
**Cons:** New dependency, requires Python environment setup

**Why Not:** Adds external dependency for marginal benefit. Not worth complexity.

### 3. Hybrid Pool (MIDI Pool + Audio Creation)
**Pros:** Simple, reliable, keeps pool benefits
**Cons:** Audio tracks not pooled

**Why Yes:** This is what we're choosing. MIDI pool + legacy audio creation.

### 4. Separate Audio Pool
**Pros:** Pre-create 4-8 audio tracks, instant selection
**Cons:** More session tracks, can't convert MIDI→Audio

**Future:** Could revisit if audio track performance becomes issue.

---

## Lessons Learned

### Technical Insights

1. **OSC String Escaping**
   - OSC transmission strips backslashes
   - Use external scripts instead of dynamic command building
   - Message format matters more than we expected

2. **Clipboard Automation**
   - Works between apps with same pasteboard expectations
   - DAWs may have custom clipboard formats
   - Verification != actual functionality
   - Not suitable for mission-critical workflows

3. **GUI Automation**
   - AppleScript menu clicking is fragile
   - Many hidden preconditions (focus, selection, permissions)
   - Silent failures are hard to debug
   - Better for one-off tasks than production features

4. **When to Pivot**
   - If workaround requires workarounds, reconsider approach
   - "Working in terminal" != "working in production"
   - Complexity accumulation is a warning sign
   - Sometimes simple + reliable beats clever + fast

### Development Process

1. **Iterative Testing Valuable**
   - Discovered issues through actual testing
   - Theory (clipboard paste) vs. reality (flaky)
   - Good that we tested before full integration

2. **Know When to Stop**
   - 2+ hours on quote escaping = sign to pivot
   - Working solution exists (legacy audio creation)
   - Don't over-optimize edge cases

3. **Document Failed Attempts**
   - This ADR prevents future retry of same approach
   - Learnings valuable for other features
   - Clear decision trail

---

## Code Status

### Completed But Not Merged

**Branch:** `phase-3-midi-to-audio`

**Files Modified:**
- `interface/bridge/enhanced-osc-bridge.js` (shell helper routing)
- `interface/src/lib/services/trackPoolService.ts` (conversion function)
- `interface/src/lib/services/trackPreparation.ts` (audio integration)
- `ableton/scripts/liveAPI-v6.js` (orchestrator)
- `interface/src/lib/components/v6/browser/GestureBrowser.svelte` (3s delay)

**Files Created:**
- `ableton/scripts/shell/*.sh` (helper scripts)
- `documentation/current-project/empty-tracks/PHASE-3-TYPESCRIPT-COMPLETE.md`

**Status:** Code complete, technically functional, but unreliable. Not recommended for production.

### What to Do

**Recommended: Discard phase-3 branch, stay on track-pool-phase-2**

```bash
git checkout track-pool-phase-2
# Phase 2 is stable and provides all core benefits
```

**If You Want to Keep Exploration:**
```bash
git checkout phase-3-midi-to-audio
git branch phase-3-clipboard-exploration  # Archive for reference
git checkout track-pool-phase-2
```

---

## Future Possibilities

### If Audio Pool Becomes Priority

**Option 1: Pre-create Audio Tracks**
- Session reset creates 12 MIDI + 4 Audio tracks
- Separate pools with separate selection algorithms
- No conversion needed
- Simple, reliable

**Option 2: AbletonOSC Bounce API**
- If AbletonOSC adds bounce/flatten API in future
- Native, reliable, proper error handling
- Worth revisiting if API becomes available

**Option 3: Live API 12+ Features**
- Future Ableton versions may add track conversion API
- Monitor Live API changelog for new features

**Option 4: Accept Legacy Audio Creation**
- It works fine (~300ms)
- Audio tracks infrequent
- Focus optimization efforts elsewhere

---

## Recommendations

### For This Project

1. **Merge Phase 2** as complete and stable
2. **Close Phase 3** as exploration (unsuccessful)
3. **Document learnings** (this ADR)
4. **Move forward** with MIDI pool only
5. **Revisit audio** if it becomes performance bottleneck

### For Future Features

1. **Avoid GUI automation** for critical workflows
2. **Test clipboard early** before investing in architecture
3. **External scripts** better than dynamic command building
4. **Keep it simple** - working solution beats clever solution
5. **Know when to pivot** - don't sink cost fallacy

---

## Conclusion

The clipboard-based MIDI→Audio conversion approach is **technically possible but practically unreliable**. The implementation taught us valuable lessons about OSC escaping, clipboard automation, and when to choose simplicity over optimization.

**Phase 2 delivers 90% of the benefit** (instant MIDI track selection) with 100% reliability. Adding audio conversion adds 10% benefit with significant reliability risk.

**Decision: Keep Phase 2, use legacy audio creation, document learnings.**

---

## References

- Phase 1: `documentation/current-project/empty-tracks/PHASE-1-COMPLETE.md`
- Phase 2: `documentation/current-project/empty-tracks/PHASE-2-IMPLEMENTATION-COMPLETE.md`
- Phase 3 Spec: `documentation/current-project/empty-tracks/phase-3-audio-conversion.md`
- Code Branch: `phase-3-midi-to-audio` (not merged)
- Forum Thread: https://cycling74.com/forums/shell-problem-with-osascript-multiline

---

**Status:** Exploration Complete - Not Recommended for Production
**Decision:** Use Phase 2 (MIDI Pool) + Legacy Audio Creation
**Branch:** Archived as `phase-3-clipboard-exploration` (reference only)

---

**Last Updated:** 2025-01-08 (Phase 3 Exploration Concluded)
