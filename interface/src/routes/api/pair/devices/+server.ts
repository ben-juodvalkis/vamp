/**
 * Settings → Devices (ADR-491): the paired devices, and forgetting them.
 * `GET` → `{devices}`; `DELETE ?hash=<hash>` forgets one, `DELETE ?all=1`
 * every one. Forgetting applies on a device's next connection, never to an
 * open one. Behind the hook's trust gate.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { deviceStore } from '$lib/server/pairing/service';

export const GET: RequestHandler = () =>
	json(
		{
			devices: deviceStore()
				.list()
				.map(({ hash, name, address, firstUsed, lastUsed }) => ({ hash, name, address, firstUsed, lastUsed }))
		},
		{ headers: { 'cache-control': 'no-store' } }
	);

export const DELETE: RequestHandler = ({ url }) => {
	if (url.searchParams.get('all') === '1') return json({ forgotten: deviceStore().forgetAll() });
	const hash = url.searchParams.get('hash') ?? '';
	return json({ forgotten: deviceStore().forget(hash) ? 1 : 0 });
};
