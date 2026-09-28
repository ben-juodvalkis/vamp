# The public name: Vamp

**Decided 2026-09-25.** The public product is **Vamp**. "Looping" stays the internal name.

The clash notes come from web searches on 2026-09-25, and the domain notes from DNS lookups the
same day. Neither is a trademark search. The file references were re-checked on 2026-09-26
(`e426920`): nothing has been renamed yet.

Part of the general release: start at [README.md](README.md). Until 2026-09-26 this was §11 of
[audit.md](audit.md).

---

## 1. Why Vamp

- **It means the thing.** To vamp is to repeat a figure until the cue and build over it. Theater
  and dance accompanists use the word. Live users already ask for it by name: an Ableton forum
  thread is titled "Is there a way to vamp?".
- **It covers the whole app.** It names what the performer does, so the browser, FX grid, pads
  and Permute fit under it. "Looping" names one feature, and every looper uses the word.
- **It's short.** One syllable, easy to say, easy to spell after hearing it.

**Clashes found:** nothing named Vamp among Live controllers, iPad loopers or Max for Live
devices. The nearest are:
- Vamp Plugins, an audio-analysis plugin format for developers.
- vAMP, a music player, and Vampr, a networking app for musicians.
- Vamp, an influencer-marketing company. It owns vamp.com and an App Store app named Vamp. The
  app only matters if this ever ships as a native app.

**Also considered:**
- Runners-up: Clipperton, Treadle, Dubbleton, Simpleton, Tonband, Cairn.
- Dropped because music software or artists already use them: Loom (AIR's Loom II synth), Rondo
  (a looper plugin), Ostinato (the Ostinator iPad looper), Gyre (one letter off 10K Audio's Gyro
  loop plugin), Segno (a listen-together app), Skeletone (several artists).

**Rule:** keep Ableton's names ("Ableton", "Live", "Push", "Move") out of the name itself, and
say "for Ableton Live" in the tagline. The current manifest name, "Live Looping Interface",
breaks this rule.

**Not done yet:** a USPTO search for "Vamp" in software and music. The marketing company may
hold marks in its own field.

## 2. Domain

- **Taken:** vamp.com (the marketing company) and vamp.live (the owner checked). So are
  vamp.app, vamp.audio, vamp.band, vamp.fm, vamp.studio, vamp.io, vamp.ing and
  vamptillready.com.
- **abletonvamp.com: don't.** Ableton's trademark in the address invites a dispute, and it reads
  as an official Ableton product.
- **No DNS record on 2026-09-25, so probably free:**
  - **vamping.live.** First choice: it keeps the nod to Live and says what the performer does.
  - **vamp.music.** The cleanest address. `.music` only registers people who attest to a music
    connection and then verify their identity, which a working composer passes.
  - **vamp.show** and **vamp.dance.** Short. `.dance` also nods to the owner's work with dance.
  - Fallbacks: getvamp.app, playvamp.com, vampforlive.com.
- **The DNS check isn't the last word.** A name with no record is very likely unregistered, but
  only a registrar can confirm it and show the price. Short words on newer endings are often
  priced as premium. Check at Cloudflare, where the owner's site already runs.
- **Launching doesn't need a domain.** GitHub Pages serves `ben-juodvalkis.github.io/vamp`, and
  a subdomain such as `vamp.benjuodvalkis.com` costs nothing.

## 3. Repo and folders

- **Done 2026-09-27:** the fresh repo ([audit.md](audit.md) §5.2) is `vamp`, public since
  2026-09-28. `Looping` stays as it is, private, as the history.
- **The clone moved 2026-09-28.** The rig runs from `/Users/Shared/DevWork/GitHub/vamp`; the
  config derives every repo path from the checkout, and the loads name the `Vamp Devices` Place
  ([plan.md](plan.md) §8). The Skaka rack still points into Looping's checkout, which stays on disk.

## 4. What to rename, and when

**What people see: any time.** None of it changes behavior on the rig. All of it still says
Looping (2026-09-26).

| Where | Today |
|---|---|
| iPad home-screen name | `interface/src/app.html:27` (`apple-mobile-web-app-title` "Looping"); `interface/static/manifest.json:2-3` (`short_name` "Looping", `name` "Live Looping Interface") |
| Connect page | `interface/src/routes/connect/+page@.svelte:65,76` (title "Connect to Looping", heading "Looping") |
| README and package | `README.md` title "Live Looping Interface"; `package.json` `name` "live-looping-interface", `description` and `author` |

An iPad that already has the icon keeps the old label until it's added to the home screen again.

**Live's Control Surface list: done 2026-09-27, with `npm run setup`** ([plan.md](plan.md) §2).
- Live lists the surface under the name of the link `install.sh` makes in Remote Scripts:
  `Remote Scripts/Vamp`.
- The surface doesn't depend on that name. `__init__.py` imports relatively, and
  `config_loader.py` finds the repo through `realpath`. Renaming the link is the whole change.
- On the rig: `npm run setup` removes the old `Looping` link and makes `Vamp`. Pick Vamp in
  Live's settings where Looping was, then restart Live fully. Until then the setup check warns.
- Preset folders come from config (`paths.*`). The general base can install "Vamp Presets" while
  the owner's overlay keeps "Looping Presets".

**Keep "looping" internal:**
- The `/looping/v3/…` wire namespace, `LoopingSurface.py` and the other internal names.
  Renaming them gains users nothing, and it would mean a wire-protocol change and a lot of test
  churn. What a user handles is renamed: the surface is `surface/`, linked as Vamp, and the
  recorder a user drops onto Return A is `Vamp Devices/Vamp-Recorder/` (Ben, 2026-09-28).
- The AX helper's `appName` and `bundleId` (`scripts/install-ax-helper.sh:30-31`). A new bundle
  id means granting Accessibility again.
- The `looping-studio` hostname, which plan.md §2 removes anyway.
