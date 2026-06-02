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
            window.PiPUtils.injectBridge([
                'platforms/youtube/youtube-document-pip-ui.js',
                'platforms/youtube/youtube-api-bridge.js'
            ]);
        }
    }

    injectBridge();

    // --- Bridge Communication ---
    let _lastIsShorts = null;
    let _lastSupportsNavigation = null;

    document.addEventListener('YouTube_State_Update', (e) => {
        const { liked, playing, volume, muted, isLive, isAd, canSkipAd, isShorts, supportsNavigation } = e.detail || {};

        if (typeof liked === 'boolean') currentLiked = liked;
        if (typeof isLive === 'boolean') currentIsLive = isLive;

        if (window.PiPUtils?.safeSendMessage) {
            const send = (type, payload) => window.PiPUtils.safeSendMessage({ type, ...payload });

            if (typeof liked === 'boolean') send('UPDATE_LIKE_STATE', { liked });
            if (typeof playing === 'boolean') send('UPDATE_PLAYBACK_STATE', { playing });
            if (typeof isAd === 'boolean' || typeof canSkipAd === 'boolean') {
                const adPayload = {};
                if (typeof isAd === 'boolean') adPayload.isAd = isAd;
                if (typeof canSkipAd === 'boolean') adPayload.canSkipAd = canSkipAd;
                send('UPDATE_AD_STATE', adPayload);
            }
            if (typeof isShorts === 'boolean' || typeof supportsNavigation === 'boolean') {
                if (isShorts !== _lastIsShorts || supportsNavigation !== _lastSupportsNavigation) {
                    _lastIsShorts = isShorts;
                    _lastSupportsNavigation = supportsNavigation;
                    send('UPDATE_NAV_SUPPORT_STATE', { isShorts, supportsNavigation });
                }
            }
            if (typeof volume === 'number' || typeof muted === 'boolean') {
                send('UPDATE_VOLUME_STATE', { volume, muted });
            }
        }
    });

    // --- Core Functionality ---
    const { MSG } = window.PIP_CONSTANTS;
    const normalizeMode = (mode) => window.PiPModeUtils?.normalizePipWindowMode
        ? window.PiPModeUtils.normalizePipWindowMode(mode)
        : (mode === 'document' ? 'document' : 'native');
    let preferredPipWindowMode = 'native';

    chrome.storage.local.get(['pipWindowMode', 'pipState'], (result) => {
        preferredPipWindowMode = normalizeMode(result.pipWindowMode || result.pipState?.pipWindowMode);
    });

    const documentPip = {
        active: false,
        metadata: null
    };

    window.PiPUtils._documentPipIsActive = () => !!documentPip.active;
    Object.defineProperty(window.PiPUtils, '_documentPipVideo', {
        configurable: true,
        get: () => null
    });
    Object.defineProperty(window.PiPUtils, '_documentPipMetadata', {
        configurable: true,
        get: () => documentPip.metadata
    });

    function getActiveYouTubeVideo() {
        const nativePip = document.pictureInPictureElement;
        if (nativePip instanceof HTMLVideoElement) return nativePip;

        const videos = Array.from(document.querySelectorAll('video'));
        return videos
            .filter(video => video.readyState > 0)
            .sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return (br.width * br.height) - (ar.width * ar.height);
            })[0] || videos[0] || null;
    }

    function collectDocumentPipMetadata(video) {
        return {
            platform: 'youtube',
            isShorts: window.location.href.includes('/shorts/'),
            supportsNavigation: window.location.href.includes('/shorts/'),
            pipMode: 'document',
            pipWindowMode: 'document',
            isExtensionTriggered: true,
            isLive: currentIsLive,
            liked: currentLiked,
            volume: Math.round((video?.volume ?? 1) * 100),
            muted: !!video?.muted,
            playing: video ? !video.paused : false
        };
    }

    function sendControl(type, payload = {}) {
        window.PiPUtils.safeSendMessage({ type, ...payload });
    }

    async function openDocumentPip() {
        document.dispatchEvent(new CustomEvent('YouTube_Control_Event', { detail: { action: 'REQUEST_DOCUMENT_PIP' } }));
        return true;
    }

    async function switchPipWindowMode(mode) {
        const nextMode = normalizeMode(mode);

        if (document.pictureInPictureElement) {
            try { await document.exitPictureInPicture(); } catch (e) { }
        }

        setTimeout(() => {
            window.__pipExt = window.__pipExt || { isSelector: false, isTriggered: false };
            window.__pipExt.isTriggered = true;
            if (nextMode === 'document') {
                openDocumentPip();
            } else {
                document.dispatchEvent(new CustomEvent('YouTube_Control_Event', { detail: { action: 'CLOSE_DOCUMENT_PIP' } }));
                setTimeout(() => {
                    document.dispatchEvent(new CustomEvent('YouTube_Control_Event', { detail: { action: 'REQUEST_PIP', mode: 'native' } }));
                }, 80);
            }
        }, 160);
    }

    function togglePiP() {
        if (window.PiPFloatingButton?.isActive?.() || documentPip.active) {
            sendControl(MSG.EXIT_PIP);
            return;
        }
        window.__pipExt = window.__pipExt || { isSelector: false, isTriggered: false };
        window.__pipExt.isTriggered = true;
        if (preferredPipWindowMode === 'document') {
            openDocumentPip();
        } else {
            document.dispatchEvent(new CustomEvent('YouTube_Control_Event', { detail: { action: 'REQUEST_PIP', mode: 'native' } }));
        }
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
            'NAVIGATE_VIDEO': window.PiPUtils.createNavigateRelay(),
            'TOGGLE_PLAY': () => ({ action: 'TOGGLE_PLAY' }),
            'EXIT_PIP': () => ({ action: 'EXIT_PIP' }),
            'SKIP_AD': () => ({ action: 'SKIP_AD' }),
            'FOCUS_PIP': () => ({ action: 'FOCUS_PIP' }),
            'PAUSE_VIDEO': () => ({ action: 'PAUSE' }),
            'SWITCH_PIP_WINDOW_MODE': (msg) => {
                preferredPipWindowMode = normalizeMode(msg.mode);
                switchPipWindowMode(msg.mode);
                return null;
            },
            'SYNC_PIP_WINDOW_MODE': (msg) => {
                preferredPipWindowMode = normalizeMode(msg.mode);
                return null;
            },
            'HIDE_VOLUME_PANEL': () => { /* icon update handled globally */ }
        });
    }

    document.addEventListener('YouTube_State_Update', (e) => {
        if (e.detail?.documentPipActive !== undefined) {
            documentPip.active = !!e.detail.documentPipActive;
            documentPip.metadata = e.detail.metadata || documentPip.metadata;
            if (documentPip.active) {
                window.PiPUtils.safeSendMessage({
                    type: MSG.PIP_ACTIVATED,
                    ...(documentPip.metadata || collectDocumentPipMetadata(getActiveYouTubeVideo()))
                });
            } else {
                documentPip.metadata = null;
                window.PiPUtils.notifyPipClosed({ force: true });
            }
        }
    });

})();
