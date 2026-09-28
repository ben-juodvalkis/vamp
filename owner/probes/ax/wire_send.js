// send one OSC message straight to the surface (11020) and print everything that comes back for N ms
// usage: node wire_send.js <address> <json array of args> [listen_ms]
const osc = require(require('path').resolve(__dirname, '../../../../node_modules/osc'));
const [addr, argsJson, ms] = [process.argv[2], process.argv[3] || '[]', Number(process.argv[4] || 4000)];
const args = JSON.parse(argsJson).map(v => typeof v === 'number' ? { type: Number.isInteger(v) ? 'i' : 'f', value: v } : { type: 's', value: String(v) });
const u = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, remoteAddress: '127.0.0.1', remotePort: 11020 });
const got = []; const t0 = Date.now();
u.on('message', m => got.push({ t: Date.now() - t0, address: m.address, args: (m.args || []).map(x => (x && typeof x === 'object' && 'value' in x) ? x.value : x) }));
u.on('ready', () => { u.send({ address: addr, args }); setTimeout(() => { u.close(); console.log(JSON.stringify(got, null, 0)); process.exit(0); }, ms); });
u.open();
