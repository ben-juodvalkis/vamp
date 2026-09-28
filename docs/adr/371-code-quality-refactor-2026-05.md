# ADR-371: Code Quality Refactor — May 2026 Sprint

## Status
**Accepted**

## Context

A code-quality audit (`documentation/code-quality-audit.md`) identified 10 spaghetti
hotspots across the bridge, SvelteKit interface, Python control surface, and build
scripts. The audit rated the codebase as "mid-tier spaghetti": architecturally sound
at gross structure but with clustering in a handful of god-files and duplication in
cross-cutting concerns.

All 10 hotspots plus the action-plan quick-wins were addressed in a single session on
branch `claude/code-quality-audit-m6mUi`. Tests stayed green (1040 TS / 1483 Python)
at every commit.

## Decision

Work through the prioritised action plan from the audit in a single focused sprint
rather than deferring individual items to feature branches. Rationale:

- The changes are pure extractions with no behaviour change — safest to batch them
  together so the test suite is a true regression gate throughout.
- Keeping them on one branch makes the before/after diff reviewable as a unit.
- Deferring to feature branches means the god-files grow further before they shrink.

### What changed

**Bridge**
- `enhanced-osc-bridge.js`: 6 near-identical `.on("message")` blocks → single loop +
  `INBOUND_MIDDLEWARE` table; pythonSurface liveness check promoted to named middleware.
- `messageRouter.js`: 76-line if/else chain → 14-entry declarative `ROUTING_RULES`
  table; `v3FallthroughSeen` Set FIFO-capped at 64 so config drift resurfaces.
- `WebSocketServer.handleMessage`: god-function → `ADDRESS_HANDLERS` +
  `TYPE_HANDLERS` dispatch tables; JSON-parse error no longer swallowed by dispatch
  try/catch.

**SvelteKit interface**
- `clipOperations.ts` (886 LOC) split into `clipOperations.ts` (562) +
  `clipTranspose.ts` (314) + `clipContext.ts` (39). Re-exports keep callers unchanged.
- `v3StateFull.ts` (959 LOC): new `V3StateFullReassembler` class (442 LOC) owns chunk
  buffer + dedupe key + waiter list; handler shrinks to 559 LOC of parse + store-apply.
- `UnifiedGestureBrowser.v6.svelte`: `pathAtRelease.ts` + `presetResolver.ts`
  extracted under `browser/utils/`; `handleGestureEnd` reduced to two named calls.
- `session.svelte.ts`: inline error-dedup state → `sessionErrorGrouper.ts` (~50 LOC).
- `selectedTrackStore`: `FXGridState` promoted to module-level sibling singleton;
  dead `DeviceParameterStorage` field removed.

**Python control surface**
- `LoopingSurface.__init__` (1252-line constructor): 4 named phase methods extracted
  (`_setup_transport`, `_init_heartbeat_state`, `_setup_session_components`,
  `_setup_v3_protocol_core`), totalling ~250 LOC out of the constructor body (-15%).
  Remaining inline clusters share closure state that requires a live Ableton runtime
  to validate end-to-end; deeper splits deferred.

**Build scripts**
- `generate-type-first-json.ts`: 5-level sort precedence extracted into
  `typeFirstSort.ts` as a generic `TypeFirstSorter<SortableNode>` class.

**Quick-wins (follow-up sweep)**
- `$config` Svelte alias wired in `svelte.config.js`; 11 deep relative config imports
  replaced.
- `requireFocusedClip()` helper exported from `session.svelte.ts`; 10 inline guards
  replaced across 6 files.
- `theme.ts` and `browserNavigationStore.svelte.ts` `any` types tightened.
- 3 empty `.catch()` blocks given `logger.debug`.
- 12 stale repo-root PNGs + 2 orphan Markdowns moved to `docs-archive/`.
- `package.json` scripts: `copy-config` aggregator added; `_scripts_help` block
  documents user-facing vs. internal scripts.

### What was explicitly deferred

- Remaining `LoopingSurface.__init__` phase splits (MutationComponent,
  PropertyComponent, Gate 4 probes, etc.) — share complex closure state, need Live
  runtime to validate.
- `generate-type-first-json.ts` scanner/merger split — sorter is out; full 3-module
  split is lower priority.
- `selectedTrackStore` → `~400 LOC` target — `slotRegistry` and the cross-store
  `paramNamesForDevice` leak deferred.

## Consequences

**Positive**
- Bridge entry points are all registry- or table-driven; per-handler tests are now
  unblocked.
- `clipOperations.ts` has two clear concerns per file instead of nine.
- `v3StateFull.ts` state-machine state is encapsulated in a class rather than module
  locals.
- `requireFocusedClip()` centralises the "no focused clip" policy — 10 former
  copy-paste guards are now one call.
- `$config` alias eliminates `../../../../config/constants.json` import chains.
- `LoopingSurface.__init__` reads as a 4-phase manifest; new phases have a clear
  insertion point.

**Negative / neutral**
- Re-exports in `clipOperations.ts` mean callers are unaffected but the module is
  slightly less self-contained.
- Deeper `__init__` splits remain as tech debt; the comment banners now promote
  to method stubs, which at least document intent.

## Tags
`refactor`, `code-quality`, `bridge`, `svelte`, `python-surface`, `scripts`
