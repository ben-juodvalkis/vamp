/**
 * The pointer primitive: two Svelte actions and the two pure state
 * machines behind them.
 *
 * Every interaction on the performance surface goes through one of these,
 * so that the invariant holds structurally rather than by discipline:
 *
 * > Every interaction is owned by exactly one pointer, identified by its
 * > `pointerId`, from the moment it starts to the moment it ends.
 *
 * See ADR-427 for the four dialects this replaced and why an action —
 * rather than a composable or a copied handler — is the shape that keeps
 * the state per-node, the teardown owned, and `touch-action` in the same
 * place as the handler it protects.
 */

export { press } from './press';
export type { PressOptions, PressInfo, PressReleaseInfo } from './press';

export { drag } from './drag';
export type { DragOptions, DragInfo, DragEndInfo } from './drag';

export {
	createPressMachine,
	HOLD_MS,
	PRESS_SLOP
} from './pressMachine';
export type {
	PressMachine,
	PressMachineConfig,
	PressEvent,
	PressRecord,
	PressReleaseReason
} from './pressMachine';

export {
	createDragMachine,
	DRAG_THRESHOLD,
	TOUCH_DRAG_THRESHOLD,
	LONG_PRESS_MS
} from './dragMachine';
export type {
	DragMachine,
	DragMachineConfig,
	DragEvent,
	DragRecord,
	DragCommit,
	DragMode,
	DragEndReason
} from './dragMachine';
