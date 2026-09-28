# Installing Vamp

About 15 minutes. You need a terminal, and Live open for part of it.

## 1. Check the requirements

- **macOS 13** or later
- **Ableton Live 12.4 Suite**
- **Node.js 22.13** or later

```bash
sw_vers -productVersion
node --version
```

If Node is missing or older, install the current LTS from [nodejs.org](https://nodejs.org/).

## 2. Get the code and install

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

## 3. Pick the control surface in Live

1. Open **Live → Settings → Link, Tempo & MIDI**.
2. In an empty **Control Surface** slot, pick **Vamp**. Input and Output stay **None** (unless a
   foot switch is on USB: step 7).
3. Quit Live and open it again. Live loads a control surface only at startup.

Live's log (`~/Library/Preferences/Ableton/Live <version>/Log.txt`) now has a line reading
`Vamp surface init`.

## 4. Add the Vamp Devices folder to Live's browser

In Live's browser sidebar, **Places → Add Folder…**, and pick the `Vamp Devices` folder in this
checkout. Keep its name: the app loads Permute, the on-screen wheels and Random Start from the
Place called "Vamp Devices".

## 5. Start it on the Mac

```bash
npm run dev
```

This runs the setup check, starts the bridge and the web app, and opens the page at
<http://localhost:3000> and Live. The first run opens **Settings** as a checklist:

- Live has the Vamp control surface
- the Vamp Devices folder is a Place in Live
- which Places the browser shows (your User Library and every Pack, to start)
- a foot switch, if you have one
- the recorder on Return A, if you want Capture

Settings stays one tap away afterwards, from the gear in the master track's view.

## 6. Connect the iPad

```bash
npm run ipad
```

This builds the app for performance and serves it on port **8889**. Open the address that
**Settings → Connection** shows, in Safari on the iPad, then **Share → Add to Home Screen** to
run it full screen. It is laid out for landscape.

- **USB-C** is the steadiest link. macOS gives the iPad's USB network no fixed address by default,
  so set it once: **System Settings → Network →** the iPad's USB interface **→ Details → TCP/IP →
  Configure IPv4: Manually**, address `192.168.100.1`, subnet mask `255.255.255.0`. Then the iPad
  opens `http://192.168.100.1:8889`.
- **Wi-Fi** works on a network that lets devices reach each other: open `http://<the Mac's
  address>:8889`.

**Anyone on the same network who can open the page can drive Live.** Use USB-C or a network you
trust.

## 7. Optional

### A foot switch

Any momentary or latching MIDI footswitch on USB:

1. In **Live → Settings → Link, Tempo & MIDI**, set the **Vamp** row's **Input** to the pedal's
   port. Output stays None.
2. In the MIDI Ports list, turn that port's **Track** and **Remote** switches off.
3. In Vamp's **Settings → General → Foot Switch**, press **Learn** and press the pedal.

A tap walks record → close → play → overdub; a hold makes a new armed audio track.

### Capture

To record what you play and turn it into a Simpler, drop the recorder device from the Vamp Devices
Place onto **Return A**. Until it is there, the REC control is greyed with the reason.

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
- **Permute or the wheels don't load.** The Vamp Devices folder isn't a Place in Live, or it was
  renamed (step 4). Restart Live after fixing it.
- **The iPad can't reach the Mac.** Over USB-C, check the cable carries data and the manual address
  in step 6. Over Wi-Fi, some networks block devices from reaching each other.
- **Something changed in the surface and nothing happened.** Live loads it once: quit Live fully
  and reopen it.

[docs/reference/setup.md](docs/reference/setup.md) has more detail and more fixes.
