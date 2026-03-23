(() => {
    if (window.__YOUTUBE_PIP_BRIDGE_LOADED__) return;
    window.__YOUTUBE_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[YouTube Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, getClosestCandidate, enableAutoSwitching, signalNavigation } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const VIDEO_STATE_EVENTS = ['play', 'pause', 'volumechange'];

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

    function normalizeToButton(node) {
        if (!node) return null;
        if (node.tagName && node.tagName.toLowerCase() === 'button') return node;
        const btn = node.closest ? node.closest('button') : null;
        return btn || node;
    }

    function findLikeButton(video) {
        // Try active Shorts renderer first
        const activeShort = document.querySelector(SELECTORS.SHORTS_RENDERER);
        if (activeShort) {
            const btn = activeShort.querySelector(SELECTORS.SHORTS_LIKE_BTN);
            if (btn) return normalizeToButton(btn);
        }

        // Standard watch page
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

        // Fallback: search for filled heart/thumb icon if aria-pressed is missing
        const filledIcon = btn.querySelector('path[d*="M3,11h3v10H3V11z"], .style-default-active');
        if (filledIcon) return true;

        return false;
    }

    // -------- PLAYER HELPERS (YouTube-specific) --------

    function getPlayer(video) {
        if (!video) return null;
        return video.closest('.html5-video-player') || window.movie_player || null;
    }

    function setVolume(video, volume) {
        if (!video) return;
        const player = getPlayer(video);
        if (typeof player?.setVolume === 'function') {
            player.setVolume(volume);
        } else {
            video.volume = volume / 100;
        }
    }

    function findMuteButton(video) {
        if (!video) return null;
        const candidates = document.querySelectorAll(SELECTORS.MUTE_BTN);
        return getClosestCandidate(video, candidates);
    }

    // -------- LIVE DETECTION --------

    function detectIsLive(video) {
        if (!video) return false;
        const durationIsLive = video.duration === Infinity || !Number.isFinite(video.duration);
        if (durationIsLive) return true;
        const urlIsLive = window.location.href.includes('/live');
        if (urlIsLive) return true;
        // Search for live badge relative to the player first, fallback to global
        const player = getPlayer(video);
        const searchRoot = player || document;
        return !!searchRoot.querySelector(SELECTORS.LIVE_BADGE);
    }

    // -------- STATE --------

    let lastBroadcastState = null;

    const monitorState = (e) => {
        // 1. Context Detection: Prioritize event target or passed element.
        const targetVideo = (e instanceof HTMLVideoElement) ? e :
            (e && e.target instanceof HTMLVideoElement) ? e.target :
                getActiveVideo();

        if (!targetVideo) return;

        // 2. Ownership Filter: If in PiP, ONLY allow updates from the PiP video itself.
        const currentPiP = document.pictureInPictureElement;
        if (currentPiP && targetVideo !== currentPiP) {
            return;
        }

        // 3. Filter: Only ignore 'pause' during navigation to prevent flickering.
        // 'Play' events are ALWAYS trusted as they signal a successful landing.
        const playing = !targetVideo.paused;
        const isNavigating = window.BridgeUtils.isNavigating && window.BridgeUtils.isNavigating();

        if (isNavigating && !playing) {
            return;
        }

        const liked = getLikeStatus(targetVideo);
        const volume = Math.round(targetVideo.volume * 100);
        const muted = targetVideo.muted;
        const isLive = detectIsLive(targetVideo);

        // Fast shallow comparison
        if (lastBroadcastState &&
            lastBroadcastState.liked === liked &&
            lastBroadcastState.playing === playing &&
            lastBroadcastState.volume === volume &&
            lastBroadcastState.muted === muted &&
            lastBroadcastState.isLive === isLive) {
            return;
        }

        const state = { liked, playing, volume, muted, isLive };
        lastBroadcastState = state;
        document.dispatchEvent(new CustomEvent('YouTube_State_Update', { detail: state }));
    };

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

    // Reset state when PiP enters so the UI gets a fresh update.
    // Also connect structural observers so they only run during PiP.
    document.addEventListener('enterpictureinpicture', () => {
        lastBroadcastState = null;
        lastPageType = getPageType(); // Ensure context is fresh on entry
        addVideoStateListeners();
        connectStructuralObservers();

        // Immediate sync upon entry
        requestAnimationFrame(monitorState);

        // Safety secondary scan for slow DOMs
        setTimeout(() => {
            monitorInteractiveElements();
            monitorState();
        }, 150);
    });

    // Clean up when PiP exits
    document.addEventListener('leavepictureinpicture', () => {
        removeVideoStateListeners();
        likeBtnObserver?.disconnect();
        likeClickController?.abort();
        disconnectStructuralObservers();

        likeBtnObserver = null;
        likeClickController = null;
        lastActiveLikeBtn = null;
        cachedLikeBtn = null;
        lastLikeVideo = null;
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

    // -------- INTERACTIVE OBSERVERS --------

    let lastActiveLikeBtn = null;
    let likeBtnObserver = null;
    let likeClickController = null;
    let lastScanTs = 0;

    function setupButtonController(config) {
        const { getElement, onUpdate, attributeFilter = ['class', 'aria-pressed'] } = config;

        return () => {
            const btnNow = getElement();
            if (btnNow === lastActiveLikeBtn) return;

            likeBtnObserver?.disconnect();
            likeClickController?.abort();

            lastActiveLikeBtn = btnNow;
            if (!lastActiveLikeBtn) return;

            likeClickController = new AbortController();
            const { signal } = likeClickController;

            const update = () => { if (document.pictureInPictureElement) onUpdate(); };

            // Single fallback timeout; MutationObserver is the primary state detector
            lastActiveLikeBtn.addEventListener('click', () => {
                setTimeout(update, 250);
            }, { passive: true, signal });

            likeBtnObserver = new MutationObserver(update);
            likeBtnObserver.observe(lastActiveLikeBtn, { attributes: true, attributeFilter });
            update();
        };
    }

    const manageLikeController = setupButtonController({
        getElement: () => getLikeButton(getActiveVideo()),
        onUpdate: monitorState
    });

    function monitorInteractiveElements() {
        if (!document.pictureInPictureElement) return;

        const now = performance.now();
        if (now - lastScanTs < 100) return;
        lastScanTs = now;

        manageLikeController();
    }

    // -------- STRUCTURAL OBSERVERS --------
    // These observers ONLY run while PiP is active (connected on
    // enterpictureinpicture, disconnected on leavepictureinpicture).

    let shortsObserver = null;
    let rootObserver = null;
    let rootDebounceTimer = null;

    function setupShortsObserver() {
        if (shortsObserver) shortsObserver.disconnect();

        if (window.BridgeUtils?.enableFastVideoSwitching) {
            shortsObserver = window.BridgeUtils.enableFastVideoSwitching({
                containerSelector: 'ytd-shorts, #shorts-container',
                attribute: 'is-active',
                onSwitch: (v) => {
                    lastBroadcastState = null;
                    manageLikeController();
                    monitorState(v);
                }
            });
        }
    }

    // YouTube-specific: catch navigation EARLY to exit PiP or signal grace period
    document.addEventListener('yt-navigate-start', (e) => {
        const nextUrl = e.detail?.url;
        if (!nextUrl || !document.pictureInPictureElement) return;

        const nextPageType = getPageType(nextUrl);
        const typeChanged = lastPageType !== nextPageType;

        if (nextPageType === 'OTHER' || typeChanged) {
            // Immediate exit for major changes
            document.exitPictureInPicture().catch(() => { });
            // Signal background immediately to prevent ghost UI on next page
            try { chrome.runtime.sendMessage({ type: 'PIP_DEACTIVATED', force: true }); } catch (err) { }
        } else {
            // Signal background to enter grace period (e.g., Watch -> Watch)
            // This prevents the volume panel from being hidden and the icon from resetting
            // when the browser natively exits PiP during DOM replacement.
            if (signalNavigation) signalNavigation();
            try { chrome.runtime.sendMessage({ type: 'SIGNAL_NAVIGATION' }); } catch (err) { }
        }
    });

    // YouTube-specific: re-scan on SPA navigation + re-check Shorts container
    document.addEventListener('yt-navigate-finish', () => {
        const currentPageType = getPageType();
        lastPageType = currentPageType; // Sync for next navigation

        if (document.pictureInPictureElement) {
            setupShortsObserver();
            monitorInteractiveElements();
            monitorState();
        }
    });

    function connectStructuralObservers() {
        // Connect root observer — only while PiP is active
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
        const playerContainer = pipVideo ? getPlayer(pipVideo) : null;
        const observeTarget = playerContainer?.parentElement || playerContainer || document.body;
        try {
            rootObserver.observe(observeTarget, { childList: true, subtree: true });
        } catch (e) {
            // Defensive: may fail inside some iframes
        }

        // Connect Shorts observer
        setupShortsObserver();
    }

    function disconnectStructuralObservers() {
        rootObserver?.disconnect();
        shortsObserver?.disconnect();

        if (rootDebounceTimer) {
            clearTimeout(rootDebounceTimer);
            rootDebounceTimer = null;
        }
    }

    // -------- CONTROL EVENTS --------

    function handleToggleLike(video) {
        const btn = getLikeButton(video);
        if (!btn) return;
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        btn.click();
        // Single fallback timeout; MutationObserver in setupButtonController handles rapid detection
        setTimeout(monitorState, 250);
    }

    async function handleRequestPip() {
        const v = getActiveVideo();
        if (!v) return;
        try {
            if (document.pictureInPictureElement === v) {
                await document.exitPictureInPicture();
            } else {
                // Force sync before PiP
                lastActiveLikeBtn = null; // Clear to force re-attachment
                monitorInteractiveElements();
                monitorState(v);

                if (v.hasAttribute('disablePictureInPicture')) v.removeAttribute('disablePictureInPicture');
                await v.requestPictureInPicture();
            }
        } catch (e) { /* Safe catch */ }
    }

    function handleMute(video, shouldMute) {
        if (!video) return;
        const muteBtn = findMuteButton(video);
        if (muteBtn) {
            const isCurrentlyMuted = video.muted;
            if (shouldMute !== isCurrentlyMuted) muteBtn.click();
        } else {
            const player = getPlayer(video);
            if (shouldMute) {
                if (typeof player?.mute === 'function') player.mute(); else video.muted = true;
            } else {
                if (typeof player?.unMute === 'function') player.unMute(); else video.muted = false;
            }
        }
    }

    function handleSetVolume(video, value) {
        if (!video || !Number.isFinite(value)) return;
        const vol = Math.max(0, Math.min(1, value / 100));
        if (vol > 0 && video.muted) handleMute(video, false);
        setVolume(video, Math.round(vol * 100));
    }

    document.addEventListener('YouTube_Control_Event', (e) => {
        const { action, value, direction } = e.detail || {};
        const video = getActiveVideo();

        switch (action) {
            case ACTIONS.TOGGLE_LIKE: handleToggleLike(video); break;
            case ACTIONS.TOGGLE_PLAY: if (video) video.paused ? video.play() : video.pause(); break;
            case ACTIONS.PAUSE: if (video) video.pause(); break;
            case ACTIONS.NAVIGATE_VIDEO: {
                if (signalNavigation) signalNavigation();
                const key = direction === 'next' ? 'ArrowDown' : 'ArrowUp';
                const opts = { key, code: key, bubbles: true, cancelable: true, view: window };
                document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
                document.body.dispatchEvent(new KeyboardEvent('keyup', opts));
                break;
            }
            case ACTIONS.REQUEST_PIP: handleRequestPip(); break;
            case ACTIONS.EXIT_PIP: if (document.pictureInPictureElement) document.exitPictureInPicture(); break;
            case ACTIONS.FOCUS_PIP: {
                const pipV = document.pictureInPictureElement;
                if (!pipV) break;
                document.exitPictureInPicture().then(() => {
                    setTimeout(() => pipV.requestPictureInPicture().catch(() => { }), 100);
                }).catch(() => { });
                break;
            }
            case ACTIONS.SEEK:
                if (video && Number.isFinite(value)) {
                    video.currentTime = Math.max(0, Math.min(video.currentTime + value, video.duration || Infinity));
                }
                break;
            case ACTIONS.MUTE: handleMute(video, true); break;
            case ACTIONS.UNMUTE: handleMute(video, false); break;
            case ACTIONS.SET_VOLUME: handleSetVolume(video, value); break;
            case ACTIONS.CHECK_STATUS:
                cachedLikeBtn = null;
                lastLikeVideo = null;
                lastBroadcastState = null;
                manageLikeController();
                monitorState();
                break;
        }
    });
})();
