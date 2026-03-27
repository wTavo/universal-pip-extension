/**
 * Universal PiP Extension — Shared Constants and Configuration
 * This file is shared across background, content, and bridge scripts.
 */

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

const MSG = Object.freeze({
    // UI Visibility & Lifecycle
    GET_UI_STATE: 'GET_UI_STATE',
    EXECUTE_COMMAND: 'EXECUTE_COMMAND',
    HIDE_EXTENSION_UI: 'HIDE_EXTENSION_UI',
    SHOW_EXTENSION_UI: 'SHOW_EXTENSION_UI',
    SYNC_SESSION_VISIBILITY: 'SYNC_SESSION_VISIBILITY',
    GET_UI_VISIBILITY: 'GET_UI_VISIBILITY',
    VISIBILITY_PING: 'VISIBILITY_PING',
    PANEL_PING: 'PANEL_PING',

    // PiP Session Management
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

    // Video Controls
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
    
    // Commands/Actions
    LIKE_VIDEO: 'LIKE_VIDEO',
    FAVORITE_VIDEO: 'FAVORITE_VIDEO',
    MUTE: 'MUTE',
    UNMUTE: 'UNMUTE',

    // State Synchronization
    UPDATE_FAVORITE_STATE: 'UPDATE_FAVORITE_STATE',
    UPDATE_LIKE_STATE: 'UPDATE_LIKE_STATE',
    UPDATE_PLAYBACK_STATE: 'UPDATE_PLAYBACK_STATE',
    UPDATE_TIKTOK_LIVE_STATE: 'UPDATE_TIKTOK_LIVE_STATE',
    UPDATE_VOLUME_STATE: 'UPDATE_VOLUME_STATE',
    UPDATE_MUTE_STATE: 'UPDATE_MUTE_STATE',
    SET_NAV_EXPANDED: 'SET_NAV_EXPANDED',
    SYNC_NAV_EXPANDED: 'SYNC_NAV_EXPANDED',
    SYNC_VOLUME_UI: 'SYNC_VOLUME_UI',
    SYNC_LIKE_UI: 'SYNC_LIKE_UI',
    SYNC_FAVORITE_UI: 'SYNC_FAVORITE_UI',
    SYNC_PLAYBACK_UI: 'SYNC_PLAYBACK_UI',
    SYNC_TIKTOK_LIVE_UI: 'SYNC_TIKTOK_LIVE_UI',
    SYNC_PIP_STATE: 'SYNC_PIP_STATE',

    // Selection Mode
    START_SELECTION_MODE: 'START_SELECTION_MODE',
    STOP_SELECTION_MODE: 'STOP_SELECTION_MODE',
    ACTIVATE_SELECTION_MODE: 'ACTIVATE_SELECTION_MODE',
    STOP_SELECTION_MODE_GLOBAL: 'STOP_SELECTION_MODE_GLOBAL',

    // UI Panels
    HIDE_VOLUME_PANEL: 'HIDE_VOLUME_PANEL',
    SHOW_VOLUME_PANEL: 'SHOW_VOLUME_PANEL',
    SHOW_GLOBAL_PIP_BTN: 'SHOW_GLOBAL_PIP_BTN',

    // Drag/Position
    SYNC_DRAG_POSITION: 'SYNC_DRAG_POSITION',
    GET_DRAG_POSITION: 'GET_DRAG_POSITION',

    // Misc
    PING: 'PING'
});

// Export for different environments
const globalObj = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEFAULT_PIP_STATE, MSG };
} else {
    globalObj.PIP_CONSTANTS = { DEFAULT_PIP_STATE, MSG };
}
