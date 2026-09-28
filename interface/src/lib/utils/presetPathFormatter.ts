/**
 * Preset path formatter
 * Turns a raw browser path like "Synths/Analog/Bass/MyPatch.adv"
 * into a breadcrumb-style display string "Synths › Analog › Bass › MyPatch".
 */

const STRIPPABLE_EXTENSIONS = [
	'.adv',
	'.adg',
	'.alp',
	'.als',
	'.wav',
	'.aif',
	'.aiff',
	'.mp3'
];

const SEPARATOR = ' › ';

export function formatPresetPath(raw: string): string {
	if (!raw) return '';

	// Split first and drop empty segments — handles leading, trailing, and
	// doubled slashes uniformly.
	const segments = raw.split('/').filter((s) => s.length > 0);
	if (segments.length === 0) return '';

	// Strip a trailing extension from the last segment if it matches the
	// allow-list. Defensive: don't mangle filenames that happen to contain
	// other dots.
	const last = segments[segments.length - 1];
	const lowerLast = last.toLowerCase();
	for (const ext of STRIPPABLE_EXTENSIONS) {
		if (lowerLast.endsWith(ext)) {
			segments[segments.length - 1] = last.slice(0, -ext.length);
			break;
		}
	}

	return segments.join(SEPARATOR);
}
