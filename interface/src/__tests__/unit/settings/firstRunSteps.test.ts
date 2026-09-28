/**
 * The first-run checklist's steps (onboarding.plan.md §7), and the "2/3" the
 * Settings sidebar shows beside Setup: the optional foot switch and recorder
 * never count against it, and nothing ticks itself.
 */
import { describe, it, expect } from 'vitest';
import { firstRunSteps, firstRunProgress } from '$lib/components/v6/settings/firstRunSteps';

const nothing = { surfaceProtocol: null, m4l: null, tickedCount: 0, footLearned: false, recorderReady: false };

describe('firstRunSteps', () => {
	it('ticks what the app can see, and counts the optional steps out', () => {
		const steps = firstRunSteps(nothing);
		expect(steps.map((s) => [s.key, s.done])).toEqual([
			['surface', false],
			['m4l', false],
			['places', false],
			['foot', false],
			['recorder', false]
		]);
		expect(firstRunProgress(steps)).toEqual({ done: 0, total: 3 });

		const done = firstRunSteps({
			surfaceProtocol: '3.11.0',
			m4l: { path: '/repo/Vamp Devices', place: 'Vamp Devices', exact: true },
			tickedCount: 3,
			footLearned: false,
			recorderReady: true
		});
		expect(firstRunProgress(done)).toEqual({ done: 3, total: 3 });
		expect(done[4].done).toBe(true);
		expect(done[0].how).toContain('3.11.0');
		expect(done[2].how).toContain('3 ticked');
	});

	it('points each step Settings can do at its section', () => {
		const goTo = Object.fromEntries(firstRunSteps(nothing).map((s) => [s.key, s.goTo?.section]));
		expect(goTo).toEqual({ surface: undefined, m4l: undefined, places: 'places', foot: 'general', recorder: undefined });
	});
});
