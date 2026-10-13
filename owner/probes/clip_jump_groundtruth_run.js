#!/usr/bin/env node
// Record jumps inside a playing audio clip, for clip_jump_audio.py to read.
//
//   node owner/probes/clip_jump_groundtruth_run.js <playerTrack> <recorderTrack> <out.json> [leadMs]
//
// Set up first (by hand or with lom_probe_driver.js): the player track holds
// the position sweep (`clip_jump_audio.py gen`) in slot 0, warped to the song;
// the recorder track takes the player's output as its input with monitoring
// off. This script arms the recorder, launches the sweep, queues the take
// (switching the global quantization to 1/16 and back while it waits, to see
// whether a queued recording keeps its bar line), then fires:
//
//   move       6 relative jumps of a bar at random points
//   move-aim   6 relative jumps fired ~205 ms ahead of a 1/16 line
//   tap16      6 tap-scrubs (global 1/16, scrub, release, global back) to a
//              whole bar away, aimed at a 1/16 line
//   tap16-sub  3 tap-scrubs to a position a bar and a quarter away
//
// and stops the take. It writes the fire times and the take's file path to
// <out.json>; the analysis is `clip_jump_audio.py analyze <take> <out.json>`.
const fs = require('fs');
const pathLib = require('path');
const osc = require(pathLib.resolve(__dirname, '..', '..', 'node_modules', 'osc'));

const [playerTrack, recTrack, outPath] = process.argv.slice(2);
if (!/^tracks\/\d+$/.test(playerTrack || '') || !/^tracks\/\d+$/.test(recTrack || '') || !outPath) {
  console.error('usage: node clip_jump_groundtruth_run.js tracks/<P> tracks/<R> <out.json>');
  process.exit(2);
}
const clipPath = playerTrack + '/slots/0/clip';
const SONG_Q = ['q_no_q', 'q_8_bars', 'q_4_bars', 'q_2_bars', 'q_bar', 'q_half',
  'q_half_triplet', 'q_quarter', 'q_quarter_triplet', 'q_eight', 'q_eight_triplet',
  'q_sixtenth', 'q_sixtenth_triplet', 'q_thirtytwoth'];
// How long before a jump's grid line to call it: audio clips act on a jump
// ~205 ms after the call (measured), MIDI clips sooner. The 4th argument
// overrides it.
const LEAD_MS = Number(process.argv[5] || 205);

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
    u.send({ address, args: args.map(v => typeof v === 'number'
      ? (Number.isInteger(v) ? { type: 'i', value: v } : { type: 'f', value: v })
      : { type: 's', value: String(v) }) });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function read(path, attrs) {
  const r = await req('/looping/probe/lom_introspect', [path, attrs.join(','), '']);
  if (r.resolve_error) throw new Error(path + ': ' + r.resolve_error);
  const out = {};
  for (const a of r.attrs || []) {
    if (a.error) throw new Error(path + '.' + a.name + ': ' + a.error);
    const v = a.value_repr;
    out[a.name] = v === 'True' ? true : v === 'False' ? false : isNaN(parseFloat(v)) ? v.replace(/^'|'$/g, '') : parseFloat(v);
  }
  return out;
}
async function set(path, sets) {
  const r = await req('/looping/probe/lom_set', [path, JSON.stringify(sets), 0]);
  for (const w of r.writes || []) if (w.error) throw new Error(`${path}.${w.chain}: ${w.error}`);
  if (r.resolve_error) throw new Error(path + ': ' + r.resolve_error);
}
const invoke = (path, method) => req('/looping/probe/lom_invoke', [path, method, '', '']);
const probe = (...args) => req('/looping/probe/clip_jump_probe', args);
const songTime = async () => (await read('song', ['current_song_time'])).current_song_time;

async function main() {
  const song = await read('song', ['tempo', 'signature_numerator', 'signature_denominator', 'clip_trigger_quantization']);
  const clip = await read(clipPath, ['loop_start', 'loop_end']);
  const bar = song.signature_numerator * 4 / song.signature_denominator;
  const spb = 60000 / song.tempo; // ms per beat
  const loopLen = clip.loop_end - clip.loop_start;
  const baseQ = SONG_Q.indexOf(String(song.clip_trigger_quantization).split('.').pop());
  if (baseQ < 0) throw new Error('quantization ' + song.clip_trigger_quantization);
  const fires = [];
  const run = { tempo: song.tempo, bar, loop_len: loopLen, base_quantization: baseQ, fires };

  // Wait until song time reaches t (polling; each read is a round trip).
  async function until(t) {
    for (;;) {
      const st = await songTime();
      if (st >= t) return st;
      const left = (t - st) * spb;
      await sleep(left > 40 ? Math.min(left - 25, 200) : 1);
    }
  }
  const natural = (st) => clip.loop_start + ((st - run.clip_start_song_time) % loopLen + loopLen) % loopLen;

  try {
    await set(recTrack, [['arm', true]]);
    // Launch the sweep, and take where it started from its own position.
    await invoke(clipPath, 'fire');
    for (let i = 0; i < 200 && !(await read(clipPath, ['is_playing'])).is_playing; i++) await sleep(20);
    await sleep(300);
    {
      const st = await songTime();
      const pos = (await read(clipPath, ['playing_position'])).playing_position;
      run.clip_start_song_time = Math.round((st - (pos - clip.loop_start)) / bar) * bar;
    }
    await probe('stop');
    await probe('start', clipPath);

    // Queue the take mid-bar; switch the global quantization while it waits.
    let st = await songTime();
    st = await until(Math.floor(st / bar) * bar + bar + 1);
    await invoke(recTrack, 'clip_slots[0].fire');
    run.record_queued_song_time = await songTime();
    await sleep(0.3 * spb);
    run.switch_while_queued = { at: await songTime() };
    await set('song', [['clip_trigger_quantization', 11]]);
    await set('song', [['clip_trigger_quantization', baseQ]]);
    run.switch_while_queued.until = await songTime();
    run.record_start_song_time = Math.ceil(run.record_queued_song_time / bar) * bar;
    await until(run.record_start_song_time + 2 * bar);

    // move: a bar back or on, at random points of the bar.
    for (let i = 0; i < 6; i++) {
      st = await songTime();
      const t = Math.floor(st / bar) * bar + bar + 0.4 + Math.random() * (bar - 1.4);
      await until(t);
      const nowPos = natural(await songTime());
      const delta = (nowPos - clip.loop_start) < bar ? bar : -bar;
      const f = (await probe('jump', 'move', delta)).fire;
      fires.push({ kind: 'move', song_time: f.song_time, expected_step: delta });
      run.clip_start_song_time -= delta; // the clip now runs `delta` ahead
      await sleep(bar * spb);
    }
    // move-aim: fire LEAD_MS ahead of a 1/16 line a beat or so off.
    for (let i = 0; i < 6; i++) {
      st = await songTime();
      const aim = Math.ceil((st + 1.5 + Math.random()) * 4) / 4;
      const fireAt = aim - LEAD_MS / spb;
      await until(fireAt);
      const nowPos = natural(aim);
      const delta = (nowPos - clip.loop_start) < bar ? bar : -bar;
      const f = (await probe('jump', 'move', delta)).fire;
      fires.push({ kind: 'move-aim', song_time: f.song_time, aim, expected_step: delta });
      run.clip_start_song_time -= delta;
      await sleep(bar * spb);
    }
    // tap16: global 1/16, scrub, release, global back; called so the first
    // 1/16 line LEAD_MS on is the aim (half a grid of margin each side).
    const tap = async (kind, stepBeats) => {
      const st0 = await songTime();
      const aim = Math.ceil((st0 + 1.5 + Math.random()) * 4) / 4;
      const fireAt = aim - LEAD_MS / spb - 0.125;
      await until(fireAt);
      const target = natural(aim) + stepBeats;
      const tgt = clip.loop_start + ((target - clip.loop_start) % loopLen + loopLen) % loopLen;
      await set('song', [['clip_trigger_quantization', 11]]);
      const f = (await probe('jump', 'scrub', tgt)).fire;
      await probe('stop_scrub');
      await set('song', [['clip_trigger_quantization', baseQ]]);
      fires.push({ kind, song_time: f.song_time, aim, target: tgt, expected_step: stepBeats });
      run.clip_start_song_time -= stepBeats;
      await sleep(bar * spb);
    };
    for (let i = 0; i < 6; i++) await tap('tap16', i % 2 ? bar : -bar);
    for (let i = 0; i < 3; i++) await tap('tap16-sub', bar + 1.25);

    // Stop the take on the next bar line, then the sweep.
    st = await songTime();
    await until(Math.ceil(st / bar) * bar + 0.5);
    await invoke(recTrack, 'clip_slots[0].stop');
    await sleep(bar * spb + 300);
    await invoke(clipPath, 'stop');
    // The listener's own record of the run, when it fits one datagram (a
    // long run's does not; the audio is the record that matters here).
    run.listener = await probe('stats').catch(e => ({ error: e.message }));
  } finally {
    fs.writeFileSync(outPath, JSON.stringify(run, null, 2));
    await set('song', [['clip_trigger_quantization', baseQ]]).catch(() => {});
    await set(recTrack, [['arm', false]]).catch(() => {});
    await probe('stop').catch(() => {});
  }
  fs.writeFileSync(outPath, JSON.stringify(run, null, 2));
  const take = await read(recTrack + '/slots/0/clip', ['file_path', 'loop_start', 'loop_end', 'start_marker', 'is_recording']);
  run.take = take;
  run.record_end_song_time = run.record_start_song_time + take.loop_end;
  fs.writeFileSync(outPath, JSON.stringify(run, null, 2));
  console.log(`take: ${take.file_path} (${take.loop_end} beats)`);
  console.log(`queued at ${run.record_queued_song_time.toFixed(3)}, quantization switched ` +
    `${run.switch_while_queued.at.toFixed(3)}–${run.switch_while_queued.until.toFixed(3)}; take expected to start ${run.record_start_song_time}`);
  console.log(`${fires.length} fires; run file ${outPath}`);
}

u.on('ready', () => main().then(() => { u.close(); process.exit(0); },
  e => { console.error(e.stack || e.message); u.close(); process.exit(1); }));
u.open();
