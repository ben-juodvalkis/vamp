/**
 * The Mac's addresses an iPad can reach, for Settings' "Open on the iPad"
 * (plan.md §11). The page's own address says nothing on the Mac — it is
 * `localhost`, which on the iPad is the iPad — so the server names the
 * Mac's IPv4 addresses and its Bonjour name, and the page puts its own port
 * on them.
 *
 * USB-C first: the rig's iPad is on a cable (`network.ipad.usbc`, the Mac's
 * side of that link, or a self-assigned 169.254 address, which is what the
 * link gets unconfigured — the same rule as `scripts/detect-interfaces.js`).
 * Tunnels (a VPN, Tailscale's `utun`), AirDrop's `awdl` and loopback are
 * left out: an iPad on the desk reaches none of them.
 */
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { configSection } from './runtimeConfig';
import type { MacAddress, MacAddresses } from '$lib/types/network';

const UNREACHABLE_IFACE = /^(lo|utun|ipsec|ppp|gif|stf|awdl|llw|anpi|ap)\d*/;

export function classifyAddresses(
	interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
	usbcAddress = ''
): MacAddress[] {
	const out: MacAddress[] = [];
	for (const [iface, infos] of Object.entries(interfaces)) {
		if (!infos || UNREACHABLE_IFACE.test(iface)) continue;
		for (const info of infos) {
			if (info.family !== 'IPv4' || info.internal) continue;
			const usb = info.address === usbcAddress || info.address.startsWith('169.254.');
			out.push({ ip: info.address, kind: usb ? 'usb-c' : 'network', iface });
		}
	}
	return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'usb-c' ? -1 : 1));
}

export function macAddresses(): MacAddresses {
	const ipad = configSection<{ ipad?: { usbc?: string } }>('network').ipad;
	const name = hostname();
	return {
		hostname: name.endsWith('.local') ? name : '',
		addresses: classifyAddresses(networkInterfaces(), ipad?.usbc ?? '')
	};
}
