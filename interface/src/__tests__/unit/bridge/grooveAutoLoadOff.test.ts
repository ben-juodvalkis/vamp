/**
 * `interface/bridge/handlers/grooveAutoLoadOff.js`: every groove Vamp adds is
 * followed by Live's Auto Load Groove box pressed off through the AX helper,
 * with the Browser shown for the press when it was hidden and hidden again.
 * A fake helper models the box as Live does: in the window only while the
 * Browser shows, and a press toggles it.
 */

import { describe, it, expect } from 'vitest';

import * as mod from '../../../../bridge/handlers/grooveAutoLoadOff.js';

type Msg = { address: string; args?: unknown[] };
const { createGrooveAutoLoadOff, GROOVE_ADDED_ADDRESS, GROOVE_BROWSER_ADDRESS, GROOVE_BROWSER_ACK_ADDRESS } =
	mod as unknown as {
		createGrooveAutoLoadOff: (o: object) => { onSurfaceMessage: (m: Msg) => boolean; idle: () => Promise<void> };
		GROOVE_ADDED_ADDRESS: string;
		GROOVE_BROWSER_ADDRESS: string;
		GROOVE_BROWSER_ACK_ADDRESS: string;
	};

function rig({ boxes, browser }: { boxes: boolean[]; browser: boolean }) {
	const live = { boxes: [...boxes], browser };
	const calls: string[] = [];
	const warnings: string[] = [];
	const axHelper = {
		async request(verb: string, args: { index?: number }) {
			calls.push(verb === 'press' ? `press ${args.index}` : verb);
			if (!live.browser) {
				throw Object.assign(new Error('missing'), { code: 'ax-control-missing' });
			}
			if (verb === 'press') live.boxes[args.index!] = !live.boxes[args.index!];
			return { elements: live.boxes.map((on) => ({ value: on ? 1 : 0 })) };
		}
	};
	let handler: ReturnType<typeof createGrooveAutoLoadOff>;
	const sendToSurface = (address: string, args: unknown[]) => {
		expect(address).toBe(GROOVE_BROWSER_ADDRESS);
		const was = live.browser ? 1 : 0;
		live.browser = args[1] === 1;
		calls.push(`browser ${args[1]}`);
		queueMicrotask(() => handler.onSurfaceMessage({ address: GROOVE_BROWSER_ACK_ADDRESS, args: [args[0], was] }));
	};
	const logger = { info() {}, warn: (m: string) => warnings.push(m) };
	handler = createGrooveAutoLoadOff({ axHelper, logger, sendToSurface, sleep: async () => {} });
	return { live, calls, warnings, handler };
}

describe('grooveAutoLoadOff', () => {
	it('presses a ticked box off and consumes the announcement', async () => {
		const { live, calls, handler } = rig({ boxes: [true, false], browser: true });
		expect(handler.onSurfaceMessage({ address: GROOVE_ADDED_ADDRESS })).toBe(true);
		await handler.idle();
		expect(live.boxes).toEqual([false, false]);
		expect(calls).toEqual(['list', 'press 0', 'list']);
	});

	it('shows a hidden Browser for the press, then hides it again', async () => {
		const { live, calls, handler } = rig({ boxes: [false, true], browser: false });
		handler.onSurfaceMessage({ address: GROOVE_ADDED_ADDRESS });
		await handler.idle();
		expect(live.boxes).toEqual([false, false]);
		expect(live.browser).toBe(false);
		expect(calls).toEqual(['list', 'browser 1', 'list', 'press 1', 'list', 'browser 0']);
	});

	it('presses nothing when no box is ticked', async () => {
		const { live, calls, handler } = rig({ boxes: [false], browser: true });
		handler.onSurfaceMessage({ address: GROOVE_ADDED_ADDRESS });
		await handler.idle();
		expect(live.boxes).toEqual([false]);
		// One read, then 600 ms of polling for a late tick.
		expect(calls).toEqual(['list', 'list', 'list', 'list', 'list']);
	});

	it('waits for the row of the first groove in an empty pool, drawn late', async () => {
		const { live, calls } = rig({ boxes: [], browser: true });
		const draw = [false, false, false];   // three reads before Live draws the row
		const reads = { n: 0 };
		const helper = {
			async request(verb: string, args: { index?: number }) {
				calls.push(verb === 'press' ? `press ${args.index}` : verb);
				if (verb === 'press') live.boxes[args.index!] = !live.boxes[args.index!];
				if (verb === 'list' && reads.n++ < draw.length) {
					throw Object.assign(new Error('missing'), { code: 'ax-control-missing' });
				}
				if (live.boxes.length === 0) live.boxes = [true];
				return { elements: live.boxes.map((on) => ({ value: on ? 1 : 0 })) };
			}
		};
		const late = createGrooveAutoLoadOff({
			axHelper: helper,
			logger: { info() {}, warn() {} },
			sendToSurface: (_a: string, args: unknown[]) =>
				queueMicrotask(() => late.onSurfaceMessage({ address: GROOVE_BROWSER_ACK_ADDRESS, args: [args[0], 1] })),
			sleep: async () => {}
		});
		late.onSurfaceMessage({ address: GROOVE_ADDED_ADDRESS });
		await late.idle();
		expect(live.boxes).toEqual([false]);
		expect(calls).toEqual(['list', 'list', 'list', 'list', 'press 0', 'list']);
	});

	it('a helper that is down is a warning, and the next add still runs', async () => {
		const { handler, warnings } = rig({ boxes: [true], browser: true });
		const down = createGrooveAutoLoadOff({
			axHelper: { request: async () => Promise.reject(Object.assign(new Error('down'), { code: 'ax-helper-down' })) },
			logger: { info() {}, warn: (m: string) => warnings.push(m) },
			sendToSurface: () => {},
			sleep: async () => {}
		});
		down.onSurfaceMessage({ address: GROOVE_ADDED_ADDRESS });
		await down.idle();
		expect(warnings).toEqual(['Auto Load Groove: could not turn it off']);
		handler.onSurfaceMessage({ address: GROOVE_ADDED_ADDRESS });
		await handler.idle();
	});

	it('leaves other surface messages alone', () => {
		const { handler } = rig({ boxes: [], browser: true });
		expect(handler.onSurfaceMessage({ address: '/looping/v3/clip/groove/file' })).toBe(false);
	});
});
