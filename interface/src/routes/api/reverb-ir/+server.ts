/**
 * `/api/reverb-ir?category=<Live's category>&file=<Live's file name>` — the
 * file(s) on disk of the impulse response a Hybrid Reverb has loaded
 * (`$lib/server/reverbIr`): `{ files: [{ channel, path }] }`, two for a
 * stereo IR, one for a mono one, none for a User IR or `<empty>`. Names
 * only: the Reverb view reads the waveform through `/api/sample-peaks`,
 * whose root gate admits Live's IR folders.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { resolveIr } from '$lib/server/reverbIr';

export const GET: RequestHandler = ({ url }) => {
	const category = url.searchParams.get('category') ?? '';
	const file = url.searchParams.get('file') ?? '';
	return json({ files: resolveIr(category, file) });
};
