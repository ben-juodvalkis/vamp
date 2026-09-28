/**
 * Domain Update Events for Type-Safe Reactive Systems
 * Discriminated unions for AbletonOSC message parsing results
 */

import type { LiveTrack, LiveDevice, LiveParameter, LiveClip, LiveScene, TimeSignature, BulkTrackData } from './live-objects.js';

// Base update interface
interface BaseUpdate {
  timestamp: number;
}

// Song-level updates
export interface TempoUpdate extends BaseUpdate {
  type: 'tempo';
  bpm: number;
}

export interface TransportUpdate extends BaseUpdate {
  type: 'transport';
  isPlaying: boolean;
}

export interface SessionRecordUpdate extends BaseUpdate {
  type: 'session-record';
  isRecording: boolean;
}

export interface TimeSignatureUpdate extends BaseUpdate {
  type: 'time-signature';
  timeSignature: TimeSignature;
}

export interface CurrentTimeUpdate extends BaseUpdate {
  type: 'current-time';
  beats: number;
}

export interface LoopUpdate extends BaseUpdate {
  type: 'loop';
  isLooping: boolean;
  loopStart: number;
  loopEnd: number;
}

export interface MetronomeUpdate extends BaseUpdate {
  type: 'metronome';
  enabled: boolean;
}

export interface GrooveUpdate extends BaseUpdate {
  type: 'groove';
  amount: number;
}

// View-level updates  
export interface TrackSelectionUpdate extends BaseUpdate {
  type: 'track-selection';
  trackIndex: number;
  previousIndex?: number;
}

export interface SceneSelectionUpdate extends BaseUpdate {
  type: 'scene-selection';
  sceneIndex: number;
  previousIndex?: number;
}

export interface DeviceSelectionUpdate extends BaseUpdate {
  type: 'device-selection';
  trackIndex: number;
  deviceIndex: number;
}

export interface ClipSelectionUpdate extends BaseUpdate {
  type: 'clip-selection';
  trackIndex: number;
  clipIndex: number;
}

/**
 * Focused view update - tracks which main document view is focused
 * Note: focused_document_view property only returns 'Session' or 'Arranger'
 * However, focus_view() method can accept more values: 'Browser', 'Detail', 'Detail/Clip', 'Detail/DeviceChain'
 */
export interface FocusedViewUpdate extends BaseUpdate {
  type: 'focused-view';
  view: 'Session' | 'Arranger';  // Only these two are returned by focused_document_view
}

// Track-level updates
export interface TrackVolumeUpdate extends BaseUpdate {
  type: 'track-volume';
  trackIndex: number;
  volume: number;
}

export interface TrackMuteUpdate extends BaseUpdate {
  type: 'track-mute';
  trackIndex: number;
  mute: boolean;
}

export interface TrackSoloUpdate extends BaseUpdate {
  type: 'track-solo';
  trackIndex: number;
  solo: boolean;
}

export interface TrackArmUpdate extends BaseUpdate {
  type: 'track-arm';
  trackIndex: number;
  arm: boolean;
}

export interface TrackPanUpdate extends BaseUpdate {
  type: 'track-pan';
  trackIndex: number;
  pan: number;
}

export interface TrackNameUpdate extends BaseUpdate {
  type: 'track-name';
  trackIndex: number;
  name: string;
}

export interface TrackNamesUpdate extends BaseUpdate {
  type: 'track-names';
  names: string[];
}

export interface TrackCountUpdate extends BaseUpdate {
  type: 'track-count';
  count: number;
}

export interface TrackColorUpdate extends BaseUpdate {
  type: 'track-color';
  trackIndex: number;
  color: number;
}

export interface TrackMeterUpdate extends BaseUpdate {
  type: 'track-meter';
  trackIndex: number;
  level: number;
}

export interface TrackSendUpdate extends BaseUpdate {
  type: 'track-send';
  trackIndex: number;
  sendIndex: number;
  value: number;
}

export interface TrackFoldStateUpdate extends BaseUpdate {
  type: 'track-fold-state';
  trackIndex: number;
  folded: boolean;
}

// Device-level updates
export interface DeviceParameterUpdate extends BaseUpdate {
  type: 'device-parameter';
  trackIndex: number;
  deviceIndex: number;
  parameterIndex: number;
  value: number;
}

export interface DeviceActiveUpdate extends BaseUpdate {
  type: 'device-active';
  trackIndex: number;
  deviceIndex: number;
  isActive: boolean;
}

export interface DevicePresetUpdate extends BaseUpdate {
  type: 'device-preset';
  trackIndex: number;
  deviceIndex: number;
  presetName: string;
}

// Clip-level updates
export interface ClipFireUpdate extends BaseUpdate {
  type: 'clip-fire';
  trackIndex: number;
  clipIndex: number;
}

export interface ClipStopUpdate extends BaseUpdate {
  type: 'clip-stop';
  trackIndex: number;
  clipIndex: number;
}

export interface ClipPlayingUpdate extends BaseUpdate {
  type: 'clip-playing';
  trackIndex: number;
  clipIndex: number;
  isPlaying: boolean;
}

export interface ClipRecordingUpdate extends BaseUpdate {
  type: 'clip-recording';
  trackIndex: number;
  clipIndex: number;
  isRecording: boolean;
}

export interface ClipNameUpdate extends BaseUpdate {
  type: 'clip-name';
  trackIndex: number;
  clipIndex: number;
  name: string;
}

export interface ClipColorUpdate extends BaseUpdate {
  type: 'clip-color';
  trackIndex: number;
  clipIndex: number;
  color: number;
}

export interface ClipLengthUpdate extends BaseUpdate {
  type: 'clip-length';
  trackIndex: number;
  clipIndex: number;
  length: number;
}

export interface ClipLoopRangeUpdate extends BaseUpdate {
  type: 'clip-loop-range';
  trackIndex: number;
  clipIndex: number;
  loopStart: number;
  loopEnd: number;
}

export interface ClipGainUpdate extends BaseUpdate {
  type: 'clip-gain';
  trackIndex: number;
  clipIndex: number;
  gain: number;
}

export interface ClipPlayingPositionUpdate extends BaseUpdate {
  type: 'clip-playing-position';
  trackIndex: number;
  clipIndex: number;
  position: number;
}

// Scene-level updates
export interface SceneFireUpdate extends BaseUpdate {
  type: 'scene-fire';
  sceneIndex: number;
}

export interface SceneNameUpdate extends BaseUpdate {
  type: 'scene-name';
  sceneIndex: number;
  name: string;
}

export interface SceneColorUpdate extends BaseUpdate {
  type: 'scene-color';
  sceneIndex: number;
  color: number;
}

export interface SceneTempoUpdate extends BaseUpdate {
  type: 'scene-tempo';
  sceneIndex: number;
  tempo: number;
  enabled: boolean;
}

// Bulk data updates (for initialization)
export interface BulkTrackDataUpdate extends BaseUpdate {
  type: 'bulk-track-data';
  tracks: LiveTrack[];
}

export interface BulkClipDataUpdate extends BaseUpdate {
  type: 'bulk-clip-data';
  trackIndex: number;
  clips: LiveClip[];
}

export interface BulkDeviceDataUpdate extends BaseUpdate {
  type: 'bulk-device-data';
  trackIndex: number;
  devices: LiveDevice[];
}

export interface BulkParameterDataUpdate extends BaseUpdate {
  type: 'bulk-parameter-data';
  trackIndex: number;
  deviceIndex: number;
  parameters: LiveParameter[];
}

export interface BulkSceneDataUpdate extends BaseUpdate {
  type: 'bulk-scene-data';
  scenes: LiveScene[];
}

// Special updates
export interface ErrorUpdate extends BaseUpdate {
  type: 'error';
  source: 'pythonSurface' | 'validation' | 'network';
  error: string;
  originalMessage?: any;
}

export interface ConnectionUpdate extends BaseUpdate {
  type: 'connection';
  status: 'connected' | 'disconnected' | 'error';
  source: 'pythonSurface';
}

export interface HeartbeatUpdate extends BaseUpdate {
  type: 'heartbeat';
  source: 'pythonSurface';
}

// Discriminated union of all possible updates
export type DomainUpdate = 
  // Song-level
  | TempoUpdate
  | TransportUpdate
  | SessionRecordUpdate
  | TimeSignatureUpdate
  | CurrentTimeUpdate
  | LoopUpdate
  | MetronomeUpdate
  | GrooveUpdate
  
  // View-level
  | TrackSelectionUpdate
  | SceneSelectionUpdate
  | DeviceSelectionUpdate
  | ClipSelectionUpdate
  | FocusedViewUpdate
  
  // Track-level
  | TrackVolumeUpdate
  | TrackMuteUpdate
  | TrackSoloUpdate
  | TrackArmUpdate
  | TrackPanUpdate
  | TrackNameUpdate
  | TrackNamesUpdate
  | TrackCountUpdate
  | TrackColorUpdate
  | TrackMeterUpdate
  | TrackSendUpdate
  | TrackFoldStateUpdate
  
  // Device-level
  | DeviceParameterUpdate
  | DeviceActiveUpdate
  | DevicePresetUpdate
  
  // Clip-level
  | ClipFireUpdate
  | ClipStopUpdate
  | ClipPlayingUpdate
  | ClipRecordingUpdate
  | ClipNameUpdate
  | ClipColorUpdate
  | ClipLengthUpdate
  | ClipLoopRangeUpdate
  | ClipGainUpdate
  | ClipPlayingPositionUpdate
  
  // Scene-level
  | SceneFireUpdate
  | SceneNameUpdate
  | SceneColorUpdate
  | SceneTempoUpdate
  
  // Bulk data
  | BulkTrackDataUpdate
  | BulkClipDataUpdate
  | BulkDeviceDataUpdate
  | BulkParameterDataUpdate
  | BulkSceneDataUpdate
  
  // Special
  | ErrorUpdate
  | ConnectionUpdate
  | HeartbeatUpdate;

// Type guards for update types
export function isTempoUpdate(update: DomainUpdate): update is TempoUpdate {
  return update.type === 'tempo';
}

export function isTransportUpdate(update: DomainUpdate): update is TransportUpdate {
  return update.type === 'transport';
}

export function isTrackVolumeUpdate(update: DomainUpdate): update is TrackVolumeUpdate {
  return update.type === 'track-volume';
}

export function isTrackSelectionUpdate(update: DomainUpdate): update is TrackSelectionUpdate {
  return update.type === 'track-selection';
}

export function isBulkTrackDataUpdate(update: DomainUpdate): update is BulkTrackDataUpdate {
  return update.type === 'bulk-track-data';
}

export function isErrorUpdate(update: DomainUpdate): update is ErrorUpdate {
  return update.type === 'error';
}

export function isConnectionUpdate(update: DomainUpdate): update is ConnectionUpdate {
  return update.type === 'connection';
}

export function isFocusedViewUpdate(update: DomainUpdate): update is FocusedViewUpdate {
  return update.type === 'focused-view';
}

// Helper functions for creating updates
export function createTempoUpdate(bpm: number): TempoUpdate {
  return {
    type: 'tempo',
    bpm,
    timestamp: Date.now()
  };
}

export function createTransportUpdate(isPlaying: boolean): TransportUpdate {
  return {
    type: 'transport',
    isPlaying,
    timestamp: Date.now()
  };
}

export function createTrackVolumeUpdate(trackIndex: number, volume: number): TrackVolumeUpdate {
  return {
    type: 'track-volume',
    trackIndex,
    volume,
    timestamp: Date.now()
  };
}

export function createErrorUpdate(
  source: ErrorUpdate['source'], 
  error: string, 
  originalMessage?: any
): ErrorUpdate {
  return {
    type: 'error',
    source,
    error,
    originalMessage,
    timestamp: Date.now()
  };
}

export function createConnectionUpdate(
  status: ConnectionUpdate['status'],
  source: ConnectionUpdate['source']
): ConnectionUpdate {
  return {
    type: 'connection',
    status,
    source,
    timestamp: Date.now()
  };
}

export function createFocusedViewUpdate(view: 'Session' | 'Arranger'): FocusedViewUpdate {
  return {
    type: 'focused-view',
    view,
    timestamp: Date.now()
  };
}