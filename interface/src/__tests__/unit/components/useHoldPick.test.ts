import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HoldPick, PICK_SHOW_AFTER_MS } from '$lib/components/v6/browser/useHoldPick.svelte';
import type { PressInfo, PressReleaseInfo } from '$lib/actions';
import type { Preset } from '$lib/services/adapters';

const info = { pointerId: 1, pointerType: 'touch', x: 0, y: 0, event: null } as PressInfo;
const release = (held: boolean): PressReleaseInfo => ({ ...info, reason: 'up', elapsedMs: 0, held, fired: !held });
const preset = (name: string) => ({ name, path: `/p/${name}.adg`, kind: 'instrument', installed: true }) as unknown as Preset;

function setup() {
	const deps = {
		rollFolder: vi.fn((_: string) => Promise.resolve(preset('Aurora'))),
		fire: vi.fn(),
		enter: vi.fn(),
		revealMs: 750
	};
	return { deps, hold: new HoldPick(deps) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HoldPick', () => {
	it('a tap on a folder drills in and leaves no charge', () => {
		const { deps, hold } = setup();
		const press = hold.folderPress('Lead');
		press.onDown!(info);
		expect(hold.chargingFolder).toBe('Lead');
		press.onPress!(info);
		press.onRelease!(release(false));
		expect(deps.enter).toHaveBeenCalledWith('Lead');
		expect(deps.fire).not.toHaveBeenCalled();
		expect(hold.chargingFolder).toBeNull();
	});

	it('a hold fires the pick rolled at press-down, and the charge outlives the finger', async () => {
		const { deps, hold } = setup();
		const press = hold.folderPress('Lead');
		press.onDown!(info);
		press.onHold!(info);
		press.onRelease!(release(true));
		expect(deps.rollFolder).toHaveBeenCalledTimes(1);
		expect(deps.fire).toHaveBeenCalledTimes(1);
		const [folder, token, pick] = deps.fire.mock.calls[0];
		expect(folder).toBe('Lead');
		expect(hold.owns(token)).toBe(true);
		expect((await pick)?.name).toBe('Aurora');
		expect(hold.chargingFolder).toBe('Lead');
		expect(deps.enter).not.toHaveBeenCalled();
	});

	it("shows the pick's name only after the show delay", async () => {
		const { hold } = setup();
		hold.folderPress('Lead').onDown!(info);
		await Promise.resolve();
		expect(hold.labelFor('Lead')).toBeNull();
		vi.advanceTimersByTime(PICK_SHOW_AFTER_MS);
		expect(hold.labelFor('Lead')).toBe('Aurora');
	});

	it('a newer press takes the token; the reveal expires', () => {
		const { hold } = setup();
		hold.folderPress('Lead').onDown!(info);
		hold.showPickOn('Lead', 'Aurora');
		expect(hold.labelFor('Lead')).toBe('Aurora');
		vi.advanceTimersByTime(750);
		expect(hold.pickedFolder).toBeNull();
		expect(hold.chargingFolder).toBeNull();
	});

	it("a section header rolls from the section's loadable presets; a tap does nothing", () => {
		const { deps, hold } = setup();
		const blocked = { ...preset('Gone'), installed: false } as Preset;
		const press = hold.sectionPress('Pads', [blocked, preset('Only')]);
		press.onDown!(info);
		expect(press.onPress).toBeUndefined();
		press.onHold!(info);
		return deps.fire.mock.calls[0][2].then((p: Preset | null) => expect(p?.name).toBe('Only'));
	});
});
