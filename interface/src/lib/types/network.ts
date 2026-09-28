/**
 * The Mac's addresses an iPad can reach, as `GET /api/network` reports them
 * (`$lib/server/networkAddresses`) and Settings reads them
 * (`components/v6/settings/ipadAddress`).
 */

export interface MacAddress {
	ip: string;
	/** USB-C: the cable link to the iPad. Network: Wi-Fi or Ethernet. */
	kind: 'usb-c' | 'network';
	iface: string;
}

export interface MacAddresses {
	/** The Bonjour name (`looping-studio.local`), or '' when the Mac has none. */
	hostname: string;
	addresses: MacAddress[];
}
