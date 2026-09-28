"""In-process stub target for fixture replay.

The real Python Control Surface doesn't exist yet (arrives at Gate 0).
Until then, the replay harness drives this stub so the harness itself
can be tested and the fixture format exercised end-to-end.

A `StubTarget` is fed a fixture's `messages` list at construction. It
exposes two methods the harness calls:

- `send(address, args)` — the harness calls this for every outbound
  (`dir: "out"`) message in the fixture. The stub just records it.
- `recv()` — the harness calls this to drain inbound (`dir: "in"`)
  messages the stub would have emitted. The stub pops from its
  pre-seeded queue.

Once Gate 0 lands, a real `ControlSurfaceTarget` replaces this — same
two-method contract, but bound to a live Python surface on ports
11020/11021.
"""

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, List, Optional, Sequence


@dataclass
class ObservedMessage:
    """A message the harness gave to the stub via send()."""

    address: str
    args: Sequence[Any]


@dataclass
class StubTarget:
    """Replays a pre-recorded fixture against a no-op target.

    Seeded at construction with the inbound messages from a fixture;
    records outbound messages the harness sends. Used by the replay
    harness to verify fixtures are well-formed and the harness drives
    them correctly.
    """

    inbound_queue: Deque[dict] = field(default_factory=deque)
    sent: List[ObservedMessage] = field(default_factory=list)

    @classmethod
    def from_fixture(cls, messages: Sequence[dict]) -> "StubTarget":
        """Build a stub pre-seeded with the `dir: "in"` entries of a fixture."""
        queue = deque(m for m in messages if m.get("dir") == "in")
        return cls(inbound_queue=queue)

    def send(self, address: str, args: Sequence[Any]) -> None:
        """Record an outbound message the harness wants delivered."""
        self.sent.append(ObservedMessage(address=address, args=tuple(args)))

    def recv(self) -> Optional[dict]:
        """Pop the next pre-seeded inbound message, or None if drained."""
        if not self.inbound_queue:
            return None
        return self.inbound_queue.popleft()

    def remaining_inbound(self) -> int:
        return len(self.inbound_queue)
