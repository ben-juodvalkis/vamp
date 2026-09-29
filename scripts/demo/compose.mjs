/**
 * The finished clip, from the recorder's one file and design.mjs's stills:
 *
 *   intro card ─▶ the take (interface in its bezel, Live beside it,
 *                 a lower-third caption per step, fading) ─▶ outro card
 *
 * This ffmpeg has no drawtext, so all type is drawn by Chromium into PNGs
 * and faded in and out here. The same caption timings go to a WebVTT
 * sidecar. Audio: Live's output, delayed under the intro, loudness-
 * normalized.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANVAS, layout, renderAssets } from './design.mjs';

const FPS = 60;
const INTRO = 3.2;
const OUTRO = 3.6;
const FADE = 0.35;

const vttTime = (s) => {
	const ms = Math.max(0, Math.round(s * 1000));
	const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
	const m = String(Math.floor(ms / 60_000) % 60).padStart(2, '0');
	const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
	return `${h}:${m}:${sec}.${String(ms % 1000).padStart(3, '0')}`;
};

/** Steps → caption cues on the take's clock (seconds from `start`), merged where a caption holds. */
export function cuesOf(take, start, end) {
	const cues = [];
	for (const s of take.steps) {
		if (!s.caption) continue;
		const last = cues.at(-1);
		if (last && last.text === s.caption && last.chapter === s.chapter && last.note === (s.note ?? null)) continue;
		if (last) last.to = s.t - start;
		cues.push({ index: s.index, chapter: s.chapter, text: s.caption, note: s.note ?? null, from: s.t - start, to: end - start });
	}
	return cues;
}

/** Steps → boxes on Live's pane: `{ rect: {x,y,w,h} in Live's window points, label }` while it holds. */
function liveCuesOf(take, start, end) {
	const cues = [];
	let current = 'none';
	for (const s of take.steps) {
		const key = JSON.stringify(s.live ?? null);
		if (key === current) continue;
		current = key;
		const last = cues.at(-1);
		if (last && last.to === end - start) last.to = s.t - start;
		if (s.live) cues.push({ box: s.live, from: s.t - start, to: end - start });
	}
	return cues;
}

export async function compose({ dir, take, log = () => {} }) {
	const [ipad, live] = take.tracks.filter((t) => t.kind === 'video');
	const hasAudio = take.tracks.some((t) => t.kind === 'audio');

	// The interface's capture has the window's title bar on top; the page is the box under it.
	const cs = ipad.scale;
	const ipadCrop = {
		x: 0,
		y: Math.round(take.ipad.chromePts * cs),
		w: Math.min(ipad.width, Math.round(1366 * take.ipad.scale * cs)),
		h: Math.min(ipad.height - Math.round(take.ipad.chromePts * cs), Math.round(1024 * take.ipad.scale * cs))
	};
	// Live: the scenario's crop of its window (points), else all of it but
	// the status bar.
	const c = take.liveCrop ?? { x: 0, y: 0, w: live.width / live.scale, h: live.height / live.scale - 22 };
	const px = (v) => Math.round(v * live.scale);
	const liveCrop = {
		x: px(c.x),
		y: px(c.y),
		w: Math.min(live.width - px(c.x), px(c.w)) & ~1,
		h: Math.min(live.height - px(c.y), px(c.h)) & ~1
	};
	const L = layout(liveCrop.w / liveCrop.h);

	const start = Math.max(0, take.steps[0].t - 60 / take.tempo);
	const end = take.endMark;
	const body = end - start;
	const total = INTRO + body + OUTRO;
	const cues = cuesOf(take, start, end);
	// Live's window points → canvas pixels, through the crop and the pane's scale.
	const k = L.live.w / liveCrop.w;
	const liveCues = liveCuesOf(take, start, end).map((c) => ({
		...c,
		label: c.box.label,
		rect: {
			x: Math.round(L.live.x + (c.box.x * live.scale - liveCrop.x) * k),
			y: Math.round(L.live.y + (c.box.y * live.scale - liveCrop.y) * k),
			w: Math.round(c.box.w * live.scale * k),
			h: Math.round(c.box.h * live.scale * k)
		}
	}));
	writeFileSync(
		join(dir, 'captions.vtt'),
		`WEBVTT\n\n${cues.map((c) => `${vttTime(INTRO + c.from)} --> ${vttTime(INTRO + c.to)}\n${c.chapter ? `${c.chapter}: ` : ''}${c.text}${c.note ? `\n${c.note}` : ''}\n`).join('\n')}`
	);

	const assetDir = join(dir, 'assets');
	mkdirSync(assetDir, { recursive: true });
	log('drawing the frame and captions…');
	const A = await renderAssets(assetDir, L, { captions: cues, intro: take.intro, outro: take.outro, liveBoxes: liveCues });

	const still = (path, seconds) => ['-loop', '1', '-framerate', String(FPS), '-t', seconds.toFixed(3), '-i', path];
	const inputs = ['-i', join(dir, 'raw.mov')];
	inputs.push(...still(A.background, total)); // 1
	inputs.push(...still(A.screenMask, total)); // 2
	inputs.push(...still(A.liveMask, total)); // 3
	inputs.push(...still(A.intro, INTRO)); // 4
	inputs.push(...still(A.outro, OUTRO)); // 5
	cues.forEach((c, i) => inputs.push(...still(A.captions[i], c.to - c.from))); // 6…
	const liveBase = 6 + cues.length;
	liveCues.forEach((c, i) => inputs.push(...still(A.liveBoxes[i], c.to - c.from)));

	const shift = `setpts=PTS-STARTPTS+${INTRO}/TB`;
	const f = [
		`[1:v]format=rgba[bg]`,
		`[0:v:0]trim=start=${start}:end=${end},${shift},crop=${ipadCrop.w}:${ipadCrop.h}:${ipadCrop.x}:${ipadCrop.y},scale=${L.screen.w}:${L.screen.h}:flags=lanczos,format=rgba[s0]`,
		`[2:v]format=gray[m0]`,
		`[s0][m0]alphamerge[ipad]`,
		`[0:v:1]trim=start=${start}:end=${end},${shift},crop=${liveCrop.w}:${liveCrop.h}:${liveCrop.x}:${liveCrop.y},scale=${L.live.w}:${L.live.h}:flags=lanczos,format=rgba[l0]`,
		`[3:v]format=gray[m1]`,
		`[l0][m1]alphamerge[live]`,
		`[bg][ipad]overlay=${L.screen.x}:${L.screen.y}:eof_action=repeat[v1]`,
		`[v1][live]overlay=${L.live.x}:${L.live.y}:eof_action=repeat[v2]`
	];
	let last = 'v2';
	liveCues.forEach((c, i) => {
		const d = c.to - c.from;
		f.push(
			`[${liveBase + i}:v]format=rgba,fade=t=in:st=0:d=${FADE}:alpha=1,fade=t=out:st=${Math.max(0, d - FADE).toFixed(3)}:d=${FADE}:alpha=1,setpts=PTS-STARTPTS+${(INTRO + c.from).toFixed(3)}/TB[lb${i}]`,
			`[${last}][lb${i}]overlay=0:0:eof_action=pass[lv${i}]`
		);
		last = `lv${i}`;
	});
	cues.forEach((c, i) => {
		const d = c.to - c.from;
		const fadeOut = Math.max(0, d - FADE);
		f.push(
			`[${6 + i}:v]format=rgba,fade=t=in:st=0:d=${FADE}:alpha=1,fade=t=out:st=${fadeOut.toFixed(3)}:d=${FADE}:alpha=1,setpts=PTS-STARTPTS+${(INTRO + c.from).toFixed(3)}/TB[cap${i}]`,
			`[${last}][cap${i}]overlay=0:0:eof_action=pass[c${i}]`
		);
		last = `c${i}`;
	});
	f.push(
		`[4:v]format=rgba,fade=t=out:st=${INTRO - 0.7}:d=0.7:alpha=1[intro]`,
		`[${last}][intro]overlay=0:0:eof_action=pass[v3]`,
		`[5:v]format=rgba,fade=t=in:st=0:d=0.8:alpha=1,setpts=PTS-STARTPTS+${(INTRO + body).toFixed(3)}/TB[outro]`,
		`[v3][outro]overlay=0:0:eof_action=pass,fps=${FPS},format=yuv420p[v]`
	);
	if (hasAudio) {
		f.push(
			`[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,afade=t=out:st=${(body - 0.4).toFixed(3)}:d=0.4,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,adelay=${Math.round(INTRO * 1000)}:all=1,apad[a]`
		);
	}

	const out = join(dir, `${take.scenario}.mp4`);
	const ffArgs = ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', f.join(';'), '-map', '[v]'];
	if (hasAudio) ffArgs.push('-map', '[a]', '-c:a', 'aac_at', '-b:a', '192k');
	ffArgs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-t', total.toFixed(3), '-movflags', '+faststart', out);
	log('composing…');
	execFileSync('ffmpeg', ffArgs, { stdio: 'inherit' });
	execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(INTRO + Math.min(8, body / 2)), '-i', out, '-frames:v', '1', join(dir, 'poster.png')]);
	writeFileSync(
		join(dir, 'meta.json'),
		JSON.stringify({ scenario: take.scenario, title: take.title, duration: total, canvas: CANVAS, captions: cues }, null, '\t')
	);
	return out;
}
