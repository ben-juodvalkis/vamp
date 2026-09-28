#!/usr/bin/env node

const { networkInterfaces } = require('os');

/**
 * The Mac's side of the iPad's USB-C link: `network.ipad.usbc` (the address
 * INSTALLATION.md has you set), else only a self-assigned 169.254 address
 * counts — the rule Settings uses (`interface/src/lib/server/networkAddresses.ts`).
 */
function configuredUsbc() {
    try {
        return require('../interface/bridge/utils/constants').loadConstants().network?.ipad?.usbc || '';
    } catch {
        return '';
    }
}

/**
 * Detect and report available network interfaces for iPad setup
 * Returns WiFi and USB-C interface addresses with clear access URLs
 */
function detectInterfaces() {
    const interfaces = networkInterfaces();
    const usbc = configuredUsbc();
    const result = {
        wifi: null,
        usb: null,
        localhost: '127.0.0.1'
    };

    // Process each interface
    for (const [name, addresses] of Object.entries(interfaces)) {
        if (!addresses) continue;

        for (const addr of addresses) {
            // Skip non-IPv4 and internal addresses
            if (addr.family !== 'IPv4' || addr.internal) continue;

            const ip = addr.address;

            // USB-C/iPad interface: the configured address, or link-local 169.254.x.x
            if (ip === usbc || ip.startsWith('169.254.')) {
                result.usb = { name, ip };
            }
            // WiFi interface (usually en0 on Mac, starts with 192.168 or 10.x)
            else if ((name.startsWith('en') || name.includes('wifi')) &&
                (ip.startsWith('192.168.') || ip.startsWith('10.'))) {
                result.wifi = { name, ip };
            }
        }
    }

    return result;
}

/**
 * Display network interface information with clear URLs
 */
function displayInterfaces(port = 8889) {
    const interfaces = detectInterfaces();
    
    console.log('\n🌐 Network Interfaces Detected:');
    console.log('='.repeat(50));
    
    // Mac localhost access
    console.log(`\n🖥️  Mac (localhost):`);
    console.log(`   http://localhost:${port}`);
    
    // WiFi access
    if (interfaces.wifi) {
        console.log(`\n📶 WiFi Network (${interfaces.wifi.name}):`);
        console.log(`   Mac:  http://${interfaces.wifi.ip}:${port}`);
        console.log(`   iPad: http://${interfaces.wifi.ip}:${port}`);
        console.log(`   📝 Note: iPad must be on same WiFi network`);
    } else {
        console.log(`\n📶 WiFi Network: Not detected`);
        console.log(`   📝 Make sure Mac is connected to WiFi`);
    }
    
    // USB-C access  
    if (interfaces.usb) {
        console.log(`\n🔌 USB-C Connection (${interfaces.usb.name}):`);
        console.log(`   Mac:  http://${interfaces.usb.ip}:${port}`);
        console.log(`   iPad: http://${interfaces.usb.ip}:${port}`);
        console.log(`   📝 Note: iPad must be connected via USB-C cable`);
        console.log(`   📝 iPad network config: IP=${interfaces.usb.ip.replace(/\.\d+$/, '.2')}, Router=${interfaces.usb.ip}`);
    } else {
        console.log(`\n🔌 USB-C Connection: Not detected`);
        console.log(`   📝 Connect iPad via USB-C cable and wait a moment`);
    }
    
    console.log('\n' + '='.repeat(50));
    
    return interfaces;
}

/**
 * Get the best available IP for iPad access
 */
function getBestIPadIP() {
    // Try to load preferred IP from constants
    try {
        const constants = require('../interface/bridge/utils/constants').loadConstants();

        // Use hardcoded preferred USB-C IP if configured
        if (constants.network?.ipad?.usbcPreferred) {
            console.log(`📌 Using preferred USB-C IP: ${constants.network.ipad.usbcPreferred}`);
            return constants.network.ipad.usbcPreferred;
        }
    } catch (error) {
        // Silently fall back to auto-detection if config can't be loaded
    }

    // Fall back to auto-detection
    const interfaces = detectInterfaces();

    // Prefer USB-C (more reliable), fallback to WiFi
    if (interfaces.usb) {
        return interfaces.usb.ip;
    } else if (interfaces.wifi) {
        return interfaces.wifi.ip;
    } else {
        return 'localhost';
    }
}

// CLI usage
if (require.main === module) {
    const port = process.argv[2] || 8889;
    const interfaces = displayInterfaces(port);
    
    // Exit with status code indicating USB-C availability
    process.exit(interfaces.usb ? 0 : 1);
}

module.exports = { detectInterfaces, displayInterfaces, getBestIPadIP };