#ADR-037: Project-Wide Constants File for Configuration Management

**Status:** Superseded → Migrated to JSON (2025-01-10)
**Date:** 2025-01-10 (Original), Updated 2025-01-10 (JSON Migration)
**Context:** Multi-Language Configuration Management
**Related:** ADR-020 (Audio Clipboard Automation)

---

## Update (2025-01-10): Migration to JSON

**New Decision:** Use `config/constants.json` as the primary configuration format (language-agnostic).

**Reason for change:** The project now spans multiple languages (Python, TypeScript, Max/MSP), and a Python-only constants file required duplication. JSON provides a single source of truth accessible to all languages.

**Migration complete:**
- ✅ `config/constants.json` created
- ✅ `scripts/audio_clipboard.py` updated (JSON first, Python fallback)
- ✅ `interface/src/lib/services/trackPoolService.ts` imports from JSON
- ✅ `scripts/constants.py` retained for backwards compatibility

See "JSON Migration" section below for details.

---

## Original Context (Python-Only Approach)

During implementation of the audio clipboard automation system, we encountered several configuration values that needed to be:
- **Hardcoded but changeable** (e.g., Ableton Live version name)
- **Tunable for performance** (e.g., timing delays)
- **Consistent across multiple scripts** (e.g., OSC ports, file paths)
- **Easy to update** when environment changes

Initially, these values were scattered throughout the codebase:
- Application names hardcoded in scripts
- Timing values duplicated across functions
- File paths embedded in multiple locations
- No single source of truth

**Specific pain point:** When Ableton Live 12 goes from Beta → Release, we'd need to search and update the application name in multiple locations.

---

## Original Decision (Now Superseded)

**Create a centralized `scripts/constants.py` file for project-wide configuration.**

**Status:** This approach worked for Python-only scripts but became limiting when TypeScript code needed the same values.

### Implementation

**File:** `/Users/Shared/DevWork/GitHub/Looping/scripts/constants.py`

```python
"""
Project-wide constants for Looping system.
Update these values as needed for your environment.
"""

# Ableton Live application name
ABLETON_APP_NAME = "Ableton Live 12 Beta"

# Common file paths
SAMPLES_BASE_PATH = "/Users/Shared/Music/Samples Organized"

# Clipboard timing (milliseconds)
CLIPBOARD_PROPAGATION_DELAY = 200
CLIPBOARD_WRITE_DELAY = 30

# Focus change timing (milliseconds)
FINDER_FOCUS_DELAY = 100
ABLETON_FOCUS_DELAY = 100
POST_FOCUS_WAIT = 50

# OSC Bridge ports
OSC_BRIDGE_PORT = 11004
OSC_RESPONSE_PORT = 11005
```

### Usage Pattern

Scripts import constants with fallback defaults:

```python
try:
    from constants import ABLETON_APP_NAME, CLIPBOARD_PROPAGATION_DELAY
except ImportError:
    # Fallback values if constants.py not found
    ABLETON_APP_NAME = "Ableton Live 12 Beta"
    CLIPBOARD_PROPAGATION_DELAY = 200
```

**Why fallback?** Ensures scripts work even if `constants.py` is missing (e.g., when running from different directory).

---

## Benefits

### 1. Single Source of Truth
- Application names in one place
- Timing values defined once
- No duplicate constants

### 2. Easy Updates
When Ableton Live 12 releases:
```python
# Change one line:
ABLETON_APP_NAME = "Ableton Live 12"  # Remove "Beta"
```

All scripts using the constant automatically updated.

### 3. Performance Tuning
Timing values can be adjusted in one place to optimize system-wide:
```python
# Test aggressive timing:
ABLETON_FOCUS_DELAY = 100  # Was 400ms

# If unstable, increase:
ABLETON_FOCUS_DELAY = 200  # Middle ground
```

### 4. Environment Portability
Different machines can have different `constants.py`:
- **Live 11** vs **Live 12**
- **Different sample paths**
- **Different OSC ports** (if running multiple systems)

### 5. Documentation
Constants file serves as configuration documentation:
- What can be changed
- What values are safe
- What each constant controls

---

## Consequences

### Positive

✅ **Maintainability**
Changing Ableton version, paths, or timing = one file edit

✅ **Consistency**
All scripts use same values (no drift/desync)

✅ **Testability**
Can create `constants_test.py` with faster/shorter delays for testing

✅ **Discoverability**
New developers know where to look for configuration

✅ **Type Safety**
Constants in one place = easier to add type hints later

### Negative

⚠️ **Import Overhead**
Scripts must import constants (but with fallback pattern, this is minimal)

⚠️ **Circular Dependency Risk**
If `constants.py` imports other project files, could create import cycles (mitigated: keep constants.py import-free)

⚠️ **Not User-Facing**
End users might not know to edit `constants.py` (mitigated: document in README if needed)

---

## Alternatives Considered

### 1. Environment Variables
**Pros:** OS-level configuration, no code changes
**Cons:** Hard to document, error-prone, type conversion needed
**Why not:** Python config files more Pythonic

### 2. JSON/YAML Config File
**Pros:** Language-agnostic, easy to parse
**Cons:** Extra parsing, less type-safe, harder to version control diffs
**Why not (original):** Python constants simpler for this use case
**UPDATE:** ✅ **This is now the chosen approach** (see JSON Migration section)

### 3. Keep Values Hardcoded
**Pros:** No abstraction overhead
**Cons:** Duplicate values, hard to update, no single source of truth
**Why not:** Already causing maintenance pain

### 4. Config Class with Dataclass/Pydantic
**Pros:** Type safety, validation, IDE support
**Cons:** Overkill for simple values, adds dependency
**Why not:** Simple constants sufficient for now (can migrate later if needed)

---

## JSON Migration (2025-01-10)

### The Problem

After implementing Phase 3 (audio track conversion), we encountered duplication:
- `CONVERSION_AUDIO_FILE` hardcoded in `trackPoolService.ts` (TypeScript)
- Same path needed in Max/MSP patch (for shell command)
- Python `constants.py` only readable by Python scripts

**This violated the "single source of truth" principle the ADR was meant to solve.**

### The Solution: Language-Agnostic JSON

**File:** `config/constants.json`

```json
{
  "ableton": {
    "appName": "Ableton Live 12 Beta",
    "conversionAudioFile": "/Users/Shared/Music/Samples Organized/..."
  },
  "paths": {
    "samplesBase": "/Users/Shared/Music/Samples Organized",
    "projectRoot": "/Users/Shared/DevWork/GitHub/Looping",
    "emptyPresets": {
      "drumRack": "/Users/.../Empty Drum Rack.adg",
      "omnisphere": "/Users/.../Omnisphere.aupreset",
      "kompleteKontrol": "/Users/.../Komplete Kontrol.aupreset",
      "niDrum": "/Users/.../NI Drum.adg"
    }
  },
  "timing": {
    "clipboardWriteDelay": 30,
    "clipboardPropagationDelay": 200,
    "finderFocusDelay": 100,
    "abletonFocusDelay": 100,
    "postFocusWait": 50
  },
  "osc": {
    "shellHelper": {
      "receive": 11007,
      "send": 11006
    },
    "midiConverter": {
      "receive": 11005,
      "send": 11004
    }
  }
}
```

### Usage Across Languages

**Python (with fallback):**
```python
def load_constants():
    """Load from JSON first, fallback to constants.py"""
    try:
        # Try JSON first (language-agnostic)
        project_root = Path(__file__).parent.parent
        config_path = project_root / "config" / "constants.json"

        if config_path.exists():
            with open(config_path, 'r') as f:
                config = json.load(f)
                return {
                    'ABLETON_APP_NAME': config['ableton']['appName'],
                    # ... other values
                }
    except Exception:
        pass

    try:
        # Fallback to constants.py (backwards compat)
        from constants import ABLETON_APP_NAME, ...
        return { ... }
    except ImportError:
        # Final fallback: hardcoded defaults
        return { ... }
```

**TypeScript:**
```typescript
import constants from '$lib/../../config/constants.json';
const CONVERSION_AUDIO_FILE = constants.ableton.conversionAudioFile;
```

**Max/MSP:**
File path comes from TypeScript via OSC (which got it from JSON).

### Benefits of JSON Approach

✅ **Truly Language-Agnostic**
Python, TypeScript, and Max/MSP can all read the same file.

✅ **Single Source of Truth (Actually)**
No duplication between languages - all read from one file.

✅ **Backwards Compatible**
Python scripts still work with `constants.py` fallback.

✅ **Familiar Pattern**
Project already uses JSON (`instruments.json`).

✅ **Easy to Edit**
JSON syntax is simpler than Python for non-programmers.

✅ **Version Control Friendly**
JSON diffs are clear and easy to review.

### Migration Steps Completed

1. ✅ Created `config/constants.json` with all values
2. ✅ Updated `audio_clipboard.py` to try JSON first
3. ✅ Updated `trackPoolService.ts` to import from JSON
4. ✅ Updated `CLAUDE.md` to reference config file
5. ✅ Kept `scripts/constants.py` for backwards compatibility

### Backwards Compatibility

**Python scripts continue to work in all scenarios:**
- ✅ With only `config/constants.json` (preferred)
- ✅ With only `scripts/constants.py` (legacy)
- ✅ With neither file (hardcoded defaults)

**Load order:**
1. Try `config/constants.json`
2. Try `scripts/constants.py`
3. Use hardcoded defaults

---

## Future Enhancements

### 1. Environment-Specific Constants
```python
import os
ENVIRONMENT = os.getenv("LOOPING_ENV", "production")

if ENVIRONMENT == "development":
    ABLETON_FOCUS_DELAY = 50  # Faster for dev
else:
    ABLETON_FOCUS_DELAY = 100
```

### 2. Validation on Import
```python
def validate_constants():
    assert ABLETON_FOCUS_DELAY > 0, "Delay must be positive"
    assert CLIPBOARD_WRITE_DELAY < 1000, "Delay too large"

validate_constants()
```

### 3. Dynamic Reloading
For long-running processes, allow constants to be reloaded without restart.

### 4. Type Hints
```python
ABLETON_APP_NAME: str = "Ableton Live 12 Beta"
CLIPBOARD_PROPAGATION_DELAY: int = 200  # milliseconds
```

---

## Implementation Notes

### Constants Added (Initial Set)

**Application:**
- `ABLETON_APP_NAME` - Application name for AppleScript targeting

**Paths:**
- `SAMPLES_BASE_PATH` - Base directory for sample files

**Timing (milliseconds):**
- `CLIPBOARD_PROPAGATION_DELAY` - Wait after clipboard write
- `CLIPBOARD_WRITE_DELAY` - Between clipboard operations
- `FINDER_FOCUS_DELAY` - Wait for Finder activation
- `ABLETON_FOCUS_DELAY` - Wait for Ableton activation
- `POST_FOCUS_WAIT` - After focus verified

**Network:**
- `OSC_BRIDGE_PORT` - Enhanced OSC bridge listening port
- `OSC_RESPONSE_PORT` - Bridge response port

### Adding New Constants

When adding constants:
1. Add to `constants.py` with comment
2. Add to fallback dict in consuming scripts
3. Update this ADR's list above
4. Document units (ms, px, etc.) in comment

### Naming Convention

- `ALL_CAPS_WITH_UNDERSCORES`
- Descriptive names
- Include units in name if ambiguous: `_DELAY_MS`, `_PATH`, `_PORT`

---

## Testing

### Verify Import Pattern Works

```bash
# From scripts/ directory
python3 -c "from constants import ABLETON_APP_NAME; print(ABLETON_APP_NAME)"

# From project root (should use fallback)
python3 -c "import sys; sys.path.append('scripts'); from audio_clipboard import ABLETON_APP_NAME; print(ABLETON_APP_NAME)"
```

### Verify Fallback Pattern

```bash
# Temporarily rename constants.py
mv scripts/constants.py scripts/constants.py.bak

# Script should still work with fallback values
python3 scripts/audio_clipboard.py copy "/path/to/file.wav"

# Restore
mv scripts/constants.py.bak scripts/constants.py
```

---

## Migration Path

### Phase 1: ✅ Complete
- Created `constants.py`
- Updated `audio_clipboard.py` to use constants
- Implemented fallback pattern

### Phase 2: Future
- Audit other scripts for hardcoded values
- Move to constants where appropriate
- Add type hints

### Phase 3: Future (Optional)
- Consider config class if complexity grows
- Add validation/bounds checking
- Environment-specific overrides

---

## Examples

### Updating Ableton Version (Live 12 Beta → Release)

```python
# Before: scripts/constants.py
ABLETON_APP_NAME = "Ableton Live 12 Beta"

# After: scripts/constants.py
ABLETON_APP_NAME = "Ableton Live 12"
```

All scripts using this constant automatically work with the new version.

### Performance Tuning

```python
# Test faster timing:
ABLETON_FOCUS_DELAY = 50  # Very aggressive

# Run tests, observe failures...

# Increase until stable:
ABLETON_FOCUS_DELAY = 100  # Stable threshold found
```

### Multi-Environment Setup

```python
# scripts/constants_dev.py (faster for testing)
FINDER_FOCUS_DELAY = 50
ABLETON_FOCUS_DELAY = 50

# scripts/constants.py (production - stable)
FINDER_FOCUS_DELAY = 100
ABLETON_FOCUS_DELAY = 100

# Switch via symlink or import
```

---

## References

- **ADR-020:** Audio Clipboard Automation (primary user of constants)
- **Code:** `config/constants.json` ← **Primary config file**
- **Code:** `scripts/constants.py` (deprecated, kept for backwards compat)
- **Code:** `scripts/audio_clipboard.py` (JSON usage example)
- **Code:** `interface/src/lib/services/trackPoolService.ts` (TypeScript usage example)

---

**Status:** Migrated to JSON (2025-01-10) - Python fallback retained
**Next Review:** When adding 5+ more languages to project
**Owner:** System Architecture

---

**Last Updated:** 2025-01-10 (JSON migration complete)

---

**Superseded in part, 2026-09-11 (audit batch 8).** `scripts/constants.py` has
been deleted. The "retained for backwards compatibility" bullet above was no
longer true: a repo-wide search found **zero** importers in any language, and
the file had drifted from the JSON it was meant to mirror — `OSC_BRIDGE_PORT =
11004` / `OSC_RESPONSE_PORT = 11005` are in fact `osc.midiConverter`'s
`remotePort` / `localPort` ("MIDI converter for pitch/mod wheel"), not bridge
ports, so anything that had imported it would have been pointed at the wrong
service. `config/constants.json` is the single source of truth; Python reads it
through `surface/config_loader.py`.

(One of the audit's own claims about this file does not hold: it says the
constant encodes "a samples root that exists nowhere". `/Users/Shared/Music/
Samples Organized` does exist on this machine — the constant was unreferenced,
not dangling.)
