/**
 * The side-by-side clip, from the recorder's one file (plan §1):
 *
 *   ┌─────────────────────┬─────────────────────┐
 *   │ interface  960×720  │ Live       960×720  │
 *   ├─────────────────────┴─────────────────────┤
 *   │ caption                           1920×360│
 *   └───────────────────────────────────────────┘
 *
 * This ffmpeg has no drawtext, so captions are drawn by Chromium into PNGs
 * and overlaid, each while its step is current. The same timings go to a
 * WebVTT sidecar for the docs page. Trimmed to a beat before the first
 * gesture; audio loudness-normalized.
 */

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PANE = { w: 960, h: 720 };
const OUT = { w: 1920, h: 1080 };
const BG = '0x111214';

const vttTime = (s) => {
	const ms = Math.max(0, Math.round(s * 1000));
	const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
	const m = String(Math.floor(ms / 60_000) % 60).padStart(2, '0');
	const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
	return `${h}:${m}:${sec}.${String(ms % 1000).padStart(3, '0')}`;
};

async function renderCaptions(dir, cues) {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: OUT.w, height: OUT.h - PANE.h } });
	const files = [];
	for (const [i, cue] of cues.entries()) {
		await page.setContent(`<!doctype html><body style="margin:0;background:#111214;height:100vh;display:flex;align-items:center;justify-content:center;font:600 54px -apple-system,system-ui,sans-serif;color:#f2f2f2;letter-spacing:.01em">${cue.text.replace(/</g, '&lt;')}</body>`);
		const file = join(dir, `caption-${i}.png`);
		await page.screenshot({ path: file });
		files.push(file);
	}
	await browser.close();
	return files;
}

export async function compose({ dir, take, log = () => {} }) {
	const video = take.tracks.filter((t) => t.kind === 'video');
	const [ipad, live] = video;
	const hasAudio = take.tracks.some((t) => t.kind === 'audio');

	// The interface's capture includes the window's title bar; the page is
	// the iPad-sized box under it.
	const cs = ipad.scale;
	const crop = {
		x: 0,
		y: Math.round(take.ipad.chromePts * cs),
		w: Math.min(ipad.width, Math.round(1366 * take.ipad.scale * cs)),
		h: Math.min(ipad.height - Math.round(take.ipad.chromePts * cs), Math.round(1024 * take.ipad.scale * cs))
	};

	const beat = 60 / take.tempo;
	const start = Math.max(0, take.steps[0].t - beat);
	const end = take.endMark;
	const cues = take.steps.map((s, i) => ({
		text: s.caption,
		from: s.t - start,
		to: (take.steps[i + 1]?.t ?? end) - start
	}));
	writeFileSync(
		join(dir, 'captions.vtt'),
		`WEBVTT\n\n${cues.map((c) => `${vttTime(c.from)} --> ${vttTime(c.to)}\n${c.text}\n`).join('\n')}`
	);

	const capDir = join(dir, 'captions');
	mkdirSync(capDir, { recursive: true });
	const pngs = await renderCaptions(capDir, cues);

	const fit = `scale=${PANE.w}:${PANE.h}:force_original_aspect_ratio=decrease,pad=${PANE.w}:${PANE.h}:(ow-iw)/2:(oh-ih)/2:color=${BG}`;
	const filters = [
		`color=c=${BG}:s=${OUT.w}x${OUT.h}:r=60,trim=duration=${end - start}[bg]`,
		`[0:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},${fit}[ipad]`,
		`[0:v:1]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${fit}[live]`,
		`[bg][ipad]overlay=0:0:eof_action=repeat[l1]`,
		`[l1][live]overlay=${PANE.w}:0:eof_action=repeat[l2]`
	];
	let last = 'l2';
	cues.forEach((c, i) => {
		filters.push(`[${last}][${i + 1}:v]overlay=0:${PANE.h}:enable='between(t,${c.from.toFixed(3)},${c.to.toFixed(3)})'[c${i}]`);
		last = `c${i}`;
	});
	filters.push(`[${last}]fps=60,format=yuv420p[v]`);
	if (hasAudio) {
		filters.push(`[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`);
	}

	const out = join(dir, `${take.scenario}.mp4`);
	const ffArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', join(dir, 'raw.mov')];
	for (const p of pngs) ffArgs.push('-loop', '1', '-i', p);
	ffArgs.push('-filter_complex', filters.join(';'), '-map', '[v]');
	if (hasAudio) ffArgs.push('-map', '[a]', '-c:a', 'aac_at', '-b:a', '192k');
	ffArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-t', String(end - start), '-movflags', '+faststart', out);
	log('composing…');
	execFileSync('ffmpeg', ffArgs, { stdio: 'inherit' });
	execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.min(4, (end - start) / 2)), '-i', out, '-frames:v', '1', join(dir, 'poster.png')]);
	writeFileSync(
		join(dir, 'meta.json'),
		JSON.stringify({ scenario: take.scenario, title: take.title, duration: end - start, captions: cues }, null, '\t')
	);
	return out;
}
