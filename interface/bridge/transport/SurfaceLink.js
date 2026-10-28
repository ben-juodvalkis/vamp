/**
 * Surface link — where a bridge→surface message goes (ADR-489).
 *
 * The surface drains its UDP port (11020) only from Live's pump, so a
 * stalled tick plus a full receive buffer dropped datagrams: the
 * handshake hello (ADR-418), a fader write, a swap hop. The TCP leg
 * (11022, `SurfaceTcpClient.js`) holds them in order until the pump runs
 * again, so while it is connected everything goes that way. While it is
 * down — Live closed, a set loading, the backoff before a redial — the
 * UDP port carries it, exactly as before.
 *
 * Shaped like an `osc.UDPPort` for sending (`send({address, args})`), so
 * it stands in for `udpPorts.pythonSurface` wherever the bridge sends:
 * `routeMessageToUDP` reaches it through the port map it is handed, and
 * the orchestrator's own senders call it directly. Args are osc.js args
 * on both legs, and both encode with `metadata: false`, so a typed arg
 * (`{type: 'i', value}`) or a blob is the same bytes on either.
 *
 * One message, one leg. Nothing is sent twice, and nothing is queued for
 * the stream while it is down: a write delivered after an unknown delay
 * is worse than one sent now on the leg that is there.
 *
 * "Up" means the surface has said it takes messages on the stream
 * (`acceptsMessages()`), not merely that it is connected: a surface from
 * before ADR-489 accepts the connection and drops everything on it, so a
 * bridge restarted ahead of Live keeps that surface on UDP.
 */

/**
 * @param {Object} opts
 * @param {{ acceptsMessages(): boolean, send(address: string, args?: unknown[]): boolean }} opts.tcp
 * @param {() => ({ send(packet: { address: string, args?: unknown[] }): void } | null | undefined)} opts.udpPort
 *        Read per send, so a port opened (or torn down) later is seen.
 * @returns {{ send(packet: { address: string, args?: unknown[] }): 'tcp'|'udp', stats(): Object }}
 *          `send` names the leg it used, and throws when the stream is
 *          down and there is no UDP port either.
 */
function createSurfaceLink({ tcp, udpPort }) {
    const stats = { tcp: 0, udp: 0, none: 0 };

    return {
        send(packet) {
            if (tcp.acceptsMessages()) {
                // A false here is a frame the stream refused (backed up,
                // or would not encode) and has already counted and
                // logged. Falling back would deliver it ahead of the
                // frames still queued on the stream, so it is not sent.
                tcp.send(packet.address, packet.args || []);
                stats.tcp += 1;
                return 'tcp';
            }
            const port = udpPort();
            if (!port) {
                stats.none += 1;
                throw new Error('python surface port is not open');
            }
            port.send(packet);
            stats.udp += 1;
            return 'udp';
        },

        stats() {
            return { ...stats, leg: tcp.acceptsMessages() ? 'tcp' : 'udp' };
        }
    };
}

module.exports = { createSurfaceLink };
