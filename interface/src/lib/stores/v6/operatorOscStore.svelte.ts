/**
 * Which of Operator's four oscillators (A to D, 0..3) its central view shows,
 * per Operator device (2026-11-07, ADR-513). The effect chain's Operator cell
 * picks it: touching one of its four pads shows that oscillator in the view,
 * as Meld's view and cell share an engine (`meldEngineStore`).
 *
 * View state only: it writes nothing to Live. Keyed by device path; an
 * Operator never touched shows oscillator A.
 */
const oscs = $state<Record<string, number>>({});

export const operatorOscStore = {
	/** The oscillator shown for the Operator at `devicePath`, 0..3: A until one is touched. */
	oscOf(devicePath: string | undefined): number {
		return (devicePath && oscs[devicePath]) || 0;
	},
	select(devicePath: string | undefined, osc: number): void {
		if (!devicePath || osc < 0 || osc > 3 || oscs[devicePath] === osc) return;
		oscs[devicePath] = osc;
	},
	/** For tests. */
	reset(): void {
		for (const key of Object.keys(oscs)) delete oscs[key];
	}
};
