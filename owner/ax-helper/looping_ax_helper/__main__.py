"""Entry point: `python -m looping_ax_helper`, run by the app's launcher through uv.

Trust belongs to the launcher. macOS keys the Accessibility grant on the
*responsible* process of the caller. Started by its LaunchAgent, this process
is a child of the signed `Looping AX Helper.app` launcher, so the grant given to
that app is the one checked here, whichever terminal started `npm run dev`
(measured 2026-09-15: trusted=True from launchd -> launcher -> uv -> Homebrew
Python). Started by hand, it inherits that terminal's trust instead; `status`
says which bundle, if any, it runs under.
"""

import logging
import os
import sys

from . import VERSION
from .config import ConfigError, load_config


def main() -> int:
    logging.basicConfig(
        stream=sys.stderr,
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s ax-helper: %(message)s",
    )
    log = logging.getLogger("ax-helper")
    try:
        config = load_config()
    except ConfigError as e:
        log.error("%s", e)
        return 78  # EX_CONFIG

    from .ax import PyObjCBackend
    from .server import AlreadyRunning, Server
    from .targets import CATALOG
    from .verbs import Helper

    bundle = os.environ.get("LOOPING_AX_HELPER_BUNDLE")
    log.info("Looping AX Helper %s starting (pid %d, %s)", VERSION, os.getpid(),
             bundle or "no bundle: inherits its launcher's trust")
    helper = Helper(PyObjCBackend(), CATALOG, messaging_timeout_s=config.messaging_timeout_s,
                    bundle=bundle, log=log)
    server = Server(helper, config.socket_path, log=log)
    try:
        code = server.serve_forever()
    except AlreadyRunning as e:
        # Non-zero, so launchd tries again later: the other instance may be a
        # by-hand run that is about to quit.
        log.warning("%s; exiting", e)
        return 75  # EX_TEMPFAIL
    if server.restart:
        sys.stderr.flush()
        os.execv(sys.executable, [sys.executable, "-m", "looping_ax_helper"])
    return code


if __name__ == "__main__":
    sys.exit(main())
