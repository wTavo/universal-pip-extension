// utils/logger.js
// Centralized Logging Utility for Universal PiP — Production-Grade

(function () {
    'use strict';

    const globalObj = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
    if (globalObj.PiPLogger) return;

    // ── Log Levels ──────────────────────────────────────────────
    const LEVELS = Object.freeze({
        NONE: 0,
        ERROR: 1,
        WARN: 2,
        INFO: 3,
        DEBUG: 4,
        TRACE: 5
    });

    // ── Console Styles (per level) ──────────────────────────────
    const STYLE_PREFIX = 'color:#a78bfa;font-weight:bold';
    const STYLE_MODULE = 'color:#60a5fa;font-weight:bold';
    const STYLE_RESET = 'color:inherit;font-weight:normal';

    // ── Console method mapping ──────────────────────────────────
    const CONSOLE_METHOD = Object.freeze({
        ERROR: 'error',
        WARN: 'warn',
        INFO: 'log',
        DEBUG: 'debug',
        TRACE: 'debug'
    });

    // ── Buffer Config ───────────────────────────────────────────
    const MAX_STORED_ENTRIES = 200;   // Max error/warn entries persisted
    const CONTEXT_RING_SIZE = 10;     // Recent INFO messages kept as antecedents
    const FLUSH_INTERVAL_MS = 5000;

    class Logger {
        constructor() {
            /** @type {number} Console output level (debug mode) */
            this._level = LEVELS.NONE;
            /** @type {Array} Context ring — last N INFO+ messages */
            this._contextRing = [];
            /** @type {Array} Pending error/warn entries to flush */
            this._pendingFlush = [];
            /** @type {number|null} */
            this._flushTimer = null;
            /** @type {boolean} */
            this._storageAvailable = false;
            /** @type {string} Hostname where this logger instance runs */
            this._host = (typeof location !== 'undefined' && location.hostname)
                ? location.hostname : 'service_worker';

            this._detectStorage();
            this._loadConfig();
            this._startFlushTimer(); // Always on — errors can happen anytime
        }

        // ── Environment Detection ───────────────────────────────
        _detectStorage() {
            try {
                this._storageAvailable = !!(
                    typeof chrome !== 'undefined' &&
                    chrome.storage &&
                    chrome.storage.local
                );
            } catch (e) {
                this._storageAvailable = false;
            }
        }

        // ── Config Loading (async, non-blocking) ────────────────
        async _loadConfig() {
            if (!this._storageAvailable) return;

            try {
                const data = await chrome.storage.local.get('logLevel');
                if (data.logLevel && LEVELS[data.logLevel] !== undefined) {
                    this._level = LEVELS[data.logLevel];
                }

                // Listen for real-time level changes (debug mode toggle)
                chrome.storage.onChanged.addListener((changes, area) => {
                    if (area !== 'local' || !changes.logLevel) return;
                    const newStr = changes.logLevel.newValue;
                    if (newStr && LEVELS[newStr] !== undefined) {
                        this._level = LEVELS[newStr];
                    }
                });
            } catch (e) {
                // Extension context may be invalidated — fail silently
            }
        }

        // ── Flush Timer Management ──────────────────────────────
        _startFlushTimer() {
            if (this._flushTimer) return;
            this._flushTimer = setInterval(() => this._flushToStorage(), FLUSH_INTERVAL_MS);
        }

        _flushToStorage() {
            if (!this._storageAvailable || this._pendingFlush.length === 0) return;

            const snapshot = this._pendingFlush.slice();
            this._pendingFlush.length = 0;

            try {
                chrome.storage.local.get('errorLogs', (result) => {
                    try {
                        let stored = Array.isArray(result?.errorLogs) ? result.errorLogs : [];
                        stored = stored.concat(snapshot);

                        // Cap total stored entries
                        if (stored.length > MAX_STORED_ENTRIES) {
                            stored = stored.slice(stored.length - MAX_STORED_ENTRIES);
                        }

                        chrome.storage.local.set({ errorLogs: stored });
                    } catch (e) { /* ignore */ }
                });
            } catch (e) { /* ignore */ }
        }

        // ── Serialize args to string ────────────────────────────
        _serialize(args) {
            return args.map(a => {
                if (a instanceof Error) return a.message;
                if (typeof a === 'string') return a;
                return '(object)';
            }).join(' ');
        }

        // ── Record to context ring (INFO and above) ─────────────
        _pushContext(levelStr, module, args) {
            this._contextRing.push({
                t: new Date().toISOString(),
                l: levelStr,
                m: module || 'Core',
                h: this._host,
                msg: this._serialize(args)
            });
            if (this._contextRing.length > CONTEXT_RING_SIZE) {
                this._contextRing.shift();
            }
        }

        // ── Record WARN/ERROR with preceding context ────────────
        _recordError(levelStr, module, args) {
            const entry = {
                t: new Date().toISOString(),
                l: levelStr,
                m: module || 'Core',
                h: this._host,
                msg: this._serialize(args),
                ctx: this._contextRing.slice() // Snapshot of recent context
            };
            this._pendingFlush.push(entry);
            // Clear context after attaching to avoid duplicate context
            this._contextRing.length = 0;
        }

        // ── Core Log Method ─────────────────────────────────────
        _log(levelStr, module, args) {
            const numLevel = LEVELS[levelStr];

            // ── Console Output ──────────────────────────────────
            // WARN/ERROR always print; INFO+ only when debug level allows
            if (numLevel <= LEVELS.WARN || numLevel <= this._level) {
                const method = CONSOLE_METHOD[levelStr];
                const moduleTag = module ? `[${module}]` : '';
                console[method](
                    `%c[Universal PiP]%c${moduleTag}%c`,
                    STYLE_PREFIX,
                    STYLE_MODULE,
                    STYLE_RESET,
                    ...args
                );
            }

            // ── Always-on buffering ─────────────────────────────
            if (numLevel <= LEVELS.WARN) {
                // WARN/ERROR → record with context and flush to storage
                this._recordError(levelStr, module, args);
            } else if (numLevel <= LEVELS.INFO) {
                // INFO → context ring (antecedents for future errors)
                this._pushContext(levelStr, module, args);
            }
        }

        // ── Public API ──────────────────────────────────────────

        // error/warn/info always call _log (console is gated inside, buffering always on)
        error(...args) { this._log('ERROR', '', args); }
        warn(...args) { this._log('WARN', '', args); }
        info(...args) { this._log('INFO', '', args); }
        // debug/trace only run if console level allows (no buffering needed)
        debug(...args) { if (this._level >= LEVELS.DEBUG) this._log('DEBUG', '', args); }
        trace(...args) { if (this._level >= LEVELS.TRACE) this._log('TRACE', '', args); }

        /**
         * Creates a child logger scoped to a module name.
         * Usage: const log = PiPLogger.create('Background');
         */
        create(moduleName) {
            const parent = this;
            return Object.freeze({
                error(...args) { parent._log('ERROR', moduleName, args); },
                warn(...args) { parent._log('WARN', moduleName, args); },
                info(...args) { parent._log('INFO', moduleName, args); },
                debug(...args) { if (parent._level >= LEVELS.DEBUG) parent._log('DEBUG', moduleName, args); },
                trace(...args) { if (parent._level >= LEVELS.TRACE) parent._log('TRACE', moduleName, args); },
                isDebugEnabled() { return parent._level >= LEVELS.DEBUG; }
            });
        }

        /**
         * Programmatic level change (debug mode toggle). Persists preference.
         * @param {string} levelStr - 'NONE'|'ERROR'|'WARN'|'INFO'|'DEBUG'|'TRACE'
         */
        setLevel(levelStr) {
            if (LEVELS[levelStr] === undefined) return;
            this._level = LEVELS[levelStr];

            if (this._storageAvailable) {
                try {
                    chrome.storage.local.set({ logLevel: levelStr });
                } catch (e) { /* ignore */ }
            }
        }

        /** Current level name */
        getLevel() {
            for (const [name, val] of Object.entries(LEVELS)) {
                if (val === this._level) return name;
            }
            return 'NONE';
        }

        /** @returns {boolean} */
        isDebugEnabled() {
            return this._level >= LEVELS.DEBUG;
        }

        /**
         * Returns formatted report data for diagnostic export.
         * Only WARN/ERROR entries with their preceding context.
         * @returns {Promise<string>}
         */
        async getReportData() {
            let storedLogs = [];

            if (this._storageAvailable) {
                try {
                    const result = await chrome.storage.local.get('errorLogs');
                    if (Array.isArray(result?.errorLogs)) {
                        storedLogs = result.errorLogs;
                    }
                } catch (e) { /* ignore */ }
            }

            const allLogs = storedLogs.concat(this._pendingFlush);

            if (allLogs.length === 0) {
                return '(No warnings or errors have been recorded)';
            }

            // Format each entry with its context antecedents
            return allLogs.map(entry => {
                const lines = [];
                const host = entry.h ? `@${entry.h}` : '';
                if (entry.ctx && entry.ctx.length > 0) {
                    entry.ctx.forEach(c => {
                        const ch = c.h ? `@${c.h}` : '';
                        lines.push(`  ├ [${c.t}] [${c.l}] [${c.m}${ch}] ${c.msg}`);
                    });
                }
                lines.push(`  ▸ [${entry.t}] [${entry.l}] [${entry.m}${host}] ${entry.msg}`);
                return lines.join('\n');
            }).join('\n\n');
        }

        /**
         * Returns storage usage in bytes for error logs.
         * @returns {Promise<number>}
         */
        async getStorageSize() {
            if (!this._storageAvailable) return 0;
            try {
                const result = await chrome.storage.local.get('errorLogs');
                if (result?.errorLogs) {
                    return new Blob([JSON.stringify(result.errorLogs)]).size;
                }
            } catch (e) { /* ignore */ }
            return 0;
        }

        /**
         * Clears all stored error logs (storage + buffers).
         */
        async clearLogs() {
            this._pendingFlush.length = 0;
            this._contextRing.length = 0;
            if (this._storageAvailable) {
                try {
                    await chrome.storage.local.remove('errorLogs');
                } catch (e) { /* ignore */ }
            }
        }
    }

    globalObj.PiPLogger = new Logger();
})();
