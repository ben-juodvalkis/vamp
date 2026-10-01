#!/usr/bin/env node
// Everything the running Live says about one device, read through the
// surface's LOM probes (DebugComponent, UDP 11020). The `device-dump` skill
// runs this; see .claude/skills/device-dump/SKILL.md.
//
//   node owner/probes/device_dump.js tracks/1/devices/2
//   node owner/probes/device_dump.js --find "auto pan"     first match on any track
//   node owner/probes/device_dump.js tracks/1/devices/1 --json out.json
//   ... --no-labels    skip the str_for_value sampling (faster)
//
// Reads, never writes: introspect and str_for_value only. Prints:
//   identity      name, class_name, class_display_name, Python type, type
//   parameters    index, name, original_name, min, max, value, default,
//                 quantized, and Live's own labels (str_for_value at every
//                 step of a quantized or small integral range; else at
//                 0/25/50/75/100% and at the current value)
//   attributes    every other property on the device and one level into
//                 the objects it holds (a Simpler's `sample`), with its
//                 value, whether it is settable (its property has a
//                 setter) and whether it has a listener
//   on the wire   the PropertyComponent allowlist rows for this class
//
// A probe reply must fit darwin's 9,216 B datagram and the probe cuts a
// list repr at 2,000 chars, so parameters are read a few at a time.

const fs = require('fs');
const path = require('path');
const osc = require(path.resolve(__dirname, '..', '..', 'node_modules', 'osc'));

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const findName = opt('--find');
const jsonOut = opt('--json');
const withLabels = !flag('--no-labels');
const devicePathArg = argv.find((a, i) => !a.startsWith('--') && !['--find', '--json'].includes(argv[i - 1]));

// --- transport: one socket, one request in flight -------------------------

const port = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 0, remoteAddress: '127.0.0.1', remotePort: 11020 });
let pending = null;
port.on('message', (m) => {
	if (!pending) return;
	const { resolve, timer } = pending;
	pending = null;
	clearTimeout(timer);
	try { resolve(JSON.parse(m.args[0])); } catch { resolve({ error: 'unparseable reply' }); }
});
function request(address, args) {
	return new Promise((resolve) => {
		const timer = setTimeout(() => { pending = null; resolve({ error: 'timeout' }); }, 3000);
		pending = { resolve, timer };
		port.send({ address, args: args.map((a) => (typeof a === 'number' ? { type: 'i', value: a } : { type: 's', value: a })) });
	});
}
const introspect = (p, attrs, dir = '') => request('/looping/probe/lom_introspect', [p, attrs.join(','), dir]);
const invoke = (p, method, args) => request('/looping/probe/lom_invoke', [p, method, '', JSON.stringify(args)]);
const py = (module, chain, dir = '') => request('/looping/probe/py_introspect', [module, chain, dir]);

/** `value_repr` → a JS value where it is plainly one (numbers, bools, quoted strings, tuples of those). */
function parseRepr(s) {
	if (s === undefined || s === '') return undefined;
	if (s === 'True') return true;
	if (s === 'False') return false;
	if (s === 'None') return null;
	if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) return Number(s);
	if (/^'.*'$/s.test(s) || /^".*"$/s.test(s)) return s.slice(1, -1);
	if (/^[([].*[)\]]$/s.test(s)) {
		try {
			return JSON.parse(s.replace(/^\(/, '[').replace(/,?\)$/, ']').replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null'));
		} catch { return s; }
	}
	return s;
}

async function readAttrs(p, attrs) {
	const out = {};
	for (let i = 0; i < attrs.length; i += 12) {
		const r = await introspect(p, attrs.slice(i, i + 12));
		if (r.error) throw new Error(`${p}: ${r.error}`);
		for (const a of r.attrs) out[a.name] = a.exists ? { value: parseRepr(a.value_repr), raw: a.value_repr, callable: !!a.callable } : { error: a.error };
	}
	return out;
}

// --- finding the device ----------------------------------------------------

async function find(name) {
	const needle = name.toLowerCase();
	const tracks = parseRepr((await introspect('song', ['tracks.*name'])).attrs[0].value_repr) || [];
	const hits = [];
	for (let t = 0; t < tracks.length; t++) {
		const r = await readAttrs(`tracks/${t}`, ['devices.*name', 'devices.*class_name']);
		const names = r['devices.*name'].value || [];
		const classes = r['devices.*class_name'].value || [];
		names.forEach((n, d) => {
			if (`${n} ${classes[d]}`.toLowerCase().includes(needle)) hits.push({ path: `tracks/${t}/devices/${d}`, track: tracks[t], name: n, className: classes[d] });
		});
	}
	return hits;
}

// --- the dump --------------------------------------------------------------

const PARAM_FIELDS = ['name', 'original_name', 'min', 'max', 'value', 'default_value', 'is_quantized'];
const SKIP = new Set(['canonical_parent', 'view', 'View', 'parameters', 'audio_inputs', 'audio_outputs', 'midi_inputs', 'midi_outputs']);
const NOT_LISTENER = '^(?!add_|remove_|_)(?!.*_has_listener$)[a-z]';

async function parameters(p) {
	const params = [];
	for (let start = 0; ; start += 5) {
		const attrs = [];
		for (let i = start; i < start + 5; i++) for (const f of PARAM_FIELDS) attrs.push(`parameters[${i}].${f}`);
		const r = await introspect(p, attrs);
		if (r.error) throw new Error(r.error);
		let more = false;
		for (let i = start; i < start + 5; i++) {
			const row = { index: i };
			let ok = false;
			for (const f of PARAM_FIELDS) {
				const a = r.attrs.find((x) => x.name === `parameters[${i}].${f}`);
				if (a && a.exists) { row[f] = parseRepr(a.value_repr); ok = true; }
			}
			if (ok) { params.push(row); more = true; }
		}
		if (!more) break;
	}
	return params;
}

async function labels(p, prm) {
	const at = `parameters[${prm.index}]`;
	// `value_items` reads back as an opaque StringVector through the probe,
	// so a quantized parameter is stepped through str_for_value too.
	const span = prm.max - prm.min;
	const integral = Number.isInteger(prm.min) && Number.isInteger(prm.max) && span <= 64 && (prm.is_quantized || span >= 2);
	const values = integral
		? Array.from({ length: span + 1 }, (_, k) => prm.min + k)
		: [0, 0.25, 0.5, 0.75, 1].map((t) => prm.min + t * span);
	if (!values.includes(prm.value)) values.push(prm.value);
	const out = [];
	for (const v of values) {
		const r = await invoke(p, `${at}.str_for_value`, [v]);
		out.push({ value: Number(v.toFixed(6)), label: r.invoke_error ? `!${r.invoke_error}` : parseRepr(r.returned) });
	}
	return out;
}

/** Live's docstring for `Type.attr`, from the module the object's class lives in. */
async function doc(moduleName, typeName, attr) {
	const r = await py(moduleName, `${typeName}.${attr}`);
	return (r.doc || '').split('\n')[0].trim();
}

/** Settable when the class's property has a setter — exact, unlike the docstring's wording. */
async function settable(moduleName, typeName, attr) {
	const r = await py(moduleName, `${typeName}.${attr}.fset`);
	return !!r.resolved_type && !/NoneType/.test(r.resolved_type);
}

async function attributes(p, chainPrefix, typeName, moduleName, depth) {
	const target = chainPrefix ? `${chainPrefix}.` : '';
	// The names: from the instance at the top, from the class one level in
	// (the probe can only list the object a path resolves to).
	let names, listeners;
	if (!chainPrefix) {
		names = (await introspect(p, [], NOT_LISTENER)).dir_matches;
		listeners = (await introspect(p, [], '_has_listener$')).dir_matches;
	} else {
		names = (await py(moduleName, typeName, NOT_LISTENER)).dir || [];
		listeners = (await py(moduleName, typeName, '_has_listener$')).dir || [];
	}
	const observable = new Set(listeners.map((n) => n.replace(/_has_listener$/, '')));
	const wanted = names.filter((n) => !SKIP.has(n) && !/^[A-Z]/.test(n));
	const read = await readAttrs(p, wanted.map((n) => target + n));
	const rows = [];
	for (const n of wanted) {
		const a = read[target + n];
		if (!a || a.error || a.callable) continue;
		const row = { name: target + n, value: a.value, observable: observable.has(n) };
		row.doc = await doc(moduleName, typeName, n);
		row.settable = await settable(moduleName, typeName, n);
		rows.push(row);
		// One level into a LOM object it holds: `<Live.Sample.Sample object at …>`.
		const m = typeof a.raw === 'string' && a.raw.match(/^<(?:Live\.)?([A-Za-z]+)\.([A-Za-z]+) object/);
		if (m && depth < 1) rows.push(...(await attributes(p, target + n, m[2], `Live.${m[1]}`, depth + 1)));
	}
	return rows;
}

function allowlist(className) {
	const file = path.resolve(__dirname, '..', '..', 'surface', 'components', 'PropertyComponent.py');
	try {
		return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(`("${className}",`)).map((l) => l.trim());
	} catch { return []; }
}

// --- main ------------------------------------------------------------------

port.on('ready', async () => {
	try {
		let devicePath = devicePathArg;
		if (findName) {
			const hits = await find(findName);
			if (!hits.length) throw new Error(`no device matching "${findName}" on any track`);
			for (const h of hits) console.log(`match  ${h.path}  "${h.name}" (${h.className}) on "${h.track}"`);
			devicePath = hits[0].path;
		}
		if (!devicePath) throw new Error('usage: device_dump.js <tracks/N/devices/M> | --find <name> [--json file] [--no-labels]');

		const id = await introspect(devicePath, ['name', 'class_name', 'class_display_name', 'type', 'can_have_chains', 'can_have_drum_pads', 'is_active']);
		if (id.error) throw new Error(`${id.error} — is Live running with the surface?`);
		if (id.resolve_error) throw new Error(id.resolve_error);
		const identity = { path: devicePath, pythonType: id.resolved_type };
		for (const a of id.attrs) identity[a.name] = parseRepr(a.value_repr);
		const moduleName = `Live.${id.resolved_type}`;

		const params = await parameters(devicePath);
		if (withLabels) for (const prm of params) prm.labels = await labels(devicePath, prm);
		const attrs = await attributes(devicePath, '', id.resolved_type, moduleName, 0);
		const wire = allowlist(identity.class_name);

		const dump = { identity, parameters: params, attributes: attrs, propertyAllowlist: wire };
		if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(dump, null, 2));

		console.log(`\n# ${identity.name}  —  class ${identity.class_name} ("${identity.class_display_name}"), Python ${identity.pythonType}, type ${identity.type}`);
		console.log(`path ${devicePath}  chains ${identity.can_have_chains}  drum pads ${identity.can_have_drum_pads}  active ${identity.is_active}`);
		console.log(`\n## Parameters (${params.length}) — index: name [original] min..max = value (default) q=quantized`);
		for (const prm of params) {
			const orig = prm.original_name && prm.original_name !== prm.name ? ` [${prm.original_name}]` : '';
			console.log(`${String(prm.index).padStart(3)}: ${prm.name}${orig}  ${prm.min}..${prm.max} = ${prm.value}${prm.default_value === undefined ? '' : ` (default ${prm.default_value})`}${prm.is_quantized ? ' q' : ''}`);
			if (prm.labels) console.log(`       ${prm.labels.map((l) => `${l.value}=${l.label}`).join('  ')}`);
		}
		console.log(`\n## Other attributes — S settable, L has a listener`);
		for (const a of attrs) {
			const v = typeof a.value === 'string' && a.value.length > 90 ? `${a.value.slice(0, 90)}…` : JSON.stringify(a.value);
			console.log(`${a.settable ? 'S' : ' '}${a.observable ? 'L' : ' '} ${a.name} = ${v}${a.doc ? `   — ${a.doc}` : ''}`);
		}
		console.log(`\n## On the wire (PropertyComponent allowlist for ${identity.class_name})`);
		console.log(wire.length ? wire.join('\n') : '(none)');
		if (jsonOut) console.log(`\nfull dump: ${jsonOut}`);
	} catch (e) {
		console.error(`device_dump: ${e.message}`);
		process.exitCode = 1;
	}
	port.close();
	setTimeout(() => process.exit(), 50);
});
port.open();
