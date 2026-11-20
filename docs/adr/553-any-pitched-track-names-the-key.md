# ADR-553: Any pitched track can name the key

## Status
**Accepted** (2026-11-20; amends ADR-446)

## Context

ADR-446 let only the bass and keys rails pick the tonic: a set where neither
voted was `no-key`, so a melody on the fifth could not decide. In practice
that made Follow (ADR-447) mostly silent. Across the two Live sessions logged
on the rig up to 2026-11-20, Follow answered "no key in what is playing" 48
times and wrote a key about a dozen. Nearly every silent pass was a set built
from synth and inst tracks, with no bass or keys tag: two synths and an inst
playing together still had no key. Ben: the bass/keys requirement is
outdated; any non-drum track should count.

## Decision

- **No role gates the answer.** Any pitched track that is not a drum or perc
  track and holds no Drum Rack can name the key. `no-key` now means only that
  nothing pitched is playing, or that no Live scale holds the notes.
- **A part votes by what it plays.** A bass-rail clip votes as the bass, and
  a keys-rail clip as keys, as before. Any other clip where at least a third
  of the onsets strike two notes or more votes its chord roots, the way keys
  do. A single collision is not enough: the rig's Wavering Plunk melody has
  one grace note that quantizes onto the next note, and it stays a line.
  Every other clip votes where it comes to rest.
- **Lines alone are at most `plausible`.** A melody often rests on the fifth.
  When only lines voted, a `sure` answer is reported as `plausible`. Follow
  still writes it over a key that is not its own (a fresh set's C Major).
  A later `sure` answer from a bass or chords moves it.

## Consequences

- A synth-and-inst set gets a key from its first pitched loop instead of
  keeping C Major.
- A melody-only answer can still be the fifth (G Major for a C melody that
  rests on G). The cap is there so the next bass or chord loop corrects it.
- The rig's Am Dm G C loop still reads A Minor (plausible): its melody is
  still a line.

## Tags
`key-detection`, `key-follow`, `surface`
