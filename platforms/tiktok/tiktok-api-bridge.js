(() => {
    if (window.__TIKTOK_PIP_BRIDGE_LOADED__) return;
    window.__TIKTOK_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[TikTok Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const {
        ACTIONS,
        getActiveVideo,
        getClosestCandidate,
        enableAutoSwitching,
        enableAntiPause,
        normalizeToButton,
        handleRequestPip,
        detectIsLive,
        createBaseBridge,
        isInteracting,
        signalInteraction
    } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const SELECTORS = {
        ITEM: 'section[id^="media-card-"], [data-e2e="recommend-list-item-container"], [class*="ItemContainer"], article',
        SIDEBAR: '[class*="ActionBarContainer"]',
        LIKE_ICON: '[data-e2e="like-icon"], [data-e2e="browse-like-icon"]',
        FAV_ICON: '[data-e2e="undefined-icon"], [data-e2e="collect-icon"], [data-e2e="browse-collect-icon"], [data-e2e="favorite-icon"]',
        AD_TAG: '[data-e2e="ad-tag"], [data-e2e*="ad"], [class*="Ad"], [class*="ad-"], [aria-label*="Sponsored"], [aria-label*="Publicidad"], [aria-label*="Patrocinado"]',
        LIVE_TITLE: '[data-e2e="live-title"], .live-stream-title',
        MUTE_BTN: '[data-e2e="video-mute"], button.TUXButton--secondary:has(svg)'
    };
    const MANUAL_NAV_UI_GRACE_MS = 1800;
    let manualNavUiGraceUntil = 0;

    // -------- SESSION CACHE (Ultimate Performance & Memory Safety) --------
    const sessionCache = new WeakMap();

    function getSession(video) {
        if (!video) return {};
        let session = sessionCache.get(video);

        // TikTok recycles <video> nodes. If the source changes, we MUST flush all states!
        if (session && session.cachedSrc !== video.currentSrc) {
            session = null;
            sessionCache.delete(video);
        }

        if (!session) {
            session = {
                item: null,
                sidebar: null,
                likeBtn: null,
                favBtn: null,
                muteBtn: null,
                isAd: null,
                isLive: null,
                missingButtonsSince: null,
                lastStableHasFavorite: true,
                cachedSrc: video.currentSrc
            };
            sessionCache.set(video, session);
        }

        // Validate individual elements connectivity (for virtualized lists)
        // If the video moved to a new card/item, we MUST reset the cached elements.
        const currentItem = video.closest(SELECTORS.ITEM);
        if (session.item && (session.item !== currentItem || !session.item.isConnected)) {
            session.item = null;
            session.sidebar = null;
            session.likeBtn = null;
            session.favBtn = null;
            session.muteBtn = null;
            session.isAd = null;
            session.isLive = null;
            session.missingButtonsSince = null;
            session.lastStableHasFavorite = true;
        }

        return session;
    }

    function getTikTokItem(video) {
        const session = getSession(video);
        if (session.item) return session.item;
        session.item = video.closest(SELECTORS.ITEM);
        return session.item;
    }

    function getTikTokSidebar(video) {
        const session = getSession(video);
        if (session.sidebar && session.sidebar.isConnected) return session.sidebar;

        const item = getTikTokItem(video);
        if (!item) return null;

        session.sidebar = item.querySelector(SELECTORS.SIDEBAR) ||
            (item.parentElement ? item.parentElement.querySelector(SELECTORS.SIDEBAR) : null);
        return session.sidebar;
    }

    // -------- BUTTON FINDERS --------

    function findButton(video, selector) {
        const item = getTikTokItem(video);
        const sidebar = getTikTokSidebar(video);

        if (sidebar) {
            const icon = sidebar.querySelector(selector);
            if (icon) return normalizeToButton(icon);
        }

        const root = item || document;
        const icons = root.querySelectorAll(`${selector}:not([data-pip-managed])`);
        if (icons.length) {
            const buttons = Array.from(icons).map(el => el.closest('button')).filter(Boolean);
            return normalizeToButton(getClosestCandidate(video, buttons));
        }
        return null;
    }

    function getLikeButton(video) {
        const session = getSession(video);
        if (session.likeBtn && session.likeBtn.isConnected) return session.likeBtn;
        session.likeBtn = findButton(video, SELECTORS.LIKE_ICON);
        return session.likeBtn;
    }

    function getFavoriteButton(video) {
        const session = getSession(video);
        if (session.favBtn && session.favBtn.isConnected) return session.favBtn;
        session.favBtn = findButton(video, SELECTORS.FAV_ICON);
        return session.favBtn;
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

    function detectIsLiveLocal(video, root = null) {
        const session = getSession(video);
        // If we already confirmed it's a Live, no need to re-check root unless forced
        if (session.isLive !== null && !root) return session.isLive;

        const observeRoot = root || getTikTokItem(video);
        const isLiveConfirmed = detectIsLive(video, [SELECTORS.LIVE_TITLE, '.live-stream-title'], observeRoot);

        if (!root) session.isLive = isLiveConfirmed;
        return isLiveConfirmed;
    }

    function detectIsAd(video) {
        const session = getSession(video);
        if (session.isAd === true) return true;

        const item = getTikTokItem(video);
        if (!item) {
            return false;
        }

        const hasAdMarker = !!item.querySelector(SELECTORS.AD_TAG);
        const text = (item.innerText || item.textContent || '').trim();
        const hasAdText = /\b(Sponsored|Promoted|Publicidad|Anuncio|Patrocinado)\b/i.test(text);
        const isAd = hasAdMarker || hasAdText;
        if (isAd) session.isAd = true;
        return isAd;
    }

    function findMuteButton(video) {
        const session = getSession(video);
        if (session.muteBtn && session.muteBtn.isConnected) return session.muteBtn;

        const item = getTikTokItem(video);
        const root = item || document;
        const muteBtnCandidates = root.querySelectorAll(SELECTORS.MUTE_BTN);
        session.muteBtn = normalizeToButton(getClosestCandidate(video, muteBtnCandidates));
        return session.muteBtn;
    }

    function shouldAutoSwitchToVideo(video) {
        if (!video || video === document.pictureInPictureElement) return false;

        const item = getTikTokItem(video);
        const itemRect = item?.getBoundingClientRect?.() || video.getBoundingClientRect();
        const minHeight = window.innerHeight * 0.55;
        const minWidth = window.innerWidth * 0.35;
        const hasSidebar = !!getTikTokSidebar(video);
        const isLiveCandidate = detectIsLiveLocal(video);
        const isAdCandidate = detectIsAd(video);
        const looksLikePrimarySurface = itemRect.height >= minHeight || itemRect.width >= minWidth;

        // Explore/grid hover previews can start playing under the cursor, but they are
        // usually lack the main feed action sidebar. We only auto-switch when the
        // candidate looks like a primary feed surface, an actual live, or an ad slot
        // reached through feed navigation.
        return isLiveCandidate || (isAdCandidate && looksLikePrimarySurface) || (hasSidebar && looksLikePrimarySurface);
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
            const session = getSession(video);

            // 1. Scoped detections (Optimized via WeakMap session cache)
            // If the video is completely unloaded, reset Ad/Live flags to ensure they are re-checked for the new content.
            if (video?.readyState === 0) {
                session.isAd = null;
                session.isLive = null;
            }

            const isAd = detectIsAd(video);

            const likeBtn = getLikeButton(video);
            const favBtn = getFavoriteButton(video);

            if (likeBtn && favBtn) {
                session.missingButtonsSince = null;
                session.lastStableHasFavorite = true;
            } else if (!session.missingButtonsSince) {
                session.missingButtonsSince = Date.now();
            }
            const missingDuration = session.missingButtonsSince ? (Date.now() - session.missingButtonsSince) : 0;

            // Define transitioning state: video is empty OR basic social buttons are missing from DOM.
            const isTransitioning = (video?.readyState === 0 || (!state.isLive && !isAd && (!likeBtn || !favBtn) && missingDuration < 3000));
            const isManualNavWindow = Date.now() < manualNavUiGraceUntil;
            const isUserDrivenTransition = isTransitioning && (isInteracting() || isManualNavWindow);

            // Keep "live" scoped to actual TikTok restrictions (real live streams / ads).
            // Transitional swaps between feed videos should not collapse the control panel UI.
            state.isTikTokLive = (state.isLive || isAd);
            state.isAd = isAd; // Expose separately so the panel can show an ad indicator
            state.hasFavorite = (state.isLive || isAd)
                ? false
                : (isUserDrivenTransition ? session.lastStableHasFavorite : !!favBtn);

            // Unify next/previous behavior: while the user is actively navigating, preserve the last
            // stable social controls instead of collapsing and re-expanding them mid-transition.
            state.isTikTokNavigating = isTransitioning && !isUserDrivenTransition;

            document.dispatchEvent(new CustomEvent('TikTok_State_Update', { detail: state }));
        },
        supportedActions: {
            [ACTIONS.TOGGLE_LIKE]: (video) => { getLikeButton(video)?.click(); return { handled: true }; },
            [ACTIONS.TOGGLE_FAVORITE]: (video) => { getFavoriteButton(video)?.click(); return { handled: true }; },
            [ACTIONS.NAVIGATE_VIDEO]: (video, msg) => {
                manualNavUiGraceUntil = Date.now() + MANUAL_NAV_UI_GRACE_MS;
                signalInteraction();
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
            [ACTIONS.CHECK_STATUS]: (video) => {
                if (video) sessionCache.delete(video);
                monitorInteractiveElements();
                baseBridge.monitorState(null, true);
                return { handled: true };
            }
        }
    });

    // -------- PIP LIFECYCLE --------

    document.addEventListener('enterpictureinpicture', () => {
        connectStructuralObservers();
        requestAnimationFrame(() => { monitorInteractiveElements(); baseBridge.monitorState(null, true); });
        setTimeout(() => { monitorInteractiveElements(); baseBridge.monitorState(null, true); }, 150);
    });

    document.addEventListener('leavepictureinpicture', () => {
        baseBridge.removeVideoStateListeners(getActiveVideo());
        likeBtnObserver?.disconnect();
        favBtnObserver?.disconnect();
        likeClickController?.abort();
        favClickController?.abort();
        disconnectStructuralObservers();
        likeBtnObserver = null; favBtnObserver = null; likeClickController = null; favClickController = null;
        lastActiveLikeBtn = null; lastActiveFavBtn = null;
    });

    if (enableAutoSwitching) {
        enableAutoSwitching((newVideo) => {
            disconnectStructuralObservers();
            connectStructuralObservers();
            monitorInteractiveElements();
            baseBridge.monitorState(newVideo);
        }, shouldAutoSwitchToVideo);
    }

    if (enableAntiPause) enableAntiPause(() => !!document.pictureInPictureElement);

    window.addEventListener('PIP_NAV_STABLE', () => {
        if (document.pictureInPictureElement) {
            monitorInteractiveElements();
            baseBridge.monitorState(null, true);
        }
    });


    // -------- INTERACTIVE OBSERVERS --------

    let likeBtnObserver = null, favBtnObserver = null;
    let likeClickController = null, favClickController = null;
    let lastActiveLikeBtn = null, lastActiveFavBtn = null;
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
        baseBridge.monitorState();
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
                rootDebounceTimer = setTimeout(() => {
                    rootDebounceTimer = null;
                    monitorInteractiveElements();
                    baseBridge.monitorState(null, true);
                }, 300);
            });
        }
        const pipVideo = document.pictureInPictureElement || getActiveVideo();
        const item = pipVideo ? getTikTokItem(pipVideo) : null;
        const observeTarget = item?.parentElement || item || document.body;
        try { rootObserver.observe(observeTarget, { childList: true, subtree: true }); } catch (e) { }
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
                preSync: (video) => {
                    if (video) sessionCache.delete(video);
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
