# Installation Guide

Step-by-step installation instructions for the Live Looping Interface.

## Overview

**Time Required:** 15-30 minutes
**Difficulty:** Beginner to Intermediate
**Prerequisites:** Basic terminal/command line knowledge

---

## Step 1: Verify System Requirements

Before installing, ensure you have:

### Required Software

- [ ] **macOS** 13.0 (Ventura) or later
- [ ] **Node.js** 18.0 or later
- [ ] **Ableton Live** 11 or 12
- [ ] **`uv`** and **`swiftc`** — only for Step 8a (the AX helper), which
      builds and signs a small Swift app. `swiftc` comes with the Xcode
      command line tools.

macOS 13 is the floor because the AX helper's app bundle declares
`LSMinimumSystemVersion 13.0` (`scripts/install-ax-helper.sh:90`). Everything
else in this project runs on 12.0; if you are on Monterey the interface works
and Step 8a does not.

### Check Your Versions

```bash
# Check macOS version
sw_vers

# Check Node.js version (should be 18.0+)
node --version

# If Node.js is not installed or outdated:
# Download from https://nodejs.org/

# For Step 8a only — the installer hard-exits without these
uv --version        # https://docs.astral.sh/uv/
swiftc --version    # xcode-select --install
```

---

## Step 2: Download the Project

### Option A: Clone with Git (Recommended)

```bash
# Navigate to where you want the project
cd ~/Documents

# Clone the repository
git clone https://github.com/ben-juodvalkis/Looping.git

# Enter the project directory
cd Looping
```

### Option B: Download ZIP

1. Go to the GitHub repository
2. Click "Code" → "Download ZIP"
3. Extract the ZIP file
4. Open Terminal and navigate to the extracted folder:
   ```bash
   cd ~/Downloads/Looping-main
   ```

---

## Step 3: Install Dependencies

This will install all required Node.js packages:

```bash
npm run setup
```

**Expected output:**
```
✅ Installing root dependencies...
✅ Installing interface dependencies...
✅ Installing bridge dependencies...
✅ All dependencies installed successfully!
```

**If you see errors:**
- Ensure Node.js 18+ is installed
- Try running `npm cache clean --force` then retry
- Check your internet connection

---

## Step 4: Your Own Settings (Optional)

`config/constants.json` is **tracked in git and works as it is**: it holds the
defaults every Mac shares. You don't edit it for your Mac. Anything of your
own goes in `config/constants.local.json`, which git ignores and every part of
the app lays over the tracked file. Objects merge key by key, so the file
holds only what differs:

```json
{
  "audio": { "defaultInputChannel": "3/4" },
  "network": { "ipad": { "usbc": "192.168.100.1" } }
}
```

| Key | What it's for |
| --- | --- |
| `audio.defaultInputChannel` | the input pair new audio tracks record from, as Live names it (unset: Live's own default input) |
| `paths.abletonApp` | a Live to open other than the one Live's preferences say you use |
| `paths.userLibraryBase` | your User Library, when Live's own `Library.cfg` doesn't name it |
| `network.ipad.usbc` | the Mac's side of the iPad's USB-C link, listed first in Settings |

Restart `npm run dev`, and Live for the surface, after changing it.

---

## Step 5: Check the Setup

`npm run setup` ends with this check, and `npm run dev` starts with it:

```bash
npm run validate
```

It fails only for what stops the app starting: Node older than 22.13, the
dependencies missing, or a config file that isn't valid JSON. Everything else
is a warning with the fix on the same line: which Live it will open, and
whether Live has this checkout as its Vamp control surface.

---

## Step 6: Set Up the Preset Browser's Places (Optional)

The preset browser shows one rail button per **Place** — a folder under
`paths.sidebarRoot` that is also in Live's browser sidebar
(`docs/reference/preset-library.md`). Create one folder per button, named for
what it holds:

```bash
SIDEBAR="$(grep '"sidebarRoot"' config/constants.json | cut -d'"' -f4)"
mkdir -p "$SIDEBAR/Drum" "$SIDEBAR/Bass" "$SIDEBAR/Key" "$SIDEBAR/Synth"
```

**Add your presets and samples:**
- Put presets (`.adg`, `.adv`, `.aupreset`, `.amxd`) anywhere inside a Place;
  subfolders become folders in the browser
- Put samples and clips in the Place's `Samples/` folder — the browser's
  Simpler and Audio switch shows them
- Drag each Place folder into Live's browser sidebar, so Live lists it (the
  rail follows Live's sidebar order)
- A Place named for a role (Drum, Bass, FX, Inst, Key, Perc, Synth) colors and
  records the tracks it loads onto; set `catalog.places.<Name>.role` for any
  other name

**Don't have presets yet?**
- You can run the system without presets
- The browser will be empty but everything else works
- Add presets later and regenerate with `npm run generate-places`

---

## Step 7: First Run

Start the development server:

```bash
npm run dev
```

**What happens:**
1. Validates your configuration
2. Generates preset catalogs from your folders
3. Starts the OSC bridge
4. Starts the SvelteKit interface
5. Opens your browser automatically
6. Launches Ableton Live

**Success looks like:**
```
✅ Configuration validated
✅ Generated instrument catalog
✅ OSC Bridge started on port 8081
✅ Interface running at http://localhost:3000
🖥️  Mac: http://localhost:3000
📱 iPad: http://YOUR-HOSTNAME.local:3000
```

**In your browser:**
- You should see the Live Looping Interface
- If Ableton Live is running, you'll see connection status

---

## Step 8: Connect Ableton Live

Live talks to the system through the **Python Control Surface** in
`surface/`. There is nothing to drag onto a track.

1. Install it: `npm run setup` runs `surface/install.sh`, which
   symlinks the surface into Live's MIDI Remote Scripts folder, so the
   working tree *is* the deployed surface.
2. In Live: **Settings → Link, Tempo & MIDI → Control Surface**, pick
   **Vamp**. Leave Input/Output as `None` unless you are using the
   USB pedal (see `docs/reference/setup.md` §Pedal MIDI input).
3. Confirm it loaded: Live's `Log.txt` carries one init line from the
   surface on startup. `lsof -i :11020` should show it listening.

Live caches Remote Script bytecode, so **restart Live fully** after any
change to the surface.

> **Removed, in case you find them referenced elsewhere:** AbletonOSC
> was deleted on 2026-04-21, and the last two Max for Live carriers
> (`AbletonOSC helper.amxd` and its `liveAPI-v6.js`) on 2026-09-23.
> Neither is part of installation; an old set that still holds the
> helper device can simply have it deleted. This step
> used to document AbletonOSC as "recommended" and linked
> `documentation/v6-architecture-overview.md`, which does not exist.

---

## Step 8a: Install the AX Helper

**Skip this and three features are dead.** Live's LOM has no verb for them, so
they are driven through Live's own UI by a small signed app that holds the one
macOS Accessibility grant (ADR-439). Without it every one of them answers
`ax-helper-down`:

- the **similar-sound swap** — the pill in the instrument, Drum Rack and clip
  views that steps a kit, a pad or a clip's sample to Live's next-nearest sound
- **Reverse** on an audio clip
- the **Save As** prompt on transport stop during an `npm run ipad` session

The bridge itself runs fine without it, and says so once at startup
(`AX helper disabled`) rather than failing.

```bash
npm run install-ax-helper
```

That builds `~/Applications/Looping AX Helper.app`, signs it, and loads a
LaunchAgent that keeps it running. Then grant it Accessibility **once**:

1. Open **System Settings → Privacy & Security → Accessibility**
2. Switch on **Looping AX Helper**

The helper re-executes itself when the grant lands, so there is nothing to
restart. Check it:

```bash
npm run install-ax-helper -- --status
```

`trusted: true` and a running agent mean the swaps will work. If it reads
`ax-untrusted`, the grant did not land on the app bundle — it is granted to the
helper, never to your terminal or to Live.

> The `axHelper` block in `config/constants.json` is what the bridge dials,
> filled in with the installer's defaults; change them in your
> `config/constants.local.json` only if you changed the installer's.

---

## Step 9: Test the System

### Basic Functionality Test

1. **In Ableton Live:**
   - Create a new MIDI track
   - Load an instrument
   - Play some notes

2. **In the Interface:**
   - You should see the track appear
   - Parameter controls should be visible
   - Moving controls should update Ableton

3. **Test Bidirectional Sync:**
   - Change a parameter in Ableton
   - The interface should update
   - Change it in the interface
   - Ableton should update

### Preset Browser Test (if configured)

1. Click the browser button in the interface
2. You should see your preset categories
3. Click a preset to load it in Ableton

### Swap Pill Test (if you did Step 8a)

1. Select a track with an instrument on it
2. The central view shows the swap pill, naming the preset or kit with an arrow
   at each end. In most instrument views and every Drum Rack it lies flat above
   the first group of controls; elsewhere (Collision, Electric, a Pattern Rack,
   an audio clip) it stands as a column down the left edge
3. Press the forward half — the right half of a flat pill, the top half of a
   column — and Live steps to its next-nearest sound

A pill that reads `ax-helper-down` and will not press means Step 8a is missing
or the Accessibility grant has not landed.

---

## Common Installation Issues

### "npm command not found"

**Solution:** Install Node.js from [nodejs.org](https://nodejs.org/)

### "Permission denied" errors

**Solution:** Don't use `sudo` with npm. If needed:
```bash
# Fix npm permissions (one-time setup)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bash_profile
source ~/.bash_profile
```

### "Port 8081 already in use"

**Solution:** Another app is using the WebSocket port. (It is 8081, not
8080 — 8080 sees system-level interference on some macOS builds that
shows up as WebSocket RSV1 protocol errors. See
`docs/reference/architecture.md` §3.)
```bash
# Find what's using port 8081
lsof -i :8081

# Kill the process (replace PID with actual process ID)
kill -9 PID
```

### "Cannot find module" errors

**Solution:** Dependencies didn't install correctly.
```bash
# Clean install
rm -rf node_modules interface/node_modules interface/bridge/node_modules
npm run setup
```

### Validation fails with path errors

**Solution:**
- Ensure paths in `config/constants.json` are absolute (start with `/`)
- Check that directories actually exist
- Create missing directories: `mkdir -p /path/to/directory`

### Browser opens but shows error

**Solution:**
- Check terminal for error messages
- Ensure the interface server started (should see "running at http://localhost:3000")
- Try accessing directly: `http://localhost:3000`

---

## Next Steps

### For Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development workflow
- Code style guidelines
- How to contribute changes

### For Live Performance

See [documentation/ipad-quickstart.md](documentation/ipad-quickstart.md) for:
- iPad connection setup
- Production mode (`npm run ipad`)
- Performance optimization

### For Troubleshooting

See [documentation/TROUBLESHOOTING.md](documentation/TROUBLESHOOTING.md) for:
- Detailed debugging steps
- Common issues and solutions
- Log analysis

### For Understanding the System

See [documentation/v6-architecture-overview.md](documentation/v6-architecture-overview.md) for:
- System architecture
- Component interactions
- Technical details

---

## Quick Reference

```bash
# Install dependencies
npm run setup

# Validate configuration
npm run validate

# Development mode (with hot reload)
npm run dev

# Production mode (for live performance)
npm run ipad

# Generate the preset browser's catalog (the Places)
npm run generate-places

# Check network interfaces
npm run interfaces

# Build production interface
npm run build
```

---

## Getting Help

- **FAQ:** [documentation/FAQ.md](documentation/FAQ.md)
- **Setup Guide:** [documentation/SETUP-GUIDE.md](documentation/SETUP-GUIDE.md)
- **Troubleshooting:** [documentation/TROUBLESHOOTING.md](documentation/TROUBLESHOOTING.md)
- **Report Issues:** Use GitHub issue templates
- **Questions:** Open a discussion on GitHub

---

## Success Checklist

- [ ] Node.js 18+ installed
- [ ] Project downloaded/cloned
- [ ] Dependencies installed (`npm run setup`)
- [ ] Configuration file created and edited
- [ ] All required paths set in `config/constants.json`
- [ ] Validation passes (`npm run validate`)
- [ ] Development server starts (`npm run dev`)
- [ ] Interface loads in browser
- [ ] Ableton Live connection works
- [ ] Can control Ableton from interface

**All checked?** You're ready to start looping! 🎵
