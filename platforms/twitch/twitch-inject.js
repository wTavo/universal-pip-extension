(function () {
    'use strict';

    if (window.__TWITCH_PIP_INJECT_LOADED__) return;
    window.__TWITCH_PIP_INJECT_LOADED__ = true;

    // --- UI Listeners and state handled by PiPFloatingButton manager ---

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
                const isLive = video.duration === Infinity || !Number.isFinite(video.duration);

                return {
                    platform: 'twitch',
                    isShorts: false, // Twitch doesn't have Shorts natively handled in this player context
                    supportsNavigation: false,
                    pipMode: (window.__pipExt && window.__pipExt.isSelector) ? 'manual' : 'main',
                    isExtensionTriggered: !!(window.__pipExt && window.__pipExt.isTriggered),
                    isLive: isLive
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
            document.dispatchEvent(new CustomEvent('Twitch_Control_Event', { detail: { action: 'EXIT_PIP' } }));
        }
    });

    // --- Bridge Injection ---
    function injectBridge() {
        if (window.__TWITCH_BRIDGE_INJECTED__) return;
        window.__TWITCH_BRIDGE_INJECTED__ = true;

        if (window.PiPUtils && window.PiPUtils.injectBridge) {
            window.PiPUtils.injectBridge('platforms/twitch/twitch-api-bridge.js');
        }
    }

    injectBridge();

    // --- Bridge Communication ---
    document.addEventListener('Twitch_State_Update', (e) => {
        const { playing, volume, muted } = e.detail || {};

        if (window.PiPUtils && window.PiPUtils.safeSendMessage) {
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
        if (window.PiPFloatingButton?.isActive?.()) {
            // PiP is active (may be in another tab) — route exit via background
            try { chrome.runtime.sendMessage({ type: 'EXIT_PIP' }); } catch (_) { }
            return;
        }
        window.__pipExt = window.__pipExt || { isSelector: false, isTriggered: false };
        window.__pipExt.isTriggered = true;
        document.dispatchEvent(new CustomEvent('Twitch_Control_Event', { detail: { action: 'REQUEST_PIP' } }));
    }

    // --- PiP Button & Selector Ball (via universal manager) ---
    window.PiPFloatingButton?.init({
        id: 'twitchPipBtn',
        text: '',
        storageKey: 'pipBtnPos_Twitch',
        style: {
            background: 'linear-gradient(135deg, #9146FF 0%, #772CE8 100%)',
            zIndex: '2147483647'
        },
        onClick: togglePiP
    });

    // --- Listen for Commands from Panel (Global) -> Relay ---
    if (window.PiPUtils && window.PiPUtils.setupMessageRelay) {
        window.PiPUtils.setupMessageRelay('Twitch_Control_Event', {
            'CHANGE_VOLUME': (msg) => ({ action: 'SET_VOLUME', value: msg.volume }),
            'TOGGLE_MUTE_VIDEO': (msg) => ({ action: msg.muted ? 'MUTE' : 'UNMUTE' }),
            'SEEK_VIDEO': (msg) => ({ action: 'SEEK', value: msg.offset }),
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
