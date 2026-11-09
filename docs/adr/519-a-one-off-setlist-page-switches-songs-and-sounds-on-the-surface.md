# ADR-519: A setlist page switches songs and sounds through the surface

## Status
**Accepted** (2026-11-08), on the `cyborg` branch only. Needs a Live restart
for the surface part.

## Context

Ben's Battlehooch keys set holds every song in one Instrument Rack on the
`Keys` track: a chain per song, holding a rack with a chain per sound. It has
been played from TouchOSC through a Max for Live patch, which he finds too
unstable. He wants the same remote served from Vamp, built in steps, starting
with choosing a song and a sound. The other controls come later.

## Decision

`SetlistComponent` does the switching in the surface, and `/setlist` is a page
of its own. The Max patch and TouchOSC take no part.

Taken from the patch, measured from its object graph: the song's sounds come
from `chains[n].devices[0]`, a sound's switch is that device's Device On, a song
change lands on its first sound, the song arrows clamp rather than wrap and act
on two taps within 500 ms, and the tempo comes from the end of the song chain's
name.

Different from the patch:

- Other songs' racks are switched off too, as Ben asked. The patch only
  switched sounds; the rig's song racks all read on.
- Nothing happens when the page opens. The patch selected song 1, sound 1 on
  load; here a reconnecting iPad must never change what is sounding.
- The new sound goes on before the old goes off.
- `Pommel Horse160` yields a tempo. The patch split on spaces, so it could not.

`npm run setlist` serves a production build and uses the running bridge or starts
one. Port `setlist.port` (8891; `npm run ipad`'s status page holds 8890) shows the
page at every path, so a typed address
or a home-screen icon that opens at `/` cannot land on the regular interface.
Every other port keeps it.

The selection is never stored: Live's Device On values are read on each
request. The surface's replies are loopback UDP, so the page polls and re-asks
after an unanswered select rather than trusting one reply.

## Controls

The song bar is also the `Output` rack's `Output` macro. Every other Audio
Effect Rack after the instrument rack gives its named macros to XY pads, X the
odd macro and Y the even one, found by name so a moved rack cannot point a pad
at the wrong thing. A rack with no named macros, LOOPER today, gets none.

A sound change, including one from a song change, returns `Output` to 64 and the
pads to what they held when the set loaded, as Ben asked. The patch zeroed its
pads instead. Tapping the sound already on changes nothing.

"When the set loaded" means the first read at least five seconds after the
surface starts. The surface is built during Live's document exchange; reading
there read 0 for LoPass, where the same set read 127 ten seconds later, and resets
wrote those zeros over the set's real values (measured 2026-11-08). The surface
logs both reads.

The sound on gets two more pads from its own rack, macros 1 and 2, then 3 and 4,
as the patch mapped them. Every sound's four are read once at set load, and
choosing a sound returns its own to those values. Reading them again on a song
change would take a pad's last move as home, so resets would stop resetting. A
sound that is a bare plug-in gets no pads, since its parameters are not macros;
the patch moved them anyway.

The controls drag relatively, as the old remote's did: a touch does not jump the
value. The page has no listeners in Live. It polls, so a macro moved in Live
shows within about 1.5 s, and nothing can leak or fire at gesture rate.

A switch selects the song's and sound's chains in Live's racks, as the patch did,
so Live's window shows what is playing. A refusal there never fails the switch.
A page opening selects nothing.

## Not yet

Chain volume, the arpeggiator and the foot switch on CC 67 that steps sounds,
all of which the patch does.
