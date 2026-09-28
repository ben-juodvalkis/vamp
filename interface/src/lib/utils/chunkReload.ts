const RELOAD_FLAG_KEY = 'chunkReload:lastReload';
const RELOAD_COOLDOWN_MS = 30_000;

const IMPORT_ERROR_PATTERNS = [
	'Failed to fetch dynamically imported module',
	'Importing a module script failed',
	'error loading dynamically imported module',
];

export function shouldReloadForImportError(error: unknown): boolean {
	if (typeof window === 'undefined') return false;

	const message = error instanceof Error ? error.message : String(error ?? '');
	if (!IMPORT_ERROR_PATTERNS.some((p) => message.toLowerCase().includes(p.toLowerCase()))) {
		return false;
	}

	try {
		const last = Number(sessionStorage.getItem(RELOAD_FLAG_KEY) ?? '0');
		if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) {
			return false;
		}
		sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));
	} catch {
		return false;
	}

	return true;
}
