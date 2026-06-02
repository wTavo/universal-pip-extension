(function () {
    'use strict';

    function normalizePipWindowMode(mode) {
        return mode === 'document' ? 'document' : 'native';
    }

    function shouldRestartForModeChange({ active, platform, tabId, currentMode, nextMode } = {}) {
        return Boolean(
            active &&
            tabId &&
            platform === 'youtube' &&
            normalizePipWindowMode(currentMode) !== normalizePipWindowMode(nextMode)
        );
    }

    const api = {
        normalizePipWindowMode,
        shouldRestartForModeChange
    };

    const globalObj = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
    globalObj.PiPModeUtils = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
