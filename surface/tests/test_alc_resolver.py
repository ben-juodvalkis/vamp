"""Tests for alc_resolver: .alc (gzipped XML clip) → underlying audio path.

Builds real gzipped ``.alc`` fixtures on the fly (mirroring the shape Live
writes) plus real on-disk sample files in a temp pack layout, then asserts
the upward-walk resolution lands on the right file. No Live API involved.
"""

from __future__ import annotations

import gzip
import os

import pytest

from components import alc_resolver


# --- fixture builders --------------------------------------------------------


def _alc_xml(name, rel_dirs, abs_path=None, pack=None):
    """Return an .alc XML string with the given SampleRef fields."""
    rel_elems = "".join(
        '<RelativePathElement Dir="{}" />'.format(d) for d in rel_dirs
    )
    path_tag = '<Path Value="{}" />'.format(abs_path) if abs_path else ""
    if pack:
        path_tag += '<LivePackName Value="{}" />'.format(pack)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Ableton><LiveSet><Tracks><AudioTrack><ClipSlotList><ClipSlot>"
        "<ClipSlot><Value><AudioClip><SampleRef><FileRef>"
        "<HasRelativePath Value=\"true\" />"
        '<RelativePathType Value="5" />'
        "<RelativePath>{rel}</RelativePath>"
        '{path}'
        '<Name Value="{name}" />'
        '<Type Value="2" />'
        "</FileRef></SampleRef></AudioClip></Value></ClipSlot>"
        "</ClipSlot></ClipSlotList></AudioTrack></Tracks></LiveSet></Ableton>"
    ).format(rel=rel_elems, path=path_tag, name=name)


def _write_alc(path, xml, gzipped=True):
    if gzipped:
        with gzip.open(path, "wb") as f:
            f.write(xml.encode("utf-8"))
    else:
        with open(path, "wb") as f:
            f.write(xml.encode("utf-8"))


def _touch(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\0")


# --- resolution --------------------------------------------------------------


def test_upward_walk_resolves_sibling_samples_folder(tmp_path):
    """The Forge-style layout: clip under Clips/Sub, sample under
    <pack>/Samples/Sub. Resolution must climb up past Clips/Sub."""
    pack = tmp_path / "The Forge by Hecq"
    alc = pack / "Clips" / "Coil Loops" / "01_MacBook1.alc"
    sample = pack / "Samples" / "Coil Pickup" / "iphone 3.aif"
    os.makedirs(alc.parent, exist_ok=True)
    _touch(str(sample))

    xml = _alc_xml("iphone 3.aif", ["Samples", "Coil Pickup"])
    _write_alc(str(alc), xml)

    assert alc_resolver.resolve_alc(str(alc)) == os.path.normpath(str(sample))


def test_drops_absolute_authoring_fallback_run(tmp_path):
    """The RelativePath's private/tmp/trunk tail must be ignored — only
    the leading real relative run participates in resolution."""
    pack = tmp_path / "Pack"
    alc = pack / "Clips" / "clip.alc"
    sample = pack / "Samples" / "kick.wav"
    os.makedirs(alc.parent, exist_ok=True)
    _touch(str(sample))

    xml = _alc_xml(
        "kick.wav",
        ["Samples", "private", "tmp", "trunk", "Pack", "Samples"],
    )
    _write_alc(str(alc), xml)

    assert alc_resolver.resolve_alc(str(alc)) == os.path.normpath(str(sample))


def test_sample_beside_alc(tmp_path):
    """Simplest layout: sample sits in the same directory as the .alc."""
    alc = tmp_path / "loop.alc"
    sample = tmp_path / "loop.wav"
    _touch(str(sample))
    _write_alc(str(alc), _alc_xml("loop.wav", []))

    assert alc_resolver.resolve_alc(str(alc)) == os.path.normpath(str(sample))


def test_absolute_path_trusted_when_present_and_real(tmp_path):
    """An absolute <Path Value> that exists is returned directly."""
    sample = tmp_path / "elsewhere" / "vox.aif"
    _touch(str(sample))
    alc = tmp_path / "clip.alc"
    # Give a bogus relative path so only the absolute path can succeed.
    xml = _alc_xml("vox.aif", ["nonexistent"], abs_path=str(sample))
    _write_alc(str(alc), xml)

    assert alc_resolver.resolve_alc(str(alc)) == str(sample)


def test_absolute_path_ignored_when_missing(tmp_path):
    """A dead absolute <Path> falls back to the upward walk."""
    pack = tmp_path / "Pack"
    alc = pack / "Clips" / "clip.alc"
    sample = pack / "Samples" / "snare.wav"
    os.makedirs(alc.parent, exist_ok=True)
    _touch(str(sample))

    xml = _alc_xml(
        "snare.wav", ["Samples"], abs_path="/private/tmp/trunk/gone/snare.wav"
    )
    _write_alc(str(alc), xml)

    assert alc_resolver.resolve_alc(str(alc)) == os.path.normpath(str(sample))


def test_plain_xml_not_gzipped(tmp_path):
    """Hand-edited clips may be plain XML; parse those too."""
    alc = tmp_path / "loop.alc"
    sample = tmp_path / "loop.wav"
    _touch(str(sample))
    _write_alc(str(alc), _alc_xml("loop.wav", []), gzipped=False)

    assert alc_resolver.resolve_alc(str(alc)) == os.path.normpath(str(sample))


# --- failure modes -----------------------------------------------------------


def test_missing_file_returns_none(tmp_path):
    assert alc_resolver.resolve_alc(str(tmp_path / "nope.alc")) is None


def test_empty_string_returns_none():
    assert alc_resolver.resolve_alc("") is None


def test_symlinked_clip_resolves_from_its_target_folder(tmp_path):
    """A library link to a clip that lives beside its audio elsewhere —
    the 190 linked accapellas (2026-09-24). The reference is relative to
    the clip's own folder, so the walk has to start at the link's target:
    from the link's folder nothing is found."""
    home = tmp_path / "Samples Organized" / "Accapellas"
    sample = home / "Dark Holler" / "apron.aif"
    _touch(str(sample))
    real = home / "Clips" / "3" / "Apron (D).alc"
    real.parent.mkdir(parents=True)
    _write_alc(str(real), _alc_xml("apron.aif", ["Dark Holler"]))
    link = tmp_path / "Library" / "Vocal" / "Accapellas" / "3" / "Apron (D).alc"
    link.parent.mkdir(parents=True)
    os.symlink(str(real), str(link))

    found = alc_resolver.resolve_alc(str(link))
    assert found is not None
    assert os.path.samefile(found, str(sample))


def test_unresolvable_sample_returns_none(tmp_path):
    """Valid .alc but the referenced sample doesn't exist anywhere."""
    alc = tmp_path / "clip.alc"
    _write_alc(str(alc), _alc_xml("ghost.wav", ["Samples"]))
    assert alc_resolver.resolve_alc(str(alc)) is None


def test_garbage_content_returns_none(tmp_path):
    alc = tmp_path / "clip.alc"
    with open(str(alc), "wb") as f:
        f.write(b"not xml and not gzip")
    assert alc_resolver.resolve_alc(str(alc)) is None


def test_no_name_returns_none(tmp_path):
    alc = tmp_path / "clip.alc"
    xml = (
        "<Ableton><SampleRef><FileRef>"
        "<RelativePath><RelativePathElement Dir=\"Samples\" /></RelativePath>"
        "</FileRef></SampleRef></Ableton>"
    )
    _write_alc(str(alc), xml)
    assert alc_resolver.resolve_alc(str(alc)) is None


# --- is_alc ------------------------------------------------------------------


@pytest.mark.parametrize(
    "path, expected",
    [
        ("/a/b/c.alc", True),
        ("/a/b/c.ALC", True),
        ("/a/b/c.wav", False),
        ("/a/b/c.aif", False),
        ("clip.als", False),
        ("", False),
    ],
)
def test_is_alc(path, expected):
    assert alc_resolver.is_alc(path) is expected


# --- a pack clip copied out of its pack (the browser's Places, 2026-09-24) ---


def _pack_clip_copied_out(tmp_path):
    """A Vinyl Classics clip, and a clone of it outside the pack."""
    packs = tmp_path / "Packs"
    sample = packs / "Vinyl Classics" / "Samples" / "Degrees Of Abstract" / "098 Lumb Robot" / "FX Whistle.aif"
    _touch(str(sample))
    xml = _alc_xml(
        "FX Whistle.aif",
        ["Samples", "Degrees Of Abstract", "098 Lumb Robot", "private", "tmp", "trunk"],
        pack="Vinyl Classics",
    )
    inside = packs / "Vinyl Classics" / "Clips" / "Degrees Of Abstract" / "FX Whistle.alc"
    os.makedirs(inside.parent, exist_ok=True)
    _write_alc(str(inside), xml)
    copy = tmp_path / "Sidebar" / "Inst" / "Samples" / "Vinyl Classics" / "Degrees Of Abstract" / "FX Whistle.alc"
    os.makedirs(copy.parent, exist_ok=True)
    _write_alc(str(copy), xml)
    return packs, sample, inside, copy


def test_pack_clip_resolves_inside_its_pack_with_no_pack_roots(tmp_path):
    packs, sample, inside, _copy = _pack_clip_copied_out(tmp_path)
    assert alc_resolver.resolve_alc(str(inside), pack_roots=[]) == os.path.normpath(str(sample))


def test_pack_clip_copied_out_resolves_through_the_packs_folder(tmp_path):
    """The walk from the copy never reaches the pack; the pack name does.
    Measured on the rig: 908 of the Places' 1,099 clips, and every Simpler
    load of one answered no-file-path before this."""
    packs, sample, _inside, copy = _pack_clip_copied_out(tmp_path)
    assert alc_resolver.resolve_alc(str(copy), pack_roots=[]) is None
    assert alc_resolver.resolve_alc(str(copy), pack_roots=[str(packs)]) == os.path.normpath(str(sample))


def test_pack_roots_default_is_what_the_surface_set(tmp_path):
    packs, sample, _inside, copy = _pack_clip_copied_out(tmp_path)
    try:
        alc_resolver.set_pack_roots([str(packs), "", None])
        assert alc_resolver.resolve_alc(str(copy)) == os.path.normpath(str(sample))
    finally:
        alc_resolver.set_pack_roots([])
    assert alc_resolver.resolve_alc(str(copy)) is None


def test_a_pack_name_is_never_a_path(tmp_path):
    """A clip naming ``..`` or a path as its pack cannot reach outside the
    Packs folder. The target sits where only ``<packs>/../`` leads — not on
    the clip's own upward walk — so a hit could only come from the pack step."""
    packs = tmp_path / "root" / "Packs"
    os.makedirs(packs, exist_ok=True)
    outside = tmp_path / "root" / "Samples" / "x.aif"
    _touch(str(outside))
    assert os.path.isfile(os.path.normpath(os.path.join(str(packs), "..", "Samples", "x.aif")))
    for bad in ("..", "../root", "a/b", "."):
        alc = tmp_path / "clipdir" / "bad.alc"
        os.makedirs(alc.parent, exist_ok=True)
        _write_alc(str(alc), _alc_xml("x.aif", ["Samples"], pack=bad))
        assert alc_resolver.resolve_alc(str(alc), pack_roots=[str(packs)]) is None, bad
