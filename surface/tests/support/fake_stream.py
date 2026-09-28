"""A stand-in for ``TCPTransport`` in tests that publish ``state/full``.

Since protocol 3.6.0 the tree only ever leaves over the ordered
stream — there is no datagram it would fit in — so a component built
without one publishes nothing at all. That would silence most of the
existing suite, which asserts against an ``emits`` list fed by the
``emit=`` callable.

``FakeStream`` closes that gap by writing into the *same* list. A test
keeps its existing assertions and its existing view of "what went out";
only the transport underneath changed. Tests that care about the
distinction (the ETag marker still rides UDP, for one) can pass their
own list instead.
"""


class FakeStream:
    """``connected`` flag plus ``send``; records what it was given.

    Args:
        connected: initial peer state. Flip it mid-test to model the
            bridge coming and going — the publisher re-probes per
            publish, so the change takes effect immediately.
        sink: where sends are appended as ``(address, args)``. Pass the
            test's ``emits`` list to make stream traffic and UDP
            traffic land in one ordered sequence; leave it ``None`` for
            a private list, available as ``.sent``.
    """

    def __init__(self, connected=True, sink=None):
        self.connected = connected
        self.sent = [] if sink is None else sink

    def send(self, address, args=()):
        self.sent.append((address, args))
        return True
