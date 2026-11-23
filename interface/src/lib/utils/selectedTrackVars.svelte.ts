/**
 * The selected track's colour on the root (ADR-544), for anything that wears
 * it in CSS. Four values, computed here so no browser needs CSS relative
 * colour:
 *   --sel-track     the strip's own name-block colour: a fill, the central
 *                   view's title band
 *   --sel-track-fg  the text that reads on that fill
 *   --sel-ink       the ink an amount is drawn in (app.css `--amount`)
 *   --sel-shade     the selected strip's fill: a deep shade in dark, a pale
 *                   one in light
 * The master selected wears Live's own master colour. With no record yet
 * (cold start) they are unset and the tokens' own fallbacks apply.
 *
 * Called once, from the root layout, so the iPad and the phone layouts both
 * have them. Not a per-frame write: it runs when the selection, the track's
 * colour or the theme changes.
 */
import { selectedRecord } from '$lib/utils/selectedTrackInk';
import { amountInk, inkShade, rgbToHex, trackInk } from '$lib/utils/formatters/trackFormatters';
import { paintModeReactive } from '$lib/utils/paintMode.svelte';
import { padTextCss } from '$lib/services/drumVirtualMacros/padLabels';

const NAMES = ['--sel-track', '--sel-track-fg', '--sel-ink', '--sel-shade'] as const;

export function useSelectedTrackVars(): void {
	$effect(() => {
		const rec = selectedRecord();
		const mode = paintModeReactive();
		const root = document.documentElement;
		if (!rec) {
			for (const name of NAMES) root.style.removeProperty(name);
			return;
		}
		const ink = trackInk(rgbToHex(rec.color), mode);
		root.style.setProperty('--sel-track', ink);
		root.style.setProperty('--sel-track-fg', padTextCss(parseInt(ink.slice(1), 16)));
		root.style.setProperty('--sel-ink', amountInk(ink, mode));
		root.style.setProperty('--sel-shade', mode === 'light' ? inkShade(ink, 0.86, 0.7) : inkShade(ink, 0.3, 0.55));
	});
}
