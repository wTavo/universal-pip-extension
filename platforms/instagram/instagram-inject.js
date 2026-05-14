(function () {
    'use strict';

    if (window.__INSTAGRAM_PIP_INJECT_LOADED__) return;
    window.__INSTAGRAM_PIP_INJECT_LOADED__ = true;

    let currentLiked = false;
    let currentFavorited = false;
    let currentSupportsNavigation = false;

    // --- PiP State Listeners (Shared) ---
    if (window.PiPUtils && window.PiPUtils.trackPiPState) {
        window.PiPUtils.trackPiPState({
            onEnter: (video) => {
                // Persistent across swaps (cleared on actual exit below)
            },
            onExit: (video) => {
                if (window.__pipExt) window.__pipExt.isTriggered = false;
            },
            controlEventName: 'Instagram_Control_Event',
            metadataCollector: (video) => {
                const isLive = window.location.pathname.includes('/live/');

                return {
                    platform: 'instagram',
                    supportsNavigation: currentSupportsNavigation,
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


    // --- Core Functionality Updated ---
    const togglePiP = window.PiPUtils.createTogglePiP('Instagram_Control_Event');

    // Listen for Commands from Panel (Global) -> Relay
    if (window.PiPUtils && window.PiPUtils.setupMessageRelay) {
        window.PiPUtils.setupMessageRelay('Instagram_Control_Event', {
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
        let { liked, favorited, playing, volume, muted, supportsNavigation, isAd } = e.detail || {};
        const recentPipNavigation = Date.now() - (window.PiPUtils?._lastPipNavigationAt || 0) < 3500;
        if (recentPipNavigation && currentSupportsNavigation && supportsNavigation === false) {
            supportsNavigation = undefined;
        }
        if (recentPipNavigation && isAd === true) {
            isAd = undefined;
        }

        if (typeof liked === 'boolean') currentLiked = liked;
        if (typeof favorited === 'boolean') currentFavorited = favorited;
        if (typeof supportsNavigation === 'boolean') currentSupportsNavigation = supportsNavigation;

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
            if (typeof supportsNavigation === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_NAV_SUPPORT_STATE', supportsNavigation });
            }
            if (typeof volume === 'number' || typeof muted === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_VOLUME_STATE', volume, muted });
            }
            if (typeof isAd === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_AD_STATE', isAd });
            }
        }
    });
})();
