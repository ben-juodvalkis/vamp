/**
 * Validates a string of two octets separated by a dot (e.g. "37.129")
 * for use in constructing a 169.254.x.y link-local address.
 */
export function validateOctets(value: string): boolean {
	const parts = value.trim().split('.');
	if (parts.length !== 2) return false;

	for (const part of parts) {
		const num = parseInt(part, 10);
		if (isNaN(num) || num < 0 || num > 255) return false;
		if (part !== String(num)) return false; // no leading zeros
	}
	return true;
}
