#!/usr/bin/env node
// Where does a jump inside a playing Session clip land?
//
//   node owner/probes/clip_jump_probe_run.js tracks/<N>/slots/<M>/clip
//
// The question behind a bar-rearranging interface: when the surface calls
// `Clip.move_playing_pos(beats)` (or `Clip.scrub(beat)`) mid-bar, does the
// playhead move at once, or does Live hold the jump to the global launch
// quantization the way a click in the clip's scrub area does?
//
// For each run the driver sets `Song.clip_trigger_quantization`, waits until
// the song is a little past the middle of a bar, fires the jump through
// `/looping/probe/clip_jump_probe`, then reads back every discontinuity the
// clip's `playing_position` listener saw. A held jump lands on a bar line
// (or a quarter, at 1/4); an immediate one lands right where it was fired.
//
// It launches the clip if it is not playing (and stops it after), and puts
// the quantization back to the value it read at the start. Needs a surface
// that has the probe: a Live restart, or `{"kind":"reload"}` through
// lom_probe_driver.js and a re-select in Settings. Prints a summary table;
// the full replies go to logs/clip-jump-probe-<time>.json.
const fs = require('fs');
const pathLib = require('path');
const osc = require(pathLib.resolve(__dirname, '..', '..', 'node_modules', 'osc'));

const clipPath = process.argv[2];
if (!clipPath || !/^tracks\/\d+\/slots\/\d+\/clip$/.test(clipPath)) {
  console.error('usage: node clip_jump_probe_run.js tracks/<N>/slots/<M>/clip');
  process.exit(2);
}

const QUANT_NAMES = ['None', '8 Bars', '4 Bars', '2 Bars', '1 Bar', '1/2', '1/2T',
  '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
// [quantization, method]. Scrub last: it is the absolute-target alternative.
const RUNS = [[4, 'move'], [0, 'move'], [7, 'move'], [4, 'scrub'], [0, 'scrub']];

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
    out[a.name] = v === 'True' ? true : v === 'False' ? false : isNaN(parseFloat(v)) ? v : parseFloat(v);
  }
  return out;
}
const setSong = sets => req('/looping/probe/lom_set', ['song', JSON.stringify(sets), 0]);
const jumpProbe = (...args) => req('/looping/probe/clip_jump_probe', args);

async function main() {
  const song0 = await read('song', ['clip_trigger_quantization', 'signature_numerator',
    'signature_denominator', 'tempo', 'is_playing']);
  const clip0 = await read(clipPath, ['is_playing', 'loop_start', 'loop_end', 'looping', 'is_midi_clip']);
  const bar = song0.signature_numerator * 4 / song0.signature_denominator;
  const msPerBeat = 60000 / song0.tempo;
  const loopLen = clip0.loop_end - clip0.loop_start;
  console.log(`song: ${song0.signature_numerator}/${song0.signature_denominator} at ${song0.tempo} BPM, ` +
    `quantization ${QUANT_NAMES[song0.clip_trigger_quantization] || song0.clip_trigger_quantization}`);
  console.log(`clip: loop ${clip0.loop_start}–${clip0.loop_end} (${loopLen / bar} bars), ` +
    `${clip0.is_midi_clip ? 'MIDI' : 'audio'}, ${clip0.is_playing ? 'playing' : 'not playing'}`);
  if (loopLen < 2 * bar) throw new Error('the clip loop needs at least two bars');

  let launched = false;
  if (!clip0.is_playing) {
    await req('/looping/probe/lom_invoke', [clipPath, 'fire', '', '']);
    launched = true;
    for (let i = 0; i < 200; i++) {
      await sleep(50);
      if ((await read(clipPath, ['is_playing'])).is_playing) break;
    }
  }

  const results = [];
  try {
    for (const [quant, method] of RUNS) {
      await setSong([['clip_trigger_quantization', quant]]);
      await jumpProbe('stop');
      const started = await jumpProbe('start', clipPath);
      if (started.error) throw new Error('start: ' + started.error);
      // Fire a little past mid-bar, so "held to the bar line" and "at once"
      // are two beats apart (at 4/4) and a quarter grid falls between them.
      let st, pos;
      for (let i = 0; i < 2000; i++) {
        const s = await read('song', ['current_song_time']);
        st = s.current_song_time;
        const phase = ((st % bar) + bar) % bar;
        if (phase >= bar / 2 + 0.1 && phase <= bar / 2 + 0.4) break;
        await sleep(5);
      }
      pos = (await read(clipPath, ['playing_position'])).playing_position;
      const barInLoop = Math.floor((pos - clip0.loop_start) / bar);
      // move: one bar back, or forward from the loop's first bar.
      // scrub: the loop's first bar, or its second from the first.
      const value = method === 'move'
        ? (barInLoop === 0 ? bar : -bar)
        : clip0.loop_start + (barInLoop === 0 ? bar : 0);
      const fired = await jumpProbe('jump', method, value);
      if (method === 'scrub') { await sleep(60); await jumpProbe('stop_scrub'); }
      await sleep(2 * bar * msPerBeat + 300);
      const stats = await jumpProbe('stats');
      await jumpProbe('stop');
      results.push({ quant, method, value, fired, stats });
      await sleep(200);
    }
  } finally {
    await setSong([['clip_trigger_quantization', song0.clip_trigger_quantization]]);
    if (launched) await req('/looping/probe/lom_invoke', [clipPath, 'stop', '', '']);
    await jumpProbe('stop').catch(() => {});
  }

  console.log('\nquant   method  value  fired at (bar phase)  landed (song time, bar phase)      off bar line  after');
  for (const r of results) {
    const f = (r.stats.fires || [])[0] || {};
    const firedPhase = ((f.song_time % bar) + bar) % bar;
    // The first jump after the fire; wraps are the loop doing its job.
    const ev = (r.stats.events || []).find(e => e.kind === 'jump' && e.song_time_after >= f.song_time);
    const row = [
      (QUANT_NAMES[r.quant] || r.quant).padEnd(7),
      r.method.padEnd(6),
      String(r.value).padStart(6),
      `${f.song_time?.toFixed(3)} (${firedPhase.toFixed(3)})`.padEnd(21),
    ];
    if (f.error) row.push('call raised: ' + f.error);
    else if (!ev) row.push('no jump seen');
    else row.push(
      `${ev.song_time_before.toFixed(3)}–${ev.song_time_after.toFixed(3)} (${ev.bar_phase_after.toFixed(3)})`.padEnd(34),
      String(ev.from_bar_line).padStart(12),
      `${((ev.song_time_after - f.song_time) * msPerBeat).toFixed(0)} ms`.padStart(7),
    );
    console.log(row.join('  '));
  }
  const out = pathLib.resolve(__dirname, '..', '..', 'logs',
    `clip-jump-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(pathLib.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ clipPath, song0, clip0, results }, null, 2));
  console.log('\nfull replies: ' + pathLib.relative(process.cwd(), out));
}

u.on('ready', () => main().then(() => { u.close(); process.exit(0); },
  e => { console.error(e.message); u.close(); process.exit(1); }));
u.open();
