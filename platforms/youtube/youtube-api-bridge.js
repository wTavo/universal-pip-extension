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
        const activeShort = document.querySelector('ytd-reel-video-renderer[is-active]');
        if (activeShort) {
            const btn = activeShort.querySelector(
                '#like-button button, like-button-view-model button, #like-button ytd-toggle-button-renderer button'
            );
            if (btn) return normalizeToButton(btn);
        }

        // Standard watch page: Use specific IDs and view-model markers
        const candidates = document.querySelectorAll(
            '#segmented-like-button button:not([data-pip-managed]), like-button-view-model button:not([data-pip-managed]), #top-level-buttons-computed ytd-toggle-button-renderer button:not([data-pip-managed])'
        );
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
        const candidates = document.querySelectorAll('button.ytdVolumeControlsMuteIconButton');
        return getClosestCandidate(video, candidates);
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

        if (!document.pictureInPictureElement) return;

        const liked = getLikeStatus(targetVideo);
        const volume = Math.round(targetVideo.volume * 100);
        const muted = targetVideo.muted;

        // Fast shallow comparison
        if (lastBroadcastState &&
            lastBroadcastState.liked === liked &&
            lastBroadcastState.playing === playing &&
            lastBroadcastState.volume === volume &&
            lastBroadcastState.muted === muted) {
            return;
        }

        const state = { liked, playing, volume, muted };
        lastBroadcastState = state;
        document.dispatchEvent(new CustomEvent('YouTube_State_Update', { detail: state }));
    };

    // Global Capturing Listeners: Catch state changes as they happen naturally.
    VIDEO_STATE_EVENTS.forEach(evt => {
        document.addEventListener(evt, monitorState, { capture: true, passive: true });
    });

    // Reset state when PiP enters so the UI gets a fresh update.
    // Also connect structural observers so they only run during PiP.
    document.addEventListener('enterpictureinpicture', () => {
        lastBroadcastState = null;
        connectStructuralObservers();
        requestAnimationFrame(monitorState);
    });

    // Clean up when PiP exits
    document.addEventListener('leavepictureinpicture', () => {

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
            lastBroadcastState = null; // Reset memory to force fresh update
            monitorState(newVideo);    // Sync immediately for the specific video
        });
    }

    // -------- INTERACTIVE OBSERVERS --------

    let likeBtnObserver = null;
    let lastActiveLikeBtn = null;
    let likeClickController = null;
    let lastScanTs = 0;

    function monitorInteractiveElements() {

        // Skip if PiP inactive
        if (!document.pictureInPictureElement) return;

        const now = performance.now();
        if (now - lastScanTs < 100) return;
        lastScanTs = now;

        const video = getActiveVideo();
        if (!video) return;

        const likeBtnNow = getLikeButton(video);

        // ---------------- LIKE ----------------
        if (likeBtnNow !== lastActiveLikeBtn) {

            likeBtnObserver?.disconnect();
            likeClickController?.abort();

            lastActiveLikeBtn = likeBtnNow;
            cachedLikeBtn = likeBtnNow;

            if (cachedLikeBtn) {

                likeClickController = new AbortController();

                cachedLikeBtn.addEventListener('click', () => {
                    setTimeout(monitorState, 60);
                    setTimeout(monitorState, 400);
                }, {
                    passive: true,
                    signal: likeClickController.signal
                });

                likeBtnObserver = new MutationObserver(() => {
                    try {
                        monitorState();
                    } catch (e) { /* Expected: observer may fire after cleanup */ }
                });

                likeBtnObserver.observe(cachedLikeBtn, {
                    attributes: true,
                    attributeFilter: [
                        'aria-pressed',
                        'class',
                        'aria-label'
                    ]
                });

                monitorState();
            }
        }
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
                    monitorInteractiveElements();
                    monitorState(v);
                }
            });
        }
    }

    // YouTube-specific: re-scan on SPA navigation + re-check Shorts container
    document.addEventListener('yt-navigate-finish', () => {
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
        try {
            rootObserver.observe(document.body, { childList: true, subtree: true });
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

    document.addEventListener('YouTube_Control_Event', (e) => {
        const { action, value, direction } = e.detail || {};
        const video = getActiveVideo();

        switch (action) {
            case ACTIONS.TOGGLE_LIKE: {
                const btn = getLikeButton(video);
                if (btn) {
                    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    setTimeout(monitorState, 60);
                    setTimeout(monitorState, 400);
                }
                break;
            }

            case ACTIONS.TOGGLE_PLAY:
                if (video) video.paused ? video.play() : video.pause();
                break;

            case ACTIONS.PAUSE:
                if (video) video.pause();
                break;

            case ACTIONS.NAVIGATE_VIDEO: {
                if (signalNavigation) signalNavigation();
                const isNext = direction === 'next';
                const key = isNext ? 'ArrowDown' : 'ArrowUp';
                const eventOptions = { key, code: key, keyCode: isNext ? 40 : 38, bubbles: true, cancelable: true, view: window };
                document.body.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
                document.body.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
                // No timeout needed: global capture listeners handle it natively
                break;
            }

            case ACTIONS.REQUEST_PIP:
                (async () => {
                    const v = getActiveVideo();
                    if (!v) return;
                    try {
                        if (document.pictureInPictureElement === v) {
                            await document.exitPictureInPicture();
                        } else {
                            monitorState();
                            if (v.hasAttribute('disablePictureInPicture')) v.removeAttribute('disablePictureInPicture');
                            await v.requestPictureInPicture();
                        }
                    } catch (e) {
                        // Expected: may fail if video is not eligible for PiP (e.g. DRM, removed from DOM)
                    }
                })();
                break;

            case ACTIONS.EXIT_PIP:
                if (document.pictureInPictureElement) document.exitPictureInPicture();
                break;

            case ACTIONS.FOCUS_PIP: {
                const pipVideo = document.pictureInPictureElement;
                if (!pipVideo) break;
                document.exitPictureInPicture().then(() => {
                    setTimeout(() => pipVideo.requestPictureInPicture().catch(() => { }), 100);
                }).catch(() => { });
                break;
            }

            case ACTIONS.SEEK:
                if (video && Number.isFinite(value)) {
                    let newTime = video.currentTime + value;
                    if (Number.isFinite(video.duration)) {
                        newTime = Math.max(0, Math.min(newTime, video.duration));
                    }
                    video.currentTime = newTime;
                }
                break;

            case ACTIONS.MUTE: {
                const muteBtn = findMuteButton(video);
                if (muteBtn) {
                    if (video && !video.muted) {
                        muteBtn.click();
                    }
                } else if (video) {
                    const player = getPlayer(video);
                    if (typeof player?.mute === 'function') {
                        player.mute();
                    } else {
                        video.muted = true;
                    }
                }
                break;
            }

            case ACTIONS.UNMUTE: {
                const muteBtn = findMuteButton(video);
                if (muteBtn) {
                    if (video && video.muted) {
                        muteBtn.click();
                    }
                } else if (video) {
                    const player = getPlayer(video);
                    if (typeof player?.unMute === 'function') {
                        player.unMute();
                    } else {
                        video.muted = false;
                    }
                }
                break;
            }

            case ACTIONS.SET_VOLUME:
                if (video && Number.isFinite(value)) {
                    const vol = Math.max(0, Math.min(1, value / 100));
                    if (vol > 0 && video.muted) {
                        const muteBtn = findMuteButton(video);
                        if (muteBtn) {
                            muteBtn.click();
                        } else {
                            const player = getPlayer(video);
                            if (typeof player?.unMute === 'function') { player.unMute(); }
                            else { video.muted = false; }
                        }
                    }
                    setVolume(video, Math.round(vol * 100));
                }
                break;

            case ACTIONS.CHECK_STATUS:
                // Force a fresh scan when UI asks for status
                cachedLikeBtn = null;
                lastLikeVideo = null;
                monitorInteractiveElements();
                monitorState();
                break;
        }
    });
})();
