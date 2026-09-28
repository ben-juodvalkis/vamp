/**
 * `GET /api/network` — the Mac's addresses an iPad can reach, and its
 * Bonjour name. Settings puts the page's own port on them for "Open on the
 * iPad" (`$lib/server/networkAddresses`).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { macAddresses } from '$lib/server/networkAddresses';

export const GET: RequestHandler = () => json(macAddresses(), { headers: { 'cache-control': 'no-store' } });
