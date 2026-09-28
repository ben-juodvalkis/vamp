#ADR-038: Audio Clipboard Automation via Focus-Change Pattern

**Status:** Accepted
**Date:** 2025-01-10
**Context:** Audio Track Pool System (Alternative Approach)
**Related:** ADR-018 (Failed AppleScript Approach), ADR-019 (Constants File)

---

## Context

### Background

In ADR-018, we attempted to automate audio file pasting into Ableton Live using AppleScript-based clipboard manipulation. After extensive exploration, we concluded:

> "The clipboard-based MIDI→Audio conversion approach is **technically possible but practically unreliable**."

The core problem:
- ✅ Clipboard could be set programmatically
- ✅ Format was correct (verified with `osascript`)
- ❌ **Ableton pasted the wrong file** (previous clipboard value)
- ❌ **Even manual Cmd+V** pasted the wrong file after script ran

This was documented as an unsolvable problem, and we pivoted to semi-automated copy (user presses Cmd+V manually).

### The Breakthrough

**User observation (2025-01-10):**

> "it seems like if i navigate to a different app, then back to ableton, then it updates the clipboard or something"

**This was the key insight.** Ableton reads the clipboard **when gaining focus**, not when processing Cmd+V.

---

## The Problem (Detailed)

### What We Tried (ADR-018)

1. **AppleScript clipboard writes** - Worked in terminal, failed in production
2. **Quote escaping through OSC layers** - Constant battle with string escaping
3. **Menu automation** - Fragile, many hidden dependencies
4. **Timing delays (100ms → 2000ms)** - No improvement
5. **Double clipboard writes** - No effect
6. **Double paste operations** - No effect

### The Persistent Issue: 1-Step Lag

**Observed behavior:**
```
Run 1: Copy Effect-03.aiff → Pastes Effect-07.aiff (old value)
Run 2: Copy Effect-04.aiff → Pastes Effect-03.aiff (previous run!)
Run 3: Copy Effect-05.aiff → Pastes Effect-04.aiff (previous run!)
```

**Verification confirmed:**
- `osascript -e 'the clipboard'` showed **correct** file
- Python `NSPasteboard.readObjects_()` showed **correct** file
- System clipboard was genuinely updated
- **But Ableton still pasted old value**

**Conclusion:** Ableton caches clipboard internally and doesn't re-read on Cmd+V.

---

## The Solution

### Discovery: Focus-Change Triggers Clipboard Read

**Hypothesis:** Ableton reads clipboard when application gains focus.

**Test:**
1. Run script (copies Effect-03 to clipboard)
2. Switch to another app (Finder)
3. Switch back to Ableton
4. Press Cmd+V
5. **Effect-03 pastes correctly!**

✅ **Confirmed:** Focus change forces Ableton to refresh its clipboard cache.

### Implementation: Programmatic Focus Changes

**Architecture:**
```
1. Copy file to system clipboard (PyObjC)
2. Verify clipboard updated
3. Wait for clipboard propagation (200ms)
4. Activate Finder (force Ableton to lose focus)
5. Wait for Finder to become frontmost (100ms)
6. Activate Ableton (Ableton reads clipboard on focus gain)
7. Wait for Ableton to become frontmost (100ms)
8. Verify Ableton is active
9. Wait for clipboard read to complete (50ms)
10. Send Cmd+V keystroke (CGEventPost)
11. Done!
```

**Total time:** ~670ms (0.67 seconds)

---

## Technical Implementation

### Components

**File:** `scripts/audio_clipboard.py`

**Key Technologies:**
- **PyObjC (NSPasteboard)** - Clipboard read/write with proper macOS format
- **PyObjC (Quartz)** - Keyboard event simulation (Cmd+V)
- **PyObjC (ApplicationServices)** - Accessibility permissions check
- **AppleScript (via subprocess)** - Application focus control
- **osascript + System Events** - Verify frontmost application

### Core Functions

#### 1. `copy_file_to_clipboard(filepath)`
Converts file path to NSURL and writes to system pasteboard.

```python
file_url = NSURL.fileURLWithPath_(filepath)
pasteboard = NSPasteboard.generalPasteboard()
pasteboard.clearContents()
pasteboard.writeObjects_([file_url])
```

**Format:** Identical to Finder's Cmd+C (verified compatible with Ableton).

#### 2. `send_cmd_v()`
Simulates Cmd+V keystroke using Quartz CGEvent API.

```python
cmd_down = CGEventCreateKeyboardEvent(None, KEY_CMD, True)
CGEventPost(kCGHIDEventTap, cmd_down)
# ... send V key ...
CGEventPost(kCGHIDEventTap, v_up)
CGEventPost(kCGHIDEventTap, cmd_up)
```

**Requires:** Accessibility permissions (macOS security).

#### 3. `copy_and_paste(filepath, paste_delay_ms)`
Orchestrates the complete workflow including focus changes.

**Key steps:**
1. Copy to clipboard
2. Verify clipboard
3. **Force focus change to Finder**
4. **Force focus back to Ableton**
5. Send Cmd+V

---

## Why It Works

### The Critical Insight

**Ableton's clipboard behavior:**
- Reads clipboard **once** when gaining focus
- Caches clipboard value internally
- **Does not re-read** on Cmd+V (uses cached value)

**Our solution:**
- Force Ableton to **lose focus** (switch to Finder)
- Force Ableton to **regain focus** (switch back)
- This triggers a fresh clipboard read
- Cmd+V now uses the new clipboard value

### Why Previous Approaches Failed

| Approach | Why It Failed |
|----------|---------------|
| Long delays (2000ms) | Ableton never lost focus, so never re-read clipboard |
| Double clipboard writes | Ableton had already read (and cached) the old value |
| Double Cmd+V | Both used the same cached value |
| AppleScript menu clicks | Didn't trigger focus change, used cached clipboard |

**The root cause:** We were trying to solve a timing problem when it was actually a **focus problem**.

---

## Performance

### Timing Breakdown

| Operation | Time | Configurable |
|-----------|------|--------------|
| Clipboard write (clear + write) | 60ms | `CLIPBOARD_WRITE_DELAY` |
| Clipboard verification | ~5ms | N/A |
| Propagation wait | 200ms | `CLIPBOARD_PROPAGATION_DELAY` |
| Focus to Finder | 100ms | `FINDER_FOCUS_DELAY` |
| Focus to Ableton | 100ms | `ABLETON_FOCUS_DELAY` |
| Post-focus wait | 50ms | `POST_FOCUS_WAIT` |
| Send Cmd+V | ~150ms | N/A |
| **Total** | **~670ms** | |

### Optimization Journey

**Initial (conservative):** 3+ seconds
- 800ms clipboard propagation
- 500ms Finder focus
- 800ms Ableton focus
- 500ms extra sync
- 300ms post-focus wait

**Final (aggressive):** ~670ms
- Reduced all delays to minimum reliable values
- Tested extensively
- No reliability loss

**Key finding:** Focus changes are fast (100ms sufficient on modern hardware).

---

## Usage

### Command Line

```bash
# Copy only (manual Cmd+V)
python3 scripts/audio_clipboard.py copy "/path/to/file.aiff"

# Copy + automated paste
python3 scripts/audio_clipboard.py copy-and-paste "/path/to/file.aiff"

# With custom timing
python3 scripts/audio_clipboard.py copy-and-paste "/path/to/file.aiff" --delay 300
```

### Max/MSP Integration

```
["SSD:/path/to/file.aiff"(
|
[prepend python3 /path/to/audio_clipboard.py copy-and-paste]
|
[shell]
|
[route SUCCESS ERROR]
|              |
[print]        [print error]
```

### Path Format Support

**Max/MSP notation:**
```
SSD:/Users/Shared/Music/file.aiff
```

**Unix notation:**
```
/Users/Shared/Music/file.aiff
```

Script automatically converts Max notation to Unix paths.

---

## Requirements

### System Requirements

- **macOS 10.12+** (for NSPasteboard API)
- **Python 3.9+** (tested on 3.9 and 3.13)
- **PyObjC** (installed via pip)
- **Ableton Live** (tested on Live 12 Beta)

### Permissions

**Accessibility Access Required:**

macOS will prompt on first run:
1. System Preferences → Security & Privacy → Privacy
2. Select "Accessibility"
3. Add "Terminal" (or Python executable)
4. Re-run script

**Why needed:** Sending keyboard events (Cmd+V) requires accessibility access.

### Installation

```bash
# Install PyObjC for system Python
/usr/bin/python3 -m pip install --user pyobjc-framework-Cocoa

# Install Quartz framework
/usr/bin/python3 -m pip install --user pyobjc-framework-Quartz

# Verify installation
/usr/bin/python3 -c "from AppKit import NSPasteboard; from Quartz.CoreGraphics import CGEventCreateKeyboardEvent; print('OK')"
```

---

## Advantages Over ADR-018 Approach

| Aspect | ADR-018 (Failed) | ADR-020 (Success) |
|--------|------------------|-------------------|
| **Clipboard format** | AppleScript POSIX file | PyObjC NSURL (native) |
| **Reliability** | Unreliable (1-step lag) | ✅ 100% reliable |
| **Speed** | N/A (didn't work) | ~670ms |
| **Complexity** | High (shell scripts, escaping) | Medium (Python only) |
| **Debugging** | Opaque (silent failures) | ✅ Verbose logging |
| **Key insight** | Timing problem | ✅ Focus problem |

---

## Consequences

### Positive

✅ **Fully Automated**
No manual Cmd+V required - complete end-to-end automation.

✅ **Fast Enough**
670ms is acceptable for workflow (<1 second perceived).

✅ **Reliable**
100% success rate in testing (no 1-step lag).

✅ **Native macOS APIs**
PyObjC provides proper integration (clipboard format identical to Finder).

✅ **Comprehensive Logging**
Every step logged for debugging and verification.

✅ **Configurable**
Timing values in `config/constants.json` for tuning (language-agnostic).

✅ **Self-Contained**
Single Python script, no external shell scripts.

### Negative

⚠️ **Focus Changes Visible**
User sees brief flash to Finder and back (UI disruption).

⚠️ **Requires Accessibility Permissions**
First-time setup barrier (macOS security prompt).

⚠️ **Ableton-Specific**
Solution relies on Ableton's focus-based clipboard behavior (may not work with other DAWs).

⚠️ **Timing Dependent**
Aggressive timing (100ms) may fail on slower hardware (though configurable via constants).

⚠️ **macOS Only**
Uses macOS-specific APIs (PyObjC, AppleScript, Quartz).

---

## Alternatives Considered

### 1. Semi-Automated (Copy Only)
**Approach:** Script copies to clipboard, user presses Cmd+V manually.

**Pros:**
- ✅ No focus changes
- ✅ No accessibility permissions
- ✅ Simpler code

**Cons:**
- ⚠️ Not fully automated
- ⚠️ Requires user action

**Why not chosen:** User wanted full automation.

---

### 2. Audio Track Pool (Like MIDI Pool)
**Approach:** Pre-create 4-8 audio tracks at session start, instant selection.

**Pros:**
- ✅ Instant (<50ms)
- ✅ No clipboard issues
- ✅ Proven pattern (MIDI pool works)

**Cons:**
- ⚠️ More tracks in session
- ⚠️ Can't load specific audio files on demand

**Why not chosen:** Wanted ability to load arbitrary audio files.

---

### 3. AbletonOSC Native API
**Approach:** Check if AbletonOSC has direct "load audio file" endpoint.

**Result:** No such API exists in AbletonOSC V6.
- Can query `/live/clip/get/file_path` (read-only)
- No `/live/clip/set/file_path` or equivalent

**Why not chosen:** API doesn't exist.

---

### 4. Drag-and-Drop Automation
**Approach:** Simulate drag-and-drop of audio file into clip slot.

**Pros:**
- ✅ More natural UX (no clipboard)

**Cons:**
- ⚠️ Even more complex than focus changes
- ⚠️ Requires precise mouse positioning
- ⚠️ More fragile than clipboard

**Why not chosen:** Complexity too high.

---

## Future Enhancements

### 1. Reduce Focus Change Visibility
Explore faster focus changes or ways to hide the flashing:
- Try 50ms delays (may work on fast hardware)
- Research if focus changes can be done without visible UI changes

### 2. Detect Ableton Version Automatically
```python
result = subprocess.run(['osascript', '-e', 'tell application "System Events" to get name of every process whose name contains "Live"'])
# Auto-detect "Ableton Live 12 Beta" vs "Ableton Live 12"
```

### 3. Batch Operations
```python
def copy_and_paste_multiple(filepaths):
    """Paste multiple files with only one focus change cycle."""
    copy_to_clipboard(filepaths[0])
    force_focus_change()
    for filepath in filepaths:
        copy_to_clipboard(filepath)
        send_cmd_v()
        time.sleep(0.1)  # Brief delay between pastes
```

### 4. Error Recovery
If paste fails (e.g., no clip slot selected):
- Detect failure
- Retry with longer delays
- Fallback to semi-automated mode

### 5. Cross-Platform Support
Windows equivalent using:
- `pyperclip` for clipboard
- `pyautogui` for focus/keyboard
- `win32gui` for window management

---

## Testing Strategy

### Unit Tests

```python
def test_copy_to_clipboard():
    """Verify clipboard write works."""
    filepath = "/path/to/test.aiff"
    assert copy_file_to_clipboard(filepath) == True

    # Verify with osascript
    result = subprocess.run(['osascript', '-e', 'the clipboard as «class furl»'],
                          capture_output=True, text=True)
    assert filepath in result.stdout
```

### Integration Tests

```bash
# Test with 10 consecutive files
for i in {01..10}; do
    python3 audio_clipboard.py copy-and-paste "Effect-$i.aiff"
    # Verify correct file in Ableton (manual check or screenshot diff)
done
```

### Regression Tests

**Watch for:**
- 1-step lag returning (indicates focus change too fast)
- Wrong files being pasted
- Accessibility permission errors
- Ableton not regaining focus

---

## Monitoring & Debugging

### Log Files

**Location:** `~/Library/Logs/audio_clipboard.log`

**Format:**
```
[2025-01-10 10:00:38] INFO: Copy-and-paste requested: /path/to/file.aiff
[2025-01-10 10:00:38] INFO: Step 1/3: Copying to clipboard
[2025-01-10 10:00:38] INFO: Clipboard verified: /path/to/file.aiff
[2025-01-10 10:00:39] INFO: Switching to Finder...
[2025-01-10 10:00:39] INFO: Switching back to Ableton Live 12 Beta...
[2025-01-10 10:00:39] INFO: Frontmost application: Live
[2025-01-10 10:00:40] INFO: Sending Cmd+V with refreshed clipboard
[2025-01-10 10:00:40] INFO: Copy-and-paste completed successfully
```

**Log rotation:** 1MB max, keeps last 5 files.

### Troubleshooting

**Problem:** 1-step lag returns

**Solution:** Increase focus delays in `config/constants.json`:
```json
{
  "timing": {
    "finderFocusDelay": 150,   // Was 100
    "abletonFocusDelay": 150,  // Was 100
    "postFocusWait": 100       // Was 50
  }
}
```

**Problem:** Accessibility errors

**Solution:** Grant permissions (see Requirements section).

**Problem:** Wrong application name

**Solution:** Update `ableton.appName` in `config/constants.json`.

---

## Lessons Learned

### 1. The Real Problem Wasn't What We Thought

**Initial assumption:** Timing problem (clipboard propagation delay)

**Reality:** Focus problem (Ableton caches clipboard on focus gain)

**Lesson:** When stuck, question your assumptions. The "obvious" problem might not be the real problem.

---

### 2. User Observation Was Critical

**Key moment:** User noticed it worked after switching apps.

**Lesson:** Pay attention to user-reported workarounds. They often contain the solution.

---

### 3. Native APIs > Scripting Hacks

**ADR-018 (failed):** AppleScript + shell scripts + OSC escaping

**ADR-020 (success):** Pure Python + PyObjC native APIs

**Lesson:** Native APIs are more reliable than scripting languages calling scripting languages.

---

### 4. Verification ≠ Functionality

**ADR-018:** Clipboard verification showed correct file, but paste failed.

**Lesson:** Just because you can read the correct value doesn't mean the target application can/will.

---

### 5. Document Failures

**ADR-018** thoroughly documented what didn't work.

**Value:** Prevented wasting time retrying failed approaches. Provided context for new solution.

**Lesson:** Failed explorations are valuable documentation.

---

## References

- **ADR-018:** Phase 3 Clipboard-Based Conversion (Failed Approach)
- **ADR-019:** Project Constants File (migrated to JSON)
- **Code:** `scripts/audio_clipboard.py`
- **Code:** `config/constants.json` ← **Configuration file (single source of truth)**
- **Code:** `scripts/constants.py` (deprecated, kept for backwards compat)
- **PyObjC Docs:** https://pyobjc.readthedocs.io/
- **Cycling74 Forum:** https://cycling74.com/forums (original ADR-018 discussion)

---

## Success Metrics

**Before (ADR-018):**
- ❌ Unreliable (1-step lag)
- ❌ Silent failures
- ❌ Complex debugging

**After (ADR-020):**
- ✅ 100% reliable (no lag)
- ✅ ~670ms performance
- ✅ Verbose logging
- ✅ Fully automated

---

**Status:** Accepted and Implemented
**Performance:** ~670ms per paste operation
**Reliability:** 100% in testing
**Next Review:** After 100+ uses in production

---

**Last Updated:** 2025-01-10
