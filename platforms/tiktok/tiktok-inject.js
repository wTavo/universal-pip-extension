(function () {
    'use strict';

    if (window.__TIKTOK_PIP_INJECT_LOADED__) return;
    window.__TIKTOK_PIP_INJECT_LOADED__ = true;

    // --- UI Listeners and state handled by PiPFloatingButton manager ---
    let currentLiked = false;
    let currentFavorited = false;
    let currentIsLive = false;
    let currentHasFavorite = true;
    let currentIsNavigating = false;

    const TIKTOK_ITEM_SELECTOR = 'section[id^="media-card-"], [data-e2e="recommend-list-item-container"], [class*="ItemContainer"], article';
    const TIKTOK_LIVE_SELECTOR = '[data-e2e="live-title"], .live-stream-title';
    const TIKTOK_AD_SELECTOR = '[data-e2e="ad-tag"], [aria-label*="Sponsored"], [aria-label*="Publicidad"], [aria-label*="Patrocinado"]';
    const TIKTOK_AD_TEXT_RE = /\b(Sponsored|Promoted|Publicidad|Anuncio|Patrocinado)\b/i;
    const TIKTOK_LIVE_ROUTE_RE = /(^|\/)live(\/|$)/i;

    function detectLiveInInject(video) {
        if (!video) return false;
        if (video.duration === Infinity || !Number.isFinite(video.duration)) return true;
        if (TIKTOK_LIVE_ROUTE_RE.test(window.location.pathname)) return true;
        const item = video.closest?.(TIKTOK_ITEM_SELECTOR);
        const root = item || document;
        return !!root.querySelector(TIKTOK_LIVE_SELECTOR);
    }

    function detectAdInInject(video) {
        if (!video) return false;
        const item = video.closest?.(TIKTOK_ITEM_SELECTOR);
        const root = item || document;
        if (root.querySelector(TIKTOK_AD_SELECTOR)) return true;
        const text = (root.innerText || root.textContent || '').trim();
        return TIKTOK_AD_TEXT_RE.test(text);
    }

    function detectRestrictedInInject(video) {
        return detectLiveInInject(video) || detectAdInInject(video);
    }

    function syncLiveStateFromVideo(video) {
        const targetVideo = video || document.pictureInPictureElement;
        if (!targetVideo) return;

        const isRestricted = detectRestrictedInInject(targetVideo);
        const isAd = detectAdInInject(targetVideo);
        currentIsLive = isRestricted;
        currentHasFavorite = !isRestricted;
        currentIsNavigating = false;

        window.PiPUtils?.safeSendMessage?.({
            type: 'UPDATE_TIKTOK_LIVE_STATE',
            isTikTokLive: isRestricted,
            hasFavorite: !isRestricted,
            isTikTokNavigating: false
        });
        // Also send ad state so the panel can show/hide the ad indicator
        window.PiPUtils?.safeSendMessage?.({ type: 'UPDATE_AD_STATE', isAd });
    }

    // --- PiP State Listeners (Shared) ---
    if (window.PiPUtils && window.PiPUtils.trackPiPState) {
        window.PiPUtils.trackPiPState({
            onEnter: (video) => {
                // Persistent across swaps (cleared on actual exit below)
                syncLiveStateFromVideo(video);
                [150, 500, 1200].forEach(delay => {
                    setTimeout(() => syncLiveStateFromVideo(document.pictureInPictureElement || video), delay);
                });
            },
            onExit: () => {
                if (window.__pipExt) window.__pipExt.isTriggered = false;
            },
            controlEventName: 'TikTok_Control_Event',
            metadataCollector: (video) => {
                const directIsRestricted = detectRestrictedInInject(video);
                return {
                    platform: 'tiktok',
                    supportsNavigation: true,
                    pipMode: (window.__pipExt && window.__pipExt.isSelector) ? 'manual' : 'main',
                    isExtensionTriggered: !!(window.__pipExt && window.__pipExt.isTriggered),
                    isLive: directIsRestricted,
                    isTikTokNavigating: currentIsNavigating,
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
    let _lastIsNavigating = null;
    let _lastIsAd = null;

    document.addEventListener('TikTok_State_Update', (e) => {
        const { liked, favorited, playing, isTikTokLive, hasFavorite, isTikTokNavigating, isAd } = e.detail || {};

        if (typeof liked === 'boolean') currentLiked = liked;
        if (typeof favorited === 'boolean') currentFavorited = favorited;
        if (typeof isTikTokLive === 'boolean') currentIsLive = isTikTokLive;
        if (typeof hasFavorite === 'boolean') currentHasFavorite = hasFavorite;
        if (typeof isTikTokNavigating === 'boolean') currentIsNavigating = isTikTokNavigating;

        if (window.PiPUtils?.safeSendMessage) {
            const send = (type, payload) => window.PiPUtils.safeSendMessage({ type, ...payload });

            if (typeof liked === 'boolean') send('UPDATE_LIKE_STATE', { liked });
            if (typeof favorited === 'boolean') send('UPDATE_FAVORITE_STATE', { favorited });
            if (typeof playing === 'boolean') send('UPDATE_PLAYBACK_STATE', { playing });

            if (currentIsLive !== _lastTikTokLive || currentHasFavorite !== _lastHasFavorite || currentIsNavigating !== _lastIsNavigating) {
                _lastTikTokLive = currentIsLive;
                _lastHasFavorite = currentHasFavorite;
                _lastIsNavigating = currentIsNavigating;
                send('UPDATE_TIKTOK_LIVE_STATE', { isTikTokLive: currentIsLive, hasFavorite: currentHasFavorite, isTikTokNavigating: currentIsNavigating });
            }
            // Propagate ad state separately so the panel can show/hide the ad indicator button
            if (typeof isAd === 'boolean' && isAd !== _lastIsAd) {
                _lastIsAd = isAd;
                send('UPDATE_AD_STATE', { isAd });
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
