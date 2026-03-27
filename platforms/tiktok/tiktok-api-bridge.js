(() => {
    if (window.__TIKTOK_PIP_BRIDGE_LOADED__) return;
    window.__TIKTOK_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[TikTok Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, getClosestCandidate, enableAutoSwitching, enableAntiPause, normalizeToButton, handleRequestPip, handleFocusPip, handleMuteUnmute, handleSetVolume, detectIsLive, createMonitorState } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const VIDEO_STATE_EVENTS = ['play', 'playing', 'pause', 'volumechange'];

    const SELECTORS = {
        ITEM: 'section[id^="media-card-"], [data-e2e="recommend-list-item-container"], [class*="ItemContainer"], article',
        SIDEBAR: '[class*="ActionBarContainer"]',
        LIKE_ICON: '[data-e2e="like-icon"], [data-e2e="browse-like-icon"]',
        FAV_ICON: '[data-e2e="undefined-icon"], [data-e2e="collect-icon"], [data-e2e="browse-collect-icon"], [data-e2e="favorite-icon"]',
        AD_TAG: '[data-e2e="ad-tag"]',
        LIVE_TITLE: '[data-e2e="live-title"], .live-stream-title',
        MUTE_BTN: '[data-e2e="video-mute"], button.TUXButton--secondary:has(svg)'
    };

    // -------- HELPERS --------

    function getTikTokItem(video) {
        if (!video) return null;
        return video.closest(SELECTORS.ITEM);
    }

    function getTikTokSidebar(video) {
        const item = getTikTokItem(video);
        if (!item) return null;
        // In some layouts, the sidebar is a sibling, in others it's a child.
        return item.querySelector(SELECTORS.SIDEBAR) || 
               (item.parentElement ? item.parentElement.querySelector(SELECTORS.SIDEBAR) : null);
    }

    // -------- BUTTON FINDERS --------

    let lastLikeVideo = null;
    let lastFavVideo = null;
    let cachedLikeBtn = null;
    let cachedFavBtn = null;

    // normalizeToButton is now imported from BridgeUtils

    function findLikeButton(video) {
        const sidebar = getTikTokSidebar(video);
        if (sidebar) {
            const icon = sidebar.querySelector(SELECTORS.LIKE_ICON);
            if (icon) return normalizeToButton(icon);
        }
        
        const root = getTikTokItem(video) || document;
        const icons = root.querySelectorAll(`${SELECTORS.LIKE_ICON}:not([data-pip-managed])`);
        if (icons.length) {
            const buttons = Array.from(icons).map(el => el.closest('button')).filter(Boolean);
            return normalizeToButton(getClosestCandidate(video, buttons));
        }

        return null;
    }

    function findFavoriteButton(video) {
        const sidebar = getTikTokSidebar(video);
        if (sidebar) {
            const icon = sidebar.querySelector(SELECTORS.FAV_ICON);
            if (icon) return normalizeToButton(icon);
        }

        const root = getTikTokItem(video) || document;
        const icons = root.querySelectorAll(`${SELECTORS.FAV_ICON}:not([data-pip-managed])`);
        if (icons.length) {
            const buttons = Array.from(icons).map(el => el.closest('button')).filter(Boolean);
            return normalizeToButton(getClosestCandidate(video, buttons));
        }

        return null;
    }

    function getLikeButton(video) {
        if (!video) return null;
        if (video === lastLikeVideo && cachedLikeBtn?.isConnected) return cachedLikeBtn;
        cachedLikeBtn = findLikeButton(video);
        lastLikeVideo = video;
        return cachedLikeBtn;
    }

    function getFavoriteButton(video) {
        if (!video) return null;
        if (video === lastFavVideo && cachedFavBtn?.isConnected) return cachedFavBtn;
        cachedFavBtn = findFavoriteButton(video);
        lastFavVideo = video;
        return cachedFavBtn;
    }

    // -------- STATE DETECTION HELPERS --------

    function isTikTokFavoriteColor(color) {
        if (!color) return false;
        const c = color.toUpperCase().trim();
        return (c === '#FACE15' || c === 'FACE15' || c === '#FFD700' ||
            c.includes('FACE15') || c.includes('FFD700') || c.includes('RGB(250, 206, 21)'));
    }

    function getLikeStatus(video) {
        const btn = getLikeButton(video);
        if (!btn) return false;

        const pressed = btn.getAttribute('aria-pressed');
        if (pressed === 'true') return true;
        
        // Red color fallback for Like from user HTML: #FE2C55
        // (Not strictly necessary if aria-pressed is updated, but good for robust detection)
        const path = btn.querySelector('path[fill="#FE2C55"], path[fill="#fe2c55"]');
        if (path) return true;

        return false;
    }

    function getFavoriteStatus(video) {
        const btn = getFavoriteButton(video);
        if (!btn) return false;

        const paths = btn.querySelectorAll('svg path');
        if (!paths.length) return false;

        for (const p of paths) {
            const fillAttr = (p.getAttribute('fill') || '').toUpperCase();
            const styleFill = (p.style?.fill || '').toUpperCase();

            if (
                isTikTokFavoriteColor(fillAttr) ||
                isTikTokFavoriteColor(styleFill)
            ) {
                return true;
            }
        }

        return false;
    }

    // -------- LIVE / AD DETECTION --------

    function detectIsLiveLocal(video) {
        return detectIsLive(video, [SELECTORS.LIVE_TITLE, '.live-stream-title']);
    }

    function detectIsAd(video) {
        const item = getTikTokItem(video);
        return item ? !!item.querySelector(SELECTORS.AD_TAG) : false;
    }

    // -------- STATE --------

    const monitorState = createMonitorState({
        platform: 'tiktok',
        getLikeStatus: getLikeStatus,
        getFavoriteStatus: getFavoriteStatus,
        detectIsLive: detectIsLiveLocal,
        onStateChange: (state) => {
            const video = document.pictureInPictureElement || getActiveVideo();
            const isAd = detectIsAd(video);
            state.isTikTokLive = state.isLive;
            state.hasFavorite = (state.isTikTokLive || isAd) ? false : !!getFavoriteButton(video);
            
            document.dispatchEvent(new CustomEvent('TikTok_State_Update', { detail: state }));
        }
    });

    // Manual helper for initial sync or clicks
    function forceMonitorSync() {
        monitorState(null, true);
    }

    // Capturing Listeners — added/removed with PiP lifecycle to avoid work when PiP is inactive
    function addVideoStateListeners() {
        VIDEO_STATE_EVENTS.forEach(evt => {
            document.addEventListener(evt, monitorState, { capture: true, passive: true });
        });
    }
    function removeVideoStateListeners() {
        VIDEO_STATE_EVENTS.forEach(evt => {
            document.removeEventListener(evt, monitorState, { capture: true });
        });
    }

    document.addEventListener('enterpictureinpicture', () => {
        lastBroadcastState = null;
        lastLikeVideo = null;
        lastFavVideo = null;
        cachedLikeBtn = null;
        cachedFavBtn = null;
        addVideoStateListeners();
        connectStructuralObservers();
        
        // Immediate sync upon entry
        requestAnimationFrame(() => {
            monitorInteractiveElements();
            monitorState();
        });
        
        // Safety secondary scan for slow DOMs
        setTimeout(() => {
            monitorInteractiveElements();
            monitorState();
        }, 150);
    });

    document.addEventListener('leavepictureinpicture', () => {
        removeVideoStateListeners();
        likeBtnObserver?.disconnect();
        favBtnObserver?.disconnect();
        likeClickController?.abort();
        favClickController?.abort();
        disconnectStructuralObservers();

        likeBtnObserver = null;
        favBtnObserver = null;
        likeClickController = null;
        favClickController = null;
        lastActiveLikeBtn = null;
        lastActiveFavBtn = null;
        cachedLikeBtn = null;
        cachedFavBtn = null;
        lastLikeVideo = null;
        lastFavVideo = null;
        lastBroadcastState = null;
    });

    if (enableAutoSwitching) {
        enableAutoSwitching((newVideo) => {
            lastBroadcastState = null;
            disconnectStructuralObservers();
            connectStructuralObservers();
            monitorInteractiveElements();
            monitorState(newVideo);
        });
    }

    if (enableAntiPause) {
        enableAntiPause(() => !!document.pictureInPictureElement);
    }

    // -------- INTERACTIVE OBSERVERS --------

    let likeBtnObserver = null;
    let favBtnObserver = null;
    let lastActiveLikeBtn = null;
    let lastActiveFavBtn = null;
    let likeClickController = null;
    let favClickController = null;
    let lastScanTs = 0;

    function setupButtonController(newBtn, lastBtn, type) {
        if (newBtn === lastBtn) return lastBtn;

        const observer = (type === 'like') ? likeBtnObserver : favBtnObserver;
        const controller = (type === 'like') ? likeClickController : favClickController;
        const attrFilter = (type === 'like') ? ['aria-pressed', 'class'] : ['class', 'style', 'fill'];

        observer?.disconnect();
        controller?.abort();

        if (newBtn) {
            const newController = new AbortController();
            // Single fallback timeout; MutationObserver is the primary state detector
            newBtn.addEventListener('click', () => {
                setTimeout(monitorState, 250);
            }, { passive: true, signal: newController.signal });

            const newObserver = new MutationObserver(() => monitorState());
            // Like: aria-pressed changes on the button itself → no subtree needed
            // Favorite: React may swap SVG children entirely → subtree + childList required
            const observeOpts = (type === 'like')
                ? { attributes: true, attributeFilter: attrFilter }
                : { attributes: true, attributeFilter: attrFilter, subtree: true, childList: true };
            newObserver.observe(newBtn, observeOpts);

            if (type === 'like') {
                likeBtnObserver = newObserver;
                likeClickController = newController;
            } else {
                favBtnObserver = newObserver;
                favClickController = newController;
            }
        } else {
            if (type === 'like') { likeBtnObserver = null; likeClickController = null; }
            else { favBtnObserver = null; favClickController = null; }
        }

        if (newBtn) monitorState();
        return newBtn;
    }

    function monitorInteractiveElements() {
        if (!document.pictureInPictureElement) return;

        const now = performance.now();
        if (now - lastScanTs < 100) return;
        lastScanTs = now;

        const video = document.pictureInPictureElement;
        if (!video) return;

        lastActiveLikeBtn = setupButtonController(getLikeButton(video), lastActiveLikeBtn, 'like');
        lastActiveFavBtn = setupButtonController(getFavoriteButton(video), lastActiveFavBtn, 'favorite');
    }

    // -------- STRUCTURAL OBSERVERS --------

    let rootObserver = null;
    let rootDebounceTimer = null;

    function connectStructuralObservers() {
        if (!rootObserver) {
            rootObserver = new MutationObserver(() => {
                if (rootDebounceTimer) return;
                rootDebounceTimer = setTimeout(() => {
                    rootDebounceTimer = null;
                    monitorInteractiveElements();
                }, 300);
            });
        }
        // Observe the narrowest useful container instead of document.body
        const pipVideo = document.pictureInPictureElement || getActiveVideo();
        const item = pipVideo ? getTikTokItem(pipVideo) : null;
        const observeTarget = item?.parentElement || item || document.body;
        try { rootObserver.observe(observeTarget, { childList: true, subtree: true }); } catch (e) {}
    }

    function disconnectStructuralObservers() {
        rootObserver?.disconnect();
        if (rootDebounceTimer) { clearTimeout(rootDebounceTimer); rootDebounceTimer = null; }
    }

    // -------- CONTROL EVENTS --------

    function handleRequestPipLocal() {
        return handleRequestPip({
            getVideo: getActiveVideo,
            preSync: () => {
                // FAST SYNC: Force a state report BEFORE browser PiP activation.
                cachedLikeBtn = null; cachedFavBtn = null; lastLikeVideo = null; lastFavVideo = null;
                monitorInteractiveElements();
                forceMonitorSync();
            }
        });
    }

    function findMuteButton(video) {
        const muteBtnCandidates = document.querySelectorAll(SELECTORS.MUTE_BTN);
        return normalizeToButton(getClosestCandidate(video, muteBtnCandidates));
    }

    function handleMuteLocal(video, shouldMute) {
        handleMuteUnmute(video, shouldMute, findMuteButton);
    }

    document.addEventListener('TikTok_Control_Event', (e) => {
        const { action, value, direction } = e.detail || {};
        const video = document.pictureInPictureElement || getActiveVideo();

        switch (action) {
            case ACTIONS.TOGGLE_LIKE:
                getLikeButton(video)?.click();
                break;
            case ACTIONS.TOGGLE_FAVORITE:
                getFavoriteButton(video)?.click();
                break;
            case ACTIONS.TOGGLE_PLAY:
                if (video) video.paused ? video.play() : video.pause();
                break;
            case ACTIONS.PAUSE:
                if (video) video.pause();
                break;
            case ACTIONS.NAVIGATE_VIDEO: {
                const key = direction === 'next' ? 'ArrowDown' : 'ArrowUp';
                const eventOptions = { key, code: key, keyCode: direction === 'next' ? 40 : 38, bubbles: true, cancelable: true, view: window };
                document.body.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
                document.body.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
                break;
            }
            case ACTIONS.REQUEST_PIP:
                handleRequestPipLocal();
                break;
            case ACTIONS.EXIT_PIP:
                if (document.pictureInPictureElement) document.exitPictureInPicture();
                break;
            case ACTIONS.FOCUS_PIP:
                handleFocusPip();
                break;
            case ACTIONS.SEEK:
                if (video && Number.isFinite(value)) {
                    let newTime = video.currentTime + value;
                    if (Number.isFinite(video.duration)) newTime = Math.max(0, Math.min(newTime, video.duration));
                    video.currentTime = newTime;
                }
                break;
            case ACTIONS.MUTE:
                handleMuteLocal(video, true);
                break;
            case ACTIONS.UNMUTE:
                handleMuteLocal(video, false);
                break;
            case ACTIONS.SET_VOLUME:
                handleSetVolume(video, value, (v, vol) => { v.volume = vol / 100; }, handleMuteLocal);
                break;
            case ACTIONS.CHECK_STATUS:
                cachedLikeBtn = null; cachedFavBtn = null; lastLikeVideo = null; lastFavVideo = null;
                monitorInteractiveElements();
                forceMonitorSync();
                break;
        }
    });

    if (document.pictureInPictureElement) {
        monitorInteractiveElements();
        requestAnimationFrame(() => monitorState());
    }
})();
