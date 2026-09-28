// JS port of the Swift OSCEnvelope (Sources/LoopingMenuBar/OSCEnvelope.swift),
// kept line-for-line equivalent so the harness validates the exact same wire
// logic the menu-bar app ships. Also matches buildWireMessage / dispatchInbound
// in interface/src/lib/api/connection/WebSocketConnection.ts.

export function encode(address, args) {
  const wireArgs = [];
  const argsTypes = [];
  for (const arg of args) {
    if (typeof arg === 'string') {
      wireArgs.push(arg);
      argsTypes.push('string');
    } else {
      wireArgs.push(arg);
      argsTypes.push('number');
    }
  }
  return JSON.stringify({ address, args: wireArgs, argsTypes });
}

// Returns an array of { address, args } messages, unwrapping /bridge/batch.
export function decode(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return [];
  }
  return decodeObject(obj);
}

function decodeObject(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const address = typeof obj.address === 'string' ? obj.address : '';
  if (address === '/bridge/batch' && Array.isArray(obj.messages)) {
    return obj.messages.flatMap(decodeObject);
  }
  if (!address) return [];
  const args = Array.isArray(obj.args) ? obj.args : [];
  return [{ address, args }];
}
