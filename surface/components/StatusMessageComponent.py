"""StatusMessageComponent — a line in Live's status bar, sent by the bridge.

One verb, ``/looping/v3/session/show_message [text]`` (Bridge→Surf), for
pairing (ADR-491): when a device on Wi-Fi asks to connect, the code it must
enter shows here, where whoever runs Live sees it without looking for it.
An empty string clears the line once the request is settled. The bridge
sends it straight to the surface, like the server heartbeat; no UI sends it.

``show`` is ``ControlSurface.show_message``, passed in so the component runs
under pytest without Live. Nothing is emitted back.
"""

import logging

logger = logging.getLogger(__name__)

SHOW_MESSAGE_ADDRESS = "/looping/v3/session/show_message"

#: Live's status bar is one line; past this the text is cut.
MAX_MESSAGE_CHARS = 160


class StatusMessageComponent:
    def __init__(self, show):
        self._show = show

    def handle_show_message(self, args, source_addr=None):
        text = args[0] if args else ""
        if not isinstance(text, str):
            logger.warning("show_message: text must be a string, got %r", text)
            return None
        line = " ".join(text.split())[:MAX_MESSAGE_CHARS]
        try:
            self._show(line)
        except Exception as e:  # noqa: BLE001 - Live's API raises its own types
            logger.warning("show_message failed: %s", e)
        return None
