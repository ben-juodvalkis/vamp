/**
 * Domain shapes still shared across the interface: the session store's
 * time signature and the track strip's view model. The rest of the
 * AbletonOSC-era object model (song, device, clip, scene records and
 * their update envelopes) went when the v3 handlers began calling the
 * session store's setters directly.
 */

// Time signature representation
export interface TimeSignature {
  readonly numerator: number;    // 1-32 (typical: 4)  
  readonly denominator: number;  // 1, 2, 4, 8, 16 (typical: 4)
}

// Live track representation
export interface LiveTrack {
  readonly index: number;           // Position in track list (-1 for master)
  readonly name: string;            // Display name (max 64 chars)
  readonly volume: number;          // 0.0-1.0, linear scale
  readonly pan: number;             // -1.0 to 1.0, center = 0.0
  readonly mute: boolean;           // Mute state
  readonly solo: boolean;           // Solo state
  readonly arm: boolean;            // Record arm (not available for master/return)
  readonly color: number;           // RGB color as integer (0x00rrggbb)
  readonly meterLevel: number;      // 0.0-1.0, current output meter
  readonly isMaster: boolean;       // True for master track
  readonly isReturn: boolean;       // True for return tracks
  readonly isGroup: boolean;        // True for group tracks
  readonly groupParentIndex: number; // Parent group index (-1 if not grouped)
  readonly deviceCount: number;     // Number of devices in device chain
  readonly clipCount: number;       // Number of clip slots
  readonly foldState: boolean;      // Folded state (for groups)
  readonly isVisible: boolean;      // Track visibility
  readonly canBeArmed: boolean;     // Whether track can be armed
  readonly hasAudioInput: boolean;  // Has audio input capability
  readonly hasAudioOutput: boolean; // Has audio output capability
  readonly hasMidiInput: boolean;   // Has MIDI input capability
  readonly hasMidiOutput: boolean;  // Has MIDI output capability
  readonly playingSlotIndex: number; // Currently playing clip slot (-1 if none)
  readonly firedSlotIndex: number;  // Currently fired clip slot (-1 if none)
}
