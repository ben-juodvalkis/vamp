/**
 * Performance utilities for debouncing and throttling
 */

export interface DebouncedFunction<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): ReturnType<T> | undefined;
    cancel: () => void;
    flush: () => ReturnType<T> | undefined;
}

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number,
    options: { leading?: boolean; trailing?: boolean } = {}
): DebouncedFunction<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<T> | null = null;
    let lastThis: any;
    let result: ReturnType<T>;
    let lastCallTime: number | undefined;

    const { leading = false, trailing = true } = options;

    function invokeFunc(time: number) {
        const args = lastArgs;
        const thisArg = lastThis;

        lastArgs = null;
        lastThis = null;
        lastCallTime = time;

        result = func.apply(thisArg, args!);
        return result;
    }

    function leadingEdge(time: number) {
        // Reset any `timeout`
        lastCallTime = time;
        // Start the timer for the trailing edge
        timeout = setTimeout(timerExpired, wait);
        // Invoke the leading edge
        return leading ? invokeFunc(time) : result;
    }

    function timerExpired() {
        const time = Date.now();

        // Restart the timer if we still need to wait
        if (shouldInvoke(time)) {
            return trailingEdge(time);
        }

        // Reset the timer
        timeout = null;
    }

    function trailingEdge(time: number) {
        timeout = null;

        // Only invoke if we have `lastArgs` which means `func` has been
        // debounced at least once.
        if (trailing && lastArgs) {
            return invokeFunc(time);
        }
        lastArgs = null;
        lastThis = null;
        return result;
    }

    function shouldInvoke(time: number): boolean {
        const timeSinceLastCall = lastCallTime === undefined ? 0 : time - lastCallTime;
        return lastCallTime === undefined || timeSinceLastCall >= wait;
    }

    function debounced(this: any, ...args: Parameters<T>) {
        const time = Date.now();
        const isInvoking = shouldInvoke(time);

        lastArgs = args;
        lastThis = this;

        if (isInvoking) {
            if (timeout === null) {
                return leadingEdge(time);
            }
        }

        if (timeout === null) {
            timeout = setTimeout(timerExpired, wait);
        }
        return result;
    }

    debounced.cancel = function() {
        if (timeout !== null) {
            clearTimeout(timeout);
        }
        lastCallTime = undefined;
        timeout = null;
        lastArgs = null;
        lastThis = null;
    };

    debounced.flush = function() {
        return timeout === null ? result : trailingEdge(Date.now());
    };

    return debounced;
}

/**
 * Creates a throttled function that only invokes func at most once per
 * every wait milliseconds
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    wait: number,
    options: { leading?: boolean; trailing?: boolean } = {}
): DebouncedFunction<T> {
    const { leading = true, trailing = true } = options;
    return debounce(func, wait, { leading, trailing });
}