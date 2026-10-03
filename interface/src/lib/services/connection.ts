/**
 * connection.ts — what a component may know about the socket to Live.
 *
 * Components never import `$lib/api/simpleClient` (scripts/check-write-boundary.mjs):
 * their writes go through the named commands in this folder. This is the
 * one read a component needs from the client, for the debug overlay.
 */

export { getConnectionStatus } from '$lib/api/simpleClient';
