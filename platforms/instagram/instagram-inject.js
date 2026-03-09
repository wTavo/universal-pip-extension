(function () {
    'use strict';

    if (window.__INSTAGRAM_PIP_INJECT_LOADED__) return;
    window.__INSTAGRAM_PIP_INJECT_LOADED__ = true;

    let currentLiked = false;
    let currentFavorited = false;

    // --- PiP State Listeners (Shared) ---
    if (window.PiPUtils && window.PiPUtils.trackPiPState) {
        window.PiPUtils.trackPiPState({
            onEnter: (video) => {
                const pipBtn = document.getElementById("instagramPipBtn");
                if (pipBtn) pipBtn.innerHTML = window.PiPFloatingButton.getActiveIcon();
                // Clear trigger flag after activation
                setTimeout(() => { if (window.__pipExt) window.__pipExt.isTriggered = false; }, 500);
            },
            onExit: (video) => {
                const pipBtn = document.getElementById("instagramPipBtn");
                if (pipBtn) pipBtn.innerHTML = window.PiPFloatingButton.getInactiveIcon();
            },
            metadataCollector: (video) => {
                const isLive = window.location.pathname.includes('/live/');

                return {
                    platform: 'instagram',
                    // Detect if PiP was triggered by the selector ball (pip-selector-logic.js sets this flag)
                    pipMode: (window.__pipExt && window.__pipExt.isSelector) ? 'manual' : 'main',
                    isExtensionTriggered: !!(window.__pipExt && window.__pipExt.isTriggered),
                    isLive: isLive,
                    liked: currentLiked,
                    favorited: currentFavorited
                };
            }
        });
    }

    let _ignoreNextPopstate = false;
    // Exit PiP on browser back/forward navigation
    window.addEventListener('popstate', () => {
        if (_ignoreNextPopstate) {
            _ignoreNextPopstate = false;
            return;
        }
        if (document.pictureInPictureElement) {
            document.dispatchEvent(new CustomEvent('Instagram_Control_Event', { detail: { action: 'EXIT_PIP' } }));
        }
    });

    // --- PiP Button & Selector Ball (via universal manager) ---
    window.PiPFloatingButton?.init({
        id: 'instagramPipBtn',
        text: '',
        storageKey: 'pipBtnPos_Instagram',
        style: {
            background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
            zIndex: '2147483647'
        },
        onClick: togglePiP
    });

    // --- Bridge Injection (Shared) ---
    function injectBridge() {
        if (window.__INSTAGRAM_BRIDGE_INJECTED__) return;
        window.__INSTAGRAM_BRIDGE_INJECTED__ = true;

        if (window.PiPUtils && window.PiPUtils.injectBridge) {
            window.PiPUtils.injectBridge('platforms/instagram/instagram-api-bridge.js');
        }
    }

    injectBridge();

    // --- Bridge Communication ---
    document.addEventListener('Instagram_State_Update', (e) => {
        const { liked, favorited, playing } = e.detail || {};

        if (typeof liked === 'boolean') currentLiked = liked;
        if (typeof favorited === 'boolean') currentFavorited = favorited;

        if (window.PiPUtils && window.PiPUtils.safeSendMessage) {
            if (typeof liked === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_LIKE_STATE', liked });
            }
            if (typeof favorited === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_FAVORITE_STATE', favorited });
            }
            if (typeof playing === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_PLAYBACK_STATE', playing });
            }
        }
    });

    // --- Core Functionality Updated ---
    function togglePiP() {
        window.__pipExt = window.__pipExt || { isSelector: false, isTriggered: false };
        window.__pipExt.isTriggered = true;
        document.dispatchEvent(new CustomEvent('Instagram_Control_Event', { detail: { action: 'REQUEST_PIP' } }));
    }

    // Listen for Commands from Panel (Global) -> Relay
    if (window.PiPUtils && window.PiPUtils.setupMessageRelay) {
        window.PiPUtils.setupMessageRelay('Instagram_Control_Event', {
            'CHANGE_VOLUME': (msg) => ({ action: 'SET_VOLUME', value: msg.volume }),
            'TOGGLE_MUTE_VIDEO': (msg) => ({ action: msg.muted ? 'MUTE' : 'UNMUTE' }),
            'SEEK_VIDEO': (msg) => ({ action: 'SEEK', value: msg.offset }),
            'LIKE_VIDEO': () => ({ action: 'TOGGLE_LIKE' }),
            'FAVORITE_VIDEO': () => ({ action: 'TOGGLE_FAVORITE' }),
            'NAVIGATE_VIDEO': (msg) => {
                _ignoreNextPopstate = true;
                setTimeout(() => { _ignoreNextPopstate = false; }, 1000);
                return { action: 'NAVIGATE_VIDEO', direction: msg.direction };
            },
            'TOGGLE_PLAY': () => ({ action: 'TOGGLE_PLAY' }),
            'EXIT_PIP': () => ({ action: 'EXIT_PIP' }),
            'FOCUS_PIP': () => ({ action: 'FOCUS_PIP' })
        });
    }


})();
