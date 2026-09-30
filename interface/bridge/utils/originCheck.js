/**
 * Which browser pages may open the bridge's WebSocket.
 *
 * A browser sends `Origin` on every WebSocket upgrade, and a page cannot
 * forge it, so this refuses a socket opened by a page from anywhere but
 * Vamp's own server. It mirrors the interface server's own rule (Vite's
 * `allowedHosts` in `interface/vite.config.ts`): localhost, an IP address,
 * or a Bonjour `.local` name. A page from any other name, such as a
 * website that points its own name at the Mac (DNS rebinding), is refused
 * before the auth challenge is even sent.
 *
 * No `Origin` at all is allowed: that is a client outside a browser (the
 * menu-bar app, the shot and perf scripts), which still has to pass the
 * auth challenge. `Origin: null` (a file:// page, a sandboxed frame) is
 * refused.
 */

const net = require('net');

function hostnameAllowed(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (net.isIP(host)) return true;
    return host.endsWith('.local');
}

/** True if a WebSocket upgrade carrying this `Origin` header may proceed. */
function originAllowed(origin) {
    if (origin === undefined || origin === '') return true;
    let url;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return hostnameAllowed(url.hostname);
}

module.exports = { originAllowed };
