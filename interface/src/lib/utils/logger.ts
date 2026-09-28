/**
 * Centralized logging utility with environment-based level filtering
 *
 * Usage:
 * ```typescript
 * import { logger } from '$lib/utils/logger';
 *
 * logger.debug('Component mounted', { component: 'TrackStrip', trackId });
 * logger.info('Track created', { trackIndex });
 * logger.warn('Deprecated API used', { api: '/old/endpoint' });
 * logger.error('Failed to load device', { error, deviceId });
 * ```
 */

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	NONE = 4
}

type RateBucket = {
	level: LogLevel;
	message: string;
	context?: Record<string, any>;
	count: number;
	firstTs: number;
};

const RATE_WINDOW_MS = 1000;

class Logger {
	private currentLevel: LogLevel;
	private rateBuckets = new Map<string, RateBucket>();
	private rateFlushTimer: ReturnType<typeof setInterval> | null = null;

	constructor() {
		// Default to WARN for cleaner output in both development and production.
		// Use localStorage.setItem('LOG_LEVEL', 'DEBUG') in browser for verbose logging.
		const isBrowser = typeof window !== 'undefined';

		if (isBrowser) {
			const storedLevel = localStorage.getItem('LOG_LEVEL');
			if (storedLevel && storedLevel in LogLevel) {
				this.currentLevel = LogLevel[storedLevel as keyof typeof LogLevel];
			} else {
				this.currentLevel = LogLevel.WARN;
			}
		} else {
			// The server (SvelteKit routes, the Places service) reads LOG_LEVEL from its environment.
			const envLevel = typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined;
			this.currentLevel =
				envLevel && envLevel in LogLevel ? LogLevel[envLevel as keyof typeof LogLevel] : LogLevel.WARN;
		}
	}

	/**
	 * Set the current log level programmatically
	 * @param level - The new log level to use
	 */
	setLevel(level: LogLevel): void {
		this.currentLevel = level;
		if (typeof window !== 'undefined') {
			localStorage.setItem('LOG_LEVEL', LogLevel[level]);
		}
	}

	/**
	 * Get the current log level
	 */
	getLevel(): LogLevel {
		return this.currentLevel;
	}

	private shouldLog(level: LogLevel): boolean {
		return level >= this.currentLevel;
	}

	/**
	 * Serialize context object, properly handling Error instances
	 * Error objects don't serialize with JSON.stringify (stack, message are lost)
	 */
	private serializeContext(context?: Record<string, any>): Record<string, any> | undefined {
		if (!context) return context;

		const serialized: Record<string, any> = {};
		for (const [key, value] of Object.entries(context)) {
			if (value instanceof Error) {
				serialized[key] = {
					name: value.name,
					message: value.message,
					stack: value.stack
				};
			} else {
				serialized[key] = value;
			}
		}
		return serialized;
	}

	private formatMessage(level: string, message: string, context?: Record<string, any>): string {
		const timestamp = new Date().toISOString();
		const serializedContext = this.serializeContext(context);
		const contextStr = serializedContext ? ` ${JSON.stringify(serializedContext)}` : '';
		return `[${timestamp}] [${level}] ${message}${contextStr}`;
	}

	/**
	 * Log debug information (only in development or when explicitly enabled)
	 * @param message - The message to log
	 * @param context - Optional context object with additional data
	 */
	debug(message: string, context?: Record<string, any>): void {
		if (this.shouldLog(LogLevel.DEBUG)) {
			console.debug(this.formatMessage('DEBUG', message, context));
		}
	}

	/**
	 * Log informational messages
	 * @param message - The message to log
	 * @param context - Optional context object with additional data
	 */
	info(message: string, context?: Record<string, any>): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.info(this.formatMessage('INFO', message, context));
		}
	}

	/**
	 * Log warning messages
	 * @param message - The message to log
	 * @param context - Optional context object with additional data
	 */
	warn(message: string, context?: Record<string, any>): void {
		if (this.shouldLog(LogLevel.WARN)) {
			console.warn(this.formatMessage('WARN', message, context));
		}
	}

	/**
	 * Log error messages
	 * @param message - The message to log
	 * @param context - Optional context object with additional data
	 */
	error(message: string, context?: Record<string, any>): void {
		if (this.shouldLog(LogLevel.ERROR)) {
			console.error(this.formatMessage('ERROR', message, context));
		}
	}

	/**
	 * Coalesced log: identical-key messages within a 1s window are folded
	 * into a single "<msg> ×N" emit. Use this for high-frequency paths
	 * where DEBUG-level instrumentation would otherwise drown out the
	 * very signal you're trying to read (meter floods, value-listener
	 * bursts, slider streams).
	 *
	 * The first hit on a fresh key emits immediately at the chosen
	 * level; subsequent hits in the same window are counted but not
	 * emitted, then flushed at window close as a single line bearing
	 * the latest message + context.
	 */
	rate(key: string, level: LogLevel, message: string, context?: Record<string, any>): void {
		if (!this.shouldLog(level)) return;
		// SSR mode: no event loop to drive a flush timer; bucketing would
		// just leak. Emit immediately and never count repeats.
		if (typeof window === 'undefined') {
			this.emitAtLevel(level, message, context);
			return;
		}
		const now = Date.now();
		const existing = this.rateBuckets.get(key);
		if (!existing) {
			this.rateBuckets.set(key, {
				level,
				message,
				context,
				count: 1,
				firstTs: now
			});
			this.emitAtLevel(level, message, context);
			this.ensureRateFlush();
			return;
		}
		existing.count += 1;
		existing.message = message;
		existing.context = context;
	}

	private emitAtLevel(level: LogLevel, message: string, context?: Record<string, any>): void {
		switch (level) {
			case LogLevel.DEBUG:
				console.debug(this.formatMessage('DEBUG', message, context));
				return;
			case LogLevel.INFO:
				console.info(this.formatMessage('INFO', message, context));
				return;
			case LogLevel.WARN:
				console.warn(this.formatMessage('WARN', message, context));
				return;
			case LogLevel.ERROR:
				console.error(this.formatMessage('ERROR', message, context));
				return;
		}
	}

	private ensureRateFlush(): void {
		if (this.rateFlushTimer || typeof window === 'undefined') return;
		this.rateFlushTimer = setInterval(() => this.flushRateBuckets(), RATE_WINDOW_MS);
	}

	private flushRateBuckets(): void {
		const now = Date.now();
		for (const [key, bucket] of this.rateBuckets) {
			if (now - bucket.firstTs < RATE_WINDOW_MS) continue;
			if (bucket.count > 1) {
				const summary = `${bucket.message} ×${bucket.count} in last ${now - bucket.firstTs}ms`;
				this.emitAtLevel(bucket.level, summary, bucket.context);
			}
			this.rateBuckets.delete(key);
		}
		if (this.rateBuckets.size === 0 && this.rateFlushTimer) {
			clearInterval(this.rateFlushTimer);
			this.rateFlushTimer = null;
		}
	}
}

// Export singleton instance
export const logger = new Logger();
