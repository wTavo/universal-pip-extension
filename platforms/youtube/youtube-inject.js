(function () {
    'use strict';

    if (window.__YOUTUBE_PIP_INJECT_LOADED__) return;
    window.__YOUTUBE_PIP_INJECT_LOADED__ = true;

    // --- UI Listeners and state handled by PiPFloatingButton manager ---
    let currentLiked = false;
    let currentIsLive = false;
    // --- PiP State Listeners (Shared) ---
    if (window.PiPUtils && window.PiPUtils.trackPiPState) {
        window.PiPUtils.trackPiPState({
            onEnter: (video) => {
                // Clear trigger flag after activation
                setTimeout(() => { if (window.__pipExt) window.__pipExt.isTriggered = false; }, 500);
            },
            metadataCollector: (video) => {
                return {
                    platform: 'youtube',
                    isShorts: window.location.href.includes('/shorts/'),
                    supportsNavigation: window.location.href.includes('/shorts/'),
                    pipMode: (window.__pipExt && window.__pipExt.isSelector) ? 'manual' : 'main',
                    isExtensionTriggered: !!(window.__pipExt && window.__pipExt.isTriggered),
                    isLive: currentIsLive,
                    liked: currentLiked
                };
            }
        });

        // Initial state sync handled globally by PiPFloatingButton manager
    }

    let _ignoreNextPopstate = false;
    // Exit PiP on browser back/forward navigation
    window.addEventListener('popstate', () => {
        if (_ignoreNextPopstate) {
            _ignoreNextPopstate = false;
            return;
        }
        if (document.pictureInPictureElement) {
            document.dispatchEvent(new CustomEvent('YouTube_Control_Event', { detail: { action: 'EXIT_PIP' } }));
        }
    });

    // --- Bridge Injection ---
    function injectBridge() {
        if (window.__YOUTUBE_BRIDGE_INJECTED__) return;
        window.__YOUTUBE_BRIDGE_INJECTED__ = true;

        if (window.PiPUtils && window.PiPUtils.injectBridge) {
            window.PiPUtils.injectBridge('platforms/youtube/youtube-api-bridge.js');
        }
    }

    injectBridge();

    // --- Bridge Communication ---
    document.addEventListener('YouTube_State_Update', (e) => {
        const { liked, playing, volume, muted, isLive } = e.detail || {};

        if (typeof liked === 'boolean') currentLiked = liked;
        if (typeof isLive === 'boolean') currentIsLive = isLive;

        if (window.PiPUtils?.safeSendMessage) {
            const send = (type, payload) => window.PiPUtils.safeSendMessage({ type, ...payload });

            if (typeof liked === 'boolean') send('UPDATE_LIKE_STATE', { liked });
            if (typeof playing === 'boolean') send('UPDATE_PLAYBACK_STATE', { playing });
            if (typeof volume === 'number' || typeof muted === 'boolean') {
                send('UPDATE_VOLUME_STATE', { volume, muted });
            }
        }
    });

    // --- Core Functionality ---
    function togglePiP() {
        if (window.PiPFloatingButton?.isActive?.()) {
            // PiP is active (may be in another tab) — route exit via background
            try { chrome.runtime.sendMessage({ type: 'EXIT_PIP' }); } catch (_) { }
            return;
        }
        window.__pipExt = window.__pipExt || { isSelector: false, isTriggered: false };
        window.__pipExt.isTriggered = true;
        document.dispatchEvent(new CustomEvent('YouTube_Control_Event', { detail: { action: 'REQUEST_PIP' } }));
    }

    // --- PiP Button & Selector Ball (via universal manager) ---
    window.PiPFloatingButton?.init({
        id: 'youtubePipBtn',
        text: '',
        storageKey: 'pipBtnPos_Youtube',
        style: { background: 'linear-gradient(45deg, #FF0000, #000000)' },
        onClick: togglePiP
    });

    // --- Listen for Commands from Panel (Global) -> Relay ---
    if (window.PiPUtils && window.PiPUtils.setupMessageRelay) {
        window.PiPUtils.setupMessageRelay('YouTube_Control_Event', {
            'CHANGE_VOLUME': (msg) => ({ action: 'SET_VOLUME', value: msg.volume }),
            'TOGGLE_MUTE_VIDEO': (msg) => ({ action: msg.muted ? 'MUTE' : 'UNMUTE' }),
            'SEEK_VIDEO': (msg) => ({ action: 'SEEK', value: msg.offset }),
            'LIKE_VIDEO': () => ({ action: 'TOGGLE_LIKE' }),
            'NAVIGATE_VIDEO': (msg) => {
                _ignoreNextPopstate = true;
                setTimeout(() => { _ignoreNextPopstate = false; }, 1000);
                return { action: 'NAVIGATE_VIDEO', direction: msg.direction };
            },
            'TOGGLE_PLAY': () => ({ action: 'TOGGLE_PLAY' }),
            'EXIT_PIP': () => ({ action: 'EXIT_PIP' }),
            'FOCUS_PIP': () => ({ action: 'FOCUS_PIP' }),
            'PAUSE_VIDEO': () => ({ action: 'PAUSE' }),
            'HIDE_VOLUME_PANEL': () => { /* icon update handled globally */ }
        });
    }

})();