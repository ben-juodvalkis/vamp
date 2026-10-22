#!/usr/bin/env node
// Render Wavetable's own wavetables as audio, for wavetable_render_audio.py
// to cut into single cycles.
//
//   node owner/probes/wavetable_render_run.js tables <out.json> [category …]
//   node owner/probes/wavetable_render_run.js calib  <out.json>
//
// Live's API names a Wavetable's tables but never hands over their samples,
// and the factory tables live in Live's encrypted resources. So this plays
// them: it appends two tracks to the open set — a MIDI track holding a fresh
// Wavetable and an audio track recording it — plays one sustained note per
// table and steps Wave Position across FRAMES frames while it sounds, then
// deletes both tracks. Nothing already in the set is touched; the song tempo
// is set to 120 for the run and put back.
//
// `tables` renders every table of the named categories (all eleven factory
// ones by default; the User category is skipped). `calib` renders Effect 1
// and Effect 2 sweeps for every effect mode on the sine, saw and square
// frames of Basics / Basic Shapes, the ground truth for the effect transforms.
//
// What colours the sound is neutralised: effect mode None, unison None, mono,
// Osc 2 and Sub off, both filters off, amp attack and release at their
// minimum and sustain full, both LFO amounts and the Global Mod Amount at 0.
// What can't be reached: the mod matrix itself (Live exposes only its target
// names). Global Mod Amount scales every matrix row, so at 0 the default
// matrix rows move nothing.
//
// The run file records, for each table, the song time of every Wave Position
// write relative to the note-on; the audio analysis finds each note-on in
// the take and cuts frame j between write j and write j+1. Osc 1 Gain stays
// at 0 outside the scheduled notes, so the take's first onset is the first
// table.
const fs = require('fs');
const pathLib = require('path');
const osc = require(pathLib.resolve(__dirname, '..', '..', 'node_modules', 'osc'));

const [mode, outPath, ...cats] = process.argv.slice(2);
if (!['tables', 'calib'].includes(mode) || !outPath) {
  console.error('usage: node wavetable_render_run.js tables|calib <out.json> [category …]');
  process.exit(2);
}

const TEMPO = 120;
const NOTE = 42; // F#1, 92.4986 Hz at A440: low enough that Wavetable keeps the harmonics
const FRAMES = 25; // Wave Position 0, 1/24 … 1
const STEP = 0.32; // beats per frame (160 ms at 120 BPM)
const NOTE_LEN = FRAMES * STEP + 0.1;
const LOOP = NOTE_LEN + 1.4; // the rest between notes, where the next table is set
const CALIB_E1 = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const CALIB_E2 = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];

const P = { osc1On: 1, transp: 2, detune: 3, pos: 4, e1: 5, e2: 6, pan: 7, gain: 8, osc2On: 9, subOn: 17,
  flt1On: 21, flt2On: 30, ampA: 39, ampD: 40, ampR: 41, ampS: 45, ampLoop: 46, lfo1Amt: 71, lfo2Amt: 80,
  globalMod: 88, unisonAmt: 89, transpose: 90, glide: 91, volume: 92 };
const prm = (i) => `parameters[${i}].value`;

const u = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, remoteAddress: '127.0.0.1', remotePort: 11020 });
let pending = null;
u.on('message', m => {
  if (!m.address.startsWith('/looping/probe/') || !pending) return;
  const a = (m.args || []).map(x => (x && typeof x === 'object' && 'value' in x) ? x.value : x);
  let p; try { p = JSON.parse(a[0]); } catch (e) { p = { raw: a[0] }; }
  const { resolve, timer } = pending; pending = null; clearTimeout(timer); resolve(p);
});
function req(address, args) {
  return new Promise((resolve, reject) => {
    pending = { resolve, timer: setTimeout(() => { pending = null; reject(new Error('timeout ' + address)); }, 4000) };
    u.send({ address, args });
  });
}
const S = (v) => ({ type: 's', value: String(v) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const unq = (v) => v.replace(/^'|'$/g, '');
async function read(path, attrs) {
  const r = await req('/looping/probe/lom_introspect', [S(path), S(attrs.join(',')), S('')]);
  if (r.resolve_error) throw new Error(path + ': ' + r.resolve_error);
  const out = {};
  for (const a of r.attrs || []) {
    if (a.error) throw new Error(path + '.' + a.name + ': ' + a.error);
    const v = a.value_repr;
    out[a.name] = v === 'True' ? true : v === 'False' ? false : isNaN(parseFloat(v)) ? unq(v) : parseFloat(v);
  }
  return out;
}
async function set(path, sets) {
  const r = await req('/looping/probe/lom_set', [S(path), S(JSON.stringify(sets)), { type: 'i', value: 0 }]);
  if (r.resolve_error) throw new Error(path + ': ' + r.resolve_error);
  for (const w of r.writes || []) if (w.error) throw new Error(`${path}.${w.chain}: ${w.error}`);
}
async function invoke(path, method, args) {
  const r = await req('/looping/probe/lom_invoke', [S(path), S(method), S(''), S(args ? JSON.stringify(args) : '')]);
  if (r.resolve_error || r.invoke_error) throw new Error(`${path}.${method}: ${r.resolve_error || r.invoke_error}`);
  return r;
}
const songTime = async () => (await read('song', ['current_song_time'])).current_song_time;
async function until(t) {
  for (;;) {
    const now = await songTime();
    if (now >= t) return now;
    const ms = (t - now) * 60000 / TEMPO;
    await sleep(ms > 30 ? ms - 20 : 1);
  }
}
async function names(path, attr, max = 120, suffix = '') {
  const out = [];
  for (let start = 0; start < max; start += 20) {
    const r = await req('/looping/probe/lom_introspect', [S(path),
      S(Array.from({ length: 20 }, (_, i) => `${attr}[${start + i}]${suffix}`).join(',')), S('')]);
    const got = (r.attrs || []).filter(a => !a.error).map(a => unq(a.value_repr));
    out.push(...got);
    if (got.length < 20) break;
  }
  return out;
}

// The note goes in through the surface's own clip/notes/add (the probe's
// invoke hands a list where Clip.set_notes wants a tuple).
function addNote(clipPath, pitch, start, dur) {
  const b = Buffer.alloc(24);
  b.writeInt32LE(-1, 0); b.writeFloatLE(pitch, 4); b.writeFloatLE(start, 8);
  b.writeFloatLE(dur, 12); b.writeFloatLE(127, 16); b.writeInt32LE(0, 20);
  u.send({ address: '/looping/v3/clip/notes/add', args: [S('wt-render'), S(clipPath), { type: 'b', value: b }] });
}

async function segmentsFor(dev) {
  const segs = [];
  const positions = Array.from({ length: FRAMES }, (_, j) => j / (FRAMES - 1));
  if (mode === 'tables') {
    const all = await names(dev, 'oscillator_wavetable_categories', 40);
    const want = cats.length ? cats : all.filter(c => c !== 'User');
    for (const cat of want) {
      const ci = all.indexOf(cat);
      if (ci < 0) throw new Error('no category ' + cat + ' (have ' + all.join(', ') + ')');
      await set(dev, [['oscillator_1_wavetable_category', ci]]);
      const tables = await names(dev, 'oscillator_1_wavetables');
      tables.forEach((name, ti) => segs.push({
        category: cat, table: name, kind: 'frames',
        pre: [['oscillator_1_wavetable_category', ci], ['oscillator_1_wavetable_index', ti]],
        frames: positions.map(p => ({ pos: p, sets: [[prm(P.pos), p]] })),
      }));
    }
  } else {
    // Basics / Basic Shapes, measured by the tables run (its harmonics
    // against the ideal shapes'): a sine at 0, a triangle at 1/3, a saw at
    // 2/3, a square at 1.
    const sources = [{ shape: 'sine', pos: 0 }, { shape: 'saw', pos: 2 / 3 }, { shape: 'square', pos: 1 }];
    for (const src of sources) {
      for (const [modeName, modeIdx] of [['none', 0], ['frequency_modulation', 1], ['sync_and_pulse_width', 2], ['warp_and_fold', 3]]) {
        const base = [['oscillator_1_wavetable_category', 0], ['oscillator_1_wavetable_index', 0], [prm(P.pos), src.pos], ['oscillator_1_effect_mode', modeIdx]];
        segs.push({ category: 'Basics', table: 'Basic Shapes', kind: 'effect1', shape: src.shape, mode: modeName, modeIndex: modeIdx, pos: src.pos,
          pre: [...base, [prm(P.e2), 0], [prm(P.e1), CALIB_E1[0]]],
          frames: CALIB_E1.map(v => ({ e1: v, e2: 0, sets: [[prm(P.e1), v]] })) });
        segs.push({ category: 'Basics', table: 'Basic Shapes', kind: 'effect2', shape: src.shape, mode: modeName, modeIndex: modeIdx, pos: src.pos,
          pre: [...base, [prm(P.e1), 0.5], [prm(P.e2), CALIB_E2[0]]],
          frames: CALIB_E2.map(v => ({ e1: 0.5, e2: v, sets: [[prm(P.e2), v]] })) });
      }
    }
  }
  // Frame 0's writes ride the pre-note writes; the rest land on the beat grid.
  for (const s of segs) s.pre.push(...s.frames[0].sets);
  return segs;
}

async function main() {
  const song0 = await read('song', ['tempo', 'is_playing', 'clip_trigger_quantization']);
  if (song0.is_playing) throw new Error('stop the transport first');
  const nTracks = (await read('song', ['tracks.*name']))['tracks.*name'];
  const base = (nTracks.match(/'[^']*'/g) || []).length;
  const midiT = `tracks/${base}`, recT = `tracks/${base + 1}`, dev = `${midiT}/devices/0`;
  const clipPath = `${midiT}/slots/0/clip`;
  const run = { mode, tempo: TEMPO, note: NOTE, frames: FRAMES, step: STEP, note_len: NOTE_LEN, loop: LOOP, segments: [] };
  let created = 0;
  try {
    await set('song', [['tempo', TEMPO]]);
    await invoke('song', 'create_midi_track', [-1]); created++;
    await invoke(midiT, 'insert_device', ['Wavetable']);
    await invoke('song', 'create_audio_track', [-1]); created++;
    const outs = await names(midiT, 'available_output_routing_types', 40, '.display_name');
    await set(midiT, [['name', 'WT Render'], ['output_routing_type', { $ref: `available_output_routing_types[${outs.indexOf('Sends Only')}]` }]]);
    const outName = (await read(midiT, ['output_routing_type.display_name']))['output_routing_type.display_name'];
    if (outName !== 'Sends Only') throw new Error('MIDI track output is ' + outName + ', expected Sends Only');
    const ins = await names(recT, 'available_input_routing_types', 40, '.display_name');
    const k = ins.indexOf('WT Render');
    if (k < 0) throw new Error('recorder cannot see WT Render: ' + ins.join(', '));
    await set(recT, [['name', 'WT Take'], ['input_routing_type', { $ref: `available_input_routing_types[${k}]` }]]);
    const chans = await names(recT, 'available_input_routing_channels', 40, '.display_name');
    await set(recT, [['input_routing_channel', { $ref: `available_input_routing_channels[${chans.indexOf('Post FX')}]` }],
      ['current_monitoring_state', 2]]);

    await set(dev, [
      ['oscillator_1_effect_mode', 0], ['oscillator_2_effect_mode', 0], ['unison_mode', 0], ['mono_poly', 0],
      [prm(P.osc1On), 1], [prm(P.transp), 0], [prm(P.detune), 0.5], [prm(P.e1), 0.5], [prm(P.e2), 0], [prm(P.pan), 0.5],
      [prm(P.gain), 0], [prm(P.osc2On), 0], [prm(P.subOn), 0], [prm(P.flt1On), 0], [prm(P.flt2On), 0],
      [prm(P.ampA), 0], [prm(P.ampS), 1], [prm(P.ampR), 0], [prm(P.ampLoop), 0], [prm(P.lfo1Amt), 0], [prm(P.lfo2Amt), 0],
      [prm(P.globalMod), 0], [prm(P.unisonAmt), 0], [prm(P.transpose), 0], [prm(P.glide), 0], [prm(P.volume), 0.5],
    ]);
    run.neutral = await read(dev, ['oscillator_1_effect_mode', 'unison_mode', 'mono_poly', ...Object.values(P).map(prm)]);

    await invoke(midiT, 'clip_slots[0].create_clip', [LOOP]);
    addNote(clipPath, NOTE, 0, NOTE_LEN);
    await sleep(300);
    const notes = await read(clipPath, ['length']);
    if (notes.length !== LOOP) throw new Error('clip length ' + notes.length);

    const segs = await segmentsFor(dev);
    console.log(`${segs.length} segments, ~${(segs.length * LOOP * 60 / TEMPO / 60).toFixed(1)} min`);

    await set(recT, [['arm', true]]);
    await invoke(recT, 'clip_slots[0].fire');
    await invoke(clipPath, 'fire');
    let playing = false;
    for (let i = 0; i < 200 && !playing; i++) { await sleep(25); playing = (await read(clipPath, ['is_playing'])).is_playing; }
    if (!playing) throw new Error('note clip never started');
    const ph = await read(clipPath, ['playing_position']);
    const now = await songTime();
    let start = now - ph.playing_position + LOOP; // the next note-on
    while (start - now < 0.6) start += LOOP;

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      await until(start - 0.7);
      const pre = i === 0 ? [...seg.pre, [prm(P.gain), 1]] : seg.pre;
      await set(dev, pre);
      const got = await read(dev, ['oscillator_1_wavetable_category', 'oscillator_1_wavetable_index', 'oscillator_1_effect_mode']);
      const rec = { ...seg, note_on: start, writes: [0], checked: got };
      delete rec.pre;
      for (let j = 1; j < seg.frames.length; j++) {
        await until(start + j * STEP);
        await set(dev, seg.frames[j].sets);
        rec.writes.push(+((await songTime()) - start).toFixed(4));
      }
      rec.frames = seg.frames.map(f => { const { sets, ...rest } = f; return rest; });
      run.segments.push(rec);
      process.stdout.write(`\r${i + 1}/${segs.length} ${seg.category} / ${seg.table}${seg.mode ? ' ' + seg.mode + ' ' + seg.kind + ' ' + seg.shape : ''}      `);
      start += LOOP;
    }
    await until(start - LOOP + NOTE_LEN + 0.2);
    await set(dev, [[prm(P.gain), 0]]);
    await sleep(300);
    await invoke(recT, 'clip_slots[0].stop');
    await invoke(clipPath, 'stop');
    await sleep(800);
    await invoke('song', 'stop_playing');
    await set(recT, [['arm', false]]);
    await sleep(1500);
    const take = await read(`${recT}/slots/0/clip`, ['file_path', 'length']);
    run.file_path = take.file_path;
    // The take lives in Live's temp folder for an unsaved set; keep a copy.
    run.copy = outPath.replace(/\.json$/, '') + pathLib.extname(take.file_path);
    fs.copyFileSync(take.file_path, run.copy);
    console.log(`\ntake: ${take.file_path} → ${run.copy}`);
  } finally {
    await invoke('song', 'stop_playing').catch(() => {});
    if (created >= 2) await invoke('song', 'delete_track', [base + 1]).catch(e => console.error(e.message));
    if (created >= 1) await invoke('song', 'delete_track', [base]).catch(e => console.error(e.message));
    await set('song', [['tempo', song0.tempo]]).catch(() => {});
    fs.writeFileSync(outPath, JSON.stringify(run, null, 1));
    console.log(`run file ${outPath}`);
    u.close();
  }
}
u.on('ready', () => main().then(() => process.exit(0), e => { console.error('\n' + e.stack); process.exit(1); }));
u.open();
