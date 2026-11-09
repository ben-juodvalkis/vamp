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

The Audio Effect Racks after the instrument rack are the page's controls: the
rack named ``Output`` gives its ``Output`` macro to the slider, and every other
rack's named macros pair up as XY pads (macro 1 and 2, 3 and 4, ...). A sound
change returns the slider to 64 and the pads to what they held when the set
loaded, in the same undo step as the switch.
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
V3_SETLIST_PARAM_ADDRESS = "/looping/v3/setlist/param"
V3_SETLIST_STATE_ADDRESS = "/looping/v3/setlist/state"

SETLIST_TRACK_NAME = "Keys"
_RACK_CLASS = "InstrumentGroupDevice"
_AUDIO_RACK_CLASS = "AudioEffectGroupDevice"
_DEVICE_ON = "Device On"
OUTPUT_NAME = "Output"
OUTPUT_RESET_VALUE = 64.0
_MACRO_COUNT = 8
_UNNAMED_MACRO = re.compile(r"^Macro \d+$")
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
        # (rack name, parameter index) -> the value it held at set load. A
        # surface instance lives as long as one open set.
        self._baselines = {}
        try:
            self._capture_baselines()
        except Exception as error:
            logger.exception("setlist baselines: %s", error)

    def disconnect(self) -> None:
        self._disconnected = True

    # --- reading Live ---------------------------------------------------

    def _track(self) -> Optional[Any]:
        for track in self._song.tracks:
            if track.name == SETLIST_TRACK_NAME:
                return track
        return None

    def _song_chains(self) -> List[Any]:
        track = self._track()
        if track is None:
            return []
        for device in track.devices:
            if device.class_name == _RACK_CLASS:
                return list(device.chains)
        return []

    def _effect_racks(self) -> List[Tuple[int, Any]]:
        """``(device index, rack)`` for the Audio Effect Racks after the
        instrument rack."""
        track = self._track()
        if track is None:
            return []
        racks = []
        passed_instruments = False
        for index, device in enumerate(track.devices):
            if device.class_name == _RACK_CLASS:
                passed_instruments = True
            elif passed_instruments and device.class_name == _AUDIO_RACK_CLASS:
                racks.append((index, device))
        return racks

    def _output(self) -> Optional[Tuple[str, Any]]:
        for index, rack in self._effect_racks():
            if rack.name != OUTPUT_NAME:
                continue
            for parameter_index, parameter in enumerate(rack.parameters):
                if parameter.name == OUTPUT_NAME:
                    return "%d/%d" % (index, parameter_index), parameter
        return None

    def _pads(self) -> List[dict]:
        """One entry per pair of macros with a name on either. Parameter 0 is
        Device On, so macro N is parameter N."""
        pads = []
        for index, rack in self._effect_racks():
            if rack.name == OUTPUT_NAME:
                continue
            parameters = list(rack.parameters)
            for x_index in range(1, min(_MACRO_COUNT, len(parameters) - 1), 2):
                x, y = parameters[x_index], parameters[x_index + 1]
                named = [p.name for p in (x, y) if not _UNNAMED_MACRO.match(p.name)]
                if not named:
                    continue
                pads.append({
                    "label": named[0],
                    "x": {"key": "%d/%d" % (index, x_index), "value": x.value},
                    "y": {"key": "%d/%d" % (index, x_index + 1), "value": y.value},
                })
        return pads

    def _capture_baselines(self) -> None:
        """Record what each pad macro holds the first time it is seen."""
        for _, rack in self._effect_racks():
            if rack.name == OUTPUT_NAME:
                continue
            for parameter_index, parameter in enumerate(rack.parameters):
                if 1 <= parameter_index <= _MACRO_COUNT:
                    self._baselines.setdefault((rack.name, parameter_index), parameter.value)

    def _reset_controls(self) -> None:
        output = self._output()
        if output is not None:
            output[1].value = OUTPUT_RESET_VALUE
        for _, rack in self._effect_racks():
            if rack.name == OUTPUT_NAME:
                continue
            for parameter_index, parameter in enumerate(rack.parameters):
                baseline = self._baselines.get((rack.name, parameter_index))
                if baseline is not None and parameter.value != baseline:
                    parameter.value = baseline

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
        self._capture_baselines()
        songs = self._song_chains()
        output = self._output()
        current_song, current_sound = self._current(songs)
        shown = songs[max(current_song, 0)] if songs else None
        payload = {
            "found": bool(songs),
            "songs": [split_song_name(chain.name)[0] for chain in songs],
            "song": current_song,
            "sounds": [chain.name for chain in self._sound_chains(shown)] if shown else [],
            "sound": current_sound,
            "tempo": self._song.tempo,
            "output": {"key": output[0], "value": output[1].value} if output else None,
            "pads": self._pads(),
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
            self._reset_controls()
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

    def handle_param(self, args, source_addr) -> None:
        """A slider or pad move: ``[key, value]``, with the key from the state.
        Sent at gesture rate, so it does not answer; the poll carries it back."""
        if self._disconnected or len(args) < 2:
            return
        try:
            self._write_param(str(args[0]), float(args[1]))
        except Exception as error:
            logger.exception("setlist param: %s", error)

    def _write_param(self, key: str, value: float) -> None:
        device_index, parameter_index = (int(part) for part in key.split("/"))
        if not 1 <= parameter_index <= _MACRO_COUNT:
            return
        for index, rack in self._effect_racks():
            if index == device_index:
                parameter = rack.parameters[parameter_index]
                parameter.value = max(parameter.min, min(parameter.max, value))
                return

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
        current = self._current(songs)
        current_song = max(current[0], 0)
        if not songs or current == (current_song, sound_index):
            return
        if not 0 <= sound_index < len(self._sound_chains(songs[current_song])):
            return
        self._apply(songs, current_song, sound_index)
