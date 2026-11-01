/**
 * The first-run checklist's steps (onboarding.plan.md §7), decided from what
 * the app can see: the surface's handshake, the "Vamp Devices" Place, the
 * ticks, the foot switch. Capture has no step since REC loads its own recorder
 * (capture.plan.md). Pure, so the checklist and the sidebar's "2/3"
 * read one answer. The iPad's address is the checklist's last word and not a
 * step here: nothing can tick it.
 */
import type { SettingsSection } from '$lib/stores/v6/settingsStore.svelte';

export interface FirstRunInput {
	/** The negotiated protocol while the surface's handshake is accepted, else null. */
	surfaceProtocol: string | null;
	/** The listing's `m4lDevices`, or null before the listing lands. */
	m4l: { path: string; place: string | null; exact: boolean } | null;
	tickedCount: number;
	footLearned: boolean;
}

export interface FirstRunStep {
	key: 'surface' | 'm4l' | 'places' | 'foot';
	done: boolean;
	/** An optional step does not count against the total. */
	optional: boolean;
	label: string;
	how: string;
	/** The section that does this step, when Settings has one. */
	goTo?: { section: SettingsSection; label: string };
}

export function firstRunSteps(input: FirstRunInput): FirstRunStep[] {
	const { surfaceProtocol, m4l, tickedCount, footLearned } = input;
	const surfaceOk = surfaceProtocol !== null;
	const m4lOk = !!m4l?.place;
	return [
		{
			key: 'surface',
			done: surfaceOk,
			optional: false,
			label: 'Live has the Vamp control surface',
			how: surfaceOk
				? `Connected, protocol ${surfaceProtocol}.`
				: 'In Live → Settings → Link, Tempo & MIDI, choose “Vamp” as a Control Surface. Install it first with npm run setup, then restart Live.'
		},
		{
			key: 'm4l',
			done: m4lOk,
			// Optional (Ben, 2026-10-31): without it Permute, the wheels and REC are not shown.
			optional: true,
			label: 'Live can reach the “Vamp Devices” folder',
			how: m4lOk
				? m4l?.exact
					? `Live lists it as the Place “${m4l.place}”. Permute, the on-screen wheels and REC load from it.`
					: `In your ${m4l?.place}. Permute, the on-screen wheels and REC load from it.`
				: `Put the Vamp Devices folder in your User Library, or add ${m4l?.path ?? 'it'} in Live’s browser with Places → Add Folder…. Permute, the on-screen wheels and REC load from it; until then they are not shown.`
		},
		{
			key: 'places',
			done: tickedCount > 0,
			optional: false,
			label: 'Pick your Places',
			how:
				tickedCount > 0
					? `${tickedCount} ticked. Tick more whenever you like.`
					: 'Tick the folders the browser should show.',
			goTo: { section: 'places', label: 'Open Places' }
		},
		{
			key: 'foot',
			done: footLearned,
			optional: true,
			label: 'A foot switch, if you have one',
			how: footLearned
				? 'Learned. Turn it on and off under General.'
				: 'Optional. Set your pedal as the Vamp control surface’s Input in Live’s MIDI settings, then Learn it under General.',
			goTo: { section: 'general', label: 'Open General' }
		}
	];
}

/** Done and total over the steps that are not optional, for the sidebar. */
export function firstRunProgress(steps: FirstRunStep[]): { done: number; total: number } {
	const counted = steps.filter((s) => !s.optional);
	return { done: counted.filter((s) => s.done).length, total: counted.length };
}
