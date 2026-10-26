// Load a preset, sample str_for_value for some parameters at 65 points across
// their range (Live's own labels, for a rail table), delete it. MUTATES THE SET.
// Built 2026-10-25 for interface/src/lib/components/v6/browser/presetCurves.ts.
//   node owner/probes/preset_rail_sample.js <track> <absPreset> <place:Name> <rel> <out.json> <idx:min:max>...
const REPO = require('path').resolve(__dirname, '..', '..');
const osc = require(require('path').join(REPO, 'node_modules', 'osc'));
const { execFileSync } = require('child_process');
const fs = require('fs');
const [track, preset, place, rel, out, ...specs] = process.argv.slice(2);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const probe = (reqs) => JSON.parse(execFileSync('node', [`${REPO}/owner/probes/lom_probe_driver.js`, JSON.stringify(reqs)]).toString());
const names = () => {
  for (let t = 0; t < 5; t++) {
    try { return JSON.parse(probe([{ kind: 'introspect', path: 'song', attrs: `tracks[${track}].devices.*name` }])[0].reply.attrs[0].value_repr.replace(/'([^']*)'/g, (m, s) => JSON.stringify(s))); } catch { sleep(1500); }
  }
  throw new Error('names');
};
const before = names();
const u = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, remoteAddress: '127.0.0.1', remotePort: 11020 });
u.on('ready', () => {
  u.send({ address: '/looping/v3/device/load', args: [`tracks/${track}`, '', preset, place, rel].map((v) => ({ type: 's', value: v })) });
  setTimeout(() => {
    u.close();
    const after = names();
    let idx = after.findIndex((n, i) => n !== before[i]);
    if (idx < 0) idx = after.length - 1;
    const path = `tracks/${track}/devices/${idx}`;
    const result = {};
    for (const spec of specs) {
      const [i, min, max] = spec.split(':').map(Number);
      const reqs = [];
      for (let k = 0; k <= 64; k++) reqs.push({ kind: 'invoke', path, method: `parameters[${i}].str_for_value`, args: [min + ((max - min) * k) / 64] });
      const rs = [];
      for (let s = 0; s < reqs.length; s += 13) rs.push(...probe(reqs.slice(s, s + 13)));
      result[i] = rs.map((r) => [r.req.args[0], r.reply?.returned]);
    }
    fs.writeFileSync(out, JSON.stringify({ preset, device: after[idx], result }, null, 1));
    probe([{ kind: 'invoke', path: `tracks/${track}`, method: 'delete_device', observe: 'devices.*name', args: [idx] }]);
    console.log(JSON.stringify({ ok: true, device: after[idx], restored: JSON.stringify(names()) === JSON.stringify(before) }));
  }, 3000);
});
u.open();
