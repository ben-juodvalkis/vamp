/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `looping-cache-${version}`;
const ASSETS = [...build, ...files];

// Install service worker and cache assets.
//
// `skipWaiting` is what makes a rebuild reachable from the iPad. By
// default a new worker installs and then *waits* until every client
// controlled by the old one is gone. A Home Screen PWA does not
// reliably reach that state on a normal relaunch, so without this the
// iPad keeps serving the previous build's bundle indefinitely and a
// fix looks like it never landed — the only cure being a force-quit
// from the app switcher.
//
// The trade-off, stated plainly: a page already open when a new
// worker activates keeps running the bundle it loaded, and the
// `activate` handler below drops the previous cache. If that page then
// lazy-loads a chunk it had not yet fetched, it goes to the network —
// where only the *new* build's hashed filenames exist. That window is
// not new (the old cache was dropped on activation before this too),
// it is short, and it closes on the next reload. Being one relaunch
// behind on every device is the worse failure for a rig that gets
// rebuilt between sets.
sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => sw.skipWaiting())
	);
});

// Activate service worker and clean up old caches
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE_NAME) await caches.delete(key);
			}
			sw.clients.claim();
		})
	);
});

// Fetch handler - network first, fallback to cache
sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);

	// Cache-first for app assets
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(
			caches.match(event.request).then((cached) => {
				return cached || fetch(event.request);
			})
		);
		return;
	}

	// Network-first for everything else
	event.respondWith(
		fetch(event.request)
			.then((response) => {
				// Cache successful responses
				if (response.ok) {
					const clone = response.clone();
					caches.open(CACHE_NAME).then((cache) => {
						cache.put(event.request, clone);
					});
				}
				return response;
			})
			.catch(() => {
				// Fallback to cache if network fails
				return caches.match(event.request).then((cached) => {
					if (cached) return cached;
					return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
				});
			})
	);
});
