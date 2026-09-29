/**
 * Node's side of `recorder/Recorder.swift`: builds it when the source is
 * newer than the binary, lists windows, and runs a recording (or the MIDI
 * port alone) as a child speaking JSON lines.
 */

import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { REPO_ROOT } from '../shot/stack.mjs';

const SOURCE = join(REPO_ROOT, 'scripts', 'demo', 'recorder', 'Recorder.swift');
const BINARY = join(REPO_ROOT, 'scripts', '.cache', 'demo', 'demo-recorder');

export function buildRecorder(log = () => {}) {
	if (existsSync(BINARY) && statSync(BINARY).mtimeMs >= statSync(SOURCE).mtimeMs) return BINARY;
	log('building the recorder (swiftc)…');
	mkdirSync(join(REPO_ROOT, 'scripts', '.cache', 'demo'), { recursive: true });
	execFileSync('swiftc', ['-O', '-swift-version', '5', '-o', BINARY, SOURCE], { stdio: ['ignore', 'ignore', 'inherit'] });
	return BINARY;
}

/** Every window ScreenCaptureKit sees. Throws with the recorder's own message. */
export function listWindows() {
	const out = execFileSync(buildRecorder(), ['list'], { encoding: 'utf8' }).trim();
	const parsed = JSON.parse(out);
	if (!Array.isArray(parsed)) throw new Error(parsed.message ?? out);
	return parsed;
}

/**
 * A running recorder child. `events` emits each JSON line by its `event`
 * name; `send` writes a command; `stop` resolves with the `stopped` event.
 */
class Child {
	constructor(args, log) {
		this.events = new EventEmitter();
		this.proc = spawn(buildRecorder(log), args, { stdio: ['pipe', 'pipe', 'inherit'] });
		this.exited = new Promise((resolve) => this.proc.on('exit', resolve));
		createInterface({ input: this.proc.stdout }).on('line', (line) => {
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				return log(`recorder: ${line}`);
			}
			this.events.emit(msg.event, msg);
			this.events.emit('any', msg);
		});
	}

	send(cmd) {
		this.proc.stdin.write(`${JSON.stringify(cmd)}\n`);
	}

	/** Resolves on `event`, rejects on the recorder's `error` or its exit. */
	next(event, timeoutMs = 15_000) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => done(reject, new Error(`recorder: no "${event}" in ${timeoutMs} ms`)), timeoutMs);
			const onEvent = (m) => done(resolve, m);
			const onError = (m) => done(reject, new Error(`recorder: ${m.message}`));
			const onExit = (code) => done(reject, new Error(`recorder exited (${code}) before "${event}"`));
			const done = (fn, v) => {
				clearTimeout(timer);
				this.events.off(event, onEvent);
				this.events.off('error', onError);
				this.proc.off('exit', onExit);
				fn(v);
			};
			this.events.on(event, onEvent);
			this.events.on('error', onError);
			this.proc.on('exit', onExit);
		});
	}

	/** MIDI bytes, each `inMs` from when the recorder reads the line. */
	midi(events) {
		this.send({ cmd: 'midi', events });
	}

	/** Seconds into the file, on the file's own clock. */
	async mark(label) {
		const reply = this.next('mark', 3000);
		this.send({ cmd: 'mark', label });
		return (await reply).t;
	}

	async stop() {
		const stopped = this.next('stopped', 30_000);
		this.send({ cmd: 'stop' });
		const result = await stopped;
		await this.exited;
		return result;
	}

	kill() {
		if (this.proc.exitCode === null) this.proc.kill('SIGINT');
	}
}

export async function startRecording({ out, windows, audioPid, fps = 60, log = () => {} }) {
	const args = ['record', '--out', out, '--fps', String(fps)];
	for (const id of windows) args.push('--window', String(id));
	if (audioPid) args.push('--audio-pid', String(audioPid));
	const child = new Child(args, log);
	const tracks = [];
	child.events.on('track', (t) => tracks.push(t));
	await child.next('recording');
	child.tracks = tracks;
	return child;
}

/** The MIDI port without capture: a take rehearsed with no recording. */
export async function startMidiOnly({ log = () => {} } = {}) {
	const child = new Child(['midi'], log);
	await child.next('ready');
	child.tracks = [];
	child.mark = async () => null;
	child.stop = async () => {
		child.send({ cmd: 'stop' });
		await child.exited;
		return null;
	};
	return child;
}
