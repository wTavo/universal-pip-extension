(function () {
    'use strict';

    if (window.__TIKTOK_PIP_INJECT_LOADED__) return;
    window.__TIKTOK_PIP_INJECT_LOADED__ = true;

    // --- UI Listeners and state handled by PiPFloatingButton manager ---

    // --- PiP State Listeners (Shared) ---
    if (window.PiPUtils && window.PiPUtils.trackPiPState) {
        window.PiPUtils.trackPiPState({
            onEnter: () => {
                // Clear trigger flag after activation
                setTimeout(() => { if (window.__pipExt) window.__pipExt.isTriggered = false; }, 500);
            },
            onExit: () => {
                // Handled globally
            },
            metadataCollector: (video) => {
                const urlIsLive = window.location.pathname.includes('/live/') ||
                    (window.location.pathname.includes('@') && window.location.pathname.includes('/live'));
                const hasLiveTitle = !!document.querySelector('[data-e2e="live-title"]') || !!document.querySelector('.live-stream-title');
                const videoIsLive = video.duration === Infinity || !Number.isFinite(video.duration);
                const isLive = urlIsLive || hasLiveTitle || videoIsLive;

                return {
                    platform: 'tiktok',
                    supportsNavigation: !isLive,
                    pipMode: (window.__pipExt && window.__pipExt.isSelector) ? 'manual' : 'main',
                    isExtensionTriggered: !!(window.__pipExt && window.__pipExt.isTriggered),
                    isLive: isLive,
                    liked: currentLiked,
                    favorited: currentFavorited
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
            document.dispatchEvent(new CustomEvent('TikTok_Control_Event', { detail: { action: 'EXIT_PIP' } }));
        }
    });

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
    document.addEventListener('TikTok_State_Update', (e) => {
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

    // --- Core Functionality ---
    function togglePiP() {
        if (window.PiPFloatingButton?.isActive?.()) {
            // PiP is active (may be in another tab) — route exit via background
            try { chrome.runtime.sendMessage({ type: 'EXIT_PIP' }); } catch (_) { }
            return;
        }
        window.__pipExt = window.__pipExt || { isSelector: false, isTriggered: false };
        window.__pipExt.isTriggered = true;
        document.dispatchEvent(new CustomEvent('TikTok_Control_Event', { detail: { action: 'REQUEST_PIP' } }));
    }

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