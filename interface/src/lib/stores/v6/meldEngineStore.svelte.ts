/**
 * Which of Meld's two engines (A or B) the Meld view is showing, per Meld
 * device (2026-11-06). The view picks it (touching an engine's level box);
 * the effect chain's Meld cell reads it, so the cell's pad drives the
 * oscillator of the engine the view is on.
 *
 * View state only: it writes nothing to Live (not Meld's own
 * `selected_engine`), so a patch change never moves it. Keyed by device
 * path; a Meld never picked shows Engine A.
 */
import type { MeldEngine } from '$lib/components/v6/central/views/meldParams';

const engines = $state<Record<string, MeldEngine>>({});

export const meldEngineStore = {
	/** The engine shown for the Meld at `devicePath`: A until one is picked. */
	engineOf(devicePath: string | undefined): MeldEngine {
		return (devicePath && engines[devicePath]) || 'A';
	},
	select(devicePath: string | undefined, engine: MeldEngine): void {
		if (!devicePath || engines[devicePath] === engine) return;
		engines[devicePath] = engine;
	},
	/** For tests. */
	reset(): void {
		for (const key of Object.keys(engines)) delete engines[key];
	}
};
