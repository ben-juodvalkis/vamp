// Load one preset onto a track through the surface (`device/load`, like a
// browser pick), dump what Live reports (device_dump.js), line the dump up
// beside what the file saves (in document order), write both to JSON, then
// delete the device. MUTATES THE SET (a load and a delete, two undo steps).
// Built 2026-10-25 for the browser preset faces (ADR-478).
//   node owner/probes/preset_measure.js <trackIndex> <absPreset> <place:Name> <relInPlace> <out.json>
const REPO = require('path').resolve(__dirname, '..', '..');
const osc = require(require('path').join(REPO, 'node_modules', 'osc'));
const { execFileSync } = require('child_process');
const zlib = require('zlib');
const fs = require('fs');
const [trackIndex, presetPath, place, rel, out] = process.argv.slice(2);
const probe = (reqs) => JSON.parse(execFileSync('node', [`${REPO}/owner/probes/lom_probe_driver.js`, JSON.stringify(reqs)]).toString());
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const names = () => {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const r = probe([{ kind: 'introspect', path: 'song', attrs: `tracks[${trackIndex}].devices.*name` }])[0];
      const v = r.reply.attrs[0].value_repr;
      // Python's repr of a list of str: single quotes, or double where a name has an apostrophe.
      return JSON.parse(v.replace(/'([^']*)'/g, (m, s) => JSON.stringify(s)));
    } catch (e) { sleep(1500); }
  }
  throw new Error('names: probe kept failing');
};
const before = names();
const u = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, remoteAddress: '127.0.0.1', remotePort: 11020 });
let err = null;
u.on('message', (m) => { if (m.address === '/looping/v3/error') err = m.args; });
u.on('ready', () => {
  u.send({ address: '/looping/v3/device/load', args: [`tracks/${trackIndex}`, '', presetPath, place, rel].map((v) => ({ type: 's', value: v })) });
  setTimeout(() => {
    u.close();
    const after = names();
    if (after.length <= before.length) { console.log(JSON.stringify({ ok: false, err, before, after })); process.exit(1); }
    // The newcomer: the first index where the lists part.
    let idx = after.findIndex((n, i) => n !== before[i]);
    if (idx < 0) idx = after.length - 1;
    const devPath = `tracks/${trackIndex}/devices/${idx}`;
    const dumpFile = out.replace(/\.json$/, '.dump.json');
    try { execFileSync('node', [`${REPO}/owner/probes/device_dump.js`, devPath, '--json', dumpFile], { stdio: 'ignore' }); } catch (e) {}
    const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
    // A Max device's .amxd is no XML: its saved values are compared by name, by hand.
    const xml = presetPath.endsWith('.amxd') ? '' : zlib.gunzipSync(fs.readFileSync(presetPath)).toString('utf8');
    const saved = [...xml.matchAll(/<(\w+)>\s*<LomId Value="-?\d+"\s*\/>\s*<Manual Value="([^"]*)"/g)].map((m) => [m[1], m[2]]);
    const rows = dump.parameters.map((p, i) => ({ i: p.index, name: p.name, min: p.min, max: p.max, lom: p.value, q: p.is_quantized, labels: p.labels, xmlName: saved[i]?.[0], xml: saved[i]?.[1] }));
    fs.writeFileSync(out, JSON.stringify({ preset: presetPath, device: after[idx], className: dump.identity?.class_name, devPath, rows, savedCount: saved.length }, null, 1));
    probe([{ kind: 'invoke', path: `tracks/${trackIndex}`, method: 'delete_device', observe: 'devices.*name', args: [idx] }]);
    const back = names();
    console.log(JSON.stringify({ ok: true, device: after[idx], className: dump.identity?.class_name, idx, restored: JSON.stringify(back) === JSON.stringify(before) }));
  }, 3000);
});
u.open();
