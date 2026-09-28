import { describe, it, expect } from 'vitest';
import {
	isOSCArg,
	isOSCMessage,
	createOSCMessage,
	type OSCArg,
	type OSCMessage
} from '$lib/types/osc';

describe('OSC types', () => {
	describe('isOSCArg', () => {
		it('should return true for strings', () => {
			expect(isOSCArg('hello')).toBe(true);
			expect(isOSCArg('')).toBe(true);
		});

		it('should return true for numbers', () => {
			expect(isOSCArg(42)).toBe(true);
			expect(isOSCArg(0)).toBe(true);
			expect(isOSCArg(-1.5)).toBe(true);
			expect(isOSCArg(Infinity)).toBe(true);
		});

		it('should return true for booleans', () => {
			expect(isOSCArg(true)).toBe(true);
			expect(isOSCArg(false)).toBe(true);
		});

		it('should return true for Uint8Array', () => {
			expect(isOSCArg(new Uint8Array([1, 2, 3]))).toBe(true);
			expect(isOSCArg(new Uint8Array())).toBe(true);
		});

		it('should return false for null and undefined', () => {
			expect(isOSCArg(null)).toBe(false);
			expect(isOSCArg(undefined)).toBe(false);
		});

		it('should return false for objects and arrays', () => {
			expect(isOSCArg({})).toBe(false);
			expect(isOSCArg([])).toBe(false);
			expect(isOSCArg({ value: 1 })).toBe(false);
		});

		it('should return false for functions', () => {
			expect(isOSCArg(() => {})).toBe(false);
		});
	});

	describe('isOSCMessage', () => {
		it('should return true for valid messages', () => {
			const msg: OSCMessage = {
				address: '/live/song/tempo',
				args: [120]
			};
			expect(isOSCMessage(msg)).toBe(true);
		});

		it('should return true for messages with no args', () => {
			const msg: OSCMessage = {
				address: '/live/song/get/tempo',
				args: []
			};
			expect(isOSCMessage(msg)).toBe(true);
		});

		it('should return true for messages with multiple arg types', () => {
			const msg: OSCMessage = {
				address: '/live/track/name',
				args: [0, 'Track Name', true]
			};
			expect(isOSCMessage(msg)).toBe(true);
		});

		it('should return true for messages with optional fields', () => {
			const msg: OSCMessage = {
				address: '/live/song/tempo',
				args: [120],
				timestamp: Date.now(),
				source: 'test'
			};
			expect(isOSCMessage(msg)).toBe(true);
		});

		it('should return false for null', () => {
			expect(isOSCMessage(null)).toBe(false);
		});

		it('should return false for non-objects', () => {
			expect(isOSCMessage('string')).toBe(false);
			expect(isOSCMessage(42)).toBe(false);
			expect(isOSCMessage(undefined)).toBe(false);
		});

		it('should return false for objects missing address', () => {
			expect(isOSCMessage({ args: [] })).toBe(false);
		});

		it('should return false for objects missing args', () => {
			expect(isOSCMessage({ address: '/test' })).toBe(false);
		});

		it('should return false for objects with invalid args', () => {
			expect(isOSCMessage({ address: '/test', args: [null] })).toBe(false);
			expect(isOSCMessage({ address: '/test', args: [{}] })).toBe(false);
		});
	});

	describe('createOSCMessage', () => {
		it('should create a valid message with no args', () => {
			const msg = createOSCMessage('/live/song/get/tempo', []);
			expect(msg.address).toBe('/live/song/get/tempo');
			expect(msg.args).toEqual([]);
		});

		it('should create a valid message with args', () => {
			const msg = createOSCMessage('/live/song/set/tempo', [120.5]);
			expect(msg.address).toBe('/live/song/set/tempo');
			expect(msg.args).toEqual([120.5]);
		});

		it('should include optional timestamp', () => {
			const timestamp = Date.now();
			const msg = createOSCMessage('/test', [], { timestamp });
			expect(msg.timestamp).toBe(timestamp);
		});

		it('should include optional source', () => {
			const msg = createOSCMessage('/test', [], { source: 'bridge' });
			expect(msg.source).toBe('bridge');
		});

		it('should throw for invalid address (not starting with /)', () => {
			expect(() => createOSCMessage('live/song/tempo', [])).toThrow(
				"Invalid OSC address: must start with '/'"
			);
		});

		it('should throw for invalid args', () => {
			expect(() => createOSCMessage('/test', [null as unknown as OSCArg])).toThrow(
				'Invalid OSC arguments'
			);
		});

		it('should accept Uint8Array args', () => {
			const blob = new Uint8Array([1, 2, 3]);
			const msg = createOSCMessage('/test', [blob]);
			expect(msg.args[0]).toBe(blob);
		});
	});

	describe('type safety', () => {
		it('should work with OSCArg union type', () => {
			const args: OSCArg[] = ['string', 42, true, new Uint8Array([1])];
			expect(args.every(isOSCArg)).toBe(true);
		});

		it('should allow mixed arg types in messages', () => {
			const msg = createOSCMessage('/live/device/parameter', [
				0, // track index (number)
				1, // device index (number)
				'Cutoff', // param name (string)
				0.75 // value (number)
			]);
			expect(msg.args).toHaveLength(4);
		});
	});
});
