/**
 * The machine's values, as the bridge reports them over `/bridge/machine
 * [json]` (onboarding.plan.md §3, §6.5): the owner's library paths, this
 * checkout's Max devices folder and the TotalMix range. Nothing about the
 * Mac is compiled into the build; a client draws from this store, and until
 * the first snapshot lands the paths are empty, which every reader treats as
 * "no library here".
 */
import { logger } from '$lib/utils/logger';
import { setTotalMixRange } from '$lib/utils/totalmixScale';

export interface MachinePaths {
	instrumentsBase: string;
	effectPresetsBase: string;
	m4lDevicesRoot: string;
}

export interface MachineSnapshot {
	paths: MachinePaths;
	totalmix: { minDb: number; maxDb: number; silenceDb: number } | null;
}

const EMPTY: MachineSnapshot = Object.freeze({
	paths: Object.freeze({ instrumentsBase: '', effectPresetsBase: '', m4lDevicesRoot: '' }),
	totalmix: null
});

class MachineStore {
	snapshot = $state<MachineSnapshot>(EMPTY);
	// Kept beside the proxied snapshot: `$state` wraps the object, so identity
	// against the frozen sentinel says nothing.
	private heard = $state(false);

	get paths(): MachinePaths {
		return this.snapshot.paths;
	}

	/** Whether the bridge has said anything yet. */
	get known(): boolean {
		return this.heard;
	}

	/** Take a `/bridge/machine` frame. A frame that does not parse leaves the last one standing. */
	update(json: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(json);
		} catch {
			logger.warn('Unreadable /bridge/machine frame', { component: 'machineStore', json });
			return;
		}
		if (!parsed || typeof parsed !== 'object') return;
		const raw = parsed as { paths?: Record<string, unknown>; totalmix?: Record<string, unknown> | null };
		const str = (v: unknown) => (typeof v === 'string' ? v : '');
		const next: MachineSnapshot = {
			paths: {
				instrumentsBase: str(raw.paths?.instrumentsBase),
				effectPresetsBase: str(raw.paths?.effectPresetsBase),
				m4lDevicesRoot: str(raw.paths?.m4lDevicesRoot)
			},
			totalmix:
				raw.totalmix && typeof raw.totalmix.minDb === 'number' && typeof raw.totalmix.maxDb === 'number'
					? {
							minDb: raw.totalmix.minDb,
							maxDb: raw.totalmix.maxDb,
							silenceDb: typeof raw.totalmix.silenceDb === 'number' ? raw.totalmix.silenceDb : -300
						}
					: null
		};
		this.heard = true;
		if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
		this.snapshot = next;
		if (next.totalmix) setTotalMixRange(next.totalmix);
	}

	/** Tests: back to nothing known. */
	reset(): void {
		this.snapshot = EMPTY;
		this.heard = false;
	}
}

export const machineStore = new MachineStore();
