/**
 * Track Strip Constants and Defaults
 */

export const TRACK_DEFAULTS = {
    volume: 0.85,
    mute: false,
    solo: false,
    arm: false,
    pan: 0,
    color: 0x808080,
    meterLevel: 0
} as const;

export const MASTER_TRACK_DEFAULTS = {
    ...TRACK_DEFAULTS,
    name: 'Master',
    color: 0xff8800
} as const;

export const TRACK_PROPERTIES = [
    'volume',
    'mute',
    'solo',
    'arm',
    'name',
    'color'
] as const;

export const TRACK_LISTENERS = [
    'output_meter_left',
    ...TRACK_PROPERTIES
] as const;