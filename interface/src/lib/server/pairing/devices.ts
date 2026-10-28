/**
 * The paired devices (ADR-491, security.plan.md "The cookie").
 *
 * A device is paired by a random 32-byte token in its cookie. Only the
 * token's SHA-256 is kept, with the device's name, the address it paired
 * from and its first and last use, in `config/.paired-devices.json`
 * (gitignored, mode 0600, like `.ws-secret`). So the file can't be replayed
 * as a cookie, and forgetting a device is deleting its line.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PairedDevice {
	hash: string;
	name: string;
	address: string;
	firstUsed: number;
	lastUsed: number;
}

/** A use is written back at most this often, so polling cannot thrash the file. */
const LAST_USED_WRITE_MS = 60 * 60 * 1000;

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function createDeviceStore(file: string, now: () => number = Date.now) {
	let devices: PairedDevice[] | null = null;

	function load(): PairedDevice[] {
		if (devices) return devices;
		try {
			const parsed = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
			devices = Array.isArray(parsed) ? parsed.filter((d) => d && typeof d.hash === 'string') : [];
		} catch {
			devices = [];
		}
		return devices;
	}

	function save(): void {
		const tmp = `${file}.tmp`;
		writeFileSync(tmp, JSON.stringify(load(), null, 2) + '\n', { mode: 0o600 });
		renameSync(tmp, file);
		try {
			chmodSync(file, 0o600);
		} catch {
			/* a filesystem without modes */
		}
	}

	return {
		/** Pair a device: its token, to be set as its cookie once and never stored. */
		issue(name: string, address: string): string {
			const token = randomBytes(32).toString('base64url');
			const t = now();
			load().push({ hash: hashToken(token), name, address, firstUsed: t, lastUsed: t });
			save();
			return token;
		},

		/** The device holding this token, its last use refreshed; null when none. */
		verify(token: string | undefined): PairedDevice | null {
			if (!token) return null;
			const hash = hashToken(token);
			const device = load().find((d) => d.hash === hash);
			if (!device) return null;
			const t = now();
			if (t - device.lastUsed > LAST_USED_WRITE_MS) {
				device.lastUsed = t;
				save();
			}
			return device;
		},

		list(): PairedDevice[] {
			return load().map((d) => ({ ...d }));
		},

		forget(hash: string): boolean {
			const before = load().length;
			devices = load().filter((d) => d.hash !== hash);
			if (devices.length === before) return false;
			save();
			return true;
		},

		forgetAll(): number {
			const count = load().length;
			devices = [];
			save();
			return count;
		}
	};
}

export type DeviceStore = ReturnType<typeof createDeviceStore>;

export function defaultDevicesFile(root: string): string {
	return join(root, 'config', '.paired-devices.json');
}
