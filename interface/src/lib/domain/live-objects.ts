/**
 * Clean Domain Object Models for Live's Object Hierarchy
 * Type-safe interfaces matching AbletonOSC data structures
 */

// Time signature representation
export interface TimeSignature {
  readonly numerator: number;    // 1-32 (typical: 4)  
  readonly denominator: number;  // 1, 2, 4, 8, 16 (typical: 4)
}

// Live song state
export interface LiveSong {
  readonly tempo: number;                    // BPM, validated 20-999
  readonly isPlaying: boolean;               // Transport state
  readonly isRecording: boolean;             // Recording state
  readonly currentTime: number;              // Playback position in beats
  readonly loopStart: number;                // Loop start in beats
  readonly loopEnd: number;                  // Loop end in beats
  readonly timeSignature: TimeSignature;    // Current time signature
  readonly selectedTrackIndex: number;      // -1 = master, 0+ = regular tracks
  readonly selectedSceneIndex: number;      // Currently selected scene
  readonly sessionRecord: boolean;          // Session record state
  readonly arrangementOverdub: boolean;     // Arrangement overdub state
  readonly backToArranger: boolean;         // Back to arranger button state
  readonly metronome: boolean;              // Metronome on/off
  readonly songLength: number;              // Song length in beats
  readonly groove: number;                  // Groove amount (0.0-1.0)
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

// Live device representation
export interface LiveDevice {
  readonly trackIndex: number;              // Parent track index
  readonly deviceIndex: number;             // Position in device chain
  readonly name: string;                    // Device display name
  readonly className: string;               // Live device class name (e.g., "Operator")
  readonly type: number;                    // 1 = audio_effect, 2 = instrument, 4 = midi_effect
  readonly isActive: boolean;               // Bypass state (true = active)
  readonly parameters: Map<number, LiveParameter>; // Parameter index → parameter
  readonly presetName: string;              // Current preset name
  readonly canHaveChains: boolean;          // True for racks and containers
}

// Live parameter representation  
export interface LiveParameter {
  readonly deviceIndex: number;     // Parent device index
  readonly parameterIndex: number;  // Parameter index within device
  readonly name: string;            // Parameter display name
  readonly value: number;           // Current value (normalized 0.0-1.0)
  readonly displayValue: string;    // Formatted display value with units
  readonly min: number;             // Minimum value
  readonly max: number;             // Maximum value
  readonly defaultValue: number;    // Default/reset value
  readonly isQuantized: boolean;    // True for discrete/enum parameters
  readonly isAutomated: boolean;    // True if automation present
  readonly stringValues: string[];  // For quantized parameters (empty if continuous)
}

// Live clip representation
export interface LiveClip {
  readonly trackIndex: number;      // Parent track index
  readonly clipIndex: number;       // Clip slot index
  readonly name: string;            // Clip name
  readonly length: number;          // Clip length in beats
  readonly loopStart: number;       // Loop start in beats
  readonly loopEnd: number;         // Loop end in beats  
  readonly startTime: number;       // Start time in beats
  readonly endTime: number;         // End time in beats
  readonly isPlaying: boolean;      // Currently playing
  readonly isRecording: boolean;    // Currently recording
  readonly isTriggered: boolean;    // Queued to play
  readonly color: number;           // RGB color
  readonly hasClip: boolean;        // True if slot contains clip
  readonly isLooping: boolean;      // Loop enabled
  readonly warp: boolean;           // Warp enabled
  readonly gain: number;            // Clip gain
  readonly pitchCoarse: number;     // Coarse pitch in semitones
  readonly pitchFine: number;       // Fine pitch in cents
  readonly startMarker: number;     // Start marker position in beats
  readonly endMarker: number;       // End marker position in beats
  readonly playingPosition: number; // Current playing position in beats
  readonly isAudioClip: boolean;    // True if audio clip
  readonly isMidiClip: boolean;     // True if MIDI clip
  readonly filePath: string;        // File path for audio clips
}

// Live scene representation
export interface LiveScene {
  readonly index: number;           // Scene index
  readonly name: string;            // Scene name
  readonly color: number;           // RGB color
  readonly tempo: number;           // Scene tempo (if enabled)
  readonly tempoEnabled: boolean;   // Whether scene tempo is active
  readonly timeSignature: TimeSignature; // Scene time signature (if enabled)
  readonly timeSignatureEnabled: boolean; // Whether scene time signature is active
  readonly isEmpty: boolean;        // Whether scene has no clips
  readonly isTriggered: boolean;    // Whether scene is triggered/queued
}

// Utility types for updates and collections

// Type-safe property updates
export type TrackProperty = keyof Omit<LiveTrack, 'index'>;
export type DeviceProperty = keyof Omit<LiveDevice, 'trackIndex' | 'deviceIndex'>;
export type ClipProperty = keyof Omit<LiveClip, 'trackIndex' | 'clipIndex'>;
export type SceneProperty = keyof Omit<LiveScene, 'index'>;

// Update action types
export interface TrackPropertyUpdate {
  trackIndex: number;
  property: TrackProperty;
  value: LiveTrack[TrackProperty];
}

export interface DevicePropertyUpdate {
  trackIndex: number;
  deviceIndex: number;
  property: DeviceProperty;
  value: LiveDevice[DeviceProperty];
}

export interface ParameterValueUpdate {
  trackIndex: number;
  deviceIndex: number;
  parameterIndex: number;
  value: number;
}

export interface ClipPropertyUpdate {
  trackIndex: number;
  clipIndex: number;
  property: ClipProperty;
  value: LiveClip[ClipProperty];
}

export interface ScenePropertyUpdate {
  sceneIndex: number;
  property: SceneProperty;
  value: LiveScene[SceneProperty];
}

// Type-safe collections for stores
export type TrackMap = Map<number, LiveTrack>;
export type DeviceMap = Map<string, LiveDevice>; // key: "trackIndex:deviceIndex"
export type ParameterMap = Map<string, LiveParameter>; // key: "trackIndex:deviceIndex:paramIndex"
export type ClipMap = Map<string, LiveClip>; // key: "trackIndex:clipIndex"
export type SceneMap = Map<number, LiveScene>;

// Collection update operations
export interface CollectionUpdate<T> {
  operation: 'set' | 'update' | 'delete';
  key: string | number;
  value?: T;
  changedProperties?: (keyof T)[];
}

// Bulk operations for efficient data loading
export interface BulkTrackData {
  tracks: LiveTrack[];
  totalTracks: number;
}

export interface BulkClipData {
  trackIndex: number;
  clips: LiveClip[];
  totalClips: number;
}

export interface BulkDeviceData {
  trackIndex: number;
  devices: LiveDevice[];
  totalDevices: number;
}

export interface BulkParameterData {
  trackIndex: number;
  deviceIndex: number;
  parameters: LiveParameter[];
  totalParameters: number;
}

// View state (what's currently selected/visible)
export interface LiveView {
  readonly selectedTrackIndex: number;
  readonly selectedSceneIndex: number;
  readonly selectedDeviceTrackIndex: number;
  readonly selectedDeviceIndex: number;
  readonly selectedClipTrackIndex: number;
  readonly selectedClipSceneIndex: number;
}

// Cue point representation
export interface LiveCuePoint {
  readonly name: string;
  readonly time: number; // Position in beats
}