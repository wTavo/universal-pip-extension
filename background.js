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

// Track tabs where the control panel was shown to ensure surgical cleanup when PiP ends
const _activeSessionTabIds = new Set();

// Helper para guardar estado
async function savePipState(newState) {
    let changed = false;
    // serialize writes to prevent lost updates
    _saveLock = _saveLock.then(async () => {
        // Recupera la versión más reciente desde storage para comparar
        const stored = await chrome.storage.local.get('pipState');
        const current = stored.pipState || pipState || { ...DEFAULT_PIP_STATE };

        // Merge sin mutar current
        if (newState.domainExceptions) {
            newState.domainExceptions = sanitizeDomainExceptions(newState.domainExceptions);
        }
        const merged = { ...current, ...newState };
        // Deep-compare domainExceptions efficiently
        const domainEqual = isDomainExceptionsEqual(current.domainExceptions || {}, merged.domainExceptions || {});
        // Check shallow primitive differences
        let hasChanges = !domainEqual || Object.keys(current).some(k => {
            if (k === 'domainExceptions') return false;
            return current[k] !== merged[k];
        });

        if (!hasChanges) {
            return { changed: false, state: current };
        }

        await chrome.storage.local.set({ pipState: merged });
        pipState = merged;
        if (!pipState.domainExceptions) pipState.domainExceptions = {};
        log.info('State saved (Changes detected):', newState);
        changed = true;
        return { changed: true, state: merged };
    }).catch(err => {
        log.error('savePipState error:', err && err.message);
        return { changed: false, state: pipState };
    });

    return _saveLock;
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
    // HEURISTIC: This list is partial. If issues arise with specific ccTLDs, add them here.
    // For a robust solution, consider migrating to a Public Suffix List (PSL) library in the build step.
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
    // Simple heuristic: take last 2 parts
    return parts.slice(-2).join('.');
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
// Message Handler Functions
// ========================================

async function handleGetUiState(message, sender, sendResponse) {
    const state = await getPipState();
    sendResponse({ uiVisible: state.uiVisible });
}

async function handleExecuteCommand(message, sender, sendResponse) {
    // Determine domain from message (popup) or sender (content script)
    let domain = null;
    const targetUrl = message.tabUrl || (sender.tab ? sender.tab.url : null);

    if (targetUrl) {
        try {
            domain = getBaseDomain(new URL(targetUrl).hostname);
        } catch (e) { }
    }

    // Only update global state if scope is global
    if (message.scope === 'global') {
        if (message.command === 'hide_ui') {
            await savePipState({ uiVisible: false, domainExceptions: {} });
            log.info('Global UI hidden via popup (Exceptions cleared)');
        } else if (message.command === 'show_ui') {
            await savePipState({ uiVisible: true, domainExceptions: {} });
            log.info('Global UI shown via popup (Exceptions cleared)');
        }
    } else {
        // Platform specific: Add exception for this domain
        if (domain) {
            const newExceptions = { ...pipState.domainExceptions };

            if (message.command === 'hide_ui') {
                // domain is already normalized by getBaseDomain() above
                newExceptions[domain] = false;
                await savePipState({ domainExceptions: newExceptions });
                log.info(`UI hidden for ${domain} (Exception added)`);
            } else if (message.command === 'show_ui') {
                // domain is already normalized by getBaseDomain() above
                newExceptions[domain] = true;
                await savePipState({ domainExceptions: newExceptions });
                log.info(`UI shown for ${domain} (Exception added)`);
            }
        } else {
            log.info(`Command ${message.command} executed in ${message.scope} mode (No domain found)`);
        }
    }

    // Post-Command Broadcast
    getPipState().then(async (updatedState) => {
        log.info('Re-calculated Session Visibility Broadcast (Per-Tab)');

        await syncToRelevantTabs((tab) => {
            let originDomain = null;
            try {
                if (tab && tab.url) originDomain = getBaseDomain(new URL(tab.url).hostname);
            } catch (err) { }

            const isSessionVisible = calculateSessionVisibility(updatedState, originDomain);
            return {
                type: 'SYNC_SESSION_VISIBILITY',
                visible: isSessionVisible,
                effectiveDomain: originDomain, // Send calculated domain to content script
                state: updatedState
            };
        });
    });

    // Respond to confirm execution (important for robust async calls)
    sendResponse({ success: true });
}

function handleVideoDetected(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
        safeSendMessage(tabId, {
            type: 'SHOW_GLOBAL_PIP_BTN'
        }, { frameId: 0 });
    }
    return false;
}

function handleActivateSelectionMode(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
        safeSendMessage(tabId, {
            type: 'START_SELECTION_MODE'
        });
    }
    return false;
}

function handlePipStateSync(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
        safeSendMessage(tabId, {
            type: 'SYNC_PIP_STATE',
            active: message.type === 'PIP_ACTIVATED'
        }, { frameId: 0 });
    }
    return false;
}

function handleStopSelectionModeGlobal(message, sender, sendResponse) {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
        safeSendMessage(tabId, { type: 'STOP_SELECTION_MODE' });
    }
    return false;
}

function handleExitPip(message, sender, sendResponse) {
    if (pipState.tabId) {
        // If exiting from a different tab, pause the video first as per user request
        if (sender.tab && sender.tab.id !== pipState.tabId) {
            safeSendMessage(pipState.tabId, { type: 'PAUSE_VIDEO' });
        }
        safeSendMessage(pipState.tabId, { type: 'EXIT_PIP' });
    } else {
        log.warn('No target tab ID for EXIT_PIP');
    }
    const MAX_SIZE = 50;

    if (Object.keys(injectionFailures).length >= MAX_SIZE) {
        // Remove entries older than TTL first
        for (const d in injectionFailures) {
            if (now - injectionFailures[d].lastAttempt > TTL) {
                delete injectionFailures[d];
            }
        }
        // If still too big, delete the oldest entries (or just the first ones found)
        if (Object.keys(injectionFailures).length >= MAX_SIZE) {
            const keys = Object.keys(injectionFailures);
            // Sort by lastAttempt to remove oldest first? Or just slice. Slice is faster/simpler.
            keys.slice(0, 25).forEach(k => delete injectionFailures[k]);
        }
    }
}

function recordInjectionFailure(domain) {
    const now = Date.now();
    const TTL = 60 * 60 * 1000; // 1 hour

    pruneInjectionFailures();

    const entry = injectionFailures[domain] || { count: 0, lastAttempt: 0 };

    // Reset count if TTL expired
    if (now - entry.lastAttempt > TTL) {
        entry.count = 0;
    }

    entry.count++;
    entry.lastAttempt = now;
    injectionFailures[domain] = entry;

    if (entry.count >= 3) {
        log.warn(`High injection failure rate for ${domain} (${entry.count}). Possible CSP block.`);
    }
}

// Inyectar el script de control en una pestaña específica
// Inyectar el script de control en una pestaña específica (Simplificado para Manifest)
async function injectControlPanel(tabId, tabUrl) {
    try {
        if (!canReceivePipMessages({ url: tabUrl })) return false;

        // With Manifest injection, we just need to verify the script is alive
        const response = await safeSendMessage(tabId, { type: 'PANEL_PING' });
        if (response && !response.error && response.panelActive) {
            return true;
        }

        // If Ping fails, the content script might not be ready yet (e.g. initial load)
        // Since it's in the manifest, it WILL load. We return true to allow the follow-up
        // showControlPanel call to proceed after its small delay.
        return true;
    } catch (err) {
        return false;
    }
}

// ensureVisibilityListener REMOVED - Handled by manifest.json

// Proactive initialization NOT needed for content scripts in manifest.
// The browser handles it for us on load.
async function initializeAllTabs() {
    log.info('Supported tabs will be initialized via manifest.');
}

// Call on load (for developer reloads)
initializeAllTabs();

chrome.runtime.onInstalled.addListener((details) => {
    log.info('Extension installed/updated:', details.reason);
    initializeAllTabs();
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
        type: 'SHOW_VOLUME_PANEL',
        state: freshState,
        sessionVisible: isVisible // Pass calculated visibility
    });
}

/**
 * Surgically removes the volume panel from all tabs where it was displayed during the session.
 */
async function cleanupAllSessionPanels() {
    if (_activeSessionTabIds.size === 0) return;

    log.info(`Surgically cleaning up panels from ${_activeSessionTabIds.size} tabs.`);
    const cleanupPromises = Array.from(_activeSessionTabIds).map(id =>
        safeSendMessage(id, { type: 'HIDE_VOLUME_PANEL' })
    );

    await Promise.allSettled(cleanupPromises);
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

        // 1. Always include the active PiP tab if there is one
        if (pipState.tabId && (!excludeId || pipState.tabId !== excludeId)) {
            targetIds.add(pipState.tabId);
        }

        // 2. Add currently visible (active) tabs across all windows
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

// ========================================
// Async Message Handlers (from second listener)
// ========================================

async function handlePipActivated(message, sender, sendResponse) {
    const oldTabId = pipState.tabId;
    const newTabId = sender.tab ? sender.tab.id : null;

    if (!newTabId) {
        log.warn('PIP_ACTIVATED without sender.tab - ignoring');
        sendResponse({ success: false, error: 'no-tab' });
        return;
    }

    let originDomain = message.originDomain;
    if (!originDomain && sender.tab && sender.tab.url) {
        try {
            originDomain = getBaseDomain(new URL(sender.tab.url).hostname);
        } catch (e) { }
    }

    const newState = {
        active: true,
        tabId: newTabId,
        volume: typeof message.volume === "number" ? message.volume : pipState.volume,
        muted: typeof message.muted === "boolean" ? message.muted : pipState.muted,
        liked: typeof message.liked === "boolean" ? message.liked : pipState.liked,
        favorited: typeof message.favorited === "boolean" ? message.favorited : pipState.favorited,
        navExpanded: true,
        pipMode: message.pipMode || 'main',
        isSelectorMode: message.pipMode === 'manual',
        isExtensionTriggered: !!message.isExtensionTriggered,
        platform: message.platform || 'unknown',
        isShorts: message.isShorts || false,
        supportsNavigation: !!message.supportsNavigation,
        playing: typeof message.playing === 'boolean' ? message.playing : true,
        isLive: typeof message.isLive === 'boolean' ? message.isLive : false,
        isTikTokLive: (message.platform === 'tiktok' && !!message.isLive),
        hasFavorite: true,
        originDomain: originDomain
    };
    await savePipState(newState);

    await syncToRelevantTabs({ type: 'SYNC_NAV_EXPANDED', expanded: true });

    log.info('Signaling other tabs to pause (PiP moved to', newTabId, ')');
    await syncToRelevantTabs({
        type: 'PIP_SESSION_STARTED',
        originTabId: newTabId
    }); // Broadcast to everyone, including sender, for UI icon sync

    // Explicitly show the control panel on the origin tab.
    // This is required because handlePipActivated doesn't automatically trigger UI updates
    // on the sender tab. We ensure the script is injected first.
    if (newTabId && sender.tab?.url) {
        (async () => {
            const success = await injectControlPanel(newTabId, sender.tab.url);
            if (success) {
                showControlPanel(newTabId);
            }
        })();
    }

    if (oldTabId && oldTabId !== newTabId) {
        log.info('PiP session moved from tab', oldTabId, 'to', newTabId);
        // Explicitly tell the old tab to hide its PiP UI (ghost UI bug fix)
        await safeSendMessage(oldTabId, { type: 'HIDE_VOLUME_PANEL' });
    }

    sendResponse({ success: true });
}

async function handleNavigateVideo(message, sender, sendResponse) {
    if (pipState.tabId) {
        // Set navigation grace period
        _navigationGraceTabId = pipState.tabId;
        if (_navigationGraceTimer) clearTimeout(_navigationGraceTimer);
        _navigationGraceTimer = setTimeout(() => {
            _navigationGraceTabId = null;
            _navigationGraceTimer = null;
        }, 2000); // 2 second grace period for video swap

        await safeSendMessage(pipState.tabId, {
            type: 'NAVIGATE_VIDEO',
            direction: message.direction
        });
    }
    sendResponse({ success: true });
}

async function handleToggleLike(message, sender, sendResponse) {
    log.info('TOGGLE_LIKE received. Target Tab ID:', pipState.tabId);
    const newLiked = !pipState.liked;
    await savePipState({ liked: newLiked });

    await syncToRelevantTabs({ type: 'SYNC_LIKE_UI', liked: newLiked });

    if (pipState.tabId) {
        await safeSendMessage(pipState.tabId, {
            type: 'LIKE_VIDEO'
        });
    } else {
        log.warn('No target tab ID for LIKE_VIDEO');
    }
    sendResponse({ success: true });
}

async function handleToggleFavorite(message, sender, sendResponse) {
    const newFavorited = !pipState.favorited;
    await savePipState({ favorited: newFavorited });

    await syncToRelevantTabs({ type: 'SYNC_FAVORITE_UI', favorited: newFavorited });

    if (pipState.tabId) {
        await safeSendMessage(pipState.tabId, {
            type: 'FAVORITE_VIDEO'
        });
    } else {
        log.warn('No target tab ID for FAVORITE_VIDEO');
    }
    sendResponse({ success: true });
}

async function handleUpdateFavoriteState(message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        const result = await savePipState({ favorited: message.favorited });
        if (result.changed) {
            await syncToRelevantTabs({ type: 'SYNC_FAVORITE_UI', favorited: message.favorited });
        }
    }
    sendResponse({ success: true });
}

async function handleUpdateLikeState(message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        const result = await savePipState({ liked: message.liked });
        if (result.changed) {
            await syncToRelevantTabs({ type: 'SYNC_LIKE_UI', liked: message.liked });
        }
    }
    sendResponse({ success: true });
}

async function handleUpdatePlaybackState(message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        const result = await savePipState({ playing: message.playing });
        if (result.changed) {
            await syncToRelevantTabs({ type: 'SYNC_PLAYBACK_UI', playing: message.playing });
        }
    }
    sendResponse({ success: true });
}

async function handleUpdateTikTokLiveState(message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        const updates = {};
        if (typeof message.isTikTokLive === 'boolean') updates.isTikTokLive = message.isTikTokLive;
        if (typeof message.hasFavorite === 'boolean') updates.hasFavorite = message.hasFavorite;
        
        await savePipState(updates);
        
        // Broadcast to UI: ALWAYS sync for TikTok. 
        // This ensures that if the background state was reset but the panel UI is still out of sync,
        // it gets corrected immediately by the bridge's first evaluation.
        await syncToRelevantTabs({ 
            type: 'SYNC_TIKTOK_LIVE_UI', 
            isTikTokLive: pipState.isTikTokLive, 
            hasFavorite: pipState.hasFavorite 
        });
    }
    sendResponse({ success: true });
}

async function handlePipDeactivated(message, sender, sendResponse) {
    if (pipState.active) {
        log.info('PiP deactivated by tab:', sender.tab?.id, 'Origin was:', pipState.tabId);

        // Notify the origin tab to hide its UI
        await savePipState({ active: false, tabId: null });
        await cleanupAllSessionPanels(); // Targeted surgical cleanup
        await syncToRelevantTabs({ type: 'HIDE_VOLUME_PANEL' });
    } else {
        log.info('Ignored PIP_DEACTIVATED - PiP already inactive');
    }
    sendResponse({ success: true });
}

async function handleSetVolume(message, sender, sendResponse) {
    _volumeDragActive = false; // Drag ended — allow bridge feedback again
    const newVolume = message.volume;
    const stateUpdate = { volume: newVolume };

    // If user sets a positive volume, treat it as an implicit unmute
    // so pipState stays consistent and all panels show the correct mute button state.
    if (newVolume > 0 && pipState.muted) {
        stateUpdate.muted = false;
    }

    await savePipState(stateUpdate);

    if (pipState.tabId) {
        await safeSendMessage(pipState.tabId, {
            type: 'CHANGE_VOLUME',
            volume: newVolume
        });
    }

    // Notify all panels of the mute state change if we just implicitly unmuted
    if (stateUpdate.muted === false) {
        await syncToRelevantTabs({ type: 'UPDATE_MUTE_STATE', muted: false });
    }

    sendResponse({ success: true });
}

async function handleTogglePlay(message, sender, sendResponse) {
    if (pipState.tabId) {
        await safeSendMessage(pipState.tabId, {
            type: 'TOGGLE_PLAY'
        });
    }
    sendResponse({ success: true });
}

async function handleToggleMute(message, sender, sendResponse) {
    const newMuted = !pipState.muted;
    await savePipState({ muted: newMuted });

    if (pipState.tabId) {
        await safeSendMessage(pipState.tabId, {
            type: 'TOGGLE_MUTE_VIDEO',
            muted: newMuted
        });
    }

    await syncToRelevantTabs({ type: 'UPDATE_MUTE_STATE', muted: newMuted });

    sendResponse({ success: true, muted: newMuted });
}

async function handleExitPip(message, sender, sendResponse) {
    log.info('handleExitPip requested by tab:', sender.tab?.id);
    if (pipState.tabId) {
        await safeSendMessage(pipState.tabId, {
            type: 'EXIT_PIP'
        });
    } else {
        log.warn('No active PiP tab known to exit.');
    }

    // Send immediate response
    if (sendResponse) sendResponse({ success: true });
}

async function handleSeekVideo(message, sender, sendResponse) {
    if (pipState.tabId) {
        await safeSendMessage(pipState.tabId, {
            type: 'SEEK_VIDEO',
            offset: message.offset
        });
    }
    sendResponse({ success: true });
}

async function handleUpdateAdState(message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        await syncToRelevantTabs({
            type: 'UPDATE_AD_STATE',
            isAd: message.isAd
        });
    }
    sendResponse({ success: true });
}

async function handleUpdateVolumeState(message, sender, sendResponse) {
    if (sender.tab && sender.tab.id === pipState.tabId) {
        // Skip save during active slider drag to prevent feedback loop log spam
        if (_volumeDragActive) {
            sendResponse({ success: true });
            return;
        }

        const newState = {};
        if (message.volume !== undefined) newState.volume = message.volume;
        if (message.muted !== undefined) newState.muted = message.muted;

        const result = await savePipState(newState);

        if (result.changed && (message.volume !== undefined || message.muted !== undefined)) {
            await syncToRelevantTabs({
                type: "SYNC_VOLUME_UI",
                volume: message.volume,
                muted: message.muted
            });
        }
    }
    sendResponse({ success: true });
}

async function handleSetNavExpanded(message, sender, sendResponse) {
    const result = await savePipState({ navExpanded: message.expanded });
    if (result.changed) {
        log.info('Nav Expanded set to:', message.expanded);
        await syncToRelevantTabs({
            type: 'SYNC_NAV_EXPANDED',
            expanded: message.expanded
        });
    }
    sendResponse({ success: true });
}

async function handleRequestPipState(message, sender, sendResponse) {
    const s = await getPipState();
    let effectiveUiVisible = s.uiVisible;

    // Reliability: ui-visibility-listener sending this message at document_start 
    // is a definitive signal that the tab context has been reset (Hard Reload).
    if (sender.tab && sender.frameId === 0) {
        // State cleanup if necessary (none needed now for successfullyInjected)
    }

    try {
        const senderTab = sender.tab;
        if (senderTab && senderTab.url) {
            const domain = getBaseDomain(new URL(senderTab.url).hostname);
            if (s.domainExceptions && s.domainExceptions[domain] !== undefined) {
                effectiveUiVisible = s.domainExceptions[domain];
            }
        }
    } catch (e) { /* ignore */ }

    sendResponse({ state: s, effectiveUiVisible });
}

async function handleCheckPipStatus(message, sender, sendResponse) {
    const s = await getPipState();
    sendResponse({ active: s.active, state: s });
}

function handlePing(message, sender, sendResponse) {
    sendResponse({ pong: true });
    return false;
}

// ========================================
// Consolidated Message Listener
// ========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Dispatch to appropriate handler based on message type
    switch (message.type) {
        case 'GET_UI_STATE':
            handleGetUiState(message, sender, sendResponse);
            return true;



        case 'EXECUTE_COMMAND':
            handleExecuteCommand(message, sender, sendResponse);
            return true; // Keep channel open for async response

        case 'VIDEO_DETECTED':
            handleVideoDetected(message, sender, sendResponse);
            return false;

        case 'ACTIVATE_SELECTION_MODE':
            handleActivateSelectionMode(message, sender, sendResponse);
            return false;

        case 'PIP_ACTIVATED':
            handlePipActivated(message, sender, sendResponse);
            handlePipStateSync(message, sender, sendResponse);
            return true;

        case 'PIP_DEACTIVATED':
            handlePipDeactivated(message, sender, sendResponse);
            handlePipStateSync(message, sender, sendResponse);
            return true;

        case 'STOP_SELECTION_MODE_GLOBAL':
            handleStopSelectionModeGlobal(message, sender, sendResponse);
            return false;

        case 'EXIT_PIP':
            handleExitPip(message, sender, sendResponse);
            // Optimistically hide the UI on all tabs immediately
            syncToRelevantTabs({ type: 'HIDE_VOLUME_PANEL' });
            return false;

        case 'NAVIGATE_VIDEO':
            handleNavigateVideo(message, sender, sendResponse);
            return true;

        case 'TOGGLE_LIKE':
            handleToggleLike(message, sender, sendResponse);
            return true;

        case 'TOGGLE_FAVORITE':
            handleToggleFavorite(message, sender, sendResponse);
            return true;

        case 'UPDATE_FAVORITE_STATE':
            handleUpdateFavoriteState(message, sender, sendResponse);
            return true;

        case 'UPDATE_LIKE_STATE':
            handleUpdateLikeState(message, sender, sendResponse);
            return true;

        case 'UPDATE_PLAYBACK_STATE':
            handleUpdatePlaybackState(message, sender, sendResponse);
            return true;

        case 'UPDATE_TIKTOK_LIVE_STATE':
            handleUpdateTikTokLiveState(message, sender, sendResponse);
            return true;

        case 'SET_VOLUME':
            handleSetVolume(message, sender, sendResponse);
            return true;

        case 'SET_VOLUME_LIVE':
            // Lightweight real-time relay during slider drag — no save, no log
            _volumeDragActive = true;
            if (pipState.tabId) {
                safeSendMessage(pipState.tabId, { type: 'CHANGE_VOLUME', volume: message.volume });
            }
            // Silent in-memory update only
            pipState.volume = message.volume;
            if (message.volume > 0 && pipState.muted) pipState.muted = false;
            sendResponse({ success: true });
            return false;

        case 'TOGGLE_PLAY':
            handleTogglePlay(message, sender, sendResponse);
            return true;

        case 'TOGGLE_MUTE':
            handleToggleMute(message, sender, sendResponse);
            return true;

        case 'SEEK_VIDEO':
            handleSeekVideo(message, sender, sendResponse);
            return true;

        case 'UPDATE_AD_STATE':
            handleUpdateAdState(message, sender, sendResponse);
            return true;

        case 'UPDATE_VOLUME_STATE':
            handleUpdateVolumeState(message, sender, sendResponse);
            return true;

        case 'SET_NAV_EXPANDED':
            handleSetNavExpanded(message, sender, sendResponse);
            return true;

        case 'REQUEST_PIP_STATE':
        case 'GET_PIP_STATE':
            handleRequestPipState(message, sender, sendResponse);
            return true;

        case 'REQUEST_EARLY_PANEL':
            // Early panel injection for non-origin tabs.
            // Triggered from ui-visibility-listener.js at document_start
            // so the volume panel appears immediately on navigation without
            // waiting for onUpdated + 300ms delay.
            (async () => {
                try {
                    const state = await getPipState();
                    const senderTabId = sender.tab?.id;
                    if (!state.active) {
                        // Cleanup: explicitly hide PiP if BfCache restored a stale DOM
                        if (senderTabId) safeSendMessage(senderTabId, { type: 'HIDE_VOLUME_PANEL' });
                        sendResponse({ skipped: true });
                        return;
                    }
                    if (!senderTabId || senderTabId === state.tabId) {
                        // This IS the origin tab — skip
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
                        lastPanelShow.delete(senderTabId); // Clear stale debounce from previous page
                        showControlPanel(senderTabId);
                    }
                    sendResponse({ success });
                } catch (e) {
                    sendResponse({ skipped: true });
                }
            })();
            return true;

        case 'CHECK_PIP_STATUS':
            handleCheckPipStatus(message, sender, sendResponse);
            return true;

        case 'SIGNAL_NAVIGATION':
            if (sender.tab && sender.tab.id) {
                // Activate navigation grace period for this tab
                _navigationGraceTabId = sender.tab.id;
                if (_navigationGraceTimer) clearTimeout(_navigationGraceTimer);
                _navigationGraceTimer = setTimeout(() => {
                    _navigationGraceTabId = null;
                    _navigationGraceTimer = null;
                }, 2000); // 2 second grace period
                log.info('SIGNAL_NAVIGATION received from tab:', sender.tab.id);
            }
            sendResponse({ success: true });
            return false;

        case 'PING':
            handlePing(message, sender, sendResponse);
            return false;

        default:
            return false; // Unknown message type
    }
});

// Detectar cuando se cierra la pestaña
chrome.tabs.onRemoved.addListener(async (tabId) => {
    // Cleanup debounce map entry to prevent memory leak
    lastPanelShow.delete(tabId);

    // Si no tenemos estado cargado, hacerlo (aunque onRemoved es síncrono, operamos best-effort)
    if (!pipState) await getPipState();

    if (tabId === pipState.tabId) {
        log.info('Tab closed');
        await savePipState({ active: false, tabId: null });
        await cleanupAllSessionPanels(); // Cleanup Google tabs if YouTube closed
        await syncToRelevantTabs({ type: 'HIDE_VOLUME_PANEL' });
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
    if (currentState.active && tabId === currentState.tabId) {
        if (isNavigationGrace) {
            log.info('Origin tab updated during navigation grace period. Skipping validation.');
            return;
        }

        // Special Handling for Prime Video:
        // Prime often updates the URL slightly after the video starts (e.g. adding ref markers).
        // If we are on Prime and PiP is confirmed active, we should NOT reset state just because URL changed.
        const isPrime = tab.url.includes('primevideo.com');

        log.info('Origin tab updated. Validating PiP...', { isPrime });

        try {
            const response = await safeSendMessage(tabId, { type: 'VALIDATE_PIP_STATUS' });

            if (!response) {
                // No response (undefined/null) -> Communication definitely failed or tab closed
                // This usually happens during reload before content script is ready
                log.warn('PiP died on update/reload (No response).');
                await savePipState({ active: false, tabId: null });
                await syncToRelevantTabs({ type: 'HIDE_VOLUME_PANEL' });
                return;
            }

            if (response.error) {
                // Communication error captured by safeSendMessage
                if (isPrime) {
                    log.warn('Communication failed on Prime update, but assuming PiP is safe (Heuristic).', response.error);
                    return; // Trust that PiP is still there
                } else {
                    log.warn('Communication failed on update. Assuming reload/navigation.', response.error);
                    await savePipState({ active: false, tabId: null });
                    await syncToRelevantTabs({ type: 'HIDE_VOLUME_PANEL' });
                    return;
                }
            }

            if (!response.isActive) {
                // Successful communication, but PiP reports not active
                log.warn('PiP reported dead on update/reload.');
                await savePipState({ active: false, tabId: null });
                await syncToRelevantTabs({ type: 'HIDE_VOLUME_PANEL' });
                return;
            } else {
                log.info('PiP survived update. Refreshing metadata.');
                if (response.metadata) {
                    await savePipState(response.metadata);
                }
            }
        } catch (e) {
            // Should be caught by safeSendMessage, but just in case
            if (isPrime) {
                log.info('Exception on Prime update check, but assuming PiP is safe.', e.message);
                return;
            }

            log.info('Exception during update check. Assuming reload.', e.message);
            await savePipState({ active: false, tabId: null });
            return;
        }
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
    log.info('Command received:', command);

    if (command === 'hide_ui' || command === 'show_ui') {
        const isVisible = command === 'show_ui';

        // Update Global State
        await savePipState({ uiVisible: isVisible });

        // Broadcast intent to all supported tabs
        // Content scripts will validate against domainExceptions locally
        const state = await getPipState();
        syncToRelevantTabs({
            type: 'SYNC_SESSION_VISIBILITY',
            visible: isVisible,
            state: state
        });

        log.info(`Global uiVisible set to: ${isVisible} (synced to relevant tabs)`);
    } else if (command === 'focus_pip') {
        const state = await getPipState();

        if (state.active && state.tabId) {
            log.info('Sending FOCUS_PIP to tab:', state.tabId);
            try {
                await safeSendMessage(state.tabId, { type: 'FOCUS_PIP' });
            } catch (e) {
                log.error('Failed to send FOCUS_PIP:', e);
            }
        } else {
            log.info('No active PiP to focus');
        }
    } else if (command === 'close_pip') {
        const state = await getPipState();

        if (state.active && state.tabId) {
            log.info('Sending EXIT_PIP to tab:', state.tabId);
            try {
                await safeSendMessage(state.tabId, { type: 'EXIT_PIP' });
            } catch (e) {
                log.error('Failed to send EXIT_PIP:', e);
            }
        } else {
            log.info('No active PiP to close');
        }
    }
});