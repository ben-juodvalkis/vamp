/**
 * The character count a `.fit-label` sizes against (app.css): the longest
 * word, because a label may wrap between words but never inside one, so
 * the longest word is the run that has to fit across its box.
 *
 * Set it as `style:--chars={longestWordLength(text)}` on the `.fit-label`.
 * Empty or missing text counts as 1, which leaves the label's size alone.
 */
export function longestWordLength(text: string | null | undefined): number {
	if (!text) return 1;
	let longest = 1;
	for (const word of text.split(/\s+/)) {
		const length = [...word].length;
		if (length > longest) longest = length;
	}
	return longest;
}
