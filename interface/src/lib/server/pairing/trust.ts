/**
 * Who is the Mac itself (ADR-491, security.plan.md "Who is trusted" §1–2).
 *
 * A caller is the Mac when its address is loopback or one of the Mac's own
 * interface addresses: a browser on the Mac, whichever address it used. Vamp
 * for iPad is the cable, and it is this case too — its connections reach the
 * page server from Vamp for Mac's relay on loopback. Safari on an iPad,
 * over the cable's self-assigned link or Wi-Fi, is not: it pairs.
 */
import { networkInterfaces } from 'node:os';

/** `::ffff:192.168.1.4` → `192.168.1.4`; `fe80::1%en0` → `fe80::1`. */
export function normalizeAddress(address: string): string {
	let a = address.trim().toLowerCase();
	if (a.startsWith('::ffff:') && a.includes('.')) a = a.slice('::ffff:'.length);
	const zone = a.indexOf('%');
	return zone >= 0 ? a.slice(0, zone) : a;
}

export function isLoopback(address: string): boolean {
	const a = normalizeAddress(address);
	return a === '::1' || a.startsWith('127.');
}

/** Every address this Mac answers on, normalized. Read per call: links come and go. */
export function ownAddresses(
	interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): Set<string> {
	const out = new Set<string>();
	for (const infos of Object.values(interfaces)) {
		for (const info of infos ?? []) out.add(normalizeAddress(info.address));
	}
	return out;
}

export function isTheMac(address: string, own: Set<string> = ownAddresses()): boolean {
	if (!address) return false;
	return isLoopback(address) || own.has(normalizeAddress(address));
}
