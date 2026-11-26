"""ListenerBag: attach records, detach on the wrapper attached to, and a
stale or refused handle never raising out of ``clear``."""

import logging

from components.listener_bag import ListenerBag


class _Target:
    def __init__(self, raise_on_add=None, raise_on_remove=None):
        self.cbs = []
        self.raise_on_add = raise_on_add
        self.raise_on_remove = raise_on_remove

    def add_value_listener(self, cb):
        if self.raise_on_add:
            raise self.raise_on_add
        self.cbs.append(cb)

    def remove_value_listener(self, cb):
        if self.raise_on_remove:
            raise self.raise_on_remove
        self.cbs.remove(cb)


def _cb():
    pass


def test_add_records_and_clear_detaches_on_the_same_wrapper():
    bag = ListenerBag("t")
    a, b = _Target(), _Target()
    assert bag.add(a, "value", _cb, tag="a")
    assert bag.add(b, "value", _cb, tag="b")
    assert len(bag) == 2 and "a" in bag and bag.tags() == ["a", "b"]
    bag.clear()
    assert a.cbs == [] and b.cbs == [] and len(bag) == 0


def test_missing_adder_is_skipped_and_reported():
    seen = []
    assert not ListenerBag("t").add(object(), "value", _cb, on_missing=lambda: seen.append(1))
    assert seen == [1]


def test_a_refused_add_is_not_recorded():
    seen = []
    bag = ListenerBag("t")
    assert not bag.add(_Target(raise_on_add=RuntimeError("no")), "value", _cb, on_error=seen.append)
    assert len(bag) == 0 and isinstance(seen[0], RuntimeError)


def test_clear_swallows_a_stale_handle_at_debug(caplog):
    bag = ListenerBag("t")
    t = _Target(raise_on_remove=TypeError("Python argument types did not match C++ signature"))
    bag.add(t, "value", _cb)
    with caplog.at_level(logging.DEBUG, logger="looping"):
        bag.clear()
    assert len(bag) == 0
    assert all(r.levelno == logging.DEBUG for r in caplog.records)


def test_clear_hands_a_failed_detach_to_on_remove_error():
    seen = []
    bag = ListenerBag("t", on_remove_error=lambda attr, e: seen.append(attr))
    bag.add(_Target(raise_on_remove=RuntimeError("gone")), "value", _cb)
    bag.clear()
    assert seen == ["value"] and len(bag) == 0


def test_remove_tag_detaches_only_that_tag():
    bag = ListenerBag("t")
    a, b = _Target(), _Target()
    bag.add(a, "value", _cb, tag=1)
    bag.add(b, "value", _cb, tag=2)
    bag.remove_tag(1)
    assert a.cbs == [] and len(b.cbs) == 1 and bag.tags() == [2]
