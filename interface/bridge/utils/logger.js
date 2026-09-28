/**
 * Centralized logging utility for Node.js OSC bridge
 *
 * Usage:
 * ```javascript
 * const { logger } = require('./utils/logger');
 *
 * logger.debug('WebSocket message received', { type: 'subscribe' });
 * logger.info('Bridge started', { port: 8081 });
 * logger.warn('Connection issue', { attempts: 3 });
 * logger.error('Failed to send OSC message', { error, address });
 * ```
 */

const fs = require('fs');
const path = require('path');

/** @type {{ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 } & Record<string, number>} */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

// Append-mode file sink for WARN/ERROR so bridge crashes/restarts survive
// past the terminal buffer. Repo-root `logs/` is already gitignored.
// __dirname = interface/bridge/utils → three parents up is the repo root.
const LOG_DIR = path.resolve(__dirname, '..', '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bridge.log');

// Rotation policy: cap the active log at MAX_LOG_BYTES; on overrun,
// rename to `bridge.log.<ts>.bak` and reopen fresh. Keep at most
// MAX_BACKUPS rotated files (delete oldest). Without this we've
// observed a single wedged session generate a 17 GB log file
// (uncaughtException loop on a closed stdout pipe) — the disk thrash
// pinned the whole machine.
const MAX_LOG_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_BACKUPS = 3;
const ROTATE_CHECK_EVERY_BYTES = 256 * 1024; // re-check size every ~256 KB written

// Use synchronous file ops (open + appendFileSync) rather than a buffered
// WriteStream. WARN/ERROR-rate writes are far below the rate where the
// blocking matters, and synchronous rotation is trivially correct: a
// `WriteStream.end()` followed by `renameSync` races kernel buffer
// flushes and silently loses writes (verified empirically).
let logFileReady = false;
let bytesSinceRotateCheck = 0;
let bytesWrittenThisFile = 0;
let isRotating = false;

function ensureLogReady() {
  if (logFileReady) return true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Seed our counter with the existing on-disk size so an existing
    // large log triggers rotation on the next write rather than riding
    // over the cap until 50 MB more accumulates.
    try {
      bytesWrittenThisFile = fs.statSync(LOG_FILE).size;
    } catch {
      bytesWrittenThisFile = 0;
    }
    logFileReady = true;
    return true;
  } catch {
    return false;
  }
}

function rotateIfTooLarge() {
  if (isRotating || !logFileReady) return;
  if (bytesWrittenThisFile < MAX_LOG_BYTES) return;
  isRotating = true;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(LOG_DIR, `bridge.log.${ts}.bak`);
    try { fs.renameSync(LOG_FILE, backup); } catch {}
    bytesWrittenThisFile = 0;
    pruneOldBackups();
  } finally {
    isRotating = false;
  }
}

function pruneOldBackups() {
  let entries;
  try {
    entries = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('bridge.log.') && f.endsWith('.bak'))
      .map(f => ({ f, full: path.join(LOG_DIR, f) }))
      .map(e => ({ ...e, mtime: fs.statSync(e.full).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // newest first
  } catch {
    return;
  }
  for (const e of entries.slice(MAX_BACKUPS)) {
    try { fs.unlinkSync(e.full); } catch {}
  }
}

ensureLogReady();

const RATE_WINDOW_MS = 1000;

class Logger {
  constructor() {
    // Default to WARN for cleaner output in both development and production
    // Use LOG_LEVEL=DEBUG env var for verbose logging

    // Check for LOG_LEVEL environment variable override
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && envLevel in LogLevel) {
      this.currentLevel = LogLevel[envLevel];
    } else {
      this.currentLevel = LogLevel.WARN;
    }
    /** @type {Map<string, {level: number, message: string, context?: Record<string, unknown>, count: number, firstTs: number}>} */
    this._rateBuckets = new Map();
    /** @type {NodeJS.Timeout | null} */
    this._rateFlushTimer = null;
  }

  /** @param {string} line */
  writeToFile(line) {
    if (!ensureLogReady()) return;
    const payload = line + '\n';
    try {
      fs.appendFileSync(LOG_FILE, payload);
    } catch {
      // Disk full / permission issue / dir vanished — best-effort.
      logFileReady = false;
      return;
    }
    const bytes = payload.length;
    bytesWrittenThisFile += bytes;
    bytesSinceRotateCheck += bytes;
    // Amortized rotation check: re-evaluate every ~256 KB written.
    // Cheap because rotation itself is rare (only when we cross 50 MB).
    if (bytesSinceRotateCheck >= ROTATE_CHECK_EVERY_BYTES) {
      bytesSinceRotateCheck = 0;
      rotateIfTooLarge();
    }
  }

  /**
   * Set the current log level programmatically
   * @param {number} level - The new log level to use
   */
  setLevel(level) {
    this.currentLevel = level;
  }

  /**
   * Get the current log level
   * @returns {number} The current log level
   */
  getLevel() {
    return this.currentLevel;
  }

  /** @param {number} level */
  shouldLog(level) {
    return level >= this.currentLevel;
  }

  /**
   * Serialize context object, properly handling Error instances
   * Error objects don't serialize with JSON.stringify (stack, message are lost)
   * @param {Record<string, unknown> | undefined} context - Context object that may contain Error instances
   * @returns {Record<string, unknown> | undefined} Context with Error instances converted to plain objects
   */
  serializeContext(context) {
    if (!context) return context;

    /** @type {Record<string, unknown>} */
    const serialized = {};
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

  /**
   * @param {string} level
   * @param {string} message
   * @param {Record<string, unknown>} [context]
   */
  formatMessage(level, message, context) {
    const timestamp = new Date().toISOString();
    const serializedContext = this.serializeContext(context);
    const contextStr = serializedContext ? ` ${JSON.stringify(serializedContext)}` : '';
    return `[${timestamp}] [${level}] ${message}${contextStr}`;
  }

  /**
   * Log debug information (only in development or when explicitly enabled)
   * @param {string} message - The message to log
   * @param {Record<string, unknown>} [context] - Optional context object with additional data
   */
  debug(message, context) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage('DEBUG', message, context));
    }
  }

  /**
   * Log informational messages
   * @param {string} message - The message to log
   * @param {Record<string, unknown>} [context] - Optional context object with additional data
   */
  info(message, context) {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage('INFO', message, context));
    }
  }

  /**
   * Log warning messages
   * @param {string} message - The message to log
   * @param {Record<string, unknown>} [context] - Optional context object with additional data
   */
  warn(message, context) {
    if (this.shouldLog(LogLevel.WARN)) {
      const line = this.formatMessage('WARN', message, context);
      console.warn(line);
      this.writeToFile(line);
    }
  }

  /**
   * Log error messages
   * @param {string} message - The message to log
   * @param {Record<string, unknown>} [context] - Optional context object with additional data
   */
  error(message, context) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const line = this.formatMessage('ERROR', message, context);
      console.error(line);
      this.writeToFile(line);
    }
  }

  /**
   * Coalesced log. Identical-key messages within a 1s window are
   * folded into a single "<msg> ×N" emit. Use this on high-rate paths
   * (per-meter inbound, per-broadcast fan-out) where unconditional
   * DEBUG would drown out anything useful.
   *
   * @param {string} key - Coalesce key (typically `${level}:${address}` or similar)
   * @param {number} level - LogLevel value
   * @param {string} message - The message to log
   * @param {Record<string, unknown>} [context] - Optional context
   */
  rate(key, level, message, context) {
    if (!this.shouldLog(level)) return;
    const now = Date.now();
    const existing = this._rateBuckets.get(key);
    if (!existing) {
      this._rateBuckets.set(key, {
        level,
        message,
        context,
        count: 1,
        firstTs: now
      });
      this._emitAtLevel(level, message, context);
      this._ensureRateFlush();
      return;
    }
    existing.count += 1;
    existing.message = message;
    existing.context = context;
  }

  /**
   * @param {number} level
   * @param {string} message
   * @param {Record<string, unknown>} [context]
   */
  _emitAtLevel(level, message, context) {
    if (level === LogLevel.DEBUG) {
      if (this.shouldLog(LogLevel.DEBUG)) console.debug(this.formatMessage('DEBUG', message, context));
    } else if (level === LogLevel.INFO) {
      if (this.shouldLog(LogLevel.INFO)) console.info(this.formatMessage('INFO', message, context));
    } else if (level === LogLevel.WARN) {
      if (this.shouldLog(LogLevel.WARN)) {
        const line = this.formatMessage('WARN', message, context);
        console.warn(line);
        this.writeToFile(line);
      }
    } else if (level === LogLevel.ERROR) {
      if (this.shouldLog(LogLevel.ERROR)) {
        const line = this.formatMessage('ERROR', message, context);
        console.error(line);
        this.writeToFile(line);
      }
    }
  }

  _ensureRateFlush() {
    if (this._rateFlushTimer) return;
    this._rateFlushTimer = setInterval(() => this._flushRateBuckets(), RATE_WINDOW_MS);
    if (this._rateFlushTimer.unref) this._rateFlushTimer.unref();
  }

  _flushRateBuckets() {
    const now = Date.now();
    for (const [key, bucket] of this._rateBuckets) {
      if (now - bucket.firstTs < RATE_WINDOW_MS) continue;
      if (bucket.count > 1) {
        const summary = `${bucket.message} ×${bucket.count} in last ${now - bucket.firstTs}ms`;
        this._emitAtLevel(bucket.level, summary, bucket.context);
      }
      this._rateBuckets.delete(key);
    }
    if (this._rateBuckets.size === 0 && this._rateFlushTimer) {
      clearInterval(this._rateFlushTimer);
      this._rateFlushTimer = null;
    }
  }
}

// Export singleton instance
const logger = new Logger();

module.exports = { logger, LogLevel };
