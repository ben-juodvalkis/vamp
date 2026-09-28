import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { logger } from '$lib/utils/logger';

export type Theme = 'light' | 'dark' | 'system';

/**
 * Look. There is ONE skin — **Hybrid** — and it is no longer a choice.
 *
 * Hybrid is the flat grammar (Ableton Live 12's visual rules: opaque surfaces,
 * 1px dark edges, 2px radii, black text on colour, one accent for ON) wearing
 * the app's own cooler grey ladder, calibrated track inks and device-family
 * colour on FX tiles. It is applied by two attributes hard-coded on `<html>` in
 * `app.html` — `data-skin="hybrid"` (palette) and `data-grammar="flat"`
 * (component overrides) — so there is no boot script, no store and no FOUC
 * window for the look. This module only owns the light/dark POLARITY.
 *
 * The retired GRATICULE skin was the base layer: its token block still lives in
 * `app.css` under bare `.dark` / `.light`, because the hybrid block is written
 * as a delta over it and redefines all but five of its tokens. Deleting it is a
 * separate, mechanical job (see Looping's `documentation/archive/graticule-skin.md`).
 */

// Create writable stores for theme state
const theme = writable<Theme>('dark');
const resolvedTheme = writable<'light' | 'dark'>('dark');

class ThemeManager {
	private mediaQuery?: MediaQueryList;
	private unsubscribe?: () => void;

	constructor() {
		if (browser) {
			this.initializeTheme();
			this.watchSystemPreference();
		}
	}

	private initializeTheme() {
		const stored = localStorage.getItem('theme') as Theme;
		if (stored && ['light', 'dark', 'system'].includes(stored)) {
			theme.set(stored);
		}
		this.updateResolvedTheme();
		this.applyTheme();
	}

	private watchSystemPreference() {
		this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

		const handleChange = () => {
			if (get(theme) === 'system') {
				this.updateResolvedTheme();
				this.applyTheme();
			}
		};

		this.mediaQuery.addEventListener('change', handleChange);
		
		// Store cleanup function
		this.unsubscribe = () => this.mediaQuery?.removeEventListener('change', handleChange);
	}

	private updateResolvedTheme() {
		const currentTheme = get(theme);

		if (currentTheme === 'system') {
			const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			resolvedTheme.set(isDark ? 'dark' : 'light');
		} else {
			resolvedTheme.set(currentTheme);
		}
	}

	private applyTheme() {
		const resolved = get(resolvedTheme);
		const root = document.documentElement;
		
		// Remove existing theme classes
		root.classList.remove('light', 'dark');
		
		// Apply new theme class
		root.classList.add(resolved);
		
		this.applyThemeColor();
	}

	/** iPad status-bar / PWA chrome colour = the active canvas (`--canvas` per polarity). */
	private applyThemeColor() {
		const metaThemeColor = document.querySelector('meta[name="theme-color"]');
		if (!metaThemeColor) return;
		// Hybrid canvas — mirrors `--canvas` in app.css's `.dark/.light[data-skin="hybrid"]`.
		const hex = get(resolvedTheme) === 'dark' ? '#1f2126' : '#d5d8dd';
		metaThemeColor.setAttribute('content', hex);
	}

	// Theme setter
	setTheme(newTheme: Theme) {
		theme.set(newTheme);
		
		if (browser) {
			localStorage.setItem('theme', newTheme);
			this.updateResolvedTheme();
			this.applyTheme();
		}
	}

	// Cycle through themes: system -> light -> dark -> system
	cycle() {
		const currentTheme = get(theme);
		const themes: Theme[] = ['system', 'light', 'dark'];
		const currentIndex = themes.indexOf(currentTheme);
		const nextIndex = (currentIndex + 1) % themes.length;
		this.setTheme(themes[nextIndex]);
	}

	// Toggle between light and dark (ignoring system)
	toggle() {
		const currentTheme = get(theme);
		const currentResolved = get(resolvedTheme);

		if (currentTheme === 'system') {
			// If currently system, toggle to opposite of resolved
			this.setTheme(currentResolved === 'dark' ? 'light' : 'dark');
		} else {
			// Toggle between light and dark
			this.setTheme(currentTheme === 'dark' ? 'light' : 'dark');
		}
	}

	destroy() {
		this.unsubscribe?.();
	}
}

// Export singleton instance
export const themeManager = new ThemeManager();

// Export stores
export { theme, resolvedTheme };

// Utility function to get current theme values (non-reactive)
export function getCurrentTheme() {
	const currentTheme = get(theme);
	const currentResolved = get(resolvedTheme);

	return {
		current: currentTheme,
		resolved: currentResolved,
		isDark: currentResolved === 'dark',
		isLight: currentResolved === 'light'
	};
}

// Theme actions for components
export const themeActions = {
	set: (newTheme: Theme) => themeManager.setTheme(newTheme),
	cycle: () => themeManager.cycle(),
	toggle: () => themeManager.toggle()
};

// OSC Message Handler for theme control
export function handleMessage(address: string, ...args: import('$lib/types/osc').OSCArg[]): void {
	logger.debug(`OSC message: ${address}`, { component: 'theme', args });
	
	if (address === '/theme/set') {
		const themeValue = args[0];
		if (typeof themeValue === 'string' && ['light', 'dark', 'system'].includes(themeValue)) {
			themeManager.setTheme(themeValue as Theme);
			logger.debug(`Set theme to: ${themeValue}`, { component: 'theme' });
		} else {
			logger.warn(`Invalid theme value: ${themeValue}`, { component: 'theme' });
		}
	} else if (address === '/theme/toggle') {
		themeManager.toggle();
		logger.debug('Toggled theme', { component: 'theme' });
	} else if (address === '/theme/cycle') {
		themeManager.cycle();
		logger.debug('Cycled theme', { component: 'theme' });
	} else {
		logger.warn(`Unknown theme address: ${address}`, { component: 'theme' });
	}
}