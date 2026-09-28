/**
 * Session error grouper.
 *
 * Carved out of session.svelte.ts (audit hotspot #8). The store's
 * 'error' dispatch case used to inline a stringly-typed
 * `_lastErrorType` + `_errorRepeatCount` pair to decide whether to log
 * an error or fold it into a repeat counter. That logic is independent
 * of any reactive state, so it lives here as a tiny module that the
 * store consumes.
 *
 * Behaviour preserved verbatim:
 * - First occurrence of an `errorType` ⇒ log full detail (`isRepeat: false`).
 * - Same `errorType` again ⇒ swallow except at milestones (10, 50, 100)
 *   where `shouldLogRepeat` flips true.
 * - Any new error type resets the repeat run to 1.
 */

const REPEAT_LOG_MILESTONES = new Set([10, 50, 100]);

export interface GroupedErrorResult {
	/** True when this matches the previous errorType. */
	isRepeat: boolean;
	/** Total occurrences of the current `errorType` since the last reset. */
	repeatCount: number;
	/** Caller should emit a repeat-log line when this is true. */
	shouldLogRepeat: boolean;
}

export interface ErrorGrouper {
	recordError(errorType: string): GroupedErrorResult;
	reset(): void;
}

export function createErrorGrouper(): ErrorGrouper {
	let lastErrorType = '';
	let repeatCount = 0;

	return {
		recordError(errorType: string): GroupedErrorResult {
			if (errorType === lastErrorType) {
				repeatCount++;
				return {
					isRepeat: true,
					repeatCount,
					shouldLogRepeat: REPEAT_LOG_MILESTONES.has(repeatCount)
				};
			}
			lastErrorType = errorType;
			repeatCount = 1;
			return { isRepeat: false, repeatCount: 1, shouldLogRepeat: false };
		},
		reset() {
			lastErrorType = '';
			repeatCount = 0;
		}
	};
}
