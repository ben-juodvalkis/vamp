#!/usr/bin/env node
// Probe: enumerate which LOM attributes/methods exist on a Simpler or
// audio Clip in the live Ableton Live session.
//
// Usage:
//   node lom_introspect_probe.js simpler <trackIndex> [deviceIndex]
//   node lom_introspect_probe.js clip    <trackIndex> <slotIndex>
//   node lom_introspect_probe.js invoke  <path> <method> [observe_csv]
//
// Examples:
//   node lom_introspect_probe.js simpler 1 0
//   node lom_introspect_probe.js clip 2 0
//   node lom_introspect_probe.js invoke tracks/1/devices/0 reverse \
//     "sample.start_marker,sample.end_marker"
//
// Read mode prints a markdown table of which attrs exist + values.
// Invoke mode CALLS the named method then re-reads `observe_csv`
// to confirm a side effect actually fired. Invoke is DESTRUCTIVE —
// only run on a track you don't mind dirtying.

const path = require('path');
const fs = require('fs');
const osc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'osc'));

// Single source of truth — never hardcode ports. constants.json lives at
// the repo root; pythonSurface.remotePort is where the surface listens.
const constants = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', 'config', 'constants.json'), 'utf8'),
);
const SURFACE_PORT = constants.osc.pythonSurface.remotePort;

const mode = process.argv[2] || '';
const VALID_MODES = new Set(['simpler', 'clip', 'invoke']);
if (!VALID_MODES.has(mode)) {
  console.error('usage: node lom_introspect_probe.js <simpler|clip|invoke> ...');
  process.exit(2);
}

// Candidate attributes by target type. These are what we want to
// probe — the LOM doc lists some, others are guesses worth checking.
const SIMPLER_ATTRS = [
  'reverse',                // method? property?
  'warp_half', 'warp_double',
  'playback_mode', 'slicing_playback_mode',
  'sample',                 // exists? type?
  'sample.reverse', 'sample.is_reversed', 'sample.reversed',
  'sample.warp_mode', 'sample.warping',
  'sample.gain', 'sample.start_marker', 'sample.end_marker',
  'sample.length', 'sample.sample_length', 'sample.tempo',
  'sample.beats_granulation_resolution',
  'sample.warp_markers',
];
const SIMPLER_DIR_REGEX = 'reverse|speed|warp|rate|playback|tempo|pitch';

const CLIP_ATTRS = [
  'reverse',                // for MIDI clips per docs; check audio
  'is_audio_clip', 'is_midi_clip',
  'warp_mode', 'warping',
  'gain', 'gain_display_string',
  'pitch_coarse', 'pitch_fine',
  'playback_rate', 'speed', 'tempo',
  'start_marker', 'end_marker', 'loop_start', 'loop_end',
  'length', 'sample_length',
  'file_path', 'sample_file_path',
  'warp_markers',
];
const CLIP_DIR_REGEX = 'reverse|speed|warp|rate|playback|tempo|pitch|gain';

let probePath = '';
let attrs = '';
let dirRegex = '';
let invokeMethod = '';
let invokeObserve = '';

if (mode === 'simpler') {
  const t = Number(process.argv[3] ?? 1);
  const d = Number(process.argv[4] ?? 0);
  probePath = `tracks/${t}/devices/${d}`;
  attrs = SIMPLER_ATTRS.join(',');
  dirRegex = SIMPLER_DIR_REGEX;
} else if (mode === 'clip') {
  if (process.argv[4] === undefined) {
    console.error('clip mode requires <trackIndex> <slotIndex>');
    process.exit(2);
  }
  const t = Number(process.argv[3]);
  const s = Number(process.argv[4]);
  probePath = `tracks/${t}/slots/${s}/clip`;
  attrs = CLIP_ATTRS.join(',');
  dirRegex = CLIP_DIR_REGEX;
} else {
  // invoke mode
  probePath = process.argv[3] || '';
  invokeMethod = process.argv[4] || '';
  invokeObserve = process.argv[5] || '';
  if (!probePath || !invokeMethod) {
    console.error('invoke mode requires <path> <method> [observe_csv]');
    process.exit(2);
  }
}

const u = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 0,
  remoteAddress: '127.0.0.1',
  remotePort: SURFACE_PORT,
});

// The transport auto-replies on the same address back to source_addr,
// so we listen for the request address echoed back, not a _reply variant.
const REPLY_INTROSPECT = '/looping/probe/lom_introspect';
const REPLY_INVOKE = '/looping/probe/lom_invoke';
let gotReply = false;

u.on('ready', () => {
  if (mode === 'invoke') {
    console.error(`-> invoke ${probePath} ${invokeMethod}`);
    if (invokeObserve) console.error(`   observing: ${invokeObserve}`);
    u.send({
      address: '/looping/probe/lom_invoke',
      args: [
        { type: 's', value: probePath },
        { type: 's', value: invokeMethod },
        { type: 's', value: invokeObserve },
      ],
    });
  } else {
    console.error(`-> introspect ${probePath} (${mode})`);
    u.send({
      address: '/looping/probe/lom_introspect',
      args: [
        { type: 's', value: probePath },
        { type: 's', value: attrs },
        { type: 's', value: dirRegex },
      ],
    });
  }
});

u.on('message', m => {
  const args = (m.args || []).map(a =>
    typeof a === 'object' && a !== null && 'value' in a ? a.value : a,
  );
  if (m.address === REPLY_INTROSPECT) {
    gotReply = true;
    let payload;
    try { payload = JSON.parse(args[0]); }
    catch (e) {
      console.error('bad JSON in reply:', e.message);
      console.error('raw:', args[0]);
      process.exit(1);
    }
    if (payload.resolve_error) {
      console.error('resolve_error:', payload.resolve_error);
      process.exit(1);
    }
    console.log(`\n# LOM introspect: ${payload.path}`);
    console.log(`Resolved type: \`${payload.resolved_type}\`\n`);
    console.log('| attr | exists | callable | value / error |');
    console.log('|------|--------|----------|---------------|');
    for (const a of payload.attrs) {
      const exists = a.exists ? '✓' : '';
      const call = a.callable ? '✓' : '';
      const cell = a.error
        ? `**${a.error}**`
        : (a.value_repr || '').replace(/\|/g, '\\|');
      console.log(`| \`${a.name}\` | ${exists} | ${call} | ${cell} |`);
    }
    if (payload.dir_matches && payload.dir_matches.length) {
      console.log(`\n**dir() matches** (filter: \`${dirRegex}\`):\n`);
      for (const n of payload.dir_matches) console.log(`- \`${n}\``);
    }
    u.close();
    process.exit(0);
  } else if (m.address === REPLY_INVOKE) {
    gotReply = true;
    let payload;
    try { payload = JSON.parse(args[0]); }
    catch (e) {
      console.error('bad JSON in reply:', e.message);
      console.error('raw:', args[0]);
      process.exit(1);
    }
    if (payload.resolve_error) {
      console.error('resolve_error:', payload.resolve_error);
      process.exit(1);
    }
    console.log(`\n# LOM invoke: ${payload.path}.${payload.method}`);
    if (payload.invoke_error) {
      console.log(`\n**invoke_error:** ${payload.invoke_error}\n`);
    } else {
      console.log('\n_invoke succeeded — checking observed deltas_\n');
    }
    if (payload.observed && payload.observed.length) {
      console.log('| attr | before | after | changed | error |');
      console.log('|------|--------|-------|---------|-------|');
      for (const o of payload.observed) {
        const before = (o.before || '').replace(/\|/g, '\\|');
        const after = (o.after || '').replace(/\|/g, '\\|');
        const ch = o.changed ? '✓' : '';
        const err = (o.error || '').replace(/\|/g, '\\|');
        console.log(`| \`${o.name}\` | ${before} | ${after} | ${ch} | ${err} |`);
      }
    }
    u.close();
    process.exit(payload.invoke_error ? 1 : 0);
  }
});

u.open();

setTimeout(() => {
  if (!gotReply) {
    console.error(`timeout — no reply on ${SURFACE_PORT}. Is the surface up?`);
    process.exit(1);
  }
}, 5000);
