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
                // Persistent across swaps (cleared on actual exit below)
            },
            onExit: () => {
                if (window.__pipExt) window.__pipExt.isTriggered = false;
            },
            controlEventName: 'YouTube_Control_Event',
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
    const togglePiP = window.PiPUtils.createTogglePiP('YouTube_Control_Event');

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
            'NAVIGATE_VIDEO': window.PiPUtils.createNavigateRelay(),
            'TOGGLE_PLAY': () => ({ action: 'TOGGLE_PLAY' }),
            'EXIT_PIP': () => ({ action: 'EXIT_PIP' }),
            'FOCUS_PIP': () => ({ action: 'FOCUS_PIP' }),
            'PAUSE_VIDEO': () => ({ action: 'PAUSE' }),
            'HIDE_VOLUME_PANEL': () => { /* icon update handled globally */ }
        });
    }

})();