(function () {
    'use strict';

    if (window.__TIKTOK_PIP_INJECT_LOADED__) return;
    window.__TIKTOK_PIP_INJECT_LOADED__ = true;

    // --- UI Listeners and state handled by PiPFloatingButton manager ---
    let currentLiked = false;
    let currentFavorited = false;
    let currentIsLive = false;
    let currentHasFavorite = true;

    // --- PiP State Listeners (Shared) ---
    if (window.PiPUtils && window.PiPUtils.trackPiPState) {
        window.PiPUtils.trackPiPState({
            onEnter: () => {
                // Persistent across swaps (cleared on actual exit below)
            },
            onExit: () => {
                if (window.__pipExt) window.__pipExt.isTriggered = false;
            },
            controlEventName: 'TikTok_Control_Event',
            metadataCollector: (video) => {
                return {
                    platform: 'tiktok',
                    supportsNavigation: !currentIsLive,
                    pipMode: (window.__pipExt && window.__pipExt.isSelector) ? 'manual' : 'main',
                    isExtensionTriggered: !!(window.__pipExt && window.__pipExt.isTriggered),
                    isLive: currentIsLive,
                    liked: currentLiked,
                    favorited: currentFavorited
                };
            }
        });

        // Initial state sync handled globally by PiPFloatingButton manager
    }


    // --- Bridge Injection (Shared) ---
    function injectBridge() {
        if (window.__TIKTOK_BRIDGE_INJECTED__) return;
        window.__TIKTOK_BRIDGE_INJECTED__ = true;

        if (window.PiPUtils && window.PiPUtils.injectBridge) {
            window.PiPUtils.injectBridge('platforms/tiktok/tiktok-api-bridge.js');
        }
    }

    injectBridge();

    // --- Bridge Communication ---
    let _lastTikTokLive = null;
    let _lastHasFavorite = null;

    document.addEventListener('TikTok_State_Update', (e) => {
        const { liked, favorited, playing, isTikTokLive, hasFavorite } = e.detail || {};

        if (typeof liked === 'boolean') currentLiked = liked;
        if (typeof favorited === 'boolean') currentFavorited = favorited;
        if (typeof isTikTokLive === 'boolean') currentIsLive = isTikTokLive;
        if (typeof hasFavorite === 'boolean') currentHasFavorite = hasFavorite;

        if (window.PiPUtils?.safeSendMessage) {
            const send = (type, payload) => window.PiPUtils.safeSendMessage({ type, ...payload });

            if (typeof liked === 'boolean') send('UPDATE_LIKE_STATE', { liked });
            if (typeof favorited === 'boolean') send('UPDATE_FAVORITE_STATE', { favorited });
            if (typeof playing === 'boolean') send('UPDATE_PLAYBACK_STATE', { playing });

            if (currentIsLive !== _lastTikTokLive || currentHasFavorite !== _lastHasFavorite) {
                _lastTikTokLive = currentIsLive;
                _lastHasFavorite = currentHasFavorite;
                send('UPDATE_TIKTOK_LIVE_STATE', { isTikTokLive: currentIsLive, hasFavorite: currentHasFavorite });
            }
        }
    });

    // --- Core Functionality ---
    const togglePiP = window.PiPUtils.createTogglePiP('TikTok_Control_Event');

    // --- PiP Button & Selector Ball (via universal manager) ---
    window.PiPFloatingButton?.init({
        id: 'tiktokPipBtn',
        text: '',
        storageKey: 'pipBtnPos_TikTok',
        style: {
            background: 'linear-gradient(45deg, #00f2ea, #ff0050)',
            zIndex: '2147483647'
        },
        onClick: togglePiP
    });

    // Listen for Commands from Panel (Global) -> Relay
    if (window.PiPUtils && window.PiPUtils.setupMessageRelay) {
        window.PiPUtils.setupMessageRelay('TikTok_Control_Event', {
            'CHANGE_VOLUME': (msg) => ({ action: 'SET_VOLUME', value: msg.volume }),
            'TOGGLE_MUTE_VIDEO': (msg) => ({ action: msg.muted ? 'MUTE' : 'UNMUTE' }),
            'SEEK_VIDEO': (msg) => ({ action: 'SEEK', value: msg.offset }),
            'LIKE_VIDEO': () => ({ action: 'TOGGLE_LIKE' }),
            'FAVORITE_VIDEO': () => ({ action: 'TOGGLE_FAVORITE' }),
            'NAVIGATE_VIDEO': window.PiPUtils.createNavigateRelay(),
            'TOGGLE_PLAY': () => ({ action: 'TOGGLE_PLAY' }),
            'EXIT_PIP': () => ({ action: 'EXIT_PIP' }),
            'FOCUS_PIP': () => ({ action: 'FOCUS_PIP' }),
            'PAUSE_VIDEO': () => ({ action: 'PAUSE' }),
            'HIDE_VOLUME_PANEL': () => { /* icon update handled globally */ }
        });
    }

})();