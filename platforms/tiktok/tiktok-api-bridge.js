(() => {
    if (window.__TIKTOK_PIP_BRIDGE_LOADED__) return;
    window.__TIKTOK_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[TikTok Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, getClosestCandidate, enableAutoSwitching, enableAntiPause, normalizeToButton, handleRequestPip, detectIsLive, createBaseBridge, isNavigating } = window.BridgeUtils;

    // -------- CONSTANTS --------

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
        return item.querySelector(SELECTORS.SIDEBAR) || 
               (item.parentElement ? item.parentElement.querySelector(SELECTORS.SIDEBAR) : null);
    }

    // -------- BUTTON FINDERS --------

    let lastLikeVideo = null;
    let lastFavVideo = null;
    let cachedLikeBtn = null;
    let cachedFavBtn = null;

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
            if (isTikTokFavoriteColor(fillAttr) || isTikTokFavoriteColor(styleFill)) return true;
        }
        return false;
    }

    function detectIsLiveLocal(video) {
        return detectIsLive(video, [SELECTORS.LIVE_TITLE, '.live-stream-title']);
    }

    function detectIsAd(video) {
        const item = getTikTokItem(video);
        return item ? !!item.querySelector(SELECTORS.AD_TAG) : false;
    }

    function findMuteButton(video) {
        const muteBtnCandidates = document.querySelectorAll(SELECTORS.MUTE_BTN);
        return normalizeToButton(getClosestCandidate(video, muteBtnCandidates));
    }

    // -------- BASE BRIDGE INITIALIZATION --------

    const baseBridge = createBaseBridge({
        platform: 'tiktok',
        getVideo: getActiveVideo,
        getLikeStatus,
        getFavoriteStatus,
        detectIsLive: detectIsLiveLocal,
        findMuteBtn: findMuteButton,
        onStateChange: (state) => {
            const video = document.pictureInPictureElement || getActiveVideo();
            const isAd = detectIsAd(video);
            state.isTikTokLive = state.isLive;
            state.hasFavorite = (state.isTikTokLive || isAd) ? false : !!getFavoriteButton(video);
            document.dispatchEvent(new CustomEvent('TikTok_State_Update', { detail: state }));
        },
        supportedActions: {
            [ACTIONS.TOGGLE_LIKE]: (video) => { getLikeButton(video)?.click(); return { handled: true }; },
            [ACTIONS.TOGGLE_FAVORITE]: (video) => { getFavoriteButton(video)?.click(); return { handled: true }; },
            [ACTIONS.NAVIGATE_VIDEO]: (video, msg) => {
                const key = msg.direction === 'next' ? 'ArrowDown' : 'ArrowUp';
                const eventOptions = { key, code: key, keyCode: msg.direction === 'next' ? 40 : 38, bubbles: true, cancelable: true, view: window };
                document.body.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
                document.body.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
                return { handled: true };
            },
            [ACTIONS.MUTE]: (video) => {
                if (detectIsLiveLocal(video)) {
                    if (!video.muted) {
                        const opts = { key: 'm', code: 'KeyM', keyCode: 77, bubbles: true };
                        video.dispatchEvent(new KeyboardEvent('keydown', opts));
                    }
                    return { handled: true };
                }
                return null; // Fallback to base
            },
            [ACTIONS.UNMUTE]: (video) => {
                if (detectIsLiveLocal(video)) {
                    if (video.muted) {
                        const opts = { key: 'm', code: 'KeyM', keyCode: 77, bubbles: true };
                        video.dispatchEvent(new KeyboardEvent('keydown', opts));
                    }
                    return { handled: true };
                }
                return null; // Fallback to base
            },
            [ACTIONS.SET_VOLUME]: (video, msg) => {
                if (detectIsLiveLocal(video)) {
                    // For Lives, if volume > 0 and it's muted, try to unmute with 'M'
                    if (msg.value > 0 && video.muted) {
                        const opts = { key: 'm', code: 'KeyM', keyCode: 77, bubbles: true };
                        video.dispatchEvent(new KeyboardEvent('keydown', opts));
                    }
                    // We let the base handle the numerical volume part if possible
                    return null; 
                }
                return null;
            },
            [ACTIONS.CHECK_STATUS]: () => {
                cachedLikeBtn = null; cachedFavBtn = null; lastLikeVideo = null; lastFavVideo = null;
                monitorInteractiveElements();
                baseBridge.monitorState(null, true);
                return { handled: true };
            }
        }
    });

    // -------- PIP LIFECYCLE --------

    document.addEventListener('enterpictureinpicture', () => {
        lastLikeVideo = null; lastFavVideo = null; cachedLikeBtn = null; cachedFavBtn = null;
        baseBridge.addVideoStateListeners(getActiveVideo());
        connectStructuralObservers();
        requestAnimationFrame(() => { monitorInteractiveElements(); baseBridge.monitorState(); });
        setTimeout(() => { monitorInteractiveElements(); baseBridge.monitorState(); }, 150);
    });

    document.addEventListener('leavepictureinpicture', () => {
        baseBridge.removeVideoStateListeners(getActiveVideo());
        likeBtnObserver?.disconnect();
        favBtnObserver?.disconnect();
        likeClickController?.abort();
        favClickController?.abort();
        disconnectStructuralObservers();
        likeBtnObserver = null; favBtnObserver = null; likeClickController = null; favClickController = null;
        lastActiveLikeBtn = null; lastActiveFavBtn = null; cachedLikeBtn = null; cachedFavBtn = null;
        lastLikeVideo = null; lastFavVideo = null;
    });

    if (enableAutoSwitching) {
        enableAutoSwitching((newVideo) => {
            disconnectStructuralObservers();
            connectStructuralObservers();
            monitorInteractiveElements();
            baseBridge.monitorState(newVideo);
        });
    }

    if (enableAntiPause) enableAntiPause(() => !!document.pictureInPictureElement);

    // -------- INTERACTIVE OBSERVERS --------

    let likeBtnObserver = null, favBtnObserver = null;
    let lastActiveLikeBtn = null, lastActiveFavBtn = null;
    let likeClickController = null, favClickController = null;
    let lastScanTs = 0;

    function setupButtonController(newBtn, lastBtn, type) {
        if (newBtn === lastBtn) return lastBtn;
        const isLike = type === 'like';
        const observer = isLike ? likeBtnObserver : favBtnObserver;
        const controller = isLike ? likeClickController : favClickController;

        observer?.disconnect(); controller?.abort();

        if (newBtn) {
            const newController = new AbortController();
            newBtn.addEventListener('click', () => setTimeout(baseBridge.monitorState, 250), { passive: true, signal: newController.signal });
            const newObserver = new MutationObserver(() => baseBridge.monitorState());
            const observeOpts = isLike ? { attributes: true, attributeFilter: ['aria-pressed', 'class'] }
                                       : { attributes: true, attributeFilter: ['class', 'style', 'fill'], subtree: true, childList: true };
            newObserver.observe(newBtn, observeOpts);
            if (isLike) { likeBtnObserver = newObserver; likeClickController = newController; }
            else { favBtnObserver = newObserver; favClickController = newController; }
        } else {
            if (isLike) { likeBtnObserver = null; likeClickController = null; }
            else { favBtnObserver = null; favClickController = null; }
        }
        if (newBtn) baseBridge.monitorState();
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

    let rootObserver = null, rootDebounceTimer = null;

    function connectStructuralObservers() {
        if (!rootObserver) {
            rootObserver = new MutationObserver(() => {
                if (rootDebounceTimer) return;
                rootDebounceTimer = setTimeout(() => { rootDebounceTimer = null; monitorInteractiveElements(); }, 300);
            });
        }
        const pipVideo = document.pictureInPictureElement || getActiveVideo();
        const item = pipVideo ? getTikTokItem(pipVideo) : null;
        const observeTarget = item?.parentElement || item || document.body;
        try { rootObserver.observe(observeTarget, { childList: true, subtree: true }); } catch (e) {}
    }

    function disconnectStructuralObservers() {
        rootObserver?.disconnect();
        if (rootDebounceTimer) { clearTimeout(rootDebounceTimer); rootDebounceTimer = null; }
    }

    document.addEventListener('TikTok_Control_Event', (e) => {
        const { action } = e.detail || {};
        if (action === ACTIONS.REQUEST_PIP) {
            handleRequestPip({
                getVideo: getActiveVideo,
                preSync: () => {
                    cachedLikeBtn = null; cachedFavBtn = null; lastLikeVideo = null; lastFavVideo = null;
                    monitorInteractiveElements();
                    baseBridge.monitorState(null, true);
                }
            });
        } else {
            baseBridge.handleMessage(e.detail);
        }
    });

    if (document.pictureInPictureElement) {
        monitorInteractiveElements();
        requestAnimationFrame(() => baseBridge.monitorState());
    }
})();
