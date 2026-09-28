/**
 * Read a value through a real `$derived` from a test.
 *
 * Runes only compile in `.svelte` / `.svelte.ts` files, so a plain
 * `*.test.ts` cannot declare one — it throws `rune_outside_svelte`. Some
 * defects are only visible through a derivation: a store can hold the right
 * value and still never signal a change, and an imperative read from test
 * code cannot tell the two apart. That is audit item 24 exactly (a plain
 * `Map` inside `$state`, which Svelte hands back un-proxied), and it is the
 * same blind spot the audit records against `paramArming`.
 *
 * Pull-based on purpose. An `$effect`-based recorder needs Svelte's
 * scheduler to run, and outside a component there is no render cycle to
 * hang that on — `tick()` returns before the effect re-runs and `flushSync()`
 * on its own never runs it at all. A `$derived` recomputes when read, so
 * `probe.value` is always current with no flushing.
 *
 * Keep this file free of anything but harnesses.
 */

export interface DerivedProbe<T> {
	/** Current value of the derivation. Recomputed on read if dirty. */
	readonly value: T;
	/** Tear down the effect root. Always call it. */
	stop: () => void;
}

/**
 * Wrap `read` in a `$derived` and expose it as `.value`.
 *
 * If the underlying store fails to signal, `.value` keeps returning the old
 * result — which is the failure this exists to catch.
 */
export function derivedProbe<T>(read: () => T): DerivedProbe<T> {
	let get!: () => T;
	const stop = $effect.root(() => {
		const value = $derived.by(read);
		get = () => value;
	});
	return {
		get value() {
			return get();
		},
		stop
	};
}

export interface RuneMount<T> {
	/** What `setup` returned. */
	readonly handle: T;
	/** Tear down the effect root. Always call it. */
	stop: () => void;
}

/**
 * Run a rune helper (`useDrumVm`, `usePadChainRows` — anything that
 * creates `$effect`s and must be called during init) inside an
 * `$effect.root`, and hand back what it returned. `flushSync()` from
 * `svelte` runs the effects it created; the hook's own `$derived` state
 * recomputes on read.
 */
export function mountRune<T>(setup: () => T): RuneMount<T> {
	let handle!: T;
	const stop = $effect.root(() => {
		handle = setup();
	});
	return { handle, stop };
}

export interface StateBox<T> {
	value: T;
}

/** A reactive cell a test can move — the input a hook's getter reads. */
export function stateBox<T>(initial: T): StateBox<T> {
	let value = $state(initial);
	return {
		get value() {
			return value;
		},
		set value(next: T) {
			value = next;
		}
	};
}
