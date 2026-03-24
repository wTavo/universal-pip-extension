// Service Worker para manejar el estado global del PiP

// Single source of truth for default state shape
const DEFAULT_PIP_STATE = Object.freeze({
    active: false,
    tabId: null,
    volume: 100,
    muted: false,
    liked: false,
    favorited: false,
    uiVisible: true,
    navExpanded: true,
    isSelectorMode: false,
    isShorts: false,
    platform: null,
    playing: false,
    isLive: false,
    isTikTokLive: false,
    hasFavorite: true,
    originDomain: null,
    isExtensionTriggered: false,
    domainExceptions: {}
});

// Centralized Message Types
const MSG = {
    // UI Visibility
    GET_UI_STATE: 'GET_UI_STATE',
    EXECUTE_COMMAND: 'EXECUTE_COMMAND',
    HIDE_EXTENSION_UI: 'HIDE_EXTENSION_UI',
    SHOW_EXTENSION_UI: 'SHOW_EXTENSION_UI',
    SYNC_SESSION_VISIBILITY: 'SYNC_SESSION_VISIBILITY',
    GET_UI_VISIBILITY: 'GET_UI_VISIBILITY',
    
    // PiP Lifecycle
    PIP_ACTIVATED: 'PIP_ACTIVATED',
    PIP_DEACTIVATED: 'PIP_DEACTIVATED',
    PIP_SESSION_STARTED: 'PIP_SESSION_STARTED',
    VALIDATE_PIP_STATUS: 'VALIDATE_PIP_STATUS',
    SIGNAL_NAVIGATION: 'SIGNAL_NAVIGATION',
    REQUEST_EARLY_PANEL: 'REQUEST_EARLY_PANEL',
    REQUEST_PIP_STATE: 'REQUEST_PIP_STATE',
    GET_PIP_STATE: 'GET_PIP_STATE',
    CHECK_PIP_STATUS: 'CHECK_PIP_STATUS',
    EXIT_PIP: 'EXIT_PIP',
    VISIBILITY_PING: 'VISIBILITY_PING',
    PANEL_PING: 'PANEL_PING',
    
    // Controls
    TOGGLE_PLAY: 'TOGGLE_PLAY',
    TOGGLE_MUTE: 'TOGGLE_MUTE',
    TOGGLE_MUTE_VIDEO: 'TOGGLE_MUTE_VIDEO',
    TOGGLE_LIKE: 'TOGGLE_LIKE',
    TOGGLE_FAVORITE: 'TOGGLE_FAVORITE',
    SEEK_VIDEO: 'SEEK_VIDEO',
    NAVIGATE_VIDEO: 'NAVIGATE_VIDEO',
    SET_VOLUME: 'SET_VOLUME',
    SET_VOLUME_LIVE: 'SET_VOLUME_LIVE',
    CHANGE_VOLUME: 'CHANGE_VOLUME',
    PAUSE_VIDEO: 'PAUSE_VIDEO',
    FOCUS_PIP: 'FOCUS_PIP',

    // Relay-compatible aliases for content scripts
    LIKE_VIDEO: 'LIKE_VIDEO',
    FAVORITE_VIDEO: 'FAVORITE_VIDEO',
    
    // State Sync
    UPDATE_FAVORITE_STATE: 'UPDATE_FAVORITE_STATE',
    UPDATE_LIKE_STATE: 'UPDATE_LIKE_STATE',
    UPDATE_PLAYBACK_STATE: 'UPDATE_PLAYBACK_STATE',
    UPDATE_TIKTOK_LIVE_STATE: 'UPDATE_TIKTOK_LIVE_STATE',
    UPDATE_VOLUME_STATE: 'UPDATE_VOLUME_STATE',
    SET_NAV_EXPANDED: 'SET_NAV_EXPANDED',
    SYNC_NAV_EXPANDED: 'SYNC_NAV_EXPANDED',
    SYNC_VOLUME_UI: 'SYNC_VOLUME_UI',
    SYNC_LIKE_UI: 'SYNC_LIKE_UI',
    SYNC_FAVORITE_UI: 'SYNC_FAVORITE_UI',
    SYNC_PLAYBACK_UI: 'SYNC_PLAYBACK_UI',
    SYNC_TIKTOK_LIVE_UI: 'SYNC_TIKTOK_LIVE_UI',
    UPDATE_MUTE_STATE: 'UPDATE_MUTE_STATE',
    SYNC_PIP_STATE: 'SYNC_PIP_STATE',
    
    // Drag/Position
    SYNC_DRAG_POSITION: 'SYNC_DRAG_POSITION',
    GET_DRAG_POSITION: 'GET_DRAG_POSITION',
    
    // Misc
    PING: 'PING',
    START_SELECTION_MODE: 'START_SELECTION_MODE',
    STOP_SELECTION_MODE: 'STOP_SELECTION_MODE',
    ACTIVATE_SELECTION_MODE: 'ACTIVATE_SELECTION_MODE',
    STOP_SELECTION_MODE_GLOBAL: 'STOP_SELECTION_MODE_GLOBAL',
    HIDE_VOLUME_PANEL: 'HIDE_VOLUME_PANEL',
    SHOW_VOLUME_PANEL: 'SHOW_VOLUME_PANEL'
};

// Estado en memoria (caché)
let pipState = { ...DEFAULT_PIP_STATE };

// Write lock to serialize state updates and prevent race conditions
let _saveLock = Promise.resolve();

// ========================================
// Logging & Debugging Configuration
// ========================================

importScripts('utils/logger.js');
const log = PiPLogger.create('BG');

// Track last sent panel shows to prevent spam/redundancy
const lastPanelShow = new Map(); // tabId -> timestamp

// Suppresses bridge feedback loop during slider drag (prevents log spam)
let _volumeDragActive = false;

// Navigation grace period to prevent PiP cleanup during video swaps
let _navigationGraceTabId = null;
let _navigationGraceTimer = null;

function startNavigationGrace(tabId, durationMs = 3000) {
    if (!tabId) return;
    _navigationGraceTabId = tabId;
    if (_navigationGraceTimer) clearTimeout(_navigationGraceTimer);
    _navigationGraceTimer = setTimeout(() => {
        if (_navigationGraceTabId === tabId) {
            _navigationGraceTabId = null;
            _navigationGraceTimer = null;
        }
    }, durationMs);
    log.info(`Navigation grace period started for tab ${tabId} (${durationMs}ms)`);
}

// Track tabs where the control panel was shown to ensure surgical cleanup when PiP ends
const _activeSessionTabIds = new Set();

async function handleSyncDragPosition(message, sender, sendResponse) {
    if (message.pos) {
        await chrome.storage.local.set({ global_pip_btn_position: message.pos });
        sendResponse({ success: true });
    } else {
        sendResponse({ success: false });
    }
}

async function handleGetDragPosition(message, sender, sendResponse) {
    const res = await chrome.storage.local.get('global_pip_btn_position');
    sendResponse({ pos: res.global_pip_btn_position || null });
}

// Helper para guardar estado
async function savePipState(newState) {
    _saveLock = _saveLock.then(async () => {
        // Use in-memory cache as base (kept synced by chrome.storage.onChanged)
        const current = pipState || { ...DEFAULT_PIP_STATE };

        if (newState.domainExceptions) {
            newState.domainExceptions = sanitizeDomainExceptions(newState.domainExceptions);
        }
        
        const merged = { ...current, ...newState };
        
        // Deep-compare target fields to avoid redundant disk writes
        const domainEqual = isDomainExceptionsEqual(current.domainExceptions || {}, merged.domainExceptions || {});
        const hasChanges = !domainEqual || Object.keys(newState).some(k => {
            if (k === 'domainExceptions') return false;
            return current[k] !== merged[k];
        });

        if (!hasChanges) {
            return { changed: false, state: current };
        }

        await chrome.storage.local.set({ pipState: merged });
        pipState = merged; // Immediate cache update
        if (!pipState.domainExceptions) pipState.domainExceptions = {};
        log.info('State saved (Changes detected):', newState);
        return { changed: true, state: merged };
    }).catch(err => {
        log.error('savePipState error:', err && err.message);
        return { changed: false, state: pipState };
    });

    return _saveLock;
}

/**
 * High-level helper to update state and optionally broadcast to relevant tabs.
 * Reduces boilerplate across command handlers.
 *
 * @param {object} delta - The partial state object to merge into pipState.
 * @param {object|function|null} syncMsg - Message to send to relevant tabs, or a function that returns a message.
 * @param {string|null} relayType - Optional message type to relay back to the PiP origin tab (pipState.tabId).
 * @param {object|null} relayPayload - Optional payload to include with the relay message.
 */
async function updateAndSync(delta, syncMsg = null, relayType = null, relayPayload = {}) {
    const result = await savePipState(delta);
    if (result.changed) {
        // 1. Send relay message to the PiP origin tab if specified
        if (relayType && pipState.tabId) {
            await safeSendMessage(pipState.tabId, { type: relayType, ...relayPayload });
        }
        // 2. Broadcast sync message to other relevant tabs
        if (syncMsg) {
            await syncToRelevantTabs(syncMsg);
        }
    }
    return result;
}

// Helper para recuperar y VALIDAR estado
async function getPipState() {
    const data = await chrome.storage.local.get('pipState');
    let storedState = data.pipState || { ...DEFAULT_PIP_STATE };

    // Si dice que está activo, verificar que la pestaña aun exista
    if (storedState.active && storedState.tabId) {
        try {
            await chrome.tabs.get(storedState.tabId);
        } catch (e) {
            log.info('Stale state detected (tab closed). Resetting.');
            storedState = { ...DEFAULT_PIP_STATE };
            await chrome.storage.local.set({ pipState: storedState });
        }
    }

    pipState = storedState;
    if (!pipState.domainExceptions) pipState.domainExceptions = {};
    return storedState;
}

// Inicializar
log.info('Service worker initialized. Loading state...');
getPipState().then(state => {
    log.info('State loaded:', state);
});

// Listen for external storage changes to keep in-memory state synchronized
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.pipState && changes.pipState.newValue) {
        const newState = changes.pipState.newValue;

        if (typeof newState !== 'object' || newState === null) {
            log.warn('Ignoring invalid pipState from storage:', newState);
            return;
        }

        // Merge with defaults to ensure shape consistency
        pipState = { ...DEFAULT_PIP_STATE, ...newState };

        // Deep sanitize specific complex fields if necessary
        if (typeof pipState.domainExceptions !== 'object' || pipState.domainExceptions === null) {
            pipState.domainExceptions = {};
        } else {
            pipState.domainExceptions = sanitizeDomainExceptions(pipState.domainExceptions);
        }

        log.info('pipState updated and validated from storage:', pipState);
    }
});

// Helper function to normalize domains (extract base domain for consistent subdomain handling)
function getBaseDomain(hostname) {
    if (!hostname) return null;
    const parts = hostname.split('.');

    // Common multi-part TLDs that require taking 3 parts instead of 2
    const multiPartTlds = [
        'co.uk', 'co.jp', 'co.kr', 'com.au', 'com.br', 'com.mx', 'com.tr', 'com.sg',
        'net.au', 'org.uk', 'ac.uk', 'edu.au', 'gov.uk', 'gov.au'
    ];

    if (parts.length >= 3) {
        const lastTwo = parts.slice(-2).join('.');
        if (multiPartTlds.includes(lastTwo)) {
            return parts.slice(-3).join('.');
        }
    }

    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
}

/**
 * Safely extracts the base domain from a tab object
 */
function getTabDomain(tab) {
    if (!tab || !tab.url) return null;
    try {
        return getBaseDomain(new URL(tab.url).hostname);
    } catch (e) {
        return null;
    }
}

function sanitizeDomainExceptions(obj = {}) {
    const out = {};
    for (const k of Object.keys(obj)) {
        try {
            const base = getBaseDomain(k);
            if (!base) continue;
            out[base] = !!obj[k];
        } catch (e) { continue; }
    }
    return out;
}

// Helper for efficient domainExceptions comparison (shallow equality)
function isDomainExceptionsEqual(a, b) {
    if (a === b) return true;
    a = a || {};
    b = b || {};
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    // ensure both sets of keys match and values are equal
    return keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
}

// Helper function to check if tab can receive PiP messages
function canReceivePipMessages(tab) {
    if (!tab || !tab.url) return false;
    const url = tab.url;
    // Exclude internal/system pages where we can't/shouldn't inject or communicate
    if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('chrome-extension://')) {
        return false;
    }
    return true; // Assume web pages are potential targets if content script is present
}

// ========================================
// Generic State Helpers
// ========================================

async function handleStateToggle(field, syncType, relayType, message, sender, sendResponse) {
    const newVal = message[field] !== undefined ? !!message[field] : !pipState[field];
    log.info(`Toggle ${field}:`, newVal);
    await updateAndSync(
        { [field]: newVal },
        { type: syncType, [field]: newVal },
        relayType,
        { [field]: newVal }
    );
    if (sendResponse) sendResponse({ success: true, [field]: newVal });
}

async function handleStateUpdate(field, syncType, message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        const val = message[field];
        await updateAndSync({ [field]: val }, { type: syncType, [field]: val });
    }
    if (sendResponse) sendResponse({ success: true });
}

async function validateTabPipStatus(tabId, url) {
    const isPrime = url.includes('primevideo.com');
    try {
        const response = await safeSendMessage(tabId, { type: MSG.VALIDATE_PIP_STATUS });
        if (!response) return false;
        if (response.error) return isPrime; // Lenient for Prime during reloads
        if (!response.isActive) return false;
        if (response.metadata) await savePipState(response.metadata);
        return true;
    } catch (e) {
        return isPrime;
    }
}

// ========================================
// Message Handler Functions
// ========================================

// Eliminated redundant handleGetUiState - callers can use handleRequestPipState

async function handleExecuteCommand(message, sender, sendResponse) {
    const command = message.command;
    const targetUrl = message.tabUrl || (sender.tab ? sender.tab.url : null);

    if (command === 'show_ui' || command === 'hide_ui') {
        await processVisibilityCommand(command, message.scope, targetUrl);
    } else if (command === 'focus_pip') {
        const state = await getPipState();
        if (state.active && state.tabId) {
            await safeSendMessage(state.tabId, { type: MSG.FOCUS_PIP });
        }
    } else if (command === 'close_pip') {
        await handleExitPip({}, null, null);
    }

    if (sendResponse) sendResponse({ success: true });
}

/**
 * Unified logic for showing/hiding UI (Global or Domain Exception)
 */
async function processVisibilityCommand(command, scope, targetUrl) {
    const isVisible = command === 'show_ui';
    const domain = getTabDomain({ url: targetUrl });

    if (scope === 'global') {
        await updateAndSync({ uiVisible: isVisible, domainExceptions: {} });
        log.info(`Global UI ${isVisible ? 'shown' : 'hidden'} (Exceptions cleared)`);
    } else if (domain) {
        const newExceptions = { ...pipState.domainExceptions };
        newExceptions[domain] = isVisible;
        await updateAndSync({ domainExceptions: newExceptions });
        log.info(`UI ${isVisible ? 'shown' : 'hidden'} for ${domain} (Exception added)`);
    }

    // Broadcast recalculated sync message to all tabs
    const updatedState = await getPipState();
    await syncToRelevantTabs((tab) => {
        const tabDomain = getTabDomain(tab);

        const isSessionVisible = calculateSessionVisibility(updatedState, tabDomain);
        return {
            type: MSG.SYNC_SESSION_VISIBILITY,
            visible: isSessionVisible,
            effectiveDomain: tabDomain,
            state: updatedState
        };
    });
}

function handleActivateSelectionMode(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
        safeSendMessage(tabId, {
            type: MSG.START_SELECTION_MODE
        });
    }
    return false;
}

function handleStopSelectionModeGlobal(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
        safeSendMessage(tabId, { type: MSG.STOP_SELECTION_MODE });
    }
    return false;
}

async function handleExitPip(message, sender, sendResponse) {
    if (pipState.active && pipState.tabId) {
        log.info('Executing exit PiP for tab:', pipState.tabId);
        
        // If exiting from a different tab, pause the video first as per user request
        if (sender && sender.tab && sender.tab.id !== pipState.tabId) {
            safeSendMessage(pipState.tabId, { type: 'PAUSE_VIDEO' });
        }
        await safeSendMessage(pipState.tabId, { type: MSG.EXIT_PIP });
    } else {
        log.warn('No target tab ID for EXIT_PIP');
    }
    
    if (sendResponse) sendResponse({ success: true });
}

// Injection failure tracking removed (Manifest v3 handles content script lifecycle automatically)

// Inyectar el script de control en una pestaña específica
// Inyectar el script de control en una pestaña específica (Simplificado para Manifest)
async function injectControlPanel(tabId, tabUrl) {
    try {
        if (!canReceivePipMessages({ url: tabUrl })) return false;

        // With Manifest injection, we just need to verify the script is alive
        // Also verify the panel is ready via PANEL_PING
        const [visRes, panelRes] = await Promise.all([
            safeSendMessage(tabId, { type: MSG.VISIBILITY_PING }),
            safeSendMessage(tabId, { type: MSG.PANEL_PING })
        ]);

        if (visRes?.alive && panelRes?.alive) {
            return true;
        }

        // Return true if at least the visibility listener is ready
        return !!(visRes && !visRes.error && visRes.alive);
    } catch (err) {
        return false;
    }
}

// ensureVisibilityListener REMOVED - Handled by manifest.json

// Proactive initialization NOT needed for content scripts in manifest.
// The browser handles it for us on load.
// Manifest v3 handles content script lifecycle automatically.
// The browser handles it for us on load.

chrome.runtime.onInstalled.addListener((details) => {
    log.info('Extension installed/updated:', details.reason);
});

// chrome.runtime.onStartup REMOVED - Manifest content scripts handle injection automatically.
// Only onInstalled is needed for updates/installs while browser is open.



// Helper to calculate visibility based on Origin Domain
function calculateSessionVisibility(state, domain) {
    if (domain && state.domainExceptions?.[domain] === true) return true;
    if (!state.uiVisible) return false;
    if (domain && state.domainExceptions?.[domain] === false) return false;
    return true;
}

async function showControlPanel(tabId, overrideVisibility = null) {
    const freshState = await getPipState();
    if (!freshState.active) return;

    // ONLY show the control panel if the PiP session was triggered by the extension.
    // Native PiP activations (browser menu, etc.) should remain "vanilla".
    if (!freshState.isExtensionTriggered) {
        log.info('Suppressing control panel: PiP session was NOT extension-triggered');
        return;
    }

    // Calculate visibility based on Origin rules if not provided
    let domain = null;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url) domain = getBaseDomain(new URL(tab.url).hostname);
    } catch (e) { }

    const isVisible = overrideVisibility !== null ? overrideVisibility : calculateSessionVisibility(freshState, domain);

    // Debounce: Don't send more than once every 500ms per tab
    const now = Date.now();
    const lastTime = lastPanelShow.get(tabId) || 0;
    if (now - lastTime < 500) {
        return;
    }

    lastPanelShow.set(tabId, now);
    _activeSessionTabIds.add(tabId); // Track tab for surgical cleanup
    safeSendMessage(tabId, {
        type: MSG.SHOW_VOLUME_PANEL,
        state: freshState,
        sessionVisible: isVisible // Pass calculated visibility
    });
}

/**
 * Unifies global cleanup when a PiP session ends (manual exit, native close, or tab removal).
 */
async function performPipGlobalCleanup() {
    log.info('Performing global PiP cleanup.');
    
    // 1. Broadcast HIDE to all tracked/relevant tabs
    await syncToRelevantTabs({ type: MSG.HIDE_VOLUME_PANEL });
    
    // 2. Reset global state
    await updateAndSync({ active: false, tabId: null });
    
    // 3. Clear session-specific tracking
    _activeSessionTabIds.clear();
}

// Helper to safely send message with Promise wrapper and error handling
function safeSendMessage(tabId, message, options = {}) {
    return new Promise((resolve) => {
        try {
            chrome.tabs.sendMessage(tabId, message, options, (response) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    const msg = lastError.message || '';
                    const isExpected = msg.includes('Receiving end does not exist') ||
                        msg.includes('The message port closed before a response was received');

                    if (isExpected) {
                        log.debug(`safeSendMessage expected failure (Tab: ${tabId}, Type: ${message.type}):`, msg);
                    } else {
                        if (log.isDebugEnabled()) {
                            log.warn(`safeSendMessage failed (Tab: ${tabId}, Type: ${message.type}):`, msg);
                        }
                    }

                    // Return checkable error object for development context
                    return resolve({ error: msg });
                }
                resolve(response);
            });
        } catch (e) {
            if (log.isDebugEnabled()) {
                log.warn(`safeSendMessage exception (Tab: ${tabId}):`, e.message);
            }
            resolve({ error: e.message });
        }
    });
}

// ========================================
// Broadcast Helper
// ========================================

async function syncToRelevantTabs(message, options = {}) {
    try {
        const excludeId = options.excludeTabId;
        const targetIds = new Set();

        // 1. Include all tabs that have shown the control panel during this session
        _activeSessionTabIds.forEach(id => {
            if (!excludeId || id !== excludeId) targetIds.add(id);
        });

        // 2. Safety: Include the active PiP origin tab
        if (pipState.tabId && (!excludeId || pipState.tabId !== excludeId)) {
            targetIds.add(pipState.tabId);
        }

        // 3. Add currently visible (active) tabs across all windows
        const activeTabs = await chrome.tabs.query({ active: true });
        for (const tab of activeTabs) {
            if (canReceivePipMessages(tab) && (!excludeId || tab.id !== excludeId)) {
                targetIds.add(tab.id);
            }
        }

        if (targetIds.size === 0) return;

        // Send messages to the targeted relevant tabs
        const promises = Array.from(targetIds).map(async (id) => {
            let msg = message;
            if (typeof message === 'function') {
                try {
                    const tab = await chrome.tabs.get(id);
                    msg = message(tab);
                } catch (e) { return; }
            }
            return safeSendMessage(id, msg);
        });

        await Promise.allSettled(promises);
    } catch (e) {
        log.warn('syncToRelevantTabs failed:', e && e.message);
    }
}

// Async Message Handlers (from second listener)
// ========================================

async function handleExitPip(message, sender, sendResponse) {
    if (pipState.active && pipState.tabId) {
        log.info('Executing manual exit for tab:', pipState.tabId);
        const oldTabId = pipState.tabId;
        
        // 1. Send exit command directly to origin tab (bridge handles the actual video exit)
        await safeSendMessage(oldTabId, { type: MSG.EXIT_PIP });

        // 2. Perform global cleanup
        await performPipGlobalCleanup();
    }
    
    if (sendResponse) sendResponse({ success: true });
}

async function handlePipActivated(message, sender, sendResponse) {
    const oldTabId = pipState.tabId;
    const newTabId = sender.tab?.id;

    if (!newTabId) {
        log.warn('PIP_ACTIVATED without sender.tab - ignoring');
        sendResponse({ success: false, error: 'no-tab' });
        return;
    }

    // Determine if this session should be considered extension-triggered.
    // We inherit the flag if:
    // 1. The message specifically says it's extension-triggered (initial start).
    // 2. OR if we have an active session in the SAME tab that was extension-triggered (video swap).
    const isExtensionTriggered = (message.isExtensionTriggered === true) || 
                                (pipState.active && pipState.tabId === newTabId && pipState.isExtensionTriggered);

    const originDomain = message.originDomain || getTabDomain(sender.tab);

    const newState = {
        ...DEFAULT_PIP_STATE,
        ...message, // Merge incoming properties
        active: true,
        tabId: newTabId,
        isExtensionTriggered,
        navExpanded: true,
        isSelectorMode: message.pipMode === 'manual',
        isTikTokLive: (message.platform === 'tiktok' && !!message.isLive),
        originDomain
    };
    
    await updateAndSync(newState, { 
        type: MSG.PIP_SESSION_STARTED, 
        state: newState,
        isExtensionTriggered: newState.isExtensionTriggered
    });

    log.info('Signaling other tabs to sync navigation state');
    await syncToRelevantTabs({ type: MSG.SYNC_NAV_EXPANDED, expanded: true });

    if (newTabId && sender.tab?.url) {
        (async () => {
            const success = await injectControlPanel(newTabId, sender.tab.url);
            if (success) showControlPanel(newTabId);
        })();
    }

    if (oldTabId && oldTabId !== newTabId) {
        log.info('PiP session moved from tab', oldTabId, 'to', newTabId);
        await safeSendMessage(oldTabId, { type: MSG.HIDE_VOLUME_PANEL });
    }

    // Explicit state sync signal
    safeSendMessage(newTabId, { type: MSG.SYNC_PIP_STATE, active: true }, { frameId: 0 });

    sendResponse({ success: true });
}

async function handleSignalNavigation(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId && tabId === pipState.tabId) {
        startNavigationGrace(tabId, 3000);
    }
    sendResponse({ success: true });
}

async function handleNavigateVideo(message, sender, sendResponse) {
    if (pipState.tabId) {
        startNavigationGrace(pipState.tabId, 2500); // Slightly shorter for manual nav
        await safeSendMessage(pipState.tabId, {
            type: MSG.NAVIGATE_VIDEO,
            direction: message.direction
        });
    }
    sendResponse({ success: true });
}

// Note: specific handlers for Liked, Favorited, and Playback are now handled 
// via handleStateToggle and handleStateUpdate in the dispatcher.

async function handleUpdateTikTokLiveState(message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        const updates = {};
        if (typeof message.isTikTokLive === 'boolean') updates.isTikTokLive = message.isTikTokLive;
        if (typeof message.hasFavorite === 'boolean') updates.hasFavorite = message.hasFavorite;
        
        // Ensure we send the NEW values in the sync message
        await updateAndSync(updates, { 
            type: MSG.SYNC_TIKTOK_LIVE_UI, 
            isTikTokLive: updates.isTikTokLive !== undefined ? updates.isTikTokLive : pipState.isTikTokLive, 
            hasFavorite: updates.hasFavorite !== undefined ? updates.hasFavorite : pipState.hasFavorite 
        });
    }
    sendResponse({ success: true });
}

async function handlePipDeactivated(message, sender, sendResponse) {
    if (pipState.active) {
        const actingTabId = sender.tab?.id;
        
        if (!message.force && actingTabId && actingTabId === _navigationGraceTabId) {
            log.info('Ignoring PiP deactivation during navigation grace period for tab:', actingTabId);
            sendResponse({ success: true });
            return;
        }

        log.info('PiP deactivated by event from tab:', actingTabId);
        await performPipGlobalCleanup();
    }
    sendResponse({ success: true });
}

async function handleSetVolume(message, sender, sendResponse) {
    _volumeDragActive = false; 
    const newVolume = Math.max(0, Math.min(100, message.volume));
    log.info('Set volume:', newVolume);

    const stateUpdate = { volume: newVolume };
    if (newVolume > 0 && pipState.muted) {
        stateUpdate.muted = false;
    }

    const result = await updateAndSync(
        stateUpdate,
        { type: MSG.SYNC_VOLUME_UI, volume: newVolume, muted: stateUpdate.muted !== undefined ? stateUpdate.muted : pipState.muted },
        MSG.CHANGE_VOLUME,
        { volume: newVolume }
    );

    if (result.state.muted === false) {
        await syncToRelevantTabs({ type: MSG.UPDATE_MUTE_STATE, muted: false });
    }

    sendResponse({ success: true });
}

async function handleToggleMute(message, sender, sendResponse) {
    const newMuted = message.muted !== undefined ? !!message.muted : !pipState.muted;
    log.info('Toggle mute:', newMuted);
    await updateAndSync(
        { muted: newMuted },
        { type: MSG.UPDATE_MUTE_STATE, muted: newMuted },
        MSG.TOGGLE_MUTE_VIDEO,
        { muted: newMuted }
    );
    sendResponse({ success: true, muted: newMuted });
}

async function handleSeekVideo(message, sender, sendResponse) {
    if (pipState.tabId) {
        await safeSendMessage(pipState.tabId, {
            type: MSG.SEEK_VIDEO,
            offset: message.offset
        });
    }
    sendResponse({ success: true });
}

async function handleUpdateVolumeState(message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        if (_volumeDragActive) {
            sendResponse({ success: true });
            return;
        }

        const newState = {};
        if (message.volume !== undefined) newState.volume = message.volume;
        if (message.muted !== undefined) newState.muted = message.muted;

        await updateAndSync(newState, {
            type: MSG.SYNC_VOLUME_UI,
            volume: message.volume,
            muted: message.muted
        });
    }
    sendResponse({ success: true });
}

async function handleSetNavExpanded(message, sender, sendResponse) {
    await updateAndSync({ navExpanded: message.expanded }, { type: MSG.SYNC_NAV_EXPANDED, expanded: message.expanded });
    sendResponse({ success: true });
}

// handleTogglePlay removed in favor of handleStateToggle

async function handleVideoDetected(message, sender, sendResponse) {
    // Placeholder for telemetry if needed
    sendResponse({ success: true });
}

async function handleRequestPipState(message, sender, sendResponse) {
    const s = await getPipState();
    const domain = getTabDomain(sender.tab);
    const effectiveUiVisible = calculateSessionVisibility(s, domain);

    sendResponse({ 
        state: s, 
        active: s.active, // Compatibility for handleCheckPipStatus
        uiVisible: s.uiVisible, // Compatibility for handleGetUiState
        effectiveUiVisible 
    });
}

function handlePing(message, sender, sendResponse) {
    sendResponse({ pong: true });
    return false;
}

// ========================================
// Consolidated Message Dispatcher
// ========================================

const COMMAND_HANDLERS = {
    [MSG.GET_UI_STATE]: handleRequestPipState,
    [MSG.EXECUTE_COMMAND]: handleExecuteCommand,
    [MSG.ACTIVATE_SELECTION_MODE]: handleActivateSelectionMode,
    [MSG.PIP_ACTIVATED]: handlePipActivated,
    [MSG.PIP_DEACTIVATED]: handlePipDeactivated,
    [MSG.STOP_SELECTION_MODE_GLOBAL]: handleStopSelectionModeGlobal,
    [MSG.EXIT_PIP]: async (message, sender, sendResponse) => {
        await handleExitPip(message, sender, sendResponse);
    },
    [MSG.NAVIGATE_VIDEO]: handleNavigateVideo,
    [MSG.TOGGLE_LIKE]: (m, s, r) => handleStateToggle('liked', MSG.SYNC_LIKE_UI, MSG.LIKE_VIDEO, m, s, r),
    [MSG.LIKE_VIDEO]: (m, s, r) => handleStateToggle('liked', MSG.SYNC_LIKE_UI, MSG.LIKE_VIDEO, m, s, r),
    [MSG.TOGGLE_FAVORITE]: (m, s, r) => handleStateToggle('favorited', MSG.SYNC_FAVORITE_UI, MSG.FAVORITE_VIDEO, m, s, r),
    [MSG.FAVORITE_VIDEO]: (m, s, r) => handleStateToggle('favorited', MSG.SYNC_FAVORITE_UI, MSG.FAVORITE_VIDEO, m, s, r),
    [MSG.UPDATE_FAVORITE_STATE]: (m, s, r) => handleStateUpdate('favorited', MSG.SYNC_FAVORITE_UI, m, s, r),
    [MSG.UPDATE_LIKE_STATE]: (m, s, r) => handleStateUpdate('liked', MSG.SYNC_LIKE_UI, m, s, r),
    [MSG.UPDATE_PLAYBACK_STATE]: (m, s, r) => handleStateUpdate('playing', MSG.SYNC_PLAYBACK_UI, m, s, r),
    [MSG.UPDATE_TIKTOK_LIVE_STATE]: handleUpdateTikTokLiveState,
    [MSG.SET_VOLUME]: handleSetVolume,
    [MSG.CHANGE_VOLUME]: handleSetVolume, // Relay-compatible alias
    [MSG.SET_VOLUME_LIVE]: (message, sender, sendResponse) => {
        // Lightweight real-time relay during slider drag
        _volumeDragActive = true;
        if (pipState.tabId) {
            safeSendMessage(pipState.tabId, { type: MSG.CHANGE_VOLUME, volume: message.volume });
        }
        pipState.volume = message.volume;
        if (message.volume > 0 && pipState.muted) pipState.muted = false;
        sendResponse({ success: true });
    },
    [MSG.TOGGLE_PLAY]: (m, s, r) => handleStateToggle('playing', MSG.SYNC_PLAYBACK_UI, MSG.TOGGLE_PLAY, m, s, r),
    [MSG.TOGGLE_MUTE]: handleToggleMute,
    [MSG.TOGGLE_MUTE_VIDEO]: handleToggleMute, // Relay-compatible alias
    [MSG.SEEK_VIDEO]: handleSeekVideo,
    [MSG.UPDATE_VOLUME_STATE]: handleUpdateVolumeState,
    [MSG.SET_NAV_EXPANDED]: handleSetNavExpanded,
    [MSG.REQUEST_PIP_STATE]: handleRequestPipState,
    [MSG.GET_PIP_STATE]: handleRequestPipState,
    [MSG.REQUEST_EARLY_PANEL]: async (message, sender, sendResponse) => {
        try {
            const state = await getPipState();
            const senderTabId = sender.tab?.id;
            if (!state.active) {
                if (senderTabId) safeSendMessage(senderTabId, { type: MSG.HIDE_VOLUME_PANEL });
                sendResponse({ skipped: true });
                return;
            }
            if (!senderTabId || senderTabId === state.tabId) {
                sendResponse({ skipped: true });
                return;
            }
            const tab = sender.tab;
            if (!tab.url || !canReceivePipMessages(tab)) {
                sendResponse({ skipped: true });
                return;
            }
            const success = await injectControlPanel(senderTabId, tab.url);
            if (success) {
                lastPanelShow.delete(senderTabId);
                showControlPanel(senderTabId);
            }
            sendResponse({ success });
        } catch (e) {
            sendResponse({ skipped: true });
        }
    },
    [MSG.CHECK_PIP_STATUS]: handleRequestPipState,
    [MSG.SIGNAL_NAVIGATION]: handleSignalNavigation,
    [MSG.SYNC_DRAG_POSITION]: handleSyncDragPosition,
    [MSG.GET_DRAG_POSITION]: handleGetDragPosition,
    [MSG.PING]: handlePing
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    const handler = COMMAND_HANDLERS[message.type];
    if (handler) {
        const result = handler(message, sender, sendResponse);
        // If handler returns exactly true, we tell Chrome to keep the channel open.
        // If it's a Promise (from an async function), we should also return true.
        if (result === true || (result && typeof result.then === 'function')) {
            return true;
        }
    }
    return false;
});

// Detectar cuando se cierra la pestaña
chrome.tabs.onRemoved.addListener(async (tabId) => {
    // Cleanup debounce map entry to prevent memory leak
    lastPanelShow.delete(tabId);

    // Si no tenemos estado cargado, hacerlo (aunque onRemoved es síncrono, operamos best-effort)
    if (!pipState) await getPipState();

    if (tabId === pipState.tabId) {
        log.info('Origin tab closed. Tearing down.');
        await performPipGlobalCleanup();
    }
    // Memory Safety: remove from tracking set if tab is closed
    _activeSessionTabIds.delete(tabId);
});

// Detectar cuando se activa una pestaña (el usuario cambia de pestaña)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (!tab.url) return;

        const currentState = await getPipState();
        if (currentState.active) {
            log.info('PiP active, ensuring control panel in activated tab:', tab.id);
            const success = await injectControlPanel(tab.id, tab.url);
            if (success) {
                // Clear debounce so onActivated ALWAYS triggers a fresh show event
                lastPanelShow.delete(tab.id);
                setTimeout(() => showControlPanel(tab.id), 200);
            }
        }
    } catch (e) { }
});

// Detectar cuando una pestaña se actualiza (recarga o navegación)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Note: status === 'loading' is too aggressive for SPA navigation tracking
    // because it often fires for fragment/history changes where the old script
    // environment persists. We clear injection status in handleRequestPipState instead.
    if (changeInfo.status !== 'complete') return;
    if (!tab.url) return;

    const currentState = await getPipState();

    // If PiP is NOT active, we don't need to do anything or log anything for every tab update.
    if (!currentState.active) return;

    // A page reload naturally removes our panel, so we stop tracking it for cleanup
    _activeSessionTabIds.delete(tabId);

    log.info('Tab updated/reloaded:', tabId);

    // Cleanup debounce tracker if tab moved to unsupported domain
    if (!canReceivePipMessages(tab)) {
        lastPanelShow.delete(tabId);
        return;
    }

    const isNavigationGrace = tabId === _navigationGraceTabId;

    // 2. If this was the PiP origin tab, validate it still exists (SPA vs Reload check)
    if (tabId === currentState.tabId) {
        if (isNavigationGrace) {
            log.info('Origin tab updated during navigation grace period. Skipping validation.');
            return;
        }

        log.info('Origin tab updated. Validating PiP...');
        const isValid = await validateTabPipStatus(tabId, tab.url);
        
        if (!isValid) {
            log.warn('PiP died or reported inactive on update/reload.');
            await updateAndSync({ active: false, tabId: null }, { type: MSG.HIDE_VOLUME_PANEL });
            return;
        }

        log.info('PiP survived update.');
    }

    // 3. If PiP is active, inject/show the control panel in this tab
    if (currentState.active) {
        const success = await injectControlPanel(tabId, tab.url);
        if (success) {
            // Clear stale debounce from previous page before showing
            lastPanelShow.delete(tabId);
            setTimeout(() => showControlPanel(tabId), 300);
        }
    }
});

// Listen for keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
    log.info('Keyboard command received:', command);

    if (command === 'hide_ui' || command === 'show_ui') {
        // Keyboard shortcuts are inherently global in this context
        await processVisibilityCommand(command, 'global', null);
    } else if (command === 'focus_pip') {
        const state = await getPipState();
        if (state.active && state.tabId) {
            log.info('Sending FOCUS_PIP to tab:', state.tabId);
            await safeSendMessage(state.tabId, { type: MSG.FOCUS_PIP });
        } else {
            log.info('No active PiP to focus');
        }
    } else if (command === 'close_pip') {
        // Use the unified exit logic which handles pausing correctly
        await handleExitPip({}, null, null);
    }
});