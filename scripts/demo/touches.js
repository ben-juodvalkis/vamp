// Finger circles for demo recordings, injected by the runner with
// addInitScript: never part of the app. It listens to touch pointers in the
// capture phase on window, before any handler of the app's can stop them,
// and draws into a layer that takes no pointer events, so it cannot change
// what a touch does.
(() => {
	const SIZE = 56;
	const layer = document.createElement('div');
	layer.setAttribute('data-demo-touches', '');
	Object.assign(layer.style, {
		position: 'fixed',
		inset: '0',
		pointerEvents: 'none',
		zIndex: '2147483647',
		overflow: 'hidden'
	});
	const mount = () => document.documentElement.appendChild(layer);
	if (document.documentElement) mount();
	else document.addEventListener('DOMContentLoaded', mount);

	const dots = new Map();
	const place = (dot, e) => {
		dot.style.transform = `translate(${e.clientX - SIZE / 2}px, ${e.clientY - SIZE / 2}px)`;
	};

	window.addEventListener(
		'pointerdown',
		(e) => {
			if (e.pointerType !== 'touch') return;
			const dot = document.createElement('div');
			Object.assign(dot.style, {
				position: 'absolute',
				left: '0',
				top: '0',
				width: `${SIZE}px`,
				height: `${SIZE}px`,
				borderRadius: '50%',
				background: 'rgba(255, 255, 255, 0.35)',
				boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.85), 0 2px 10px rgba(0, 0, 0, 0.45)',
				transition: 'opacity 220ms ease-out, scale 220ms ease-out',
				scale: '1'
			});
			place(dot, e);
			layer.appendChild(dot);
			dots.set(e.pointerId, dot);
		},
		{ capture: true, passive: true }
	);
	window.addEventListener(
		'pointermove',
		(e) => {
			const dot = dots.get(e.pointerId);
			if (dot) place(dot, e);
		},
		{ capture: true, passive: true }
	);
	const lift = (e) => {
		const dot = dots.get(e.pointerId);
		if (!dot) return;
		dots.delete(e.pointerId);
		dot.style.opacity = '0';
		dot.style.scale = '1.25';
		setTimeout(() => dot.remove(), 260);
	};
	window.addEventListener('pointerup', lift, { capture: true, passive: true });
	window.addEventListener('pointercancel', lift, { capture: true, passive: true });
})();
