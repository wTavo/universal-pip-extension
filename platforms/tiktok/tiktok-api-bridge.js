(() => {
    if (window.__TIKTOK_PIP_BRIDGE_LOADED__) return;
    window.__TIKTOK_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[TikTok Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, getClosestCandidate, enableAutoSwitching, enableAntiPause } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const VIDEO_STATE_EVENTS = ['play', 'pause', 'volumechange'];

    // -------- BUTTON FINDERS --------

    let lastLikeVideo = null;
    let lastFavVideo = null;
    let cachedLikeBtn = null;
    let cachedFavBtn = null;

    function normalizeToButton(node) {
        if (!node) return null;
        if (node.tagName && node.tagName.toLowerCase() === 'button') return node;
        const btn = node.closest ? node.closest('button') : null;
        return btn || node;
    }

    function findLikeButton(video) {
        const icons = document.querySelectorAll('[data-e2e="like-icon"]:not([data-pip-managed])');
        if (!icons.length) return null;

        const buttons = [...icons].map(el => el.closest('button')).filter(Boolean);

        return normalizeToButton(getClosestCandidate(video, buttons));
    }

    function findFavoriteButton(video) {
        // TikTok keeps changing this. undefined-icon is common, but collect-icon is also used.
        const icons = document.querySelectorAll('[data-e2e="undefined-icon"]:not([data-pip-managed])');
        if (!icons.length) return null;

        const buttons = [...icons].map(el => el.closest('button')).filter(Boolean);
        return normalizeToButton(getClosestCandidate(video, buttons));
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
        if (pressed === 'false') return false;

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

    // -------- STATE --------

    let lastBroadcastState = null;
    let monitoredVideo = null;

    const monitorState = () => {
        const video = getActiveVideo();
        if (!video) return;

        const pipActive = !!document.pictureInPictureElement;

        // Only attach/re-attach video event listeners while PiP is active.
        if (pipActive && video !== monitoredVideo) {
            if (monitoredVideo) {
                VIDEO_STATE_EVENTS.forEach(evt => monitoredVideo.removeEventListener(evt, monitorState));
            }

            monitoredVideo = video;
            lastBroadcastState = null; // Force update on video change

            VIDEO_STATE_EVENTS.forEach(evt => video.addEventListener(evt, monitorState));
        }

        const liked = getLikeStatus(video);
        const favorited = getFavoriteStatus(video);
        const playing = !video.paused;
        const volume = Math.round(video.volume * 100);
        const muted = video.muted;

        // Fast shallow comparison — avoids JSON.stringify overhead
        if (lastBroadcastState &&
            lastBroadcastState.liked === liked &&
            lastBroadcastState.favorited === favorited &&
            lastBroadcastState.playing === playing &&
            lastBroadcastState.volume === volume &&
            lastBroadcastState.muted === muted) {
            return;
        }

        const state = { liked, favorited, playing, volume, muted };
        lastBroadcastState = state;
        document.dispatchEvent(new CustomEvent('TikTok_State_Update', { detail: state }));
    };

    // Reset state when PiP enters so the UI gets a fresh update.
    // Also connect structural observers so they only run during PiP.
    document.addEventListener('enterpictureinpicture', () => {
        lastBroadcastState = null;
        connectStructuralObservers();
        requestAnimationFrame(monitorState);
    });

    // Clean up when PiP exits: detach video event listeners, disconnect ALL
    // observers and clear all caches so NOTHING runs in the background.
    document.addEventListener('leavepictureinpicture', () => {
        if (monitoredVideo) {
            VIDEO_STATE_EVENTS.forEach(
                evt => monitoredVideo.removeEventListener(evt, monitorState)
            );
            monitoredVideo = null;
        }

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
        enableAutoSwitching(monitorState);
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

    function monitorInteractiveElements() {

        // Skip if PiP inactive
        if (!document.pictureInPictureElement) return;

        const now = performance.now();
        if (now - lastScanTs < 100) return;
        lastScanTs = now;

        const video = getActiveVideo();
        if (!video) return;

        const likeBtnNow = getLikeButton(video);
        const favBtnNow = getFavoriteButton(video);

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
                        'class'
                    ]
                });

                monitorState();
            }
        }

        // ---------------- FAVORITE ----------------
        if (favBtnNow !== lastActiveFavBtn) {

            favBtnObserver?.disconnect();
            favClickController?.abort();

            lastActiveFavBtn = favBtnNow;
            cachedFavBtn = favBtnNow;

            if (cachedFavBtn) {

                favClickController = new AbortController();

                cachedFavBtn.addEventListener('click', () => {
                    setTimeout(monitorState, 60);
                    setTimeout(monitorState, 400);
                }, {
                    passive: true,
                    signal: favClickController.signal
                });

                favBtnObserver = new MutationObserver(() => {
                    try {
                        monitorState();
                    } catch (e) { /* Expected: observer may fire after cleanup */ }
                });

                favBtnObserver.observe(cachedFavBtn, {
                    attributes: true,
                    attributeFilter: [
                        'class',
                        'style'
                    ]
                });

                monitorState();
            }
        }
    }

    // -------- STRUCTURAL OBSERVERS --------
    // These observers ONLY run while PiP is active (connected on
    // enterpictureinpicture, disconnected on leavepictureinpicture).

    let rootObserver = null;
    let rootDebounceTimer = null;

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
    }

    function disconnectStructuralObservers() {
        rootObserver?.disconnect();

        if (rootDebounceTimer) {
            clearTimeout(rootDebounceTimer);
            rootDebounceTimer = null;
        }
    }

    // -------- CONTROL EVENTS --------

    document.addEventListener('TikTok_Control_Event', (e) => {
        const { action, value, direction } = e.detail || {};
        const video = getActiveVideo();

        switch (action) {
            case ACTIONS.TOGGLE_LIKE: {
                const btn = getLikeButton(video);
                btn?.click();
                break;
            }

            case ACTIONS.TOGGLE_FAVORITE: {
                const btn = getFavoriteButton(video);
                btn?.click();
                break;
            }

            case ACTIONS.TOGGLE_PLAY:
                if (video) video.paused ? video.play() : video.pause();
                break;

            case ACTIONS.PAUSE:
                if (video) video.pause();
                break;

            case ACTIONS.NAVIGATE_VIDEO: {
                const isNext = direction === 'next';
                const key = isNext ? 'ArrowDown' : 'ArrowUp';
                const eventOptions = { key, code: key, keyCode: isNext ? 40 : 38, bubbles: true, cancelable: true, view: window };
                document.body.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
                document.body.dispatchEvent(new KeyboardEvent('keyup', eventOptions));
                setTimeout(monitorState, 800);
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
                const muteBtnCandidates = document.querySelectorAll(
                    '[data-e2e="video-mute"], button.TUXButton--secondary:has(svg)'
                );
                const muteBtn = normalizeToButton(getClosestCandidate(video, muteBtnCandidates));

                if (muteBtn) {
                    if (video && !video.muted) {
                        muteBtn.click();
                    }
                } else if (video) {
                    video.muted = true;
                }
                break;
            }

            case ACTIONS.UNMUTE: {
                const unmuteBtnCandidates = document.querySelectorAll(
                    '[data-e2e="video-mute"], button.TUXButton--secondary:has(svg)'
                );
                const unmuteBtn = normalizeToButton(getClosestCandidate(video, unmuteBtnCandidates));

                if (unmuteBtn) {
                    if (video && video.muted) {
                        unmuteBtn.click();
                    }
                } else if (video) {
                    video.muted = false;
                }
                break;
            }

            case ACTIONS.SET_VOLUME:
                if (video && Number.isFinite(value)) {
                    const vol = Math.max(0, Math.min(1, value / 100));
                    if (vol > 0 && video.muted) {
                        video.muted = false;
                    }
                    video.volume = vol;
                }
                break;

            case ACTIONS.CHECK_STATUS:
                // Force a fresh scan when UI asks for status
                cachedLikeBtn = null;
                cachedFavBtn = null;
                lastLikeVideo = null;
                lastFavVideo = null;
                monitorInteractiveElements();
                monitorState();
                break;
        }
    });
})();
