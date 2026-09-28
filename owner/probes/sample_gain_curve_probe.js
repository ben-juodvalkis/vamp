#!/usr/bin/env node
// Probe: sweep sample.gain on a Simpler and capture the echoed value.
//
// Usage: node sample_gain_curve_probe.js <trackIndex> [deviceIndex]
//   trackIndex defaults to 1 (the 2nd track).
//   deviceIndex defaults to 0 (first device on the track).
//
// Sends /looping/v3/property/set for a sequence of values, listens
// for /looping/v3/property/value echoes, and prints a table.
//
// You — the human operator — read the dB number off Live's Simpler UI
// for each value and we use those to fit the 0..1 ↔ dB curve.

const path = require('path');
const osc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'osc'));

const trackIdx = Number(process.argv[2] ?? 1);
const deviceIdx = Number(process.argv[3] ?? 0);
const devicePath = `tracks/${trackIdx}/devices/${deviceIdx}`;
const property = 'sample.gain';
const generation = 1_000_000; // high enough to never be stale

// Sweep values. Hit endpoints, midpoint, and a couple of points near
// each extreme so we can spot whether the curve is linear-in-dB or
// logarithmic.
const values = [0.0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5];

const u = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 0,
  remoteAddress: '127.0.0.1',
  remotePort: 11020,
});

const echoes = new Map();          // value sent → value echoed back
const errors = [];
let sweepDone = false;

u.on('ready', async () => {
  // Subscribe so the surface emits property/value to us specifically.
  u.send({
    address: '/looping/v3/property/subscribe',
    args: [
      { type: 's', value: devicePath },
      { type: 's', value: property },
    ],
  });

  // Brief beat for subscribe to settle, then start writing.
  await new Promise(r => setTimeout(r, 200));

  for (const v of values) {
    u.send({
      address: '/looping/v3/property/set',
      args: [
        { type: 's', value: devicePath },
        { type: 's', value: property },
        { type: 'f', value: v },
        { type: 'i', value: generation },
      ],
    });
    console.error(`-> set ${property} = ${v}`);
    // Slow enough that you can read each dB value off the Simpler UI
    // without scrambling. You'll watch the GUI; the script just paces.
    await new Promise(r => setTimeout(r, 3000));
  }
  sweepDone = true;

  // Drain echoes for another second, then unsubscribe + report.
  await new Promise(r => setTimeout(r, 800));
  u.send({
    address: '/looping/v3/property/unsubscribe',
    args: [
      { type: 's', value: devicePath },
      { type: 's', value: property },
    ],
  });

  console.log('\n--- result ---');
  console.log(`devicePath: ${devicePath}`);
  console.log(`property:   ${property}`);
  console.log('value sent | echoed back');
  console.log('-----------+------------');
  for (const v of values) {
    const echoed = echoes.has(v) ? echoes.get(v) : '(no echo)';
    console.log(`${v.toFixed(2).padStart(10)} | ${echoed}`);
  }
  if (errors.length) {
    console.log('\nerrors:');
    for (const e of errors) console.log('  ', e);
  }
  console.log('\nNow tell me the dB readout the Simpler UI shows for each value.');
  u.close();
  process.exit(0);
});

u.on('message', m => {
  const args = (m.args || []).map(a =>
    typeof a === 'object' && a !== null && 'value' in a ? a.value : a
  );
  if (m.address === '/looping/v3/property/value') {
    const [dp, prop, val] = args;
    if (dp === devicePath && prop === property) {
      // Match the echoed value to the sent value (within 1e-4).
      let matched = null;
      for (const v of values) {
        if (Math.abs(v - val) < 1e-4) { matched = v; break; }
      }
      if (matched !== null) echoes.set(matched, val);
      console.error(`<- echo ${prop} = ${val}`);
    }
  } else if (m.address === '/looping/v3/error') {
    const [origin, code, errPath, detail] = args;
    if (origin && origin.startsWith('/looping/v3/property/')) {
      const msg = `${origin} ${code} path=${errPath} detail=${detail}`;
      errors.push(msg);
      console.error(`!! ${msg}`);
    }
  }
});

u.open();

// Hard timeout in case nothing comes back.
setTimeout(() => {
  if (!sweepDone) {
    console.error('timeout — no progress');
    process.exit(1);
  }
}, 30_000);
