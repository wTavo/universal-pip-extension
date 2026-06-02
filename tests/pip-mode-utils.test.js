const assert = require('assert');
const {
    normalizePipWindowMode,
    shouldRestartForModeChange
} = require('../utils/pip-mode-utils.js');

assert.strictEqual(normalizePipWindowMode('document'), 'document');
assert.strictEqual(normalizePipWindowMode('native'), 'native');
assert.strictEqual(normalizePipWindowMode('bad-value'), 'native');
assert.strictEqual(normalizePipWindowMode(undefined), 'native');

assert.strictEqual(shouldRestartForModeChange({
    active: true,
    platform: 'youtube',
    tabId: 7,
    currentMode: 'native',
    nextMode: 'document'
}), true);

assert.strictEqual(shouldRestartForModeChange({
    active: true,
    platform: 'tiktok',
    tabId: 7,
    currentMode: 'native',
    nextMode: 'document'
}), false);

assert.strictEqual(shouldRestartForModeChange({
    active: true,
    platform: 'youtube',
    tabId: 7,
    currentMode: 'document',
    nextMode: 'document'
}), false);

assert.strictEqual(shouldRestartForModeChange({
    active: false,
    platform: 'youtube',
    tabId: 7,
    currentMode: 'native',
    nextMode: 'document'
}), false);
