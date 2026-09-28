# ADR 030: Focused View Tracking and Control

**Status**: Implemented
**Date**: 2025-10-10
**Context**: V6 Live API Integration

## Context

The looping system needs to track which main view (Session vs Arranger) is currently focused in Ableton Live, and provide the ability to programmatically switch between views. This enables:

1. **Context-aware UI**: Display which view the user is currently working in
2. **Programmatic view switching**: Allow the interface to focus specific views (Session, Arranger, Browser, Detail, etc.)
3. **Workflow automation**: Automatically switch to appropriate views during track preparation or device loading

## Decision

We implemented focused view tracking using the Live Object Model's `Application.View` API with both observer-based updates and imperative control.

### API Structure

**Observable Property** (Read-only):
- Path: `live_app view`
- Property: `focused_document_view`
- Returns: `"Session"` or `"Arranger"` (only main document views)
- Sends updates automatically when user switches views

**Control Method** (Write):
- Path: `live_app view`
- Method: `focus_view(viewName)`
- Accepts: All available view names from `available_main_views()`
  - `"Session"` - Session view
  - `"Arranger"` - Arranger view
  - `"Browser"` - Browser panel
  - `"Detail"` - Detail view
  - `"Detail/Clip"` - Clip detail view
  - `"Detail/DeviceChain"` - Device chain detail view

### OSC Implementation

**Incoming (Max → Interface)**:
```
/view/focused_document_view [viewName]
```
- Sent automatically when user switches between Session/Arranger
- Sent on initialization with current view state

**Outgoing (Interface → Max)**:
```
/view/get/focused_document_view []
```
- Query current focused view (returns via `/view/focused_document_view`)

```
/view/set/focus_view [viewName]
```
- Programmatically switch to a specific view
- Example: `/view/set/focus_view Session`

### Max/MSP Implementation

**Critical Path Detail**: The canonical Live API path is `live_app view` (not `live_set view` or `live_set application view`).

**Observer Setup** (`liveAPI-v6.js:initializeFocusedViewObserver`):
```javascript
// Correct path - Application.View object
focusedViewObserver = new LiveAPI(focusedViewChanged, "live_app view");
focusedViewObserver.property = "focused_document_view";

// Get initial state
var viewApi = new LiveAPI("live_app view");
var currentView = viewApi.get("focused_document_view");
```

**Imperative Control** (`liveAPI-v6.js:/view/set/focus_view`):
```javascript
var viewApi = new LiveAPI("live_app view");
viewApi.call("focus_view", viewName);
```

### Frontend Integration

**Session Store** (`stores/session.svelte.ts`):
```typescript
let _focusedDocumentView = $state<'Session' | 'Arranger' | null>(null);

function handleFocusedViewUpdate(update: FocusedViewUpdate) {
  _focusedDocumentView = update.view;
  console.log(`👁️ Focused View: ${oldView || 'Unknown'} → ${update.view}`);
}
```

**Service Layer** (`services/trackPreparation.ts`):
```typescript
export type LiveViewName =
  | 'Browser'
  | 'Arranger'
  | 'Session'
  | 'Detail'
  | 'Detail/Clip'
  | 'Detail/DeviceChain';

export function focusView(viewName: LiveViewName): void {
  send('/view/set/focus_view', [viewName]);
}
```

## Consequences

### Positive

1. **Observable State**: UI automatically updates when user switches views
2. **Programmatic Control**: Interface can switch views during automated workflows
3. **Type Safety**: TypeScript types ensure only valid view names are used
4. **Clear Separation**: Observable property (`focused_document_view`) returns only main views, while control method (`focus_view`) accepts all views

### Negative

1. **API Path Confusion**: The correct path is `live_app view`, not `live_set view` - easy to get wrong
2. **Limited Observability**: Observer only reports `"Session"` or `"Arranger"`, not other views like Browser or Detail
3. **Device Reload Required**: Changes to Max/MSP code require reloading the AbletonOSC device

### Trade-offs

- **Property vs Method Asymmetry**: The observable property returns fewer values than the method accepts - this is a Live API design decision we must work with
- **Two Communication Patterns**: Read uses observer pattern (push), write uses imperative calls (pull) - this is consistent with other Live API features

## Implementation Notes

### Common Mistakes

1. ❌ Using `"live_set view"` instead of `"live_app view"`
2. ❌ Using `set("focus_view", viewName)` instead of `call("focus_view", viewName)`
3. ❌ Expecting observer to report all view types (it only reports Session/Arranger)

### Testing

To test focused view tracking:
1. Switch between Session and Arranger views in Live
2. Check SystemCentralView component displays current view
3. Click view buttons in SystemCentralView to programmatically switch
4. Verify console logs show `👁️ Focused View:` updates

## References

- **Live API Documentation**: https://docs.cycling74.com/apiref/lom/application_view/
- **Implementation**:
  - Max: `ableton/scripts/liveAPI-v6.js` (lines 1225-1248, 2218-2240)
  - Frontend: `interface/src/lib/stores/session.svelte.ts` (lines 66, 156, 484-488)
  - Service: `interface/src/lib/services/trackPreparation.ts` (lines 483-495)
  - Component: `interface/src/lib/components/v6/central/views/SystemCentralView.svelte`
- **Domain Types**: `interface/src/lib/domain/updates.ts` (`FocusedViewUpdate`)

## Related ADRs

- ADR 003: TrackStrip Max Observer Migration (established observer pattern)
- ADR 015: Max4Live Observer Performance Optimization (observer best practices)
