(() => {
    if (window.__YOUTUBE_PIP_BRIDGE_LOADED__) return;
    window.__YOUTUBE_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[YouTube Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, getClosestCandidate, enableAutoSwitching, signalNavigation, normalizeToButton, handleRequestPip, detectIsLive, createBaseBridge } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const SELECTORS = {
        LIKE_BTN_GROUP: '#segmented-like-button button:not([data-pip-managed]), like-button-view-model button:not([data-pip-managed]), #top-level-buttons-computed ytd-toggle-button-renderer button:not([data-pip-managed])',
        SHORTS_LIKE_BTN: '#like-button button, like-button-view-model button, #like-button ytd-toggle-button-renderer button',
        SHORTS_RENDERER: 'ytd-reel-video-renderer[is-active]',
        MUTE_BTN: 'button.ytp-mute-button, button.ytdVolumeControlsMuteIconButton',
        PLAYER_CONTAINER: '.html5-video-player',
        LIVE_BADGE: '.ytp-live, [data-layer="badge-label"]'
    };

    function getPageType(url = window.location.href) {
        if (url.includes('/watch')) return 'WATCH';
        if (url.includes('/shorts/')) return 'SHORTS';
        if (url.includes('/live')) return 'LIVE';
        return 'OTHER';
    }

    let lastPageType = getPageType();

    // -------- BUTTON FINDERS --------

    let lastLikeVideo = null;
    let cachedLikeBtn = null;

    function findLikeButton(video) {
        const activeShort = document.querySelector(SELECTORS.SHORTS_RENDERER);
        if (activeShort) {
            const btn = activeShort.querySelector(SELECTORS.SHORTS_LIKE_BTN);
            if (btn) return normalizeToButton(btn);
        }
        const candidates = document.querySelectorAll(SELECTORS.LIKE_BTN_GROUP);
        if (!candidates.length) return null;
        return normalizeToButton(getClosestCandidate(video, candidates) || candidates[0]);
    }

    function getLikeButton(video) {
        if (!video) return null;
        if (video === lastLikeVideo && cachedLikeBtn?.isConnected) return cachedLikeBtn;
        cachedLikeBtn = findLikeButton(video);
        lastLikeVideo = video;
        return cachedLikeBtn;
    }

    // -------- STATE DETECTION HELPERS --------

    function getLikeStatus(video) {
        const btn = getLikeButton(video);
        if (!btn) return false;
        const viewModel = btn.closest('like-button-view-model');
        if (viewModel?.data) {
            if (typeof viewModel.data.isToggled !== 'undefined') return !!viewModel.data.isToggled;
            if (typeof viewModel.data.likeStatus === 'string') return viewModel.data.likeStatus === 'LIKE';
        }
        const pressed = btn.getAttribute('aria-pressed');
        if (pressed !== null) return pressed === 'true';
        if (btn.classList.contains('style-default-active')) return true;
        const filledIcon = btn.querySelector('path[d*="M3,11h3v10H3V11z"], .style-default-active');
        if (filledIcon) return true;
        return false;
    }

    function getPlayer(video) {
        if (!video) return null;
        return video.closest('.html5-video-player') || window.movie_player || null;
    }

    function findMuteButton(video) {
        if (!video) return null;
        const candidates = document.querySelectorAll(SELECTORS.MUTE_BTN);
        return getClosestCandidate(video, candidates);
    }

    function detectIsLiveLocal(video) {
        return detectIsLive(video, [SELECTORS.LIVE_BADGE]);
    }

    // -------- BASE BRIDGE INITIALIZATION --------

    const baseBridge = createBaseBridge({
        platform: 'youtube',
        getVideo: getActiveVideo,
        getLikeStatus,
        detectIsLive: detectIsLiveLocal,
        findMuteBtn: findMuteButton,
        getPlayer,
        onStateChange: (state) => {
            document.dispatchEvent(new CustomEvent('YouTube_State_Update', { detail: state }));
        },
        supportedActions: {
            [ACTIONS.TOGGLE_LIKE]: (video) => {
                const btn = getLikeButton(video);
                if (!btn) return;
                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                btn.click();
                setTimeout(baseBridge.monitorState, 250);
                return { handled: true };
            },
            [ACTIONS.NAVIGATE_VIDEO]: (video, msg) => {
                if (signalNavigation) signalNavigation();
                const key = msg.direction === 'next' ? 'ArrowDown' : 'ArrowUp';
                const opts = { key, code: key, bubbles: true, cancelable: true, view: window };
                document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
                document.body.dispatchEvent(new KeyboardEvent('keyup', opts));
                return { handled: true };
            },
            [ACTIONS.CHECK_STATUS]: () => {
                cachedLikeBtn = null;
                lastLikeVideo = null;
                monitorInteractiveElements();
                baseBridge.monitorState(null, true);
                return { handled: true };
            }
        }
    });

    // -------- PIP LIFECYCLE --------

    document.addEventListener('enterpictureinpicture', () => {
        lastPageType = getPageType();
        baseBridge.addVideoStateListeners(getActiveVideo());
        connectStructuralObservers();
        requestAnimationFrame(() => baseBridge.monitorState(null, true));
        setTimeout(() => {
            monitorInteractiveElements();
            baseBridge.monitorState();
        }, 150);
    });

    document.addEventListener('leavepictureinpicture', () => {
        baseBridge.removeVideoStateListeners(getActiveVideo());
        likeBtnObserver?.disconnect();
        likeClickController?.abort();
        disconnectStructuralObservers();
        likeBtnObserver = null;
        likeClickController = null;
        lastActiveLikeBtn = null;
        cachedLikeBtn = null;
        lastLikeVideo = null;
    });

    if (enableAutoSwitching) {
        enableAutoSwitching((newVideo) => {
            disconnectStructuralObservers();
            connectStructuralObservers();
            monitorInteractiveElements();
            baseBridge.monitorState(newVideo);
        });
    }

    // -------- INTERACTIVE OBSERVERS --------

    let lastActiveLikeBtn = null;
    let likeBtnObserver = null;
    let likeClickController = null;
    let lastScanTs = 0;

    function monitorInteractiveElements() {
        if (!document.pictureInPictureElement) return;
        const now = performance.now();
        if (now - lastScanTs < 100) return;
        lastScanTs = now;

        const btnNow = getLikeButton(getActiveVideo());
        if (btnNow === lastActiveLikeBtn) return;

        likeBtnObserver?.disconnect();
        likeClickController?.abort();

        lastActiveLikeBtn = btnNow;
        if (!lastActiveLikeBtn) return;

        likeClickController = new AbortController();
        const update = () => { if (document.pictureInPictureElement) baseBridge.monitorState(); };

        lastActiveLikeBtn.addEventListener('click', () => setTimeout(update, 250), { passive: true, signal: likeClickController.signal });
        likeBtnObserver = new MutationObserver(update);
        likeBtnObserver.observe(lastActiveLikeBtn, { attributes: true, attributeFilter: ['class', 'aria-pressed'] });
        update();
    }

    // -------- STRUCTURAL OBSERVERS --------

    let shortsObserver = null;
    let rootObserver = null;
    let rootDebounceTimer = null;

    function setupShortsObserver() {
        shortsObserver?.disconnect();
        if (window.BridgeUtils?.enableFastVideoSwitching) {
            shortsObserver = window.BridgeUtils.enableFastVideoSwitching({
                containerSelector: 'ytd-shorts, #shorts-container',
                attribute: 'is-active',
                onSwitch: (v) => {
                    monitorInteractiveElements();
                    baseBridge.monitorState(v);
                }
            });
        }
    }

    document.addEventListener('yt-navigate-start', (e) => {
        const nextUrl = e.detail?.url;
        if (!nextUrl || !document.pictureInPictureElement) return;
        const nextPageType = getPageType(nextUrl);
        if (nextPageType === 'OTHER' || lastPageType !== nextPageType) {
            document.exitPictureInPicture().catch(() => { });
        } else {
            if (signalNavigation) signalNavigation();
        }
    });

    document.addEventListener('yt-navigate-finish', () => {
        lastPageType = getPageType();
        if (document.pictureInPictureElement) {
            setupShortsObserver();
            monitorInteractiveElements();
            baseBridge.monitorState(null, true);
        }
    });

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
        const pipVideo = document.pictureInPictureElement || getActiveVideo();
        const playerContainer = pipVideo ? getPlayer(pipVideo) : null;
        const observeTarget = playerContainer?.parentElement || playerContainer || document.body;
        try { rootObserver.observe(observeTarget, { childList: true, subtree: true }); } catch (e) { }
        setupShortsObserver();
    }

    function disconnectStructuralObservers() {
        rootObserver?.disconnect();
        shortsObserver?.disconnect();
        if (rootDebounceTimer) { clearTimeout(rootDebounceTimer); rootDebounceTimer = null; }
    }

    document.addEventListener('YouTube_Control_Event', (e) => {
        const { action } = e.detail || {};
        if (action === ACTIONS.REQUEST_PIP) {
            handleRequestPip({
                getVideo: getActiveVideo,
                preSync: () => {
                    lastActiveLikeBtn = null;
                    monitorInteractiveElements();
                    baseBridge.monitorState(null, true);
                }
            });
        } else {
            baseBridge.handleMessage(e.detail);
        }
    });
})();
