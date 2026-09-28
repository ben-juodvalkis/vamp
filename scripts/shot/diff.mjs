/**
 * Pixel diff between two PNGs, decoded in the same Chromium the shots
 * were taken with — no image-decoding dependency.
 *
 * The output is the shape ADR-415 used to argue a change was visually
 * inert: how many pixels differ, and by how much on the worst channel.
 * Read both numbers together. Two captures of *identical* code are not
 * bit-identical here — meters and playhead visualisations animate — so
 * a handful of differing pixels at a high max delta is noise, while a
 * large count at a low delta is usually an anti-aliasing shift. A real
 * layout change moves thousands of pixels.
 *
 *   node scripts/shot/diff.mjs before.png after.png
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function launch() {
	const { chromium } = await import('playwright');
	try {
		return await chromium.launch();
	} catch (err) {
		const fallback = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
		return await chromium.launch({ executablePath: fallback }).catch(() => {
			throw err;
		});
	}
}

/**
 * @returns {Promise<{total:number, differing:number, percent:number, maxDelta:number}>}
 */
export async function diffPngs(pathA, pathB) {
	const [a, b] = await Promise.all([readFile(pathA), readFile(pathB)]);
	const browser = await launch();
	try {
		const page = await browser.newPage();
		return await page.evaluate(
			async ([srcA, srcB]) => {
				const decode = (src) =>
					new Promise((res, rej) => {
						const img = new Image();
						img.onload = () => res(img);
						img.onerror = rej;
						img.src = src;
					});
				const [imgA, imgB] = await Promise.all([decode(srcA), decode(srcB)]);
				if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
					throw new Error(
						`Dimension mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`
					);
				}
				const { width, height } = imgA;
				const pixelsOf = (img) => {
					const canvas = document.createElement('canvas');
					canvas.width = width;
					canvas.height = height;
					const ctx = canvas.getContext('2d', { willReadFrequently: true });
					ctx.drawImage(img, 0, 0);
					return ctx.getImageData(0, 0, width, height).data;
				};
				const pa = pixelsOf(imgA);
				const pb = pixelsOf(imgB);

				let differing = 0;
				let maxDelta = 0;
				for (let i = 0; i < pa.length; i += 4) {
					let worst = 0;
					for (let c = 0; c < 4; c++) {
						const d = Math.abs(pa[i + c] - pb[i + c]);
						if (d > worst) worst = d;
					}
					if (worst > 0) {
						differing++;
						if (worst > maxDelta) maxDelta = worst;
					}
				}
				const total = width * height;
				return { total, differing, percent: (differing / total) * 100, maxDelta };
			},
			[`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]
		);
	} finally {
		await browser.close();
	}
}

const invokedDirectly =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
	const [a, b] = process.argv.slice(2);
	if (!a || !b) {
		console.error('usage: node scripts/shot/diff.mjs <before.png> <after.png>');
		process.exit(1);
	}
	const r = await diffPngs(a, b);
	console.log(
		`${r.differing}/${r.total} px differ (${r.percent.toFixed(4)}%), max channel delta ${r.maxDelta}`
	);
}
