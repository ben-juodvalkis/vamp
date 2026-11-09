# Installing Vamp

Two ways in: **download Vamp for Mac** (below, about five minutes), or
[**run it from the code**](#from-the-code) to work on it.

## Download

You need **macOS 14** or later (Apple Silicon or Intel) and **Ableton Live 12.4 Suite**.

1. **[Download Vamp.dmg](https://github.com/ben-juodvalkis/vamp/releases/latest/download/Vamp.dmg)**,
   open it and drag **Vamp** to Applications. Open Vamp from there: it opens Vamp in a window,
   and keeps a menu in the menu bar, as a V. Closing the window leaves Vamp running there.
2. It puts its control surface and a **Vamp Devices** folder (Permute, the wheels, the recorder,
   the groove) in Live's User Library. Nothing to add in Live's browser: Live lists the User
   Library already.
3. In **Live → Settings → Link, Tempo & MIDI**, pick **Vamp** in an empty Control Surface slot,
   then quit Live and open it again.
4. On the iPad: open **Vamp for iPad** with the USB-C cable in, and type the six-digit code the
   Mac's menu bar shows. Without the app, choose **Show iPad Address as QR Code** in Vamp's menu
   and point the iPad's camera at it, then **Share → Add to Home Screen** in Safari.

Vamp's menu lists what is left and ticks each step off. It checks for updates itself (**Check for
Updates…** in the menu); an update that changes the control surface says to restart Live.
**Uninstall Vamp…** in the menu removes the control surface from Live and moves the app to the
Trash, and asks before deleting your settings; Vamp Devices stays.

The iPad's links and pairing ([step 6](#6-connect-the-ipad)) and the optional extras
([step 7](#7-optional): a foot switch, Capture) apply to both ways in.

## From the code

About 15 minutes. You need a terminal, and Live open for part of it.

### 1. Check the requirements

- **macOS 13** or later
- **Ableton Live 12.4 Suite**
- **Node.js 22.13** or later

```bash
sw_vers -productVersion
node --version
```

If Node is missing or older, install the current LTS from [nodejs.org](https://nodejs.org/).

### 2. Get the code and install

```bash
git clone https://github.com/ben-juodvalkis/vamp.git
cd vamp
npm run setup
```

`npm run setup` checks Node, installs the dependencies, links the control surface into Live's
User Library as `Remote Scripts/Vamp`, and runs the setup check. It is safe to run again. The
check fails only for what stops the app starting (Node too old, missing dependencies, a config
file that isn't valid JSON); anything else is a warning with the fix on the same line.

It finds your User Library from Live's own preferences. If it can't, point it there:

```bash
LOOPING_USER_LIBRARY="/path/to/User Library" npm run setup
```

### 3. Pick the control surface in Live

1. Open **Live → Settings → Link, Tempo & MIDI**.
2. In an empty **Control Surface** slot, pick **Vamp**. Input and Output stay **None** (unless a
   foot switch is on USB: step 7).
3. Quit Live and open it again. Live loads a control surface only at startup.

Live's log (`~/Library/Preferences/Ableton/Live <version>/Log.txt`) now has a line reading
`Vamp surface init`.

### 4. Add the Vamp Devices folder to Live's browser

In Live's browser sidebar, **Places → Add Folder…**, and pick the `Vamp Devices` folder in this
checkout. Keep its name: the app loads Permute, the on-screen wheels and Random Start from the
Place called "Vamp Devices", or, with no such Place, from a `Vamp Devices` folder in your User
Library. Without either, those controls are not shown.

### 5. Start it on the Mac

```bash
npm run dev
```

This runs the setup check, starts the bridge and the web app, and opens the page at
<http://localhost:3000> and Live. The first run opens **Settings** as a checklist:

- Live has the Vamp control surface
- the Vamp Devices folder is a Place in Live
- which Places the browser shows (your User Library and every Pack, to start)
- a foot switch, if you have one

Settings stays one tap away afterwards, from the gear in the master track's view, and on the
Mac from **Settings…** (⌘,) in Vamp's menu.

## 6. Connect the iPad

From the code (the downloaded app does this itself):

```bash
npm run ipad
```

This builds the app for performance and serves it on port **8889**. Open the address that
**Settings → Connection** shows, in Safari on the iPad, then **Share → Add to Home Screen** to
run it full screen. It is laid out for landscape.

- **USB-C** is the steadiest link. With Vamp for iPad (ADR-488) there is nothing to set: plug in and
  open the app. In Safari, open `http://<the Mac's name>.local:8889` (Settings → Connection shows
  it). macOS now keeps the iPad's USB network private, so it can no longer be given a fixed address.
- **Wi-Fi** works on a network that lets devices reach each other: open `http://<the Mac's
  address>:8889`.

**A device other than the Mac pairs once** (ADR-491): a code in Live's status bar, or Allow on a
screen already connected. Vamp for iPad on the cable pairs once with Vamp for Mac instead
(ADR-494): it asks for the six-digit code the Mac shows in its menu bar, beside a key.
[SECURITY.md](SECURITY.md) says what is exposed.

## 7. Optional

### A foot switch

Any momentary or latching MIDI footswitch on USB:

1. In **Live → Settings → Link, Tempo & MIDI**, set the **Vamp** row's **Input** to the pedal's
   port. Output stays None.
2. In the MIDI Ports list, turn that port's **Track** and **Remote** switches off.
3. In Vamp's **Settings → General → Foot Switch**, press **Learn** and press the pedal.

A tap walks record → close → play → overdub; a hold stops the track and moves to the next empty slot, so the next tap records a new clip. New Audio and New MIDI, right of the last track, make a track.

### Capture

REC records what the selected track plays and turns it into a Simpler. The first time on a track
it puts the Vamp-Capture device at the end of that track's chain (it needs the Vamp Devices Place)
and reuses it after. To record your audio interface instead, choose **Input** and its channel in
**Settings → General → Capture**.

### Your own settings

`config/constants.json` is the defaults every Mac shares; don't edit it. Your Mac's own values go
in `config/constants.local.json`, which git ignores and which is laid over the defaults, key by
key:

```json
{
  "audio": { "defaultInputChannel": "3/4" }
}
```

| Key | What it's for |
| --- | --- |
| `audio.defaultInputChannel` | the input pair new audio tracks record from, as Live names it (unset: Live's default) |
| `paths.abletonApp` | a Live to open other than the one you last used |
| `paths.userLibraryBase` | your User Library, if Live's preferences don't say |

Restart `npm run dev` after changing it, and Live too for anything the surface reads.
The `features` switches (all off) are the author's own gear;
[docs/reference/toggles.md](docs/reference/toggles.md) says what each does.

## Troubleshooting

- **The page shows no tracks.** Check that Live's log has `Vamp surface init`, that
  `lsof -i :11020` shows Live listening, and read `logs/bridge.log`.
- **"Vamp" isn't in Live's Control Surface list.** Run `npm run setup` again and read what the
  linking step printed, then restart Live.
- **No Permute, wheels or REC.** Live can't reach the Vamp Devices folder: it isn't a Place
  (step 4) nor in your User Library, or it was renamed. Restart Live after fixing it.
- **The iPad can't reach the Mac.** Over USB-C, check the cable carries data and the manual address
  in step 6. Over Wi-Fi, some networks block devices from reaching each other.
- **Something changed in the surface and nothing happened.** Live loads it once: quit Live fully
  and reopen it.

[docs/reference/setup.md](docs/reference/setup.md) has more detail and more fixes.
