/**
 * How the server runs one of its own scripts in a process of its own (the
 * thumbnail bake, the category build): the built `scripts/<name>.mjs` with
 * plain Node when the app ships one (installer.plan.md Phase 2), else the
 * TypeScript through the checkout's tsx. Null when neither is there, and the
 * caller does the work itself.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './runtimeConfig';

export function childScript(name: string, ...args: string[]): { argv: string[]; cwd: string } | null {
	const root = repoRoot();
	const built = join(root, 'scripts', `${name}.mjs`);
	if (existsSync(built)) return { argv: [built, ...args], cwd: root };
	const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	const script = join(root, 'scripts', `${name}.ts`);
	if (!existsSync(tsx) || !existsSync(script)) return null;
	return { argv: [tsx, '--tsconfig', join(root, 'interface', 'tsconfig.json'), script, ...args], cwd: root };
}
