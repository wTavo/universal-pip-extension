(() => {
    if (window.__INSTAGRAM_PIP_BRIDGE_LOADED__) return;
    window.__INSTAGRAM_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[Instagram Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, getClosestCandidate } = window.BridgeUtils;

    // -------- BUTTON FINDERS --------

    let lastVideo = null;
    let cachedLikeBtn = null;
    let cachedFavBtn = null;

    function normalizeToRole(node) {
        if (!node) return null;
        if (node.tagName && node.tagName.toLowerCase() === 'button') return node;
        if (node.getAttribute('role') === 'button') return node;
        const btn = node.closest ? node.closest('[role="button"]') || node.closest('button') : null;
        return btn || node;
    }

    function findLikeButton(video) {
        if (!video) return null;
        let parent = video.parentElement;

        // Instagram SVG Like Button Finder
        for (let i = 0; i < 15; i++) {
            if (!parent) break;
            const candidates = parent.querySelectorAll('svg[aria-label="Like"]:not([data-pip-managed]), svg[aria-label="Unlike"]:not([data-pip-managed]), svg[aria-label="Me gusta"]:not([data-pip-managed]), svg[aria-label="Ya no me gusta"]:not([data-pip-managed])');
            if (candidates.length) return normalizeToRole(getClosestCandidate(video, candidates));
            parent = parent.parentElement;
        }
        const allCandidates = document.querySelectorAll('svg[aria-label="Like"]:not([data-pip-managed]), svg[aria-label="Unlike"]:not([data-pip-managed]), svg[aria-label="Me gusta"]:not([data-pip-managed]), svg[aria-label="Ya no me gusta"]:not([data-pip-managed])');
        return normalizeToRole(getClosestCandidate(video, allCandidates));
    }

    function findFavoriteButton(video) {
        if (!video) return null;
        let parent = video.parentElement;
        for (let i = 0; i < 15; i++) {
            if (!parent) break;
            const candidates = parent.querySelectorAll('svg[aria-label="Save"]:not([data-pip-managed]), svg[aria-label="Remove"]:not([data-pip-managed]), svg[aria-label="Guardar"]:not([data-pip-managed]), svg[aria-label="Eliminar"]:not([data-pip-managed])');
            if (candidates.length) return normalizeToRole(getClosestCandidate(video, candidates));
            parent = parent.parentElement;
        }
        const allCandidates = document.querySelectorAll('svg[aria-label="Save"]:not([data-pip-managed]), svg[aria-label="Remove"]:not([data-pip-managed]), svg[aria-label="Guardar"]:not([data-pip-managed]), svg[aria-label="Eliminar"]:not([data-pip-managed])');
        return normalizeToRole(getClosestCandidate(video, allCandidates));
    }

    function getLikeButton(video) {
        if (!video) return null;
        if (video === lastVideo && cachedLikeBtn?.isConnected) return cachedLikeBtn;
        cachedLikeBtn = findLikeButton(video);
        lastVideo = video;
        return cachedLikeBtn;
    }

    function getFavoriteButton(video) {
        if (!video) return null;
        if (video === lastVideo && cachedFavBtn?.isConnected) return cachedFavBtn;
        cachedFavBtn = findFavoriteButton(video);
        lastVideo = video;
        return cachedFavBtn;
    }

    // -------- STATE DETECTION HELPERS --------

    function getLikeStatus(video) {
        const btn = getLikeButton(video);
        if (!btn) return false;

        const svg = btn.querySelector('svg') || (btn.tagName.toLowerCase() === 'svg' ? btn : null);
        if (!svg) return false;

        const label = (svg.getAttribute('aria-label') || '').toLowerCase();

        if (label === 'unlike' || label === 'ya no me gusta') return true;
        if (label === 'like' || label === 'me gusta') return false;

        const path = svg.querySelector('path');
        if (path) {
            const fill = (path.getAttribute('fill') || '').toUpperCase();
            if (fill === '#FF3040' || fill === 'RED') return true;
        }

        return false;
    }

    function getFavoriteStatus(video) {
        const btn = getFavoriteButton(video);
        if (!btn) return false;

        const svg = btn.querySelector('svg') || (btn.tagName.toLowerCase() === 'svg' ? btn : null);
        if (!svg) return false;

        const label = (svg.getAttribute('aria-label') || '').toLowerCase();
        if (label === 'remove' || label === 'eliminar') return true;
        if (label === 'save' || label === 'guardar') return false;

        return false;
    }

    // -------- STATE --------

    let lastBroadcastState = null;
    let monitoredVideo = null;

    const monitorState = () => {
        const video = getActiveVideo();
        if (!video) return;

        // Re-attach listeners if video changed
        if (video !== monitoredVideo) {
            if (monitoredVideo) {
                const events = ['play', 'pause', 'volumechange'];
                events.forEach(evt => monitoredVideo.removeEventListener(evt, monitorState));
            }

            monitoredVideo = video;
            lastBroadcastState = null; // Force update on video change

            const events = ['play', 'pause', 'volumechange'];
            events.forEach(evt => video.addEventListener(evt, monitorState));
        }

        const state = {
            liked: getLikeStatus(video),
            favorited: getFavoriteStatus(video),
            playing: !video.paused,
            volume: Math.round(video.volume * 100),
            muted: video.muted
        };

        const stateJSON = JSON.stringify(state);
        if (stateJSON !== lastBroadcastState) {
            lastBroadcastState = stateJSON;
            document.dispatchEvent(new CustomEvent('Instagram_State_Update', { detail: state }));
        }
    };

    // Reset cache when PiP enters
    document.addEventListener('enterpictureinpicture', () => {
        lastBroadcastState = null;
        setTimeout(monitorState, 100);
    });

    if (window.BridgeUtils.enableAutoSwitching) {
        window.BridgeUtils.enableAutoSwitching(monitorState);
    }

    if (window.BridgeUtils.enableAntiPause) {
        window.BridgeUtils.enableAntiPause(() => !!document.pictureInPictureElement);
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
        // Performance: Skip if not in PiP
        if (!document.pictureInPictureElement) return;

        const now = performance.now();
        if (now - lastScanTs < 100) return; // throttle 100ms
        lastScanTs = now;

        const video = getActiveVideo();
        if (!video) return;

        const likeBtnNow = getLikeButton(video);
        const favBtnNow = getFavoriteButton(video);

        // LIKE
        if (likeBtnNow !== lastActiveLikeBtn) {
            if (likeBtnObserver) likeBtnObserver.disconnect();
            if (likeClickController) likeClickController.abort();

            lastActiveLikeBtn = likeBtnNow;
            cachedLikeBtn = likeBtnNow ? normalizeToRole(likeBtnNow) : null;

            if (cachedLikeBtn) {
                likeClickController = new AbortController();
                cachedLikeBtn.addEventListener('click', () => {
                    setTimeout(monitorState, 60);
                    setTimeout(monitorState, 500);
                }, { passive: true, signal: likeClickController.signal });

                // We need to observe the inner svg or path where the color or label changes normally happen
                const targetObserved = cachedLikeBtn.querySelector('svg') || cachedLikeBtn;

                likeBtnObserver = new MutationObserver(() => {
                    setTimeout(() => { try { monitorState(); } catch (e) { } }, 30);
                });
                likeBtnObserver.observe(targetObserved, {
                    attributes: true,
                    attributeFilter: ['aria-label', 'class', 'style', 'fill'],
                    childList: true,
                    subtree: true
                });

                monitorState();
            }
        }

        // FAVORITE
        if (favBtnNow !== lastActiveFavBtn) {
            if (favBtnObserver) favBtnObserver.disconnect();
            if (favClickController) favClickController.abort();

            lastActiveFavBtn = favBtnNow;
            cachedFavBtn = favBtnNow ? normalizeToRole(favBtnNow) : null;

            if (cachedFavBtn) {
                favClickController = new AbortController();
                cachedFavBtn.addEventListener('click', () => {
                    setTimeout(monitorState, 60);
                    setTimeout(monitorState, 500);
                }, { passive: true, signal: favClickController.signal });

                const targetObserved = cachedFavBtn.querySelector('svg') || cachedFavBtn;

                favBtnObserver = new MutationObserver(() => {
                    setTimeout(() => { try { monitorState(); } catch (e) { } }, 30);
                });
                favBtnObserver.observe(targetObserved, {
                    attributes: true,
                    attributeFilter: ['aria-label', 'class', 'style', 'fill'],
                    childList: true,
                    subtree: true
                });

                monitorState();
            }
        }
    }

    // -------- STRUCTURAL OBSERVERS --------

    function setupStructuralObservers() {
        const rootObserver = new MutationObserver(() => {
            if (document.pictureInPictureElement) {
                monitorInteractiveElements();
            }
        });
        try {
            rootObserver.observe(document.body, { childList: true, subtree: true });
        } catch (e) {
            // Defensive: may fail inside some iframes
        }
    }

    setupStructuralObservers();
    monitorState();
    monitorInteractiveElements();

    // -------- CONTROL EVENTS --------

    document.addEventListener('Instagram_Control_Event', (e) => {
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
                            if (v.hasAttribute('disablePictureInPicture')) v.removeAttribute('disablePictureInPicture');
                            await v.requestPictureInPicture();
                        }
                        monitorState();
                    } catch { }
                })();
                break;

            case ACTIONS.EXIT_PIP:
                document.pictureInPictureElement?.ownerDocument.exitPictureInPicture?.();
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
                // Find all mute buttons (they often have aria-label "Toggle audio", "Alternar audio", etc. or contain specific SVGs)
                const muteBtnCandidates = document.querySelectorAll(
                    'button[aria-label="Toggle audio"], button[aria-label="Alternar audio"], ' +
                    'svg[aria-label="Audio is unmuted"], svg[aria-label="El audio no está silenciado"]'
                );
                const muteBtn = normalizeToRole(getClosestCandidate(video, muteBtnCandidates));

                if (muteBtn) {
                    // Check current state. If it's already muted, don't click it.
                    const svg = muteBtn.querySelector('svg') || (muteBtn.tagName.toLowerCase() === 'svg' ? muteBtn : null);
                    const label = svg ? (svg.getAttribute('aria-label') || '').toLowerCase() : '';

                    // If label says it's MUTED, we are already muted. Don't click.
                    // If it doesn't say it's muted, click to mute.
                    if (!label.includes('is muted') && !label.includes('está silenciado')) {
                        muteBtn.click();
                    }
                } else if (video) {
                    video.muted = true;
                }
                break;
            }

            case ACTIONS.UNMUTE: {
                const unmuteBtnCandidates = document.querySelectorAll(
                    'button[aria-label="Toggle audio"], button[aria-label="Alternar audio"], ' +
                    'svg[aria-label="Audio is muted"], svg[aria-label="El audio está silenciado"]'
                );
                const unmuteBtn = normalizeToRole(getClosestCandidate(video, unmuteBtnCandidates));

                if (unmuteBtn) {
                    // Check current state. If it's already unmuted, don't click it.
                    const svg = unmuteBtn.querySelector('svg') || (unmuteBtn.tagName.toLowerCase() === 'svg' ? unmuteBtn : null);
                    const label = svg ? (svg.getAttribute('aria-label') || '').toLowerCase() : '';

                    // If label says it's MUTED, click it to unmute.
                    if (label.includes('is muted') || label.includes('está silenciado')) {
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
                // Force fresh scan
                cachedLikeBtn = null;
                cachedFavBtn = null;
                lastVideo = null;
                monitorInteractiveElements();
                monitorState();
                break;
        }
    });

    // Bridge loaded silently
})();
