#!/usr/bin/env python3
"""Inventory a Max for Live device file without opening Max.

    python3 scripts/amxd-inventory.py "Vamp Devices/Permute/Permute.amxd"

An .amxd is a binary header followed by the patcher JSON; this reads the JSON
and prints (1) an object census by maxclass, (2) every live.* parameter with
its long name, short name and parameter order, and (3) every object with text
(the logic: udpsend, metro, v8, prepend, route, message boxes, ...). Used to
verify the thin Permute (permute ADR-020) after each Max save: the 38 pattern
parameters must keep their long names and orders 1-38 (22 until ADR-443 appended
steps 9-16 of each lane), plugin~/plugout~ must
survive, and nothing under (3) but comments should remain. Read-only.
"""
import collections
import json
import sys


def load(path):
    b = open(path, "rb").read()
    i, j = b.find(b"{"), b.rfind(b"}")
    return json.loads(b[i:j + 1].decode("utf-8", "replace"))


def walk(patcher, depth=0, rows=None):
    rows = [] if rows is None else rows
    for bx in patcher.get("boxes", []):
        x = bx["box"]
        sa = x.get("saved_attribute_attributes", {}).get("valueof", {})
        rows.append({
            "depth": depth, "maxclass": x.get("maxclass"), "text": (x.get("text") or ""),
            "long": sa.get("parameter_longname", ""), "short": sa.get("parameter_shortname", ""),
            "order": sa.get("parameter_order"), "varname": x.get("varname", ""),
        })
        if "patcher" in x:
            walk(x["patcher"], depth + 1, rows)
    return rows


def main(path):
    rows = walk(load(path)["patcher"])
    print("object census:", dict(collections.Counter(r["maxclass"] for r in rows).most_common()))
    params = [r for r in rows if (r["maxclass"] or "").startswith("live.") and r["long"]]
    print("\nparameters (%d):" % len(params))
    for r in sorted(params, key=lambda r: (r["order"] if r["order"] is not None else 999, r["long"])):
        print("  order=%-3s %-14s long=%-16r short=%-14r depth=%d" % (r["order"], r["maxclass"], r["long"], r["short"], r["depth"]))
    logic = [r for r in rows if r["maxclass"] in ("newobj", "message") and r["text"]]
    print("\nobjects with text (%d):" % len(logic))
    for r in logic:
        print("  %-8s %r" % (r["maxclass"], r["text"][:80]))
    flags = [t for t in ("udpsend", "metro", "transport", "v8 ", "js ", "---tojs", "---fromjs") if any(t in r["text"] for r in logic)]
    print("\nfat-device markers present:", flags or "none")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
