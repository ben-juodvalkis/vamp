# ADR Directory

Architecture Decision Records for the live looping system.

> **Backend cutoff note (2026-04-21).** ADRs numbered before roughly
> 140 were written against the three-backend world (M4L observer +
> AbletonOSC + a scattering of side-channels). The v3 Python Control
> Surface migration (documented under `documentation/archive/m4l-to-python-v3/`)
> collapsed the wire to a single Python-surface backend with
> positional-path identity. Older ADRs remain historical record —
> when they contradict current architecture, current code and
> `docs/reference/{architecture,wire-protocol,ui-architecture}.md`
> are authoritative. Don't edit old ADRs to reflect the new world;
> supersede them with a new ADR if the decision needs revisiting.

## Creating a New ADR

1. **Find next number**: `ls -1 *.md | sort -t- -k1,1n | tail -1`
2. **Use next sequential number** (3-digit, zero-padded): e.g., `086-your-title.md`
3. **Ensure header matches filename**: `# ADR-086: Your Title`

## Format

```markdown
# ADR-086: Descriptive Title

## Status
**Accepted** | **Proposed** | **Superseded** | **Deprecated**

## Context
Brief description of the situation and problem...

## Decision
What we decided to do and why...

## Consequences
Positive and negative outcomes...

## Tags
`relevant-tags`, `for-searchability`
```

**Never assume the next number** — always check the directory first.
