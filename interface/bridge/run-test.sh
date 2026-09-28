#!/bin/bash
set -e

# Kill any existing processes on port 8081
lsof -ti:8081 | xargs kill -9 2>/dev/null || true
pkill -f enhanced-osc-bridge 2>/dev/null || true
sleep 1

cd /Users/Shared/DevWork/GitHub/vamp/interface/bridge

echo "=== Starting Bridge ==="
node enhanced-osc-bridge.js &
BRIDGE_PID=$!
sleep 3

echo ""
echo "=== Testing WebSocket Connection ==="
node -e "
const WebSocket = require('ws');
console.log('ws version:', require('ws/package.json').version);

const ws = new WebSocket('ws://localhost:8081', { perMessageDeflate: false });
let messageCount = 0;

ws.on('open', () => {
    console.log('CLIENT: Connected!');
    ws.send(JSON.stringify({address: '/init', args: []}));

    setTimeout(() => {
        ws.send(JSON.stringify({address: '/test', args: [1,2,3]}));
    }, 300);

    setTimeout(() => {
        ws.send(JSON.stringify({address: '/ping', args: ['hello']}));
    }, 600);
});

ws.on('message', (d) => {
    messageCount++;
    console.log('CLIENT: Message #' + messageCount + ':', d.toString().slice(0,80));
});

ws.on('error', (e) => {
    console.error('CLIENT ERROR:', e.message, '- code:', e.code);
});

ws.on('close', (code) => {
    console.log('CLIENT: Closed with code:', code);
    console.log('CLIENT: Total messages received:', messageCount);

    // 1000 = normal close, 1005 = no status code (also normal for client-initiated)
    if ((code === 1000 || code === 1005) && messageCount >= 1) {
        console.log('SUCCESS: Connection stable!');
        process.exit(0);
    } else {
        console.log('FAILED: Connection dropped or no messages received');
        process.exit(1);
    }
});

setTimeout(() => {
    console.log('CLIENT: Test complete, closing gracefully...');
    ws.close();
}, 2000);
"

TEST_EXIT=$?

# Cleanup
kill $BRIDGE_PID 2>/dev/null || true

exit $TEST_EXIT
