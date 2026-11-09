"""SetlistComponent — songs and sounds in one nested rack (ADR-519).

A set built for live keys holds every song in one Instrument Rack on the
track named ``Keys``:

    Keys / first Instrument Rack / chain per song ("Joke 144")
         / the song's rack / chain per sound ("Lead", "Organ")
         / the sound's first device

Exactly one song and one sound are switched on at a time, through their
Device On parameters, which saves the CPU of everything else. The surface
holds no selection of its own: Live's Device On values are the state, read
afresh on each request, so a reconnecting page or a reopened set cannot
disagree with what is sounding. A page opening or asking for state changes
nothing in Live; only a select does.

The new song and sound go on before the old ones go off, so a switch has no
silent gap. The tempo comes from the digits ending the song chain's name.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, List, Optional, Tuple

logger = logging.getLogger(__name__)

V3_SETLIST_GET_ADDRESS = "/looping/v3/setlist/get"
V3_SETLIST_SELECT_SONG_ADDRESS = "/looping/v3/setlist/select_song"
V3_SETLIST_SELECT_SOUND_ADDRESS = "/looping/v3/setlist/select_sound"
V3_SETLIST_STATE_ADDRESS = "/looping/v3/setlist/state"

SETLIST_TRACK_NAME = "Keys"
_RACK_CLASS = "InstrumentGroupDevice"
_DEVICE_ON = "Device On"
_NAME_WITH_TEMPO = re.compile(r"^(.*?)\s*(\d{2,3})\s*$")
_TEMPO_MIN = 20
_TEMPO_MAX = 999


def split_song_name(name: str) -> Tuple[str, Optional[int]]:
    """``"Joke 144"`` → ``("Joke", 144)``; a name without a tempo keeps all
    of itself and gives ``None``. Digits touching the words count too, since
    the set has ``"Pommel Horse160"``."""
    match = _NAME_WITH_TEMPO.match(name)
    if not match or not match.group(1):
        return name, None
    tempo = int(match.group(2))
    if tempo < _TEMPO_MIN or tempo > _TEMPO_MAX:
        return name, None
    return match.group(1), tempo


def _device_on(device: Any) -> Optional[Any]:
    for parameter in device.parameters:
        if parameter.name == _DEVICE_ON:
            return parameter
    return None


def _is_on(device: Any) -> bool:
    parameter = _device_on(device)
    return bool(parameter is not None and parameter.value)


def _set_on(device: Any, on: bool) -> None:
    parameter = _device_on(device)
    if parameter is None:
        return
    value = 1.0 if on else 0.0
    if parameter.value != value:
        parameter.value = value


def _first_device(chain: Any) -> Optional[Any]:
    devices = list(chain.devices)
    return devices[0] if devices else None


class SetlistComponent:
    def __init__(self, song: Any, emit: Callable[[str, Any], None]):
        self._song = song
        self._emit = emit
        self._disconnected = False

    def disconnect(self) -> None:
        self._disconnected = True

    # --- reading Live ---------------------------------------------------

    def _song_chains(self) -> List[Any]:
        for track in self._song.tracks:
            if track.name != SETLIST_TRACK_NAME:
                continue
            for device in track.devices:
                if device.class_name == _RACK_CLASS:
                    return list(device.chains)
        return []

    @staticmethod
    def _song_rack(song_chain: Any) -> Optional[Any]:
        device = _first_device(song_chain)
        return device if device is not None and device.class_name == _RACK_CLASS else None

    def _sound_chains(self, song_chain: Any) -> List[Any]:
        rack = self._song_rack(song_chain)
        return list(rack.chains) if rack is not None else []

    def _current(self, songs: List[Any]) -> Tuple[int, int]:
        """The first song whose rack is on and has a sound on, and that
        sound; ``(-1, -1)`` when nothing is playing yet."""
        for song_index, song_chain in enumerate(songs):
            rack = self._song_rack(song_chain)
            if rack is None or not _is_on(rack):
                continue
            for sound_index, sound_chain in enumerate(self._sound_chains(song_chain)):
                device = _first_device(sound_chain)
                if device is not None and _is_on(device):
                    return song_index, sound_index
        return -1, -1

    def _emit_state(self) -> None:
        songs = self._song_chains()
        current_song, current_sound = self._current(songs)
        shown = songs[max(current_song, 0)] if songs else None
        payload = {
            "found": bool(songs),
            "songs": [split_song_name(chain.name)[0] for chain in songs],
            "song": current_song,
            "sounds": [chain.name for chain in self._sound_chains(shown)] if shown else [],
            "sound": current_sound,
            "tempo": self._song.tempo,
        }
        self._emit(V3_SETLIST_STATE_ADDRESS, (json.dumps(payload, separators=(",", ":")),))

    # --- writing Live ---------------------------------------------------

    def _apply(self, songs: List[Any], song_index: int, sound_index: int) -> None:
        """Turn the chosen song and sound on, then everything else off, in
        one undo step."""
        chosen_song = songs[song_index]
        chosen_rack = self._song_rack(chosen_song)
        chosen_sound = _first_device(self._sound_chains(chosen_song)[sound_index])
        song = self._song
        song.begin_undo_step()
        try:
            if chosen_rack is not None:
                _set_on(chosen_rack, True)
            if chosen_sound is not None:
                _set_on(chosen_sound, True)
            for chain in songs:
                rack = self._song_rack(chain)
                if rack is None:
                    continue
                if chain is not chosen_song:
                    _set_on(rack, False)
                for index, sound_chain in enumerate(self._sound_chains(chain)):
                    if chain is chosen_song and index == sound_index:
                        continue
                    device = _first_device(sound_chain)
                    if device is not None:
                        _set_on(device, False)
        finally:
            song.end_undo_step()

    # --- wire -----------------------------------------------------------

    def handle_get(self, args, source_addr) -> None:
        if self._disconnected:
            return
        self._guarded(lambda: None)

    def handle_select_song(self, args, source_addr) -> None:
        if self._disconnected or not args:
            return
        self._guarded(lambda: self._select_song(int(args[0])))

    def handle_select_sound(self, args, source_addr) -> None:
        if self._disconnected or not args:
            return
        self._guarded(lambda: self._select_sound(int(args[0])))

    def _guarded(self, action: Callable[[], None]) -> None:
        """A failed write still answers with what Live now holds, so the page
        never shows a selection Live did not take."""
        try:
            action()
        except Exception as error:
            logger.exception("setlist: %s", error)
        try:
            self._emit_state()
        except Exception as error:
            logger.exception("setlist state: %s", error)

    def _select_song(self, song_index: int) -> None:
        songs = self._song_chains()
        if not 0 <= song_index < len(songs) or not self._sound_chains(songs[song_index]):
            return
        self._apply(songs, song_index, 0)
        tempo = split_song_name(songs[song_index].name)[1]
        if tempo is not None:
            self._song.tempo = float(tempo)

    def _select_sound(self, sound_index: int) -> None:
        songs = self._song_chains()
        # With nothing on yet, the page is showing the first song's sounds.
        current_song = max(self._current(songs)[0], 0)
        if not songs:
            return
        if not 0 <= sound_index < len(self._sound_chains(songs[current_song])):
            return
        self._apply(songs, current_song, sound_index)
