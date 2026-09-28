/**
 * The on-screen pitch and mod wheels → the MidiWheels device on the selected
 * MIDI track (the surface's MidiWheelsComponent loads it on the first touch).
 *
 * Pitch is 0–16383 with 8192 as centre; mod is 0–127. Every instrument view
 * sends through these two, so the addresses live in one place.
 */
import { send } from './simpleClient';

export const WHEELS_PITCH_ADDRESS = '/looping/v3/wheels/pitch';
export const WHEELS_MOD_ADDRESS = '/looping/v3/wheels/mod';

export function sendPitchWheel(value: number): void {
	send(WHEELS_PITCH_ADDRESS, [value]);
}

export function sendModWheel(value: number): void {
	send(WHEELS_MOD_ADDRESS, [value]);
}
