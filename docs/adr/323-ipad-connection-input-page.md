# ADR-323: iPad Connection Input Page

**Date:** 2026-03-11
**Status:** Implemented

## Context

When connecting an iPad via USB-C, the Mac gets a link-local IP address in the `169.254.x.x` range. This address changes each time the cable is reconnected or the network interface resets. The previous workflow required:

1. Running `npm run ipad` which detects the current IP
2. AirDropping the full URL to the iPad
3. Opening it in Safari and saving to home screen

This was friction-heavy — the AirDrop step had to be repeated every time the IP changed, and saving a new home screen shortcut each time was tedious.

## Decision

Add a standalone `/connect` route that serves as a persistent entry point saved once to the iPad home screen. The user types only the two variable octets of the USB-C address (e.g., `37.129` from `169.254.37.129`) and taps Connect to redirect to the full looper interface URL.

### Key design choices:

1. **Layout-independent route** (`+page@.svelte`) — skips the root layout entirely so there's no WebSocket connection, no service initialization, no Ableton dependency. It's just a lightweight redirect page.

2. **Accessed via stable WiFi address** — the page itself is loaded from the stable WiFi IP (e.g., `192.168.50.147:8889/connect` or `bj.local:8889/connect`), avoiding the chicken-and-egg problem of needing the USB-C IP to load the page.

3. **localStorage persistence** — remembers the last-used octets and offers a one-tap reconnect button, since the IP often stays the same between sessions.

4. **iOS standalone mode** — includes `apple-mobile-web-app-capable` meta tags so when saved to the iPad home screen it runs full-screen without Safari chrome, matching the main looper interface behavior.

5. **Port-agnostic** — reads `window.location.port` to construct the redirect URL, so it works on any port (dev, preview, production) without configuration.

## Workflow

### One-time setup:
1. Connect iPad via WiFi (or USB-C with known IP)
2. Navigate to `http://<wifi-ip>:<port>/connect`
3. Save to iPad home screen (Share > Add to Home Screen)

### Every session:
1. Open the saved "Connect" app on iPad home screen
2. Check the Mac terminal for the current `169.254.x.x` address
3. Type the last two octets (e.g., `37.129`)
4. Tap Connect — redirects to the full looper interface

## File Structure

```
interface/src/routes/connect/
└── +page@.svelte    # Standalone page (no root layout)
```

## Consequences

**Positive:**
- Eliminates repeated AirDrop workflow
- One-time home screen save works permanently
- Last-used address makes reconnection near-instant when IP hasn't changed
- No new dependencies or configuration needed

**Negative:**
- User still needs to read the IP from the Mac terminal (or status page) — but only the last two octets
- Requires WiFi connectivity for the initial page load (USB-C alone isn't sufficient since the IP isn't known yet)

## Tags
`ipad`, `networking`, `usb-c`, `link-local`, `ux`, `connect`
