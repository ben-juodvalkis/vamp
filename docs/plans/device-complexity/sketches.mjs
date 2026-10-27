// Renders this proposal's sketches at the central band's size (1062 x 330 CSS
// px, 2x): static HTML in the flat grammar, not the app. From the repo root:
// node docs/plans/device-complexity/sketches.mjs docs/plans/device-complexity
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.cwd() + '/')('playwright');
const out = process.argv[2];
const ink = '#9a7cf2';
const css = `
*{box-sizing:border-box;margin:0}
body{background:#2e323a;font-family:Inter,-apple-system,Helvetica,sans-serif;color:#e6e6e6;width:100vw;height:100vh;overflow:hidden}
.band{display:flex;gap:16px;padding:16px;height:100vh}
.band.mini{gap:8px;padding:8px}
.band.mini .row{gap:8px}
.band.mini .box .lab{font-size:13px}
.band.mini .box .val{font-size:11px}
.rows{display:flex;flex-direction:column;gap:16px;flex:1;min-height:0}
.rail{display:flex;flex-direction:column;gap:6px;width:56px;flex:none}
.chip{flex:1;font-size:13px;border:1px solid #6b6f78;background:#1a1c21;display:flex;align-items:center;justify-content:center;font-size:12px;color:${ink};border-radius:2px;text-align:center;line-height:1.1}
.chip.on{background:${ink};color:#111;border-color:${ink}}
.chip.off{opacity:.45}
.chip .dot{display:block;font-size:9px;color:inherit;opacity:.8}
.seam{width:1px;background:linear-gradient(transparent,#5c606a 15%,#5c606a 85%,transparent);flex:none}
.group{display:flex;flex-direction:column;gap:4px;min-width:0}
.eyebrow{font-size:12px;color:${ink};text-align:center;height:16px;white-space:nowrap}
.row{display:flex;gap:16px;flex:1;min-height:0}
.box{flex:1;min-width:0;border:1px solid #111;background:#1a1c21;position:relative;overflow:hidden;border-radius:2px}
.box .fill{position:absolute;left:0;right:0;bottom:0;background:${ink}}
.box .lab{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:15px;color:#f2f2f2;text-shadow:0 0 3px #000,0 0 6px #000;text-align:center;z-index:1}
.box .val{font-size:13px;opacity:.9;margin-top:4px}
.box.ghost{opacity:.4}
.pad{flex:1.6;border:1px solid #111;background:#1a1c21;position:relative;border-radius:2px}
.pad .lab{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;color:${ink}}
.pad .dot{position:absolute;width:12px;height:12px;border-radius:50%;background:#ddd}
.seg{display:flex;flex-direction:column;flex:1;border:1px solid #6b6f78;border-radius:2px;min-width:0}
.seg div{flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;color:${ink};border-top:1px solid #33363d}
.seg div:first-child{border-top:0}
.seg .on{background:${ink};color:#111}
.switch{height:44px;border:1px solid #6b6f78;background:#1a1c21;display:flex;align-items:center;justify-content:center;font-size:14px;color:#bbb;border-radius:2px;flex:none}
.switch.on{background:${ink};color:#111;border-color:${ink}}
.inst{display:grid;grid-template-columns:repeat(4,1fr);height:44px;border:1px solid #6b6f78;border-radius:2px}.inst span{display:flex;align-items:center;justify-content:center;color:${ink};font-size:14px}.inst span.on{background:${ink};color:#111}
.note{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#aaa}
`;
const box = (t, v, f, cls = '') => `<div class="box ${cls}"><div class="fill" style="height:${f}%"></div><div class="lab">${t}<span class="val">${v}</span></div></div>`;
const rail = (sel, items) => `<div class="rail">${items.map(([n, s]) => `<div class="chip ${n === sel ? 'on' : ''} ${s === 'off' ? 'off' : ''}">${n}${s === 'off' ? '<span class="dot">off</span>' : ''}</div>`).join('')}</div>`;
const OP = [['Face'], ['Osc'], ['Filter'], ['Mod'], ['Global']];
const pages = {
	'operator-face': `<div class="band">${rail('Face', OP)}
		<div class="group" style="flex:4"><div class="eyebrow">Amp Envelope</div><div class="row">${box('A', '2 ms', 20)}${box('D', '600 ms', 45)}${box('S', '-6 dB', 70)}${box('R', '50 ms', 30)}</div></div>
		<div class="seam"></div>
		<div class="group" style="flex:3"><div class="eyebrow"></div><div class="row">${box('Feedback', '0 %', 5)}${box('Time', '0 %', 50)}${box('Tone', '70 %', 70)}</div></div>
		<div class="seam"></div>
		<div class="pad" style="flex:2.6"><div class="lab">Filter</div><div class="dot" style="left:70%;top:30%"></div></div></div>`,
	'operator-osc-a': `<div class="band">${rail('Osc', OP)}
		<div class="group" style="flex:0 0 96px"><div class="eyebrow">Osc</div><div class="inst"><span class="on">A</span><span>B</span><span>C</span><span>D</span></div><div class="switch on" style="flex:none;margin-top:8px">A On</div><div class="seg" style="margin-top:8px"><div class="on">Sine</div><div>Sw 64</div><div>Sq 64</div><div>Tri</div><div>Noise</div></div></div>
		<div class="seam"></div>
		<div class="group" style="flex:5"><div class="eyebrow">Pitch</div><div class="row">${box('Coarse', '1', 2)}${box('Fine', '0', 0)}${box('Freq<Vel', '0', 50)}${box('Level', '0 dB', 80)}${box('Feedback', '0 %', 3)}</div></div>
		<div class="seam"></div>
		<div class="group" style="flex:5"><div class="eyebrow">Envelope</div><div class="row">${box('A', '0 ms', 2)}${box('D', '600 ms', 45)}${box('S', '-inf', 0)}${box('R', '50 ms', 30)}${box('Vel', '0 %', 0)}</div></div></div>`,
	'simpler-filter-off': `<div class="band">${rail('Filter', [['Face'], ['Sample'], ['Filter', 'off'], ['Mod', 'off'], ['Amp']])}
		<div class="group" style="flex:0 0 96px"><div class="eyebrow">Filter</div><div class="switch" style="flex:1">Off</div></div>
		<div class="seam"></div>
		<div class="group" style="flex:6;position:relative"><div class="eyebrow">Filter, ghosted: names from the reference</div><div class="row">${box('Freq', '', 70, 'ghost')}${box('Res', '', 20, 'ghost')}${box('Type', '', 0, 'ghost')}${box('Drive', '', 0, 'ghost')}${box('Env', '', 50, 'ghost')}${box('Key', '', 0, 'ghost')}</div></div></div>`
};
const EL = [['Face'], ['Mallet'], ['Fork'], ['Pickup'], ['Global']];
const CO = [['Face'], ['Exciter'], ['Res'], ['LFO'], ['Global']];
const badge = (letters, on) => `<div class="inst" style="grid-template-columns:repeat(${letters.length},1fr)">${letters.map((l) => `<span class="${l === on ? 'on' : ''}">${l}</span>`).join('')}</div>`;
const seg = (opts, on) => `<div class="seg">${opts.map((o) => `<div class="${o === on ? 'on' : ''}">${o}</div>`).join('')}</div>`;
const pad = (t, x, y, flex = 1.6) => `<div class="pad" style="flex:${flex}"><div class="lab">${t}</div><div class="dot" style="left:${x}%;top:${y}%"></div></div>`;
Object.assign(pages, {
	'electric-face': `<div class="band">${rail('Face', EL)}
		${pad('Hammer', 35, 55, 2.2)}${pad('Fork', 62, 38, 2.2)}
		<div class="seam"></div>
		<div class="group" style="flex:2"><div class="eyebrow">Damper · Pickup</div><div class="row">${box('Damp', '50 %', 50)}<div style="flex:1;display:flex;min-width:0">${seg(['R', 'W'], 'R')}</div>${box('Volume', '-6 dB', 75)}</div></div></div>`,
	'electric-fork': `<div class="band">${rail('Fork', EL)}
		<div class="group" style="flex:5"><div class="eyebrow">Tine</div><div class="row">${box('Decay', '1.2 s', 45)}${box('Volume', '-4 dB', 70)}${box('Color', '50 %', 50)}${box('< Key', '0 %', 50)}</div></div>
		<div class="seam"></div>
		<div class="group" style="flex:2.5"><div class="eyebrow">Tone</div><div class="row">${box('Decay', '800 ms', 35)}${box('Volume', '-12 dB', 40)}</div></div>
		<div class="seam"></div>
		<div class="group" style="flex:1.25"><div class="eyebrow"></div><div class="row">${box('Release', '150 ms', 25)}</div></div></div>`,
	'collision-face': `<div class="band">${rail('Face', CO)}
		${pad('Mallet', 40, 60, 2)}
		<div class="seam"></div>
		<div class="group" style="flex:3"><div class="eyebrow">Res 1</div><div class="row">${box('Tune', '0 st', 50)}${box('Decay', '1.5 s', 55)}${box('Material', '60 %', 60)}</div></div>
		<div class="seam"></div>
		<div class="group" style="flex:2"><div class="eyebrow"></div><div class="row">${box('Res 2', '30 %', 30)}${box('Volume', '-6 dB', 75)}</div></div></div>`,
	'collision-res': `<div class="band">${rail('Res', CO)}
		<div class="group" style="flex:0 0 120px"><div class="eyebrow">Resonator</div>${badge(['1', '2'], '1')}<div class="switch on" style="margin-top:8px">1 On</div><div style="margin-top:8px;flex:1;display:flex">${seg(['Beam', 'Marimba', 'String', 'Membrane', 'Plate', 'Pipe', 'Tube'], 'Marimba')}</div></div>
		<div class="seam"></div>
		<div class="rows" style="flex:7">
			<div class="row">${box('Tune', '0 st', 50)}${box('Fine', '0 ct', 50)}${box('Decay', '1.5 s', 55)}${box('Material', '60 %', 60)}${box('Radius', '40 %', 40)}${box('Ratio', '1.0', 20)}</div>
			<div class="row">${box('Bright', '50 %', 50)}${box('Inharm', '0 %', 50)}${box('Opening', '0 %', 0)}${box('Hit', '25 %', 25)}${box('Bleed', '0 %', 0)}${box('Volume', '0 dB', 80)}</div>
		</div></div>`,
	'operator-osc-mini': pages['operator-osc-a'].replace('<div class="band">', '<div class="band mini">')
});
const SIZES = { 'operator-osc-mini': [850, 236] };

// Playwright's own browser, or the cloud container's preinstalled one.
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
for (const [name, body] of Object.entries(pages)) {
	const [width, height] = SIZES[name] ?? [1062, 330];
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
	await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`);
	await page.screenshot({ path: `${out}/${name}.png` });
	await page.close();
}
await browser.close();
