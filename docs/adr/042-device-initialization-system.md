# ADR 033: Device Initialization System

**Status**: Implemented
**Date**: 2025-01-11
**Context**: V6 Device Configuration, Automatic Parameter/Property Setup

## Context

When devices load in Ableton Live, they often need specific parameter values or property settings for optimal performance in the looping workflow. Previously, these defaults had to be set manually after each device load, which was:

1. **Tedious** - User had to remember and set parameters every time
2. **Error-prone** - Easy to forget settings, leading to inconsistent behavior
3. **Workflow-breaking** - Interrupts creative flow to adjust technical settings

### Use Cases

1. **Simpler Loop Mode**: Always enable Loop when loading samples for live looping
2. **Omnisphere Macros**: Set macros 3-6 to 1.0 for optimal patch response
3. **Playback Modes**: Ensure Classic mode (not One-Shot or Slicing) by default
4. **Envelope Settings**: Configure ADSR envelopes for performance-ready sounds

## Decision

We implemented a **declarative device initialization system** in the unified device configuration that automatically sets parameters and LiveAPI properties when devices are loaded.

### Key Design Decisions

1. **Declarative Configuration**: Define initialization in JSON, not code
2. **Dual Action Types**: Support both parameters (numeric) and properties (LiveAPI)
3. **Trigger on Device Add**: Run only when devices are newly loaded, not on track switching
4. **Delayed Execution**: Wait configurable delay (500ms default) for device to be ready
5. **Single Source of Truth**: Configuration lives in `device-configs.json`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│           device-configs.json                            │
│  {                                                       │
│    "OriginalSimpler": {                                 │
│      "initialization": {                                │
│        "trigger": "device_loaded",                      │
│        "delay": 500,                                    │
│        "actions": [                                     │
│          { "type": "set_parameter", ... },             │
│          { "type": "set_property", ... }               │
│        ]                                                │
│      }                                                  │
│    }                                                    │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│   TypeScript: selectedTrackStore.svelte.ts              │
│                                                          │
│   handleDeviceAdded(device) {                           │
│     checkDeviceInitialization(device)                   │
│   }                                                      │
│                                                          │
│   checkDeviceInitialization(device) {                   │
│     config = getUnifiedDeviceConfig(device.className)   │
│     if (!config.initialization) return                  │
│                                                          │
│     setTimeout(() => {                                  │
│       actions.forEach(action => {                       │
│         if (action.type === 'set_parameter')            │
│           setParameter(device.id, index, value)         │
│         else if (action.type === 'set_property')        │
│           setProperty(device.id, path, value)           │
│       })                                                │
│     }, delay)                                           │
│   }                                                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│          Existing Parameter/Property Systems             │
│   • setParameter() → OSC → Max4Live → LiveAPI           │
│   • setProperty() → liveObjectAPI → Max4Live → LiveAPI  │
└─────────────────────────────────────────────────────────┘
```

## Implementation

### 1. TypeScript Interfaces

**File**: `interface/src/lib/configs/UnifiedDeviceConfigs.ts`

```typescript
export interface DeviceInitializationConfig {
  trigger: 'device_loaded' | 'patch_loaded';
  delay: number;
  description: string;
  actions: DeviceInitializationAction[];
}

export type DeviceInitializationAction =
  | DeviceParameterAction
  | DevicePropertyAction;

export interface DeviceParameterAction {
  type: 'set_parameter';
  index: number;
  value: number;
  description: string;
}

export interface DevicePropertyAction {
  type: 'set_property';
  path: string;
  value: number | string | boolean;
  description: string;
}

export interface UnifiedDeviceConfig {
  // ... existing fields
  initialization?: DeviceInitializationConfig;
}
```

### 2. Configuration Example

**File**: `data/device-configs.json`

```json
{
  "OriginalSimpler": {
    "parameters": { /* ... */ },
    "initialization": {
      "trigger": "device_loaded",
      "delay": 500,
      "description": "Enable Loop and set Classic playback mode",
      "actions": [
        {
          "type": "set_parameter",
          "index": 5,
          "value": 1.0,
          "description": "Enable Loop mode"
        },
        {
          "type": "set_property",
          "path": "playback_mode",
          "value": 0,
          "description": "Classic playback mode (not One-Shot or Slicing)"
        }
      ]
    }
  }
}
```

### 3. Execution Logic

**File**: `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts`

```typescript
private checkDeviceInitialization(device: Device) {
  import('$lib/configs/UnifiedDeviceConfigs').then(({ getUnifiedDeviceConfig }) => {
    const config = getUnifiedDeviceConfig(device.className);

    if (!config.initialization) {
      return;
    }

    const { delay, actions, description } = config.initialization;
    console.log(`[DeviceInit] ${device.name}: ${description}`);

    setTimeout(() => {
      actions.forEach(action => {
        if (action.type === 'set_parameter') {
          console.log(`[DeviceInit] Setting parameter ${action.index} = ${action.value} (${action.description})`);
          this.setParameter(device.id, action.index, action.value);
        } else if (action.type === 'set_property') {
          console.log(`[DeviceInit] Setting property ${action.path} = ${action.value} (${action.description})`);
          this.setProperty(device.id, action.path, action.value);
        }
      });
    }, delay);
  });
}
```

## Workflow

1. **User loads device** (via browser, sample-to-simpler, etc.)
2. **M4L sends** `/looping/devices/added` OSC message
3. **TypeScript receives** device info in `handleDeviceAdded()`
4. **Check config** for `initialization` section
5. **Wait** configured delay (500ms) for device to be ready
6. **Execute actions** in order:
   - `set_parameter` → Uses existing parameter system
   - `set_property` → Uses LiveAPI property system
7. **Log** each action to console for debugging

## Trigger Behavior

### When Initialization Runs

✅ **Device is added via**:
- Browser instrument loading
- Sample-to-Simpler operation
- Manual device drag-and-drop
- Track preparation commands

❌ **Device is NOT initialized when**:
- Switching to a track that already has the device
- Opening an existing Ableton project
- Reloading the interface

**Rationale**: Initialization is for **new** devices only. Once a device exists, we respect any user edits to parameters/properties. This matches standard DAW behavior where presets/devices initialize once at load time.

## Examples

### Simpler Configuration

```json
{
  "initialization": {
    "trigger": "device_loaded",
    "delay": 500,
    "description": "Enable Loop and set Classic playback mode",
    "actions": [
      {
        "type": "set_parameter",
        "index": 5,
        "value": 1.0,
        "description": "Enable Loop mode"
      },
      {
        "type": "set_property",
        "path": "playback_mode",
        "value": 0,
        "description": "Classic playback mode"
      }
    ]
  }
}
```

**Console Output**:
```
[DeviceInit] Simpler: Enable Loop and set Classic playback mode
[DeviceInit] Setting parameter 5 = 1.0 (Enable Loop mode)
[DeviceInit] Setting property playback_mode = 0 (Classic playback mode)
```

### Omnisphere Configuration

```json
{
  "initialization": {
    "trigger": "patch_loaded",
    "delay": 2000,
    "description": "Set Macro 3-6 to 1.0 for optimal patch response",
    "actions": [
      { "type": "set_parameter", "index": 3, "value": 1.0, "description": "Enable Macro 3" },
      { "type": "set_parameter", "index": 4, "value": 1.0, "description": "Enable Macro 4" },
      { "type": "set_parameter", "index": 5, "value": 1.0, "description": "Enable Macro 5" },
      { "type": "set_parameter", "index": 6, "value": 1.0, "description": "Enable Macro 6" }
    ]
  }
}
```

## Consequences

### Positive

✅ **Declarative**: Add initialization by editing JSON, no code changes needed

✅ **Automatic**: Works for all device load methods (browser, sample-to-simpler, etc.)

✅ **Type-Safe**: TypeScript enforces correct action types and fields

✅ **Flexible**: Mix parameters and properties in any order

✅ **Logged**: Console shows exactly what's being initialized

✅ **Non-Invasive**: Only runs on device creation, respects existing devices

✅ **Extensible**: Easy to add new action types in the future

### Negative

⚠️ **Delay Required**: Must wait for device to be ready (500ms typical)

⚠️ **No Validation**: No check if parameter/property index is valid

⚠️ **No Undo**: Initialization actions are fire-and-forget

### Trade-offs

- **Automatic vs Manual Control**: Chose automatic for consistency, sacrificing per-load customization
- **On Add vs On Switch**: Chose on-add to respect user edits, sacrificing enforced defaults
- **JSON vs Code**: Chose JSON for declarative simplicity, sacrificing type safety at config time

## Future Enhancements

Possible improvements for future iterations:

1. **Conditional Actions**: Run actions based on device state or context
   ```json
   {
     "condition": "sample.length > 10000",
     "actions": [...]
   }
   ```

2. **Property Validation**: Check if property exists before setting
3. **Undo Support**: Track initialization actions for undo functionality
4. **User Overrides**: Allow user to disable initialization per device type
5. **Multiple Triggers**: Support different actions for different triggers
6. **Action Dependencies**: Wait for property set before parameter set

## Related ADRs

- **ADR 031**: Track Pool M4L Single Source of Truth (established device event patterns)
- **ADR 032**: Sample Audio Clip to Simpler (uses initialization system)
- **LiveAPI Architecture**: `documentation/current-project/simpler/architecture.md` (property system)

## References

- **Implementation Files**:
  - Config: `data/device-configs.json`
  - Types: `interface/src/lib/configs/UnifiedDeviceConfigs.ts` (lines 51-75)
  - Logic: `interface/src/lib/stores/v6/selectedTrackStore.svelte.ts` (lines 552-578)
- **Device Configs**: Currently implemented for OriginalSimpler, AuPluginDevice:Omnisphere
- **Console Logs**: Search for `[DeviceInit]` in browser console

---

**Last Updated**: 2025-01-11
