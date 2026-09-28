import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogLevel } from '$lib/utils/logger';

// We need to test the Logger class behavior, but the module exports a singleton.
// To test properly, we'll reimport after manipulating localStorage.

describe('Logger', () => {
	let consoleSpy: {
		debug: ReturnType<typeof vi.spyOn>;
		info: ReturnType<typeof vi.spyOn>;
		warn: ReturnType<typeof vi.spyOn>;
		error: ReturnType<typeof vi.spyOn>;
	};

	beforeEach(() => {
		// Spy on console methods
		consoleSpy = {
			debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
			info: vi.spyOn(console, 'info').mockImplementation(() => {}),
			warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
			error: vi.spyOn(console, 'error').mockImplementation(() => {})
		};

		// Clear localStorage
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('LogLevel enum', () => {
		it('should have correct numeric values', () => {
			expect(LogLevel.DEBUG).toBe(0);
			expect(LogLevel.INFO).toBe(1);
			expect(LogLevel.WARN).toBe(2);
			expect(LogLevel.ERROR).toBe(3);
			expect(LogLevel.NONE).toBe(4);
		});

		it('should have increasing severity', () => {
			expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
			expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
			expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
			expect(LogLevel.ERROR).toBeLessThan(LogLevel.NONE);
		});
	});

	describe('log level filtering', () => {
		it('should filter debug messages when level is WARN', async () => {
			// Fresh import to get singleton with default WARN level
			const { logger } = await import('$lib/utils/logger');

			logger.debug('debug message');
			logger.info('info message');
			logger.warn('warn message');
			logger.error('error message');

			expect(consoleSpy.debug).not.toHaveBeenCalled();
			expect(consoleSpy.info).not.toHaveBeenCalled();
			expect(consoleSpy.warn).toHaveBeenCalled();
			expect(consoleSpy.error).toHaveBeenCalled();
		});

		it('should allow all levels when set to DEBUG', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');

			logger.setLevel(LogLevel.DEBUG);

			logger.debug('debug message');
			logger.info('info message');
			logger.warn('warn message');
			logger.error('error message');

			expect(consoleSpy.debug).toHaveBeenCalled();
			expect(consoleSpy.info).toHaveBeenCalled();
			expect(consoleSpy.warn).toHaveBeenCalled();
			expect(consoleSpy.error).toHaveBeenCalled();
		});

		it('should block all logs when level is NONE', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');

			logger.setLevel(LogLevel.NONE);

			logger.debug('debug message');
			logger.info('info message');
			logger.warn('warn message');
			logger.error('error message');

			expect(consoleSpy.debug).not.toHaveBeenCalled();
			expect(consoleSpy.info).not.toHaveBeenCalled();
			expect(consoleSpy.warn).not.toHaveBeenCalled();
			expect(consoleSpy.error).not.toHaveBeenCalled();
		});

		it('should only allow ERROR when level is ERROR', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');

			logger.setLevel(LogLevel.ERROR);

			logger.debug('debug message');
			logger.info('info message');
			logger.warn('warn message');
			logger.error('error message');

			expect(consoleSpy.debug).not.toHaveBeenCalled();
			expect(consoleSpy.info).not.toHaveBeenCalled();
			expect(consoleSpy.warn).not.toHaveBeenCalled();
			expect(consoleSpy.error).toHaveBeenCalled();
		});
	});

	describe('setLevel and getLevel', () => {
		it('should update the current level', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');

			logger.setLevel(LogLevel.DEBUG);
			expect(logger.getLevel()).toBe(LogLevel.DEBUG);

			logger.setLevel(LogLevel.ERROR);
			expect(logger.getLevel()).toBe(LogLevel.ERROR);
		});

		it('should persist level to localStorage', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');

			logger.setLevel(LogLevel.DEBUG);
			expect(localStorage.getItem('LOG_LEVEL')).toBe('DEBUG');

			logger.setLevel(LogLevel.ERROR);
			expect(localStorage.getItem('LOG_LEVEL')).toBe('ERROR');
		});
	});

	describe('message formatting', () => {
		it('should include timestamp in log messages', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');
			logger.setLevel(LogLevel.WARN);

			logger.warn('test message');

			expect(consoleSpy.warn).toHaveBeenCalled();
			const loggedMessage = consoleSpy.warn.mock.calls[0][0];
			// Should contain ISO timestamp pattern
			expect(loggedMessage).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		});

		it('should include log level in messages', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');
			logger.setLevel(LogLevel.DEBUG);

			logger.debug('debug msg');
			logger.info('info msg');
			logger.warn('warn msg');
			logger.error('error msg');

			expect(consoleSpy.debug.mock.calls[0][0]).toContain('[DEBUG]');
			expect(consoleSpy.info.mock.calls[0][0]).toContain('[INFO]');
			expect(consoleSpy.warn.mock.calls[0][0]).toContain('[WARN]');
			expect(consoleSpy.error.mock.calls[0][0]).toContain('[ERROR]');
		});

		it('should include message text', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');
			logger.setLevel(LogLevel.WARN);

			logger.warn('my specific message');

			expect(consoleSpy.warn.mock.calls[0][0]).toContain('my specific message');
		});

		it('should include context as JSON', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');
			logger.setLevel(LogLevel.WARN);

			logger.warn('test', { component: 'TestComponent', value: 42 });

			const loggedMessage = consoleSpy.warn.mock.calls[0][0];
			expect(loggedMessage).toContain('"component":"TestComponent"');
			expect(loggedMessage).toContain('"value":42');
		});

		it('should handle missing context', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');
			logger.setLevel(LogLevel.WARN);

			logger.warn('message without context');

			expect(consoleSpy.warn).toHaveBeenCalled();
			// Should not throw
		});
	});

	describe('Error serialization', () => {
		it('should serialize Error objects in context', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');
			logger.setLevel(LogLevel.ERROR);

			const error = new Error('Something went wrong');
			logger.error('Operation failed', { error });

			const loggedMessage = consoleSpy.error.mock.calls[0][0];
			expect(loggedMessage).toContain('"name":"Error"');
			expect(loggedMessage).toContain('"message":"Something went wrong"');
			expect(loggedMessage).toContain('"stack"');
		});

		it('should handle TypeError in context', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');
			logger.setLevel(LogLevel.ERROR);

			const error = new TypeError('Invalid type');
			logger.error('Type error occurred', { error });

			const loggedMessage = consoleSpy.error.mock.calls[0][0];
			expect(loggedMessage).toContain('"name":"TypeError"');
			expect(loggedMessage).toContain('"message":"Invalid type"');
		});

		it('should handle mixed context with errors and regular values', async () => {
			const { logger, LogLevel } = await import('$lib/utils/logger');
			logger.setLevel(LogLevel.ERROR);

			const error = new Error('Failed');
			logger.error('Mixed context', {
				error,
				userId: 123,
				action: 'save'
			});

			const loggedMessage = consoleSpy.error.mock.calls[0][0];
			expect(loggedMessage).toContain('"error"');
			expect(loggedMessage).toContain('"userId":123');
			expect(loggedMessage).toContain('"action":"save"');
		});
	});
});
