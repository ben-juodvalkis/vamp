#!/usr/bin/env node
// Follow-up experiments on jumps inside a playing Session clip, through
// `/looping/probe/clip_jump_probe` (clip_jump_probe_run.js has the first one).
//
//   node owner/probes/clip_jump_research_run.js tracks/<N>/slots/<M>/clip <experiment>
//
// Experiments:
//   latency   move_playing_pos fired at random points of a bar, several times
//             at each of three tempos and three warp modes: how long after the
//             call the playhead moves, in ms and in beats.
//   clipquant scrub with the clip's own launch quantization at 1/4 while the
//             global one is 1 Bar: which one decides where it lands.
//   finequant scrub with the global quantization at 1/4 and 1/16, released
//             at several delays after it lands: where it lands and whether it
//             repeats its segment before the release takes.
//   swapquant global quantization switched to a finer value just for the scrub
//             call and straight back: is the value read at the call or at the
//             landing, and which one sets the length a held scrub repeats.
//   tapscrub  the fine quantization set, a scrub and its release sent back to
//             back, the quantization put back: one jump onto the grid, or
//             none, or a repeat? Three times each at 1/16, 1/4 and 1 Bar.
//   pending   a relaunch of the clip queued for the next bar line, then the
//             global quantization switched to 1/16 and back while it waits:
//             does the queued launch keep the bar line? Without and with a
//             tap-scrub, at several points of the wait.
//   edges     move_playing_pos across the loop's start and end.
//
// Every value it changes (tempo, global and clip quantization, warp mode) is
// read first and written back from that read. Full replies go to
// logs/clip-jump-research-<experiment>-<time>.json.
const fs = require('fs');
const pathLib = require('path');
const osc = require(pathLib.resolve(__dirname, '..', '..', 'node_modules', 'osc'));

const [clipPath, experiment] = process.argv.slice(2);
const EXPERIMENTS = ['latency', 'clipquant', 'finequant', 'swapquant', 'tapscrub', 'pending', 'edges'];
if (!/^tracks\/\d+\/slots\/\d+\/clip$/.test(clipPath || '') || !EXPERIMENTS.includes(experiment)) {
  console.error('usage: node clip_jump_research_run.js tracks/<N>/slots/<M>/clip ' + EXPERIMENTS.join('|'));
  process.exit(2);
}

// Live.Song.Quantization and Live.Clip.ClipLaunchQuantization, read off the
// running Live with py_introspect.
const SONG_Q = ['q_no_q', 'q_8_bars', 'q_4_bars', 'q_2_bars', 'q_bar', 'q_half',
  'q_half_triplet', 'q_quarter', 'q_quarter_triplet', 'q_eight', 'q_eight_triplet',
  'q_sixtenth', 'q_sixtenth_triplet', 'q_thirtytwoth'];
const CLIP_Q = ['q_global', 'q_none', 'q_8_bars', 'q_4_bars', 'q_2_bars', 'q_bar', 'q_half',
  'q_half_triplet', 'q_quarter', 'q_quarter_triplet', 'q_eighth', 'q_eighth_triplet',
  'q_sixteenth', 'q_sixteenth_triplet', 'q_thirtysecond'];
const enumIndex = (table, v) => typeof v === 'number' ? v : table.indexOf(String(v).split('.').pop());

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
async function set(path, sets) {
  const r = await req('/looping/probe/lom_set', [path, JSON.stringify(sets), 0]);
  for (const w of r.writes || []) if (w.error) throw new Error(`${path}.${w.chain}: ${w.error}`);
  if (r.resolve_error) throw new Error(path + ': ' + r.resolve_error);
  return r;
}
const probe = (...args) => req('/looping/probe/clip_jump_probe', args);

let song, clip, bar, loopLen;
const msPerBeat = () => 60000 / song.tempo;
const phaseOf = st => ((st % bar) + bar) % bar;
async function songTime() { return (await read('song', ['current_song_time'])).current_song_time; }
// Wait until the song's position in the bar is inside [lo, hi).
async function waitPhase(lo, hi) {
  for (let i = 0; i < 4000; i++) {
    const st = await songTime();
    const ph = phaseOf(st);
    if (ph >= lo && ph < hi) return st;
    await sleep(3);
  }
  throw new Error('song never reached bar phase ' + lo);
}
// The first jump the listener saw at or after song time `from`.
const firstJump = (stats, from) => (stats.events || []).find(e => e.kind === 'jump' && e.song_time_after >= from);
const r3 = x => Math.round(x * 1000) / 1000;
function summary(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, mean: r3(mean), min: r3(s[0]), max: r3(s[s.length - 1]) };
}

// --- experiments -------------------------------------------------------------

async function latencyTrials(label, n) {
  await probe('stop');
  await probe('start', clipPath);
  const trials = [];
  for (let i = 0; i < n; i++) {
    // A random point in the bar, clear of the bar line so a whole-bar move
    // never crosses the loop's edge during the delay.
    const lo = 0.3 + Math.random() * (bar - 1.6);
    await waitPhase(lo, lo + 0.2);
    const pos = (await read(clipPath, ['playing_position'])).playing_position;
    const barInLoop = Math.floor((pos - clip.loop_start) / bar);
    const delta = barInLoop === 0 ? bar : -bar;
    const f = (await probe('jump', 'move', delta)).fire;
    await sleep(Math.max(600, 1.5 * msPerBeat()));
    trials.push(f);
  }
  const stats = await probe('stats');
  await probe('stop');
  const lags = [];
  for (const f of trials) {
    const ev = firstJump(stats, f.song_time);
    if (!ev) { lags.push(null); continue; }
    lags.push({
      // The jump fell between the last sample before and the first after.
      ms_lo: (ev.t_before - f.t) * 1000, ms_hi: (ev.t_after - f.t) * 1000,
      beats_hi: ev.song_time_after - f.song_time,
      step: ev.step_beats, expected_step: f.value,
    });
  }
  const seen = lags.filter(Boolean);
  const row = {
    label, tempo: song.tempo, missed: lags.length - seen.length,
    ms_after_lo: seen.length ? summary(seen.map(l => l.ms_lo)) : null,
    ms_after_hi: seen.length ? summary(seen.map(l => l.ms_hi)) : null,
    beats_after: seen.length ? summary(seen.map(l => l.beats_hi)) : null,
    step_exact: seen.every(l => Math.abs(l.step - l.expected_step) < 0.002),
  };
  console.log(`${label.padEnd(24)} n=${seen.length}/${lags.length}  moved ${row.ms_after_lo.mean}–${row.ms_after_hi.mean} ms after ` +
    `(latest seen ${row.ms_after_hi.min}–${row.ms_after_hi.max})  = ${row.beats_after.mean} beats  step exact: ${row.step_exact}`);
  return { row, trials, stats };
}

async function latency() {
  const out = [];
  const base = { tempo: song.tempo, warp: clip.warp_mode };
  const warpable = clip.is_audio_clip && clip.warping;
  try {
    for (const tempo of [base.tempo, 120, 90]) {
      await set('song', [['tempo', tempo]]);
      song.tempo = tempo;
      await sleep(300);
      out.push(await latencyTrials(`tempo ${tempo}`, 6));
    }
    await set('song', [['tempo', base.tempo]]);
    song.tempo = base.tempo;
    if (warpable) {
      for (const [mode, name] of [[4, 'complex'], [3, 'repitch'], [1, 'tones']]) {
        await set(clipPath, [['warp_mode', mode]]);
        await sleep(300);
        out.push(await latencyTrials(`warp ${name} @${base.tempo}`, 6));
      }
    }
  } finally {
    await set('song', [['tempo', base.tempo]]);
    if (warpable) await set(clipPath, [['warp_mode', base.warp]]);
    const now = { song: await read('song', ['tempo']), clip: await read(clipPath, ['warp_mode']) };
    console.log(`restored: tempo ${now.song.tempo}, warp_mode ${now.clip.warp_mode}`);
  }
  return out;
}

// Fire one scrub mid-bar, hold it `holdBeats` past the fire, release, then
// report the jumps the listener saw from the fire on.
async function scrubOnce(label, target, holdBeats, swap) {
  await probe('stop');
  await probe('start', clipPath);
  const st = await waitPhase(bar / 2 + 0.1, bar / 2 + 0.3);
  // swap: [fine, normal] global quantization, set around the call alone.
  let t0;
  if (swap) { t0 = Date.now(); await set('song', [['clip_trigger_quantization', swap[0]]]); }
  const f = (await probe('jump', 'scrub', target)).fire;
  if (swap) {
    await set('song', [['clip_trigger_quantization', swap[1]]]);
    f.swapped_for_ms = Date.now() - t0;
  }
  await sleep(holdBeats * msPerBeat());
  const rel = (await probe('stop_scrub')).fire;
  await sleep(1.5 * bar * msPerBeat());
  const stats = await probe('stats');
  await probe('stop');
  const jumps = (stats.events || []).filter(e => e.kind === 'jump' && e.song_time_after >= f.song_time);
  console.log(`${label}: fired at bar phase ${r3(phaseOf(f.song_time))}, released ${r3(rel.song_time - f.song_time)} beats later` +
    (swap ? `, fine quantization held ${f.swapped_for_ms} ms` : ''));
  for (const e of jumps.slice(0, 12)) {
    console.log(`    jump ${String(e.step_beats).padStart(8)}  at song ${e.song_time_before}–${e.song_time_after} ` +
      `(phase ${e.bar_phase_after}, ${e.from_bar_line} off a bar line)  pos ${e.pos_before} → ${e.pos_after}` +
      `${e.song_time_after > rel.song_time ? '  [after release]' : ''}`);
  }
  if (jumps.length > 12) console.log(`    … ${jumps.length - 12} more`);
  if (!jumps.length) console.log('    no jump');
  return { label, fire: f, release: rel, jumps, stats };
}

async function clipquant() {
  const base = { song_q: enumIndex(SONG_Q, song.clip_trigger_quantization), clip_q: enumIndex(CLIP_Q, clip.launch_quantization) };
  const out = [];
  try {
    await set('song', [['clip_trigger_quantization', 4]]); // 1 Bar
    await set(clipPath, [['launch_quantization', 8]]); // 1/4
    // Hold past the next bar line: a 1/4 landing comes first if the clip's
    // own quantization counts, the bar line if only the global one does.
    out.push(await scrubOnce('global 1 Bar, clip 1/4', clip.loop_start, bar / 2 + 1));
    await set(clipPath, [['launch_quantization', 1]]); // None
    out.push(await scrubOnce('global 1 Bar, clip None', clip.loop_start, bar / 2 + 1));
  } finally {
    await set('song', [['clip_trigger_quantization', base.song_q]]);
    await set(clipPath, [['launch_quantization', base.clip_q]]);
    const s = await read('song', ['clip_trigger_quantization']);
    const c = await read(clipPath, ['launch_quantization']);
    console.log(`restored: global ${s.clip_trigger_quantization}, clip ${c.launch_quantization}`);
  }
  return out;
}

async function finequant() {
  const base = enumIndex(SONG_Q, song.clip_trigger_quantization);
  const out = [];
  try {
    for (const [q, name, grid] of [[7, '1/4', 1], [11, '1/16', 0.25]]) {
      await set('song', [['clip_trigger_quantization', q]]);
      // Held for a short and a long time after the next grid line: does a
      // release stop the segment repeating, and how soon does it take?
      for (const extra of [0.1, 1, 2.5]) {
        out.push(await scrubOnce(`global ${name}, held ${extra} beat past the next ${name}`,
          clip.loop_start + bar, grid + extra));
      }
    }
  } finally {
    await set('song', [['clip_trigger_quantization', base]]);
    console.log(`restored: global ${(await read('song', ['clip_trigger_quantization'])).clip_trigger_quantization}`);
  }
  return out;
}

async function swapquant() {
  const base = enumIndex(SONG_Q, song.clip_trigger_quantization);
  const out = [];
  try {
    // 1/16 only for the call; 1 Bar otherwise. Landing on a 1/16 line well
    // short of the bar line means the value is read at the call.
    for (const hold of [1, 2.5]) {
      out.push(await scrubOnce(`1/16 around the call, 1 Bar after; held ${hold} beats`,
        clip.loop_start + bar, hold, [11, 4]));
    }
    // And with the bar left at 1/4 rather than 1 Bar, for the repeat length.
    out.push(await scrubOnce('1/16 around the call, 1/4 after; held 2.5 beats',
      clip.loop_start + bar, 2.5, [11, 7]));
  } finally {
    await set('song', [['clip_trigger_quantization', base]]);
    console.log(`restored: global ${(await read('song', ['clip_trigger_quantization'])).clip_trigger_quantization}`);
  }
  return out;
}

async function tapscrub() {
  const base = enumIndex(SONG_Q, song.clip_trigger_quantization);
  const out = [];
  try {
    for (const [q, name] of [[11, '1/16'], [7, '1/4'], [4, '1 Bar']]) {
      for (let i = 0; i < 3; i++) {
        await probe('stop');
        await probe('start', clipPath);
        await waitPhase(0.3 + Math.random() * 2, 3);
        const pos = (await read(clipPath, ['playing_position'])).playing_position;
        // Two bars on in the loop: a jump that cannot be the loop's own wrap.
        const target = clip.loop_start + ((Math.floor((pos - clip.loop_start) / bar) + 2) * bar) % loopLen;
        const t0 = Date.now();
        await set('song', [['clip_trigger_quantization', q]]);
        const f = (await probe('jump', 'scrub', target)).fire;
        const rel = (await probe('stop_scrub')).fire;
        await set('song', [['clip_trigger_quantization', base]]);
        const swapMs = Date.now() - t0;
        await sleep(Math.max(1.5 * bar, 2) * msPerBeat());
        const stats = await probe('stats');
        await probe('stop');
        const jumps = (stats.events || []).filter(e => e.kind === 'jump' && e.song_time_after >= f.song_time);
        const grid = { 11: 0.25, 7: 1, 4: bar }[q];
        const desc = jumps.map(e => {
          // The landing: the grid line the jump brackets, and the position
          // the clip shows there against the target.
          const line = Math.ceil(e.song_time_before / grid - 1e-9) * grid;
          const posAtLine = e.pos_after - (e.song_time_after - line);
          return `step ${e.step_beats} at ${r3(e.song_time_before)}–${r3(e.song_time_after)} ` +
            `(grid line ${r3(line)}, ${r3(line - f.song_time)} beats after the call; clip at ${r3(posAtLine)} there)`;
        });
        console.log(`${name} #${i + 1}: call at ${r3(f.song_time)} (phase ${r3(phaseOf(f.song_time))}), ` +
          `target ${target}, release ${r3((rel.song_time - f.song_time) * msPerBeat())} ms after, ` +
          `quantization back after ${swapMs} ms`);
        for (const d of desc) console.log('    ' + d);
        if (!desc.length) console.log('    no jump');
        out.push({ q, fire: f, release: rel, jumps });
      }
    }
  } finally {
    await set('song', [['clip_trigger_quantization', base]]);
    console.log(`restored: global ${(await read('song', ['clip_trigger_quantization'])).clip_trigger_quantization}`);
  }
  return out;
}

async function queued() {
  const base = enumIndex(SONG_Q, song.clip_trigger_quantization);
  const out = [];
  try {
    // [label, when to switch (beats after the relaunch), switch for (ms), also tap-scrub?]
    const cases = [
      ['no switch (control)', null, 0, false],
      ['switch 1/16 and back, 0.3 beat in', 0.3, 0, false],
      ['switch 1/16 and back, 1 beat in', 1, 0, false],
      ['switch 1/16 and back, held 300 ms, 0.3 beat in', 0.3, 300, false],
      ['switch 1/16 + scrub + release + back, 0.3 beat in', 0.3, 0, true],
    ];
    for (const [label, after, holdMs, scrub] of cases) {
      await probe('stop');
      await probe('start', clipPath);
      const st0 = await waitPhase(0.4, 0.6);
      await req('/looping/probe/lom_invoke', [clipPath, 'fire', '', '']);
      const fired = await songTime();
      let sw = null;
      if (after !== null) {
        await waitPhase(phaseOf(fired) + after, phaseOf(fired) + after + 0.2);
        sw = { at: await songTime() };
        await set('song', [['clip_trigger_quantization', 11]]);
        if (scrub) {
          const pos = (await read(clipPath, ['playing_position'])).playing_position;
          await probe('jump', 'scrub', clip.loop_start + ((Math.floor((pos - clip.loop_start) / bar) + 2) * bar) % loopLen);
          await probe('stop_scrub');
        }
        if (holdMs) await sleep(holdMs);
        await set('song', [['clip_trigger_quantization', base]]);
        sw.until = await songTime();
      }
      await sleep(1.5 * bar * msPerBeat());
      const stats = await probe('stats');
      await probe('stop');
      const nextBar = Math.ceil(fired / bar) * bar;
      const jumps = (stats.events || []).filter(e => e.kind !== 'wrap' && e.song_time_after >= fired - 0.05);
      // The relaunch: the clip back at its start.
      const launch = jumps.find(e => Math.abs(e.pos_after - clip.loop_start) < 0.1 + (e.song_time_after - e.song_time_before));
      console.log(`${label}: relaunch queued at ${r3(fired)} for the bar line ${nextBar}` +
        (sw ? `; switched ${r3(sw.at)}–${r3(sw.until)}` : ''));
      for (const e of jumps.slice(0, 4)) {
        console.log(`    jump ${e.step_beats} at ${r3(e.song_time_before)}–${r3(e.song_time_after)}, pos ${e.pos_before} → ${e.pos_after}` +
          (e === launch ? `  <- relaunch, ${r3(e.song_time_after - nextBar)} beats off the bar line` : ''));
      }
      if (!launch) console.log('    relaunch not seen');
      out.push({ label, fired, nextBar, sw, jumps });
    }
  } finally {
    await set('song', [['clip_trigger_quantization', base]]);
    console.log(`restored: global ${(await read('song', ['clip_trigger_quantization'])).clip_trigger_quantization}`);
  }
  return out;
}

async function edges() {
  const out = [];
  await probe('stop');
  await probe('start', clipPath);
  const fires = [];
  // From the loop's first bar, a bar back; from its last bar, a bar on; and
  // a jump of more than the whole loop.
  for (const [wantBar, delta] of [[0, -bar], [loopLen / bar - 1, bar], [0, loopLen + bar]]) {
    for (let i = 0; i < 400; i++) {
      await waitPhase(1, 1.5);
      const pos = (await read(clipPath, ['playing_position'])).playing_position;
      if (Math.floor((pos - clip.loop_start) / bar) === wantBar) break;
      await sleep(Math.min(bar * msPerBeat() * 0.6, 1500));
    }
    const f = (await probe('jump', 'move', delta)).fire;
    fires.push(f);
    await sleep(1.5 * bar * msPerBeat());
  }
  const stats = await probe('stats');
  await probe('stop');
  for (const f of fires) {
    const ev = firstJump(stats, f.song_time);
    console.log(`move ${f.value} from pos ${r3(f.playing_position)}: ` + (ev
      ? `pos ${ev.pos_before} → ${ev.pos_after} (step ${ev.step_beats}, ${ev.kind})`
      : 'no jump seen'));
    out.push({ fire: f, event: ev || null });
  }
  return { out, stats };
}

async function main() {
  song = await read('song', ['tempo', 'signature_numerator', 'signature_denominator', 'clip_trigger_quantization']);
  clip = await read(clipPath, ['is_playing', 'loop_start', 'loop_end', 'is_audio_clip', 'warping',
    'warp_mode', 'launch_quantization']);
  bar = song.signature_numerator * 4 / song.signature_denominator;
  loopLen = clip.loop_end - clip.loop_start;
  console.log(`song ${song.signature_numerator}/${song.signature_denominator} at ${song.tempo} BPM, global ${song.clip_trigger_quantization}; ` +
    `clip ${clip.is_audio_clip ? 'audio' : 'MIDI'} loop ${clip.loop_start}–${clip.loop_end}, warp_mode ${clip.warp_mode}, ` +
    `clip quantization ${clip.launch_quantization}\n`);
  if (!clip.is_playing) throw new Error('launch the clip first');
  if (loopLen < 2 * bar) throw new Error('the clip loop needs at least two bars');
  const result = await { latency, clipquant, finequant, swapquant, tapscrub, pending: queued, edges }[experiment]();
  const out = pathLib.resolve(__dirname, '..', '..', 'logs',
    `clip-jump-research-${experiment}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(pathLib.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ clipPath, song, clip, result }, null, 2));
  console.log('\nfull replies: ' + pathLib.relative(process.cwd(), out));
}

u.on('ready', () => main().then(() => { u.close(); process.exit(0); },
  e => { console.error(e.stack || e.message); probe('stop').finally(() => { u.close(); process.exit(1); }); }));
u.open();
