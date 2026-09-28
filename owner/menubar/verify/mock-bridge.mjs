// Minimal, dependency-free stand-in for the Node OSC bridge + Python surface,
// used only by verify.mjs. Implements just enough RFC 6455 (text frames) to
// exercise the exact choreography the menu-bar app relies on:
//
//   - handshake/hello  -> accept, then re-emit auto_arm + move_volume_knob
//                         (mirrors the surface's emit_on_accept, §2.12)
//   - <toggle>/query   -> reply on the SAME address to the asking client
//   - <toggle> [0|1]   -> update state, echo on the same address to ALL
//                         clients (surface echo + bridge broadcast) — this is
//                         what makes menu-bar <-> web-UI sync bidirectional
//   - /bridge/ping     -> periodic liveness beacon
//   - one broadcast is wrapped in a /bridge/batch envelope to exercise unwrap
//
// No `ws` dependency: raw framing over the http 'upgrade' socket so the harness
// runs on a bare Node with nothing installed.

import http from 'node:http';
import crypto from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const SETTABLE = new Set([
  '/looping/v3/session/auto_arm',
  '/looping/v3/session/move_volume_knob',
  '/looping/v3/session/auto_capture',
  '/looping/v3/session/metronome',
  // session_record + loop are no longer surfaced by the menu-bar app, but the
  // bridge still relays them — kept here so the /bridge/batch-unwrap path (the
  // batched `loop` echo below) stays exercised.
  '/looping/v3/session/session_record',
  '/looping/v3/session/loop',
]);

export function startMockBridge({ mode = 'dev', auth = false, secret = 'test-secret' } = {}) {
  /** Addresses refused for want of authentication. Asserted by verify.mjs. */
  const refusals = [];
  const state = {
    '/looping/v3/session/auto_arm': 1,
    '/looping/v3/session/move_volume_knob': 1,
    // Mirrors the surface's mode-derived default: ipad→on, dev→off. The real
    // surface seeds this on the first heartbeat; the mock resolves it up front
    // from the launch mode it was started with.
    '/looping/v3/session/auto_capture': mode === 'ipad' ? 1 : 0,
    '/looping/v3/session/metronome': 0,
    '/looping/v3/session/session_record': 0,
    '/looping/v3/session/loop': 0,
  };
  const clients = new Set();
  let pingSeq = 0;

  const server = http.createServer();

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    clients.add(socket);

    // Auth challenge first, then the launch mode — the same order the
    // real bridge uses, and the order is the point: a client that seeds
    // on the first ordinary frame will race its own (async) answer and
    // be refused. That exact bug shipped in the Swift client and this
    // harness did not catch it, because the mock never challenged.
    socket.authed = !auth;
    if (auth) {
      socket.authSalt = crypto.randomBytes(8).toString('hex');
      sendTo(socket, '/bridge/auth/challenge', [socket.authSalt]);
    }

    // Announce launch mode on connect, like WebSocketServer.handleConnection.
    sendTo(socket, '/bridge/server_mode', [mode]);

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let frame;
      while ((frame = readFrame(buffer)) !== null) {
        buffer = frame.rest;
        if (frame.opcode === 0x8) {
          // close
          socket.end();
          return;
        }
        if (frame.opcode === 0x9) {
          // ping -> pong
          socket.write(encodeFrame(frame.payload, 0xa));
          continue;
        }
        if (frame.opcode === 0x1) {
          handleText(frame.payload.toString('utf8'), socket);
        }
      }
    });

    const cleanup = () => clients.delete(socket);
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  function sendTo(socket, address, args) {
    socket.write(encodeFrame(Buffer.from(JSON.stringify({ address, args }), 'utf8'), 0x1));
  }

  function broadcast(address, args, { batched = false } = {}) {
    const inner = { address, args };
    const payload = batched
      ? { address: '/bridge/batch', messages: [inner], source: 'bridge' }
      : inner;
    const frame = encodeFrame(Buffer.from(JSON.stringify(payload), 'utf8'), 0x1);
    // Unauthenticated clients see nothing — refusing only their writes
    // would still hand the whole Set to anything that opened a socket.
    for (const c of clients) if (c.authed) c.write(frame);
  }

  function handleText(text, socket) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const { address, args = [] } = msg;

    // Auth gate, mirroring WebSocketServer: the auth frame is allowed
    // through, everything else from an unauthenticated client is
    // refused and nothing is broadcast back to it.
    if (address === '/bridge/auth') {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(socket.authSalt || '')
        .digest('hex');
      if (args[0] === expected) {
        socket.authed = true;
        sendTo(socket, '/bridge/auth/result', [1]);
      } else {
        sendTo(socket, '/bridge/auth/result', [0, 'bad-proof']);
      }
      return;
    }
    if (!socket.authed) {
      refusals.push({ address });
      return;
    }

    if (address === '/looping/v3/handshake/hello') {
      sendTo(socket, '/looping/v3/handshake/accept', ['3.3.0', 'mock-session', 1]);
      // emit_on_accept re-emit of the primary SessionSettings toggles.
      sendTo(socket, '/looping/v3/session/auto_arm', [state['/looping/v3/session/auto_arm']]);
      sendTo(socket, '/looping/v3/session/move_volume_knob', [
        state['/looping/v3/session/move_volume_knob'],
      ]);
      sendTo(socket, '/looping/v3/session/auto_capture', [
        state['/looping/v3/session/auto_capture'],
      ]);
      return;
    }

    // /query -> reply on the same address to the asking client only.
    if (address.endsWith('/query')) {
      const base = address.slice(0, -'/query'.length);
      if (base in state) sendTo(socket, address, [state[base]]);
      return;
    }

    // A set -> store + echo to everyone (bidirectional sync).
    if (SETTABLE.has(address) && args.length >= 1) {
      const v = Number(args[0]) === 1 ? 1 : 0;
      state[address] = v;
      // Wrap the loop echo in a batch envelope to exercise the unwrap path.
      broadcast(address, [v], { batched: address === '/looping/v3/session/loop' });
    }
  }

  const pingTimer = setInterval(() => {
    for (const c of clients) sendTo(c, '/bridge/ping', [pingSeq++, Date.now()]);
    broadcast('/bridge/server_mode', [mode]); // self-healing beacon
  }, 1000);
  pingTimer.unref?.();

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        state,
        secret,
        refusals,
        clientCount: () => clients.size,
        close: () =>
          new Promise((res) => {
            clearInterval(pingTimer);
            for (const c of clients) c.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

// --- minimal RFC 6455 framing -------------------------------------------------

// Parse one frame from the head of `buf`. Returns { opcode, payload, rest } or
// null if a full frame isn't buffered yet. Handles masked client frames and
// 7 / 16 / 64-bit lengths.
function readFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    len = Number(buf.readBigUInt64BE(offset));
    offset += 8;
  }

  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;

  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (masked) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  return { opcode, payload, rest: buf.subarray(offset + len) };
}

// Encode an unmasked server frame (FIN set).
function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}
