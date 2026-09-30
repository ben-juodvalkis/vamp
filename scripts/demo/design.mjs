/**
 * The look of a demo clip: one 1920×1080 frame, drawn by Chromium from
 * HTML into PNGs that ffmpeg layers over the recorded windows.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  VAMP ON IPAD                    ABLETON LIVE            │
 *   │ ╭──────────────────────────╮   ╭──────────────────────╮  │
 *   │ │                          │   │ Live's window,       │  │
 *   │ │  the interface, 4:3,     │   │ its browser hidden   │  │
 *   │ │  in an iPad Pro bezel    │   ╰──────────────────────╯  │
 *   │ ╰──────────────────────────╯                             │
 *   │  02  RECORD A LOOP                                       │
 *   │  Tap record. It starts on the next bar.                  │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Everything here is geometry and type; compose.mjs does the timing.
 */

import { chromium } from 'playwright';
import { join } from 'node:path';

export const CANVAS = { w: 1920, h: 1080 };

/**
 * Where the recorded windows land, in canvas pixels. `frame` 'ipad': the
 * interface alone, larger, with the captions in a column beside it (a clip
 * about the interface itself, where Live has nothing to show).
 */
export function layout(liveAspect, frame = 'both') {
	if (frame === 'ipad') {
		const bezel = 18;
		const screen = { w: 1067, h: 800 };
		const device = { x: 64, y: Math.round((CANVAS.h - screen.h - 2 * bezel) / 2) + 16, w: screen.w + 2 * bezel, h: screen.h + 2 * bezel };
		Object.assign(screen, { x: device.x + bezel, y: device.y + bezel });
		const capX = device.x + device.w + 72;
		const caption = { x: capX, y: device.y, w: CANVAS.w - capX - 72, h: device.h };
		return { screen, device, live: null, caption, bezel, screenRadius: 20, deviceRadius: 38, liveRadius: 12 };
	}
	const margin = 56;
	const bezel = 18;
	const top = 96;
	// The iPad's screen: 1366×1024 at 0.62. Live gets the rest of the width
	// and both panes share a centre line, so they read as one pair.
	const screen = { x: margin + bezel, y: top + bezel, w: 847, h: 635 };
	const device = { x: margin, y: top, w: screen.w + 2 * bezel, h: screen.h + 2 * bezel };
	const liveX = device.x + device.w + 48;
	let liveW = CANVAS.w - margin - liveX;
	let liveH = Math.round(liveW / liveAspect);
	if (liveH > device.h) {
		liveH = device.h;
		liveW = Math.round(liveH * liveAspect);
	}
	const live = { x: liveX, y: device.y + Math.round((device.h - liveH) / 2), w: liveW, h: liveH };
	const capY = device.y + device.h + 40;
	const caption = { x: margin, y: capY, w: CANVAS.w - 2 * margin, h: CANVAS.h - capY - 40 };
	return { screen, device, live, caption, bezel, screenRadius: 18, deviceRadius: 34, liveRadius: 12 };
}

const FONT = `-apple-system, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif`;
const ACCENT = '#f2b46b';

const page = (body, css = '') => `<!doctype html><html><head><style>
	* { box-sizing: border-box; margin: 0; }
	html, body { width: ${CANVAS.w}px; height: ${CANVAS.h}px; background: transparent; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
	${css}
</style></head><body>${body}</body></html>`;

const box = (r) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;`;

function backgroundHtml(L) {
	return page(
		`<div class="bg"></div>
		<div class="label" style="left:${L.device.x + 4}px;top:${L.device.y - 40}px">Vamp <span>on iPad</span></div>
		${L.live ? `<div class="label" style="left:${L.live.x + 2}px;top:${L.device.y - 40}px">Ableton Live</div>` : ''}
		<div class="device" style="${box(L.device)}"><div class="glass" style="left:${L.bezel}px;top:${L.bezel}px;width:${L.screen.w}px;height:${L.screen.h}px"></div></div>
		${L.live ? `<div class="liveshadow" style="${box(L.live)}"></div>` : ''}`,
		`.bg { position:absolute; inset:0;
			background:
				radial-gradient(1200px 800px at 30% 38%, #23262d 0%, rgba(20,21,25,0) 70%),
				radial-gradient(900px 700px at 82% 45%, #1d2026 0%, rgba(20,21,25,0) 70%),
				linear-gradient(180deg, #121317 0%, #0b0c0f 100%); }
		.label { position:absolute; font-size:17px; font-weight:600; letter-spacing:.16em; text-transform:uppercase; color:#8c909a; }
		.label span { color:#5d616b; }
		.device { position:absolute; border-radius:${L.deviceRadius}px;
			background: linear-gradient(145deg, #2a2b30, #131417 60%);
			box-shadow: 0 0 0 1.5px #3b3d44, inset 0 0 0 1px #0a0a0c, 0 40px 90px rgba(0,0,0,.55), 0 12px 30px rgba(0,0,0,.4); }
		.glass { position:absolute; border-radius:${L.screenRadius}px; background:#000; }
		.liveshadow { position:absolute; border-radius:${L.liveRadius}px; background:#000;
			box-shadow: 0 0 0 1px #34363d, 0 30px 70px rgba(0,0,0,.55), 0 10px 24px rgba(0,0,0,.35); }`
	);
}

function maskHtml(w, h, radius) {
	return `<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;background:#000}
		div{width:${w}px;height:${h}px;border-radius:${radius}px;background:#fff}</style></head><body><div></div></body></html>`;
}

function captionHtml(L, { index, chapter, text, note }) {
	const num = index == null ? '' : `<span class="num">${String(index).padStart(2, '0')}</span>`;
	return page(
		`<div class="cap" style="${box(L.caption)}">
			<div class="chapter">${num}${escape(chapter ?? '')}</div>
			<div class="text">${escape(text)}</div>
			${note ? `<div class="note">${escape(note)}</div>` : ''}
		</div>`,
		`.cap { position:absolute; display:flex; flex-direction:column; justify-content:center; gap:10px; }
		.chapter { font-size:18px; font-weight:700; letter-spacing:.2em; text-transform:uppercase; color:${ACCENT}; }
		.num { color:#6b6f79; margin-right:16px; letter-spacing:.08em; }
		.text { font-size:40px; font-weight:600; letter-spacing:-.01em; color:#f4f4f6; line-height:1.15; }
		.note { font-size:26px; font-weight:450; color:#a3a7b0; line-height:1.3; max-width:1500px; }`
	);
}

/** A box on Live's pane: `r` in canvas pixels, clipped to the pane, the rest of the pane dimmed. */
function liveBoxHtml(L, r, label) {
	const x = r.x - L.live.x;
	const y = r.y - L.live.y;
	return page(
		`<div class="pane" style="${box(L.live)}">
			<div class="spot" style="left:${x}px;top:${y}px;width:${r.w}px;height:${r.h}px"></div>
		</div>
		${label ? `<div class="tag" style="left:${Math.max(L.live.x + 6, Math.min(r.x, L.live.x + L.live.w - 240))}px;top:${r.y - 40 < L.live.y ? r.y + r.h + 8 : r.y - 40}px">${escape(label)}</div>` : ''}`,
		`.pane { position:absolute; overflow:hidden; border-radius:${L.liveRadius}px; }
		.spot { position:absolute; border-radius:8px; box-shadow: 0 0 0 3px ${ACCENT}, 0 0 22px 4px rgba(242,180,107,.35), 0 0 0 200vmax rgba(6,7,10,.5); }
		.tag { position:absolute; padding:6px 12px 7px; border-radius:8px; background:${ACCENT}; color:#1b1307; font:700 17px ${FONT}; white-space:nowrap; box-shadow:0 6px 18px rgba(0,0,0,.45); }`
	);
}

function cardHtml({ title, subtitle, foot }) {
	return page(
		`<div class="card"><div class="mark">${escape(title)}</div>
			<div class="sub">${escape(subtitle)}</div>
			${foot ? `<div class="foot">${escape(foot)}</div>` : ''}</div>`,
		`.card { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:26px;
			background: radial-gradient(1100px 700px at 50% 45%, #202228 0%, #0b0c0f 75%); }
		.mark { font-size:168px; font-weight:800; letter-spacing:-.045em; color:#f5f5f7; line-height:1; }
		.sub { font-size:36px; font-weight:500; color:#a3a7b0; letter-spacing:-.005em; }
		.foot { margin-top:30px; font-size:22px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:${ACCENT}; }`
	);
}

function escape(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/**
 * Every still the clip needs: the background, two corner masks, one PNG
 * per caption and the two cards. Returns their paths.
 */
export async function renderAssets(dir, L, { captions, intro, outro, liveBoxes = [] }) {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ viewport: { width: CANVAS.w, height: CANVAS.h }, deviceScaleFactor: 1 });
	const p = await ctx.newPage();
	const shot = async (html, file, { transparent = true, clip } = {}) => {
		await p.setContent(html);
		await p.evaluate(() => document.fonts.ready);
		const path = join(dir, file);
		await p.screenshot({ path, omitBackground: transparent, clip });
		return path;
	};
	const out = {
		background: await shot(backgroundHtml(L), 'background.png', { transparent: false }),
		screenMask: await shot(maskHtml(L.screen.w, L.screen.h, L.screenRadius), 'mask-screen.png', {
			transparent: false,
			clip: { x: 0, y: 0, width: L.screen.w, height: L.screen.h }
		}),
		liveMask: !L.live ? null : await shot(maskHtml(L.live.w, L.live.h, L.liveRadius), 'mask-live.png', {
			transparent: false,
			clip: { x: 0, y: 0, width: L.live.w, height: L.live.h }
		}),
		captions: [],
		liveBoxes: [],
		intro: await shot(cardHtml(intro), 'card-intro.png', { transparent: false }),
		outro: await shot(cardHtml(outro), 'card-outro.png', { transparent: false })
	};
	for (const [i, c] of captions.entries()) out.captions.push(await shot(captionHtml(L, c), `caption-${i}.png`));
	for (const [i, b] of liveBoxes.entries()) out.liveBoxes.push(await shot(liveBoxHtml(L, b.rect, b.label), `live-box-${i}.png`));
	await browser.close();
	return out;
}
