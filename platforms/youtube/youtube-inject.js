(function () {
    'use strict';

    if (window.__YOUTUBE_PIP_INJECT_LOADED__) return;
    window.__YOUTUBE_PIP_INJECT_LOADED__ = true;

    let currentLiked = false;
    let _pipActive = false; // tracks global PiP state (cross-tab)

    // --- Helper: update floating button icon ---
    function updatePipBtn(htmlContent) {
        const btn = document.getElementById("youtubePipBtn");
        if (btn) btn.innerHTML = htmlContent;
    }

    function setActive() { _pipActive = true; updatePipBtn(window.PiPFloatingButton.getActiveIcon()); }
    function setInactive() { _pipActive = false; updatePipBtn(window.PiPFloatingButton.getInactiveIcon()); }

    // --- PiP State Listeners (Shared) ---
    if (window.PiPUtils && window.PiPUtils.trackPiPState) {
        window.PiPUtils.trackPiPState({
            onEnter: (video) => {
                setActive();
                // Clear trigger flag after activation
                setTimeout(() => { if (window.__pipExt) window.__pipExt.isTriggered = false; }, 500);
            },
            onExit: () => {
                setInactive();
            },
            metadataCollector: (video) => {
                const isLive = video.duration === Infinity || !Number.isFinite(video.duration) ||
                    !!document.querySelector('.ytp-live') ||
                    !!document.querySelector('[data-layer="badge-label"]') ||
                    window.location.href.includes('/live');

                return {
                    platform: 'youtube',
                    isShorts: window.location.href.includes('/shorts/'),
                    pipMode: (window.__pipExt && window.__pipExt.isSelector) ? 'manual' : 'main',
                    isExtensionTriggered: !!(window.__pipExt && window.__pipExt.isTriggered),
                    isLive: isLive,
                    liked: currentLiked
                };
            }
        });

        // Request initial state to sync button icon if PiP is already active globally
        window.PiPUtils.safeSendMessage({ type: 'GET_PIP_STATE' }, (res) => {
            if (res && res.state && res.state.active) {
                setActive();
            }
        });
    }

    // Exit PiP on browser back/forward navigation
    window.addEventListener('popstate', () => {
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
        const { liked, playing, volume, muted } = e.detail || {};

        if (typeof liked === 'boolean') currentLiked = liked;

        if (window.PiPUtils && window.PiPUtils.safeSendMessage) {
            if (typeof liked === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_LIKE_STATE', liked });
            }
            if (typeof playing === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_PLAYBACK_STATE', playing });
            }
            if (typeof volume === 'number' || typeof muted === 'boolean') {
                window.PiPUtils.safeSendMessage({ type: 'UPDATE_VOLUME_STATE', volume, muted });
            }
        }
    });

    // --- Core Functionality ---
    function togglePiP() {
        if (_pipActive) {
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
            'NAVIGATE_VIDEO': (msg) => ({ action: 'NAVIGATE_VIDEO', direction: msg.direction }),
            'TOGGLE_PLAY': () => ({ action: 'TOGGLE_PLAY' }),
            'EXIT_PIP': () => ({ action: 'EXIT_PIP' }),
            'FOCUS_PIP': () => ({ action: 'FOCUS_PIP' }),
            'PAUSE_VIDEO': () => ({ action: 'PAUSE' }),
            'PIP_ACTIVATED': () => { setActive(); },
            'PIP_SESSION_STARTED': () => { setActive(); },
            'HIDE_VOLUME_PANEL': () => { setInactive(); }
        });
    }

})();