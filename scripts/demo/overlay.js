// The demo's drawing layer, injected by the runner with addInitScript:
// never part of the app. It takes no pointer events, so it cannot change
// what a touch does.
//
//   - finger: every touch (and the runner's mouse-type finger, run.mjs)
//     draws a dot with a ripple, which lingers a moment after lift so a
//     quick tap still reads on video;
//   - approach ring: before each touch the runner glides a ring to the
//     target (window.__demo.approach), so a viewer sees where it is going;
//   - spotlight: window.__demo.box(rects, label) dims everything but the
//     part of the interface a step is about, outlines it and names it.
(() => {
	const ACCENT = '#f2b46b';
	const FINGER = 64;

	const el = (styles) => {
		const d = document.createElement('div');
		Object.assign(d.style, styles);
		return d;
	};
	const layer = el({ position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647', overflow: 'hidden' });
	layer.setAttribute('data-demo-overlay', '');
	const mount = () => document.documentElement.appendChild(layer);
	if (document.documentElement) mount();
	else document.addEventListener('DOMContentLoaded', mount);

	// ---- spotlight --------------------------------------------------------
	const spot = el({
		position: 'absolute',
		left: '0',
		top: '0',
		width: '0',
		height: '0',
		borderRadius: '14px',
		opacity: '0',
		boxShadow: `0 0 0 3px ${ACCENT}, 0 0 28px 6px rgba(242, 180, 107, 0.35), 0 0 0 200vmax rgba(6, 7, 10, 0.58)`,
		transition:
			'left 480ms cubic-bezier(.2,.8,.2,1), top 480ms cubic-bezier(.2,.8,.2,1), width 480ms cubic-bezier(.2,.8,.2,1), height 480ms cubic-bezier(.2,.8,.2,1), opacity 380ms ease'
	});
	const tag = el({
		position: 'absolute',
		left: '0',
		top: '0',
		padding: '7px 14px 8px',
		borderRadius: '9px',
		background: ACCENT,
		color: '#1b1307',
		font: '700 19px -apple-system, "SF Pro Text", system-ui, sans-serif',
		letterSpacing: '0.01em',
		whiteSpace: 'nowrap',
		boxShadow: '0 6px 18px rgba(0,0,0,.45)',
		opacity: '0',
		transition: 'left 480ms cubic-bezier(.2,.8,.2,1), top 480ms cubic-bezier(.2,.8,.2,1), opacity 380ms ease'
	});
	layer.append(spot, tag);

	// ---- approach ring -------------------------------------------------------
	const ring = el({
		position: 'absolute',
		left: '0',
		top: '0',
		width: `${FINGER}px`,
		height: `${FINGER}px`,
		marginLeft: `${-FINGER / 2}px`,
		marginTop: `${-FINGER / 2}px`,
		borderRadius: '50%',
		border: '3px solid rgba(255,255,255,.95)',
		boxShadow: '0 0 0 1px rgba(0,0,0,.35), 0 4px 16px rgba(0,0,0,.5)',
		opacity: '0',
		transform: 'translate(-200px, -200px)',
		transition: 'transform 420ms cubic-bezier(.25,.8,.25,1), opacity 220ms ease'
	});
	layer.append(ring);
	let ringAt = null;

	window.__demo = {
		/** Outline the union of `rects` ({x,y,w,h}, CSS px) and dim the rest; null clears. */
		box(rects, label) {
			if (!rects || !rects.length) {
				spot.style.opacity = '0';
				tag.style.opacity = '0';
				return;
			}
			const pad = 6;
			const x0 = Math.min(...rects.map((r) => r.x)) - pad;
			const y0 = Math.min(...rects.map((r) => r.y)) - pad;
			const x1 = Math.max(...rects.map((r) => r.x + r.w)) + pad;
			const y1 = Math.max(...rects.map((r) => r.y + r.h)) + pad;
			Object.assign(spot.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px`, opacity: '1' });
			if (label) {
				tag.textContent = label;
				// Above the box, or inside its top edge when it reaches the screen's top.
				const above = y0 - 48 >= 4;
				const w = tag.offsetWidth || label.length * 11 + 28;
				const left = Math.min(Math.max(4, x0), innerWidth - w - 4);
				Object.assign(tag.style, { left: `${left}px`, top: `${above ? y0 - 46 : y0 + 10}px`, opacity: '1' });
			} else {
				tag.style.opacity = '0';
			}
		},
		/** Glide the ring to (x, y), CSS px. */
		approach(x, y) {
			if (!ringAt) {
				ring.style.transition = 'none';
				ring.style.transform = `translate(${x}px, ${y + 90}px)`;
				void ring.offsetWidth;
				ring.style.transition = 'transform 420ms cubic-bezier(.25,.8,.25,1), opacity 220ms ease';
			}
			ring.style.opacity = '1';
			ring.style.transform = `translate(${x}px, ${y}px)`;
			ringAt = { x, y };
		},
		/** Fade the ring out (after a touch). */
		lift() {
			ring.style.opacity = '0';
			ringAt = null;
		}
	};

	// ---- finger -------------------------------------------------------------
	const dots = new Map();
	// left/top, not a transform: the ripple and the lift animate `scale`,
	// which composes with a transform and would scale the offset too.
	const place = (node, e) => {
		node.style.left = `${e.clientX - FINGER / 2}px`;
		node.style.top = `${e.clientY - FINGER / 2}px`;
	};

	window.addEventListener(
		'pointerdown',
		(e) => {
			if (e.pointerType !== 'touch' && e.pointerType !== 'mouse') return;
			const dot = el({
				position: 'absolute',
				left: '0',
				top: '0',
				width: `${FINGER}px`,
				height: `${FINGER}px`,
				borderRadius: '50%',
				background: 'rgba(255, 255, 255, 0.55)',
				boxShadow: '0 0 0 3px rgba(255,255,255,.95), 0 3px 14px rgba(0,0,0,.5)',
				transition: 'opacity 260ms ease-out, scale 260ms ease-out'
			});
			const ripple = el({
				position: 'absolute',
				left: '0',
				top: '0',
				width: `${FINGER}px`,
				height: `${FINGER}px`,
				borderRadius: '50%',
				border: `3px solid ${ACCENT}`,
				transition: 'scale 700ms cubic-bezier(.2,.7,.3,1), opacity 700ms ease-out'
			});
			place(dot, e);
			place(ripple, e);
			layer.append(ripple, dot);
			void ripple.offsetWidth;
			ripple.style.scale = '2.4';
			ripple.style.opacity = '0';
			setTimeout(() => ripple.remove(), 760);
			dots.set(e.pointerId, { dot, down: performance.now() });
			window.__demo.lift();
		},
		{ capture: true, passive: true }
	);
	window.addEventListener(
		'pointermove',
		(e) => {
			const d = dots.get(e.pointerId);
			if (d) place(d.dot, e);
		},
		{ capture: true, passive: true }
	);
	const up = (e) => {
		const d = dots.get(e.pointerId);
		if (!d) return;
		dots.delete(e.pointerId);
		// A tap is ~100 ms; keep the dot up long enough to see.
		const linger = Math.max(0, 380 - (performance.now() - d.down));
		setTimeout(() => {
			d.dot.style.opacity = '0';
			d.dot.style.scale = '1.2';
			setTimeout(() => d.dot.remove(), 300);
		}, linger);
	};
	window.addEventListener('pointerup', up, { capture: true, passive: true });
	window.addEventListener('pointercancel', up, { capture: true, passive: true });
})();
