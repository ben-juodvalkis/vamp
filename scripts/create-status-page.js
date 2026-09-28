#!/usr/bin/env node

/**
 * Create iPad Status Page
 * Generates a simple HTML page showing iPad connection URLs prominently
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// The status page is what you point a browser at when the iPad cannot reach
// the rig, so every number on it has to be the real one. It used to print a
// hardcoded "OSC: 8080"; constants.json says 8081, and its own description
// records that 8080 produces RSV1 protocol errors here — so the bridge has
// never listened on 8080 and the page was aiming a debugger at a dead port.
const constants = require('../interface/bridge/utils/constants').loadConstants();

function getNetworkInterfaces() {
    const interfaces = os.networkInterfaces();
    // The Mac's side of the USB-C link: the configured address, or a
    // self-assigned 169.254 one (the rule Settings uses, networkAddresses.ts).
    const usbcAddress = constants.network?.ipad?.usbc || '';
    const results = {
        wifi: null,
        usbc: null,
        localhost: 'http://localhost:8889'
    };

    Object.keys(interfaces).forEach(name => {
        const iface = interfaces[name];
        if (!iface) return;

        iface.forEach(details => {
            if (details.family === 'IPv4' && !details.internal) {
                // USB-C interface - prioritize this first
                if (details.address === usbcAddress || details.address.startsWith('169.254.')) {
                    results.usbc = `http://${details.address}:8889`;
                }
                // WiFi interface (192.168.x.x or 10.x.x.x)
                else if (details.address.startsWith('192.168.') || details.address.startsWith('10.')) {
                    results.wifi = `http://${details.address}:8889`;
                }
            }
        });
    });

    return results;
}

function generateStatusHTML(interfaces) {
    const timestamp = new Date().toLocaleString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>iPad Connection - Live Looping</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
            background: #1a1a2e;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e0e0e0;
            padding: 16px;
        }

        .container {
            background: #252540;
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            width: 100%;
        }

        h1 {
            font-size: 1.25rem;
            margin-bottom: 4px;
            font-weight: 600;
            color: #fff;
        }

        .subtitle {
            font-size: 0.85rem;
            margin-bottom: 20px;
            color: #888;
        }

        .url-row {
            display: flex;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid #333;
        }

        .url-row:last-of-type {
            border-bottom: none;
        }

        .url-label {
            font-size: 0.8rem;
            color: #888;
            width: 70px;
            flex-shrink: 0;
        }

        .url-label .badge {
            display: block;
            font-size: 0.65rem;
            font-weight: 600;
            margin-top: 2px;
        }

        .url-label .badge.recommended { color: #4ade80; }
        .url-label .badge.backup { color: #fbbf24; }

        a.url-link {
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.95rem;
            color: #60a5fa;
            text-decoration: none;
            word-break: break-all;
        }

        a.url-link:hover {
            color: #93c5fd;
            text-decoration: underline;
        }

        a.url-link.primary {
            font-size: 1.1rem;
            color: #4ade80;
            font-weight: 500;
        }

        a.url-link.primary:hover {
            color: #86efac;
        }

        .status-bar {
            margin-top: 16px;
            padding: 8px 12px;
            background: rgba(74, 222, 128, 0.1);
            border-radius: 6px;
            font-size: 0.75rem;
            color: #4ade80;
            display: flex;
            justify-content: space-between;
        }

        .timestamp {
            margin-top: 12px;
            font-size: 0.7rem;
            color: #555;
            text-align: right;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Live Looping Interface</h1>
        <p class="subtitle">iPad Connection URLs</p>

        ${interfaces.usbc ? `
        <div class="url-row">
            <span class="url-label">USB-C<span class="badge recommended">BEST</span></span>
            <a href="${interfaces.usbc}" class="url-link primary" target="_blank">${interfaces.usbc}</a>
        </div>
        ` : ''}

        ${interfaces.wifi ? `
        <div class="url-row">
            <span class="url-label">WiFi<span class="badge backup">BACKUP</span></span>
            <a href="${interfaces.wifi}" class="url-link" target="_blank">${interfaces.wifi}</a>
        </div>
        ` : ''}

        <div class="url-row">
            <span class="url-label">Mac</span>
            <a href="${interfaces.localhost}" class="url-link" target="_blank">${interfaces.localhost}</a>
        </div>

        <div class="status-bar">
            <span>OSC: ${constants.osc.webSocket.port}</span>
            <span>Preview: 8889</span>
            <span>Ready</span>
        </div>

        <div class="timestamp">Updated: ${timestamp}</div>
    </div>

    <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => window.location.reload(), 30000);
    </script>
</body>
</html>`;
}

function createStatusPage() {
    const interfaces = getNetworkInterfaces();
    const html = generateStatusHTML(interfaces);
    
    // Create status directory in project root
    const statusDir = path.join(process.cwd(), 'status');
    if (!fs.existsSync(statusDir)) {
        fs.mkdirSync(statusDir, { recursive: true });
    }
    
    // Write status page
    const statusPath = path.join(statusDir, 'index.html');
    fs.writeFileSync(statusPath, html);
    
    // Start simple HTTP server for status page on port 8890
    const http = require('http');
    const statusPort = 8890;
    
    // Kill any existing server on this port
    try {
        const { execSync } = require('child_process');
        execSync(`lsof -ti:${statusPort} | xargs kill -9`, { stdio: 'ignore' });
    } catch (e) {
        // Port not in use, continue
    }
    
    // Start simple static server
    const server = http.createServer((req, res) => {
        if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });
    
    // Resolves once the port is actually bound. Callers that open a browser at
    // this URL await it instead of guessing a delay — setup-ipad.js used to
    // sleep 2s here and hope.
    const ready = new Promise((resolve) => {
        server.listen(statusPort, '0.0.0.0', () => {
            console.log(`\n📄 iPad Status Page Created:`);
            console.log(`   🌐 Open in browser: http://localhost:${statusPort}/`);
            console.log(`   📁 File location: ${statusPath}`);
            resolve();
        });
        server.on('error', (err) => {
            console.error(`⚠️  Status page server failed on :${statusPort}: ${err.message}`);
            resolve(); // non-fatal — the rest of the startup does not depend on it
        });
    });
    
    // Keep server running
    process.on('SIGINT', () => {
        server.close();
    });
    
    // Log prominent URLs to console as well
    console.log(`\n🎯 iPad Connection URLs:`);
    if (interfaces.usbc) {
        console.log(`   🔌 USB-C (RECOMMENDED): ${interfaces.usbc}`);
    }
    if (interfaces.wifi) {
        console.log(`   📶 WiFi: ${interfaces.wifi}`);
    }
    console.log(`   🖥️  Mac: ${interfaces.localhost}`);
    console.log(``);

    return { statusPath, server, ready };
}

// Run if called directly
if (require.main === module) {
    createStatusPage();
}

module.exports = { createStatusPage, getNetworkInterfaces };