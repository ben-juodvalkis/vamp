/**
 * Memoization utility for caching function results
 */

/**
 * Creates a memoized version of a function that caches its results
 */
export function memoize<T extends (...args: any[]) => any>(
    fn: T,
    options: {
        maxSize?: number;
        getKey?: (...args: Parameters<T>) => string;
        ttl?: number; // Time to live in milliseconds
    } = {}
): T {
    const { maxSize = 100, getKey, ttl } = options;
    const cache = new Map<string, { value: ReturnType<T>; timestamp?: number }>();

    // Default key generation
    const defaultGetKey = (...args: Parameters<T>) => JSON.stringify(args);
    const keyFn = getKey || defaultGetKey;

    return ((...args: Parameters<T>): ReturnType<T> => {
        const key = keyFn(...args);

        // Check cache
        if (cache.has(key)) {
            const cached = cache.get(key)!;

            // Check TTL if specified
            if (ttl && cached.timestamp) {
                const age = Date.now() - cached.timestamp;
                if (age > ttl) {
                    cache.delete(key);
                } else {
                    return cached.value;
                }
            } else {
                return cached.value;
            }
        }

        // Calculate new value
        const value = fn(...args);

        // Store in cache
        cache.set(key, {
            value,
            timestamp: ttl ? Date.now() : undefined
        });

        // Enforce max size (LRU eviction)
        if (cache.size > maxSize) {
            const firstKey = cache.keys().next().value;
            if (firstKey !== undefined) {
                cache.delete(firstKey);
            }
        }

        return value;
    }) as T;
}

/**
 * Creates a weak memoized function that uses WeakMap for object arguments
 * Good for memoizing with object keys that should be garbage collected
 */
export function weakMemoize<T extends (...args: any[]) => any>(
    fn: T
): T {
    const cache = new WeakMap<object, any>();

    return ((obj: object, ...args: any[]): ReturnType<T> => {
        if (!cache.has(obj)) {
            cache.set(obj, new Map<string, ReturnType<T>>());
        }

        const objCache = cache.get(obj)!;
        const key = JSON.stringify(args);

        if (!objCache.has(key)) {
            objCache.set(key, fn(obj, ...args));
        }

        return objCache.get(key)!;
    }) as T;
}