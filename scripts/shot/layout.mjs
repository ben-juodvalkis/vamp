/**
 * layout.mjs — the central-view spacing check (ADR-434), run by tour.mjs on
 * every state.
 *
 * Two invariants, measured off the rendered page rather than read from the
 * source — the five off-centre seams ADR-433's third pass found all looked
 * fine in the source:
 *
 *   1. Every SectionDivider has the view's `--central-gap` on BOTH sides,
 *      measured to the nearest painted thing rather than to a box edge.
 *   2. The painted content sits `--central-inset` from the central frame's
 *      inner edge on all four sides. A state whose content is deliberately
 *      centred on one axis says so with `layout: { centered: 'x' }` (or
 *      'y'); that axis must then clear the inset and be balanced instead.
 *
 * Overlays — anything positioned absolute or fixed, and what is inside it —
 * and anything outside the frame count for neither: a floating toggle or a
 * modal is not part of the layout's rhythm.
 *
 * A box counts only where it is PAINTED, so every box is cut to the ancestors
 * that clip their overflow. The case that needs it is text: a Range reports
 * the whole string, ellipsis or not, so the swap pill's clipped name — 509 px
 * of kit name in a 309 px column — read as content 144 px above the frame,
 * none of which is drawn (2026-09-15).
 *
 * What it does NOT check: the gap between two controls with no divider
 * between them, and spacing inside one control. Neither has an answer a
 * measurement can know without being told which boxes are one control.
 */

const TOLERANCE_PX = 1;

/** Runs in the page (via `page.evaluate`), so it must be self-contained. */
export function measureLayout() {
	const frame = document.querySelector('.central-frame');
	if (!frame) return { error: 'no .central-frame on the page' };

	const desc = (el) => {
		const cls = [...el.classList].filter((c) => !c.startsWith('svelte-')).slice(0, 3).join('.');
		const text = (el.innerText || el.getAttribute('aria-label') || '').trim().split('\n')[0].slice(0, 18);
		return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
	};
	const outOfFlow = (el) => {
		for (let e = el; e && e !== frame; e = e.parentElement) {
			const pos = getComputedStyle(e).position;
			if (pos === 'absolute' || pos === 'fixed') return true;
		}
		return false;
	};
	// What an ancestor's clipped overflow leaves of a box, cut axis by axis.
	// `overflow: hidden` clips to the padding box, and a box cut away entirely
	// is painted nowhere.
	const clipBox = (el) => {
		const b = el.getBoundingClientRect();
		if (!el.clientWidth && !el.clientHeight) return b;
		const left = b.left + el.clientLeft;
		const top = b.top + el.clientTop;
		return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
	};
	const paintedPart = (rect, from) => {
		let { left, top, right, bottom } = rect;
		for (let e = from; e && e !== frame.parentElement; e = e.parentElement) {
			const cs = getComputedStyle(e);
			if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
			const box = clipBox(e);
			if (cs.overflowX !== 'visible') {
				left = Math.max(left, box.left);
				right = Math.min(right, box.right);
			}
			if (cs.overflowY !== 'visible') {
				top = Math.max(top, box.top);
				bottom = Math.min(bottom, box.bottom);
			}
		}
		return right - left > 0 && bottom - top > 0
			? { left, top, right, bottom, width: right - left, height: bottom - top }
			: null;
	};

	// A role's value where it applies: a hidden probe reads the custom
	// property through `width`, which resolves rem and density overrides.
	const probe = (host, prop) => {
		const p = document.createElement('div');
		p.style.cssText = `position:absolute;visibility:hidden;width:var(${prop})`;
		host.appendChild(p);
		const w = p.getBoundingClientRect().width;
		p.remove();
		return w;
	};

	const fr = frame.getBoundingClientRect();
	const inner = { l: fr.left + frame.clientLeft, t: fr.top + frame.clientTop };
	inner.r = inner.l + frame.clientWidth;
	inner.b = inner.t + frame.clientHeight;

	// Every painted, in-flow box inside the frame: a background, a border,
	// media, or a run of text.
	const boxes = [];
	for (const el of frame.querySelectorAll('*')) {
		if (el.classList.contains('section-divider')) continue;
		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
		const r = el.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) continue;
		if (outOfFlow(el)) continue;
		const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none';
		const border = ['Top', 'Right', 'Bottom', 'Left'].some(
			(s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none'
		);
		const media = ['CANVAS', 'IMG', 'svg', 'SVG', 'INPUT'].includes(el.tagName);
		// An element's own box is cut by its ancestors' overflow, never by its
		// own; a text run inside it is cut by the element too.
		if (bg || border || media) {
			const box = paintedPart(r, el.parentElement);
			if (box) boxes.push({ r: box, el });
		}
		for (const n of el.childNodes) {
			if (n.nodeType !== 3 || !n.textContent.trim()) continue;
			const range = document.createRange();
			range.selectNodeContents(n);
			const tr = paintedPart(range.getBoundingClientRect(), el);
			if (tr && tr.width > 0) boxes.push({ r: tr, el });
		}
	}
	const inFrame = boxes.filter(
		({ r }) =>
			r.right > inner.l && r.left < inner.r && r.bottom > inner.t && r.top < inner.b &&
			// a full-bleed background is the view, not its content
			!(r.width >= frame.clientWidth * 0.95 && r.height >= frame.clientHeight * 0.95)
	);

	const dividers = [...frame.querySelectorAll('.section-divider')]
		.filter((d) => {
			const r = d.getBoundingClientRect();
			return r.width > 0 && r.height > 0 && getComputedStyle(d).display !== 'none';
		})
		.map((d, index) => {
			const D = d.getBoundingClientRect();
			const vertical = d.dataset.orientation !== 'horizontal';
			let before = null;
			let after = null;
			for (const b of inFrame) {
				if (b.el.contains(d)) continue;
				const r = b.r;
				if (vertical) {
					if (!(r.bottom > D.top + 1 && r.top < D.bottom - 1)) continue;
					if (r.right <= D.left + 0.5 && (!before || r.right > before.r.right)) before = b;
					if (r.left >= D.right - 0.5 && (!after || r.left < after.r.left)) after = b;
				} else {
					if (!(r.right > D.left + 1 && r.left < D.right - 1)) continue;
					if (r.bottom <= D.top + 0.5 && (!before || r.bottom > before.r.bottom)) before = b;
					if (r.top >= D.bottom - 0.5 && (!after || r.top < after.r.top)) after = b;
				}
			}
			const round = (v) => +v.toFixed(1);
			return {
				index,
				orientation: vertical ? 'vertical' : 'horizontal',
				at: Math.round(vertical ? D.left - inner.l : D.top - inner.t),
				want: probe(d.parentElement, '--central-gap'),
				before: before ? round(vertical ? D.left - before.r.right : D.top - before.r.bottom) : null,
				after: after ? round(vertical ? after.r.left - D.right : after.r.top - D.bottom) : null,
				beforeEl: before ? desc(before.el) : null,
				afterEl: after ? desc(after.el) : null
			};
		});

	const root = frame.querySelector('[data-density]') ?? frame.firstElementChild?.firstElementChild ?? frame;
	const edge = {};
	for (const { r, el } of inFrame) {
		if (!edge.l || r.left < edge.l.v) edge.l = { v: r.left, el: desc(el) };
		if (!edge.t || r.top < edge.t.v) edge.t = { v: r.top, el: desc(el) };
		if (!edge.r || r.right > edge.r.v) edge.r = { v: r.right, el: desc(el) };
		if (!edge.b || r.bottom > edge.b.v) edge.b = { v: r.bottom, el: desc(el) };
	}
	const sides = edge.l
		? {
				left: { px: +(edge.l.v - inner.l).toFixed(1), el: edge.l.el },
				top: { px: +(edge.t.v - inner.t).toFixed(1), el: edge.t.el },
				right: { px: +(inner.r - edge.r.v).toFixed(1), el: edge.r.el },
				bottom: { px: +(inner.b - edge.b.v).toFixed(1), el: edge.b.el }
			}
		: null;

	return {
		density: root.dataset?.density ?? 'standard',
		gap: probe(root, '--central-gap'),
		inset: probe(root, '--central-inset'),
		sides,
		dividers
	};
}

/** Human-readable problems with a `measureLayout` result; empty when it holds. */
export function layoutViolations(m, { centered } = {}) {
	if (m.error) return [m.error];
	const problems = [];
	const near = (a, b) => Math.abs(a - b) <= TOLERANCE_PX;

	for (const d of m.dividers) {
		if (d.before == null || d.after == null) {
			problems.push(`divider ${d.index} (${d.orientation}, ${d.at}px): nothing painted on one side`);
		} else if (!near(d.before, d.want) || !near(d.after, d.want)) {
			problems.push(
				`divider ${d.index} (${d.orientation}, ${d.at}px): ${d.before} | ${d.after}, want ${d.want} | ${d.want}` +
					` — ${d.beforeEl} | ${d.afterEl}`
			);
		}
	}

	if (m.sides) {
		const axes = { x: ['left', 'right'], y: ['top', 'bottom'] };
		for (const [axis, [a, b]] of Object.entries(axes)) {
			const A = m.sides[a];
			const B = m.sides[b];
			if (centered === axis) {
				if (A.px < m.inset - TOLERANCE_PX || B.px < m.inset - TOLERANCE_PX || Math.abs(A.px - B.px) > 2) {
					problems.push(`inset (centred ${axis}): ${a} ${A.px}px, ${b} ${B.px}px — want both ≥ ${m.inset} and equal`);
				}
				continue;
			}
			for (const [side, s] of [[a, A], [b, B]]) {
				if (!near(s.px, m.inset)) problems.push(`inset: ${side} ${s.px}px, want ${m.inset} — ${s.el}`);
			}
		}
	}
	return problems;
}
