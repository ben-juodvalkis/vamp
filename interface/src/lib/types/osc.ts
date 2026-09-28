/**
 * OSC (Open Sound Control) Type Definitions
 *
 * Type-safe representations of OSC messages and arguments.
 * Used throughout the application for communication between:
 * - SvelteKit interface
 * - Enhanced OSC Bridge
 * - Ableton Live (via AbletonOSC and Max4Live)
 *
 * @see documentation/v6-api.md for OSC address patterns and usage
 */

/**
 * Valid OSC argument types
 *
 * OSC supports these primitive types:
 * - string: Text data
 * - number: Integers and floats (OSC handles both as numbers in JS)
 * - boolean: True/false values
 * - Uint8Array: Binary data (blobs)
 */
export type OSCArg = string | number | boolean | Uint8Array;

/**
 * OSC Message structure
 *
 * Represents a complete OSC message with address and arguments.
 * @example
 * ```typescript
 * const tempoMessage: OSCMessage = {
 *   address: '/live/song/get/tempo',
 *   args: []
 * };
 *
 * const setTempoMessage: OSCMessage = {
 *   address: '/live/song/set/tempo',
 *   args: [120.0]
 * };
 *
 * const createTrackMessage: OSCMessage = {
 *   address: '/live/song/create_audio_track',
 *   args: [-1] // -1 means append at end
 * };
 * ```
 */
export interface OSCMessage {
  /** OSC address pattern (e.g., '/live/song/get/tempo') */
  address: string;

  /** Array of OSC arguments */
  args: OSCArg[];

  /** Optional timestamp (milliseconds since epoch) */
  timestamp?: number;

  /** Optional source identifier for debugging/routing */
  source?: string;
}

/**
 * Type guard to check if a value is a valid OSC argument
 * @param value - The value to check
 * @returns True if the value is a valid OSC argument type
 */
export function isOSCArg(value: unknown): value is OSCArg {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Uint8Array
  );
}

/**
 * Type guard to check if a value is a valid OSC message
 * @param value - The value to check
 * @returns True if the value has the structure of an OSC message
 */
export function isOSCMessage(value: unknown): value is OSCMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const msg = value as Partial<OSCMessage>;

  return (
    typeof msg.address === 'string' &&
    Array.isArray(msg.args) &&
    msg.args.every(isOSCArg)
  );
}

/**
 * Safely create an OSC message with validation
 * @param address - OSC address pattern
 * @param args - Array of OSC arguments
 * @param options - Optional timestamp and source
 * @returns A validated OSC message
 * @throws Error if arguments are invalid
 */
export function createOSCMessage(
  address: string,
  args: OSCArg[],
  options?: { timestamp?: number; source?: string }
): OSCMessage {
  if (!address.startsWith('/')) {
    throw new Error(`Invalid OSC address: must start with '/' (got: ${address})`);
  }

  if (!args.every(isOSCArg)) {
    throw new Error(`Invalid OSC arguments: must be string, number, boolean, or Uint8Array`);
  }

  return {
    address,
    args,
    timestamp: options?.timestamp,
    source: options?.source
  };
}
