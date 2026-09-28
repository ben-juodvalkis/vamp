import globals from 'globals';

/**
 * Lint config for the OSC bridge.
 *
 * Scope is deliberately `interface/bridge/**` and the rule set is deliberately
 * one rule. The bridge is ~3.8k LOC of CommonJS that no type-checker covers
 * (`interface/tsconfig.json` set `checkJs: false` in audit item 20) and that
 * roughly half of has no test. `no-undef` is the rule that catches the class of
 * bug `interface/src/__tests__/.../webSocketServerWiring.test.ts` was written
 * after: a handler referencing an identifier that was never required or
 * declared ships green, because every pure-function test around it still
 * passes and the ReferenceError only fires on a live connection.
 *
 * Kept to one rule on purpose: the gate runs it on every push (inside vitest,
 * `bridgeLintGate.test.ts`), and a gate that fails on formatting opinions is a
 * gate everybody learns to skip.
 *
 * `interface/bridge/package.json` has no `"type"` field, so despite living
 * under `interface/` (which is `"type": "module"`) the nearest package.json
 * wins and these files are CommonJS. Hence `sourceType: 'commonjs'`, which is
 * what gives us `require`/`module`/`exports` as globals.
 */
export default [
	{
		files: ['interface/bridge/**/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: {
				...globals.node
			}
		},
		rules: {
			'no-undef': 'error'
		}
	}
];
