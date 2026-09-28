/**
 * `GET /api/places/list` — every folder a user can tick (Live's sidebar
 * Places, the User Library, the installed Packs), each with its tick, plus
 * whether this Mac is on its first run and which catalog source is in use
 * (onboarding.plan.md §2, §6.2, §7). Settings' Places card reads it.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { placesService } from '$lib/server/places/service';

export const GET: RequestHandler = () => json(placesService().listing(), { headers: { 'cache-control': 'no-store' } });
