/**
 * Live's song position in beats, smooth enough to draw from. The surface
 * reports it at 10 Hz (`/looping/v3/session/song_time`); between reports
 * this runs it on at the tempo, once a frame, while the transport plays.
 * It never runs more than one report's worth past the last one heard, so
 * a stalled wire holds still rather than drifting.
 *
 * `useSongBeats(active)` must be called from a component's script: it
 * owns an `$effect`, and runs its frame loop only while `active()` is true.
 */
import { session } from '$lib/stores/session.svelte';

/** The furthest past a report the position is run on, in ms (two 10 Hz reports). */
const MAX_EXTRAPOLATE_MS = 200;

export function songBeatsAt(reported: number, reportedAt: number, now: number, tempo: number, playing: boolean): number {
	if (!playing) return reported;
	const ms = Math.min(MAX_EXTRAPOLATE_MS, Math.max(0, now - reportedAt));
	return reported + (ms * tempo) / 60000;
}

export function useSongBeats(active: () => boolean): { readonly beats: number } {
	let beats = $state(session.currentTime);
	let reported = session.currentTime;
	let reportedAt = performance.now();

	$effect(() => {
		reported = session.currentTime;
		reportedAt = performance.now();
		if (!session.isPlaying) beats = reported;
	});

	$effect(() => {
		if (!active()) return;
		let frame = 0;
		const tick = () => {
			beats = songBeatsAt(reported, reportedAt, performance.now(), session.tempo, session.isPlaying);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});

	return {
		get beats() {
			return beats;
		}
	};
}
