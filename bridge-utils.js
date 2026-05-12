(() => {
    if (window.__PIP_BRIDGE_LOADED__) return;
    window.__PIP_BRIDGE_LOADED__ = true;

    const ACTIONS = {
        SET_VOLUME: 'SET_VOLUME',
        MUTE: 'MUTE',
        UNMUTE: 'UNMUTE',
        TOGGLE_LIKE: 'TOGGLE_LIKE',
        TOGGLE_FAVORITE: 'TOGGLE_FAVORITE',
        NAVIGATE_VIDEO: 'NAVIGATE_VIDEO',
        CHECK_STATUS: 'CHECK_STATUS',
        TOGGLE_PLAY: 'TOGGLE_PLAY',
        REQUEST_PIP: 'REQUEST_PIP',
        EXIT_PIP: 'EXIT_PIP',
        FOCUS_PIP: 'FOCUS_PIP',
        SEEK: 'SEEK',
        PAUSE: 'PAUSE'
    };

    let cachedActiveVideo = null;
    let lastNavigationTime = 0;
    let _isNavigating = false;
    let _isInteracting = false;
    let _navTimer = null;
    let _interactionTimer = null;
    let _isSwitching = false;
    let _ghostMonitorTimer = null;
    let _ghostStartedAt = 0;
    let _isManualSession = false;
    let _autoSwitchPlayListener = null;
    const GHOST_PIP_CLOSE_AFTER_SECONDS = 1;
    const GHOST_PIP_MONITOR_INTERVAL_MS = 250;

    function clearInteraction() {
        _isInteracting = false;
        if (_interactionTimer) {
            clearTimeout(_interactionTimer);
            _interactionTimer = null;
        }
        try {
            document.documentElement.removeAttribute('data-pip-interaction');
        } catch (e) {}
    }

    function clearNavigation() {
        _isNavigating = false;
        if (_navTimer) {
            clearTimeout(_navTimer);
            _navTimer = null;
        }
        try {
            document.documentElement.removeAttribute('data-pip-navigating');
            window.dispatchEvent(new CustomEvent('PIP_NAV_STABLE'));
        } catch (e) {}
    }

    function signalNavigation() {
        lastNavigationTime = Date.now();
        _isNavigating = true;
        try {
            document.documentElement.setAttribute('data-pip-navigating', 'true');
            window.dispatchEvent(new CustomEvent('PIP_NAVIGATING'));
        } catch (e) {}

        if (_navTimer) clearTimeout(_navTimer);
        _navTimer = setTimeout(clearNavigation, 800);
    }

    function signalInteraction() {
        _isInteracting = true;
        try {
            document.documentElement.setAttribute('data-pip-interaction', 'true');
        } catch (e) {}

        if (_interactionTimer) clearTimeout(_interactionTimer);
        _interactionTimer = setTimeout(clearInteraction, INTERACTION_GRACE_MS);

        // This will also trigger signalNavigation and its cleanup timer
        signalNavigation();
    }

    function isNavigating() {
        const _nav = _isNavigating || document.documentElement.hasAttribute('data-pip-navigating');
        if (_nav) return true;

        const v = getActiveVideoFast();
        // Fallback: If video is completely unloaded (readyState 0), treat as navigating to avoid stale data
        if (v && v.readyState === 0) return true;

        return false;
    }

    function isInteracting() {
        return _isInteracting || document.documentElement.hasAttribute('data-pip-interaction');
    }

    // --- Ghost PiP Safety (Auto-close after configured seconds of empty video) ---
    function startGhostMonitor() {
        if (_ghostMonitorTimer) return;
        _ghostStartedAt = 0;
        _ghostMonitorTimer = setInterval(() => {
            const pip = document.pictureInPictureElement;
            if (!pip) {
                stopGhostMonitor();
                return;
            }

            // signalNavigation() is still used by UI/state logic, but it no longer delays ghost closing.
            // A PiP is a "ghost" if the video is stripped from the DOM or has no data.
            // [CRITICAL EXEMPTION]: Manual selections (from grids/profiles, including side previews)
            // are 100% EXEMPT from the ghost monitor. Platforms like TikTok often completely destroy the
            // <video> element from the DOM when you stop hovering a thumbnail preview. If the user explicitly
            // chose this video, we must not auto-close it.
            const isGhost = _isManualSession
                ? false // NEVER auto-close manual PiP sessions
                : (!pip.isConnected || pip.readyState === 0);

            if (isGhost) {
                if (!_ghostStartedAt) _ghostStartedAt = Date.now();
                const ghostElapsedMs = Date.now() - _ghostStartedAt;
                if (ghostElapsedMs >= GHOST_PIP_CLOSE_AFTER_SECONDS * 1000) {
                    // Try to exit PiP. If the element is detached, this may fail, so we also broadcast the exit.
                    document.exitPictureInPicture().catch(() => {});

                    // Forcefully notify the extension that PiP has ended via the universal utility relay.
                    // This ensures all UI 'ghost' panels (volume, buttons) are cleaned up even if the video is gone.
                    window.dispatchEvent(new CustomEvent('PIP_AUTO_CLOSED'));

                    stopGhostMonitor();
                }
            } else {
                _ghostStartedAt = 0;
            }
        }, GHOST_PIP_MONITOR_INTERVAL_MS);
    }

    function stopGhostMonitor() {
        if (_ghostMonitorTimer) {
            clearInterval(_ghostMonitorTimer);
            _ghostMonitorTimer = null;
        }
        _ghostStartedAt = 0;
    }

    // --- Unified Navigation Listener ---
    function setupNavigationListeners() {
        // Detect Scroll
        const onScrollIntent = () => signalInteraction();
        window.addEventListener('wheel', onScrollIntent, { passive: true });
        window.addEventListener('mousewheel', onScrollIntent, { passive: true });
        window.addEventListener('touchstart', onScrollIntent, { passive: true });

        // --- Session Tracking (Manual vs Auto) ---
        window.addEventListener('enterpictureinpicture', (e) => {
            // Check if this PiP was triggered by the manual selector tool
            // We check both the global window flag AND the DOM attribute for cross-world compatibility
            _isManualSession = !!(window.__pipExt && window.__pipExt.isSelector) ||
                              (e.target && e.target.hasAttribute('data-pip-is-selector'));

        }, true);

        window.addEventListener('leavepictureinpicture', () => {
            _isManualSession = false;
        }, true);

        // Detect Keys
        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.keyCode === 38 || e.keyCode === 40) {
                signalInteraction();
            }
        }, { passive: true });

        // SPA Navigation (History API)
        const patch = (type) => {
            const original = history[type];
            history[type] = function() {
                const result = original.apply(this, arguments);
                signalNavigation();
                return result;
            };
        };
        patch('pushState');
        patch('replaceState');

        window.addEventListener('popstate', () => signalNavigation());
    }

    // Initialize listeners
    setupNavigationListeners();

    // Universal PiP monitoring
    window.addEventListener('enterpictureinpicture', startGhostMonitor, true);
    window.addEventListener('leavepictureinpicture', stopGhostMonitor, true);

    function isEligibleForPiP(video, rect) {
        if (!video) return false;
        const r = rect || video.getBoundingClientRect();
        // Ignore very small videos relative to viewport (likely previews/thumbnails)
        // At least 20% of viewport width and non-zero height
        return r.width >= window.innerWidth * 0.20 && r.height > 0;
    }

    function getVideoFromViewportCenter() {
        const x = window.innerWidth / 2;
        const y = window.innerHeight / 2;

        let el = document.elementFromPoint(x, y);

        while (el && el !== document.body) {
            if (el.tagName === 'VIDEO') return el;
            el = el.parentElement;
        }

        return null;
    }

    function computeActiveVideo() {
        if (document.pictureInPictureElement) {
            cachedActiveVideo = document.pictureInPictureElement;
            return cachedActiveVideo;
        }

        // FAST PATH: video en el centro del viewport
        const centerVideo = getVideoFromViewportCenter();
        if (centerVideo && isEligibleForPiP(centerVideo)) {
            cachedActiveVideo = centerVideo;
            return cachedActiveVideo;
        }

        const videos = document.getElementsByTagName('video');
        if (!videos.length) return cachedActiveVideo;

        const items = [];

        for (const v of videos) {
            const r = v.getBoundingClientRect();

            if (
                r.bottom > 0 &&
                r.top < window.innerHeight &&
                isEligibleForPiP(v, r)
            ) {
                items.push({ v, r });
            }
        }

        if (!items.length) return cachedActiveVideo;

        const viewportCenterY = window.innerHeight / 2;

        const playing = items
            .filter(({ v }) => !v.paused)
            .sort((a, b) => {
                const aCenter = a.r.top + a.r.height / 2;
                const bCenter = b.r.top + b.r.height / 2;
                return Math.abs(aCenter - viewportCenterY) -
                    Math.abs(bCenter - viewportCenterY);
            });

        if (playing.length) {
            cachedActiveVideo = playing[0].v;
            return cachedActiveVideo;
        }

        let closest = null;
        let closestDistance = Infinity;

        for (const { v, r } of items) {
            const centerY = r.top + r.height / 2;
            const distance = Math.abs(centerY - viewportCenterY);

            if (distance < closestDistance) {
                closestDistance = distance;
                closest = v;
            }
        }

        cachedActiveVideo = closest;
        return cachedActiveVideo;
    }

    function getActiveVideoFast() {
        return document.pictureInPictureElement ||
            cachedActiveVideo ||
            computeActiveVideo();
    }

    function refreshActiveVideo() {
        computeActiveVideo();
    }

    ['play', 'pause', 'loadedmetadata'].forEach(evt => {
        document.addEventListener(evt, refreshActiveVideo, true);
    });

    let scrollScheduled = false;

    document.addEventListener('scroll', () => {
        if (scrollScheduled) return;

        scrollScheduled = true;

        requestAnimationFrame(() => {
            scrollScheduled = false;
            refreshActiveVideo();
        });

    }, { passive: true });

    window.addEventListener('resize', refreshActiveVideo);

    function getClosestCandidate(video, candidates, options = {}) {
        if (!video || !candidates || candidates.length === 0) return null;

        const maxMultiplier = options.maxMultiplier || 2.25;
        const checkVisibility = options.checkVisibility;

        let closestBtn = null;
        let closestDistanceSq = Infinity;

        const videoRect = video.getBoundingClientRect();
        const centerX = videoRect.left + videoRect.width / 2;
        const centerY = videoRect.top + videoRect.height / 2;

        for (const candidate of candidates) {
            // IGNORE extension UI to prevent feedback loops
            if (candidate.hasAttribute?.('data-pip-managed')) continue;

            const btn = normalizeToButton(candidate);

            if (!btn || btn.hasAttribute('data-pip-managed')) continue;

            if (checkVisibility && (!checkVisibility(candidate) || !checkVisibility(btn))) continue;

            const rect = btn.getBoundingClientRect();

            if (!rect.width || !rect.height) continue;

            const btnX = rect.left + rect.width / 2;
            const btnY = rect.top + rect.height / 2;

            const dist =
                (centerX - btnX) ** 2 +
                (centerY - btnY) ** 2;

            if (dist < closestDistanceSq) {
                closestDistanceSq = dist;
                closestBtn = btn;
            }
        }

        const maxDistanceSq =
            Math.max(videoRect.height, videoRect.width) ** 2 * maxMultiplier;

        if (closestDistanceSq < maxDistanceSq) {
            return closestBtn;
        }

        return null;
    }

    let _pipObserver = null;
    let _pipMutationObserver = null;

    function findFeedContainer() {
        const videos = document.querySelectorAll('video');

        for (const v of videos) {
            let el = v.parentElement;

            while (el && el !== document.body) {
                const style = getComputedStyle(el);

                const isScrollable =
                    style.overflowY === 'auto' ||
                    style.overflowY === 'scroll';

                if (
                    isScrollable &&
                    el.clientHeight > window.innerHeight * 0.6
                ) {
                    return el;
                }

                el = el.parentElement;
            }
        }

        return null;
    }

    function switchToVideo(newVideo, onSwitchCallback) {
        const currentPiP = document.pictureInPictureElement;
        if (!newVideo || newVideo === currentPiP || _isSwitching) return;

        signalNavigation();
        _isSwitching = true;

        const performSwitch = () => {
            newVideo.removeAttribute('disablePictureInPicture');
            newVideo.requestPictureInPicture()
                .then(() => {
                    clearNavigation();
                    // Force an immediate state broadcast for the new video
                    if (onSwitchCallback) onSwitchCallback(newVideo, true);
                    newVideo.play().catch(() => { });
                    setTimeout(() => {
                        _isSwitching = false;
                        if (typeof refreshActiveVideo === 'function') {
                            refreshActiveVideo();
                        }
                    }, 150);
                })
                .catch(() => {
                    _isSwitching = false;
                });
        };

        if (newVideo.readyState >= 1) performSwitch();
        else newVideo.addEventListener('loadedmetadata', performSwitch, { once: true });
    }

    /**
     * Generalized helper to enable fast PiP switching based on DOM attributes (e.g. is-active).
     * Bypasses IntersectionObserver for near-instant transitions.
     */
    function enableFastVideoSwitching(options = {}) {
        const { containerSelector, attribute = 'is-active', onSwitch } = options;
        const container = document.querySelector(containerSelector);
        if (!container) return null;

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                if (m.type === 'attributes' && m.attributeName === attribute && m.target.hasAttribute(attribute)) {
                    const newVideo = m.target.querySelector('video');
                    if (newVideo && document.pictureInPictureElement) {
                        switchToVideo(newVideo, onSwitch);
                    }
                }
            });
        });

        observer.observe(container, {
            attributes: true,
            attributeFilter: [attribute],
            subtree: true
        });

        return observer;
    }

    function enableAutoSwitching(onSwitchCallback, shouldSwitchFn = null) {
        if (_pipObserver) return;

        // Store callback globally within bridge context for the natural play switch
        window.BridgeUtils._onSwitchCallback = onSwitchCallback;

        const feed = findFeedContainer() || null;
        const observed = new WeakSet();

        // 1. Natural Play Switch: If a new video starts playing, it's likely the user's focus.
        // This handles cases where IntersectionObserver might be slow or platform attributes are missing.
        _autoSwitchPlayListener = (e) => {
            const currentPiP = document.pictureInPictureElement;
            if (!currentPiP || _isSwitching) return;

            const newVideo = e.target;
            if (newVideo.tagName === 'VIDEO' && newVideo !== currentPiP) {
                // If the new video is highly visible and playing, take over PiP.
                // We add a tiny delay to allow the browser to settle and ensure it's not a background pre-roll.
                requestAnimationFrame(() => {
                    const r = newVideo.getBoundingClientRect();
                    if (isEligibleForPiP(newVideo, r) && !newVideo.paused && (!shouldSwitchFn || shouldSwitchFn(newVideo))) {
                        switchToVideo(newVideo, onSwitchCallback);
                    }
                });
            }
        };
        document.addEventListener('play', _autoSwitchPlayListener, true);

        // 2. IntersectionObserver: Standard fallback for scrolling without autoplay, or for pre-emptive swaps.
        _pipObserver = new IntersectionObserver((entries) => {
            if (!document.pictureInPictureElement) return;

            const isLocked = document.documentElement.hasAttribute('data-pip-selector-locked');
            if (isLocked) return;

            const visibleEntry = entries
                .filter(e => {
                    if (!e.isIntersecting) return false;
                    return isEligibleForPiP(e.target, e.boundingClientRect);
                })
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

            if (!visibleEntry) return;

            const newVideo = visibleEntry.target;
            const currentPiP = document.pictureInPictureElement;

            if (currentPiP && newVideo !== currentPiP && !_isSwitching) {
                // STABILITY CHECK: If current video is still highly visible, don't switch.
                const rect = currentPiP.getBoundingClientRect();
                const vh = window.innerHeight;
                const vw = window.innerWidth;
                const visibleHeight = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
                const visibleWidth = Math.min(rect.right, vw) - Math.max(rect.left, 0);
                const visibleArea = Math.max(0, visibleWidth) * Math.max(0, visibleHeight);
                const totalArea = rect.width * rect.height;

                if (totalArea > 0 && (visibleArea / totalArea) > 0.8) {
                    return; // Current video is stable, ignore switch.
                }

                if (!shouldSwitchFn || shouldSwitchFn(newVideo)) {
                    switchToVideo(newVideo, onSwitchCallback);
                }
            }

        }, {
            root: feed,
            threshold: 0.3 // Lower threshold for earlier detection
        });

        const observeVideo = (v) => {
            if (!v) return;
            if (observed.has(v)) return;
            if (v === document.pictureInPictureElement) return;

            observed.add(v);
            _pipObserver.observe(v);
        };

        const root = feed || document;

        root.querySelectorAll('video').forEach(observeVideo);

        // Force layout calculation to warm up IntersectionObserver rects
        requestAnimationFrame(() => {
            root.querySelectorAll('video')
                .forEach(v => v.getBoundingClientRect());
        });

        _pipMutationObserver = new MutationObserver((muts) => {
            muts.forEach(m => {
                m.addedNodes.forEach(node => {

                    if (node.nodeName === 'VIDEO') observeVideo(node);
                    if (node.querySelectorAll)
                        node.querySelectorAll('video')
                            .forEach(observeVideo);
                });

            });

        });

        _pipMutationObserver.observe(feed || document.body, {
            childList: true,
            subtree: true
        });
    }

    function disableAutoSwitching() {
        _pipObserver?.disconnect();
        _pipMutationObserver?.disconnect();
        if (_autoSwitchPlayListener) {
            document.removeEventListener('play', _autoSwitchPlayListener, true);
            _autoSwitchPlayListener = null;
        }

        _pipObserver = null;
        _pipMutationObserver = null;
    }

    function enableAntiPause(isPipActiveFn) {
        let lastHiddenTime = 0;
        let shouldBlockResume = false;
        let resumeBlockTime = 0;

        document.addEventListener('play', (e) => {
            if (!isPipActiveFn()) return;
            if (e.target !== getActiveVideoFast()) return;

            if (shouldBlockResume &&
                (Date.now() - resumeBlockTime < 500)
            ) {
                e.target.pause();
                shouldBlockResume = false;
                e.stopImmediatePropagation();
            }

        }, true);

        let lastForcePlay = 0;

        document.addEventListener('pause', (e) => {
            if (!isPipActiveFn()) return;
            if (e.target !== getActiveVideoFast()) return;

            if (document.hidden) {

                const timeSinceHide =
                    Date.now() - lastHiddenTime;

                if (
                    (timeSinceHide < 1000 || (Date.now() - lastNavigationTime < 2000)) &&
                    Date.now() - lastForcePlay > 1000
                ) {
                    lastForcePlay = Date.now();
                    e.target.play().catch(() => { });
                    e.stopImmediatePropagation();
                }
            }

        }, true);

        document.addEventListener(
            "visibilitychange",
            () => {
                if (document.hidden) {
                    lastHiddenTime = Date.now();
                } else {
                    const video = getActiveVideoFast();

                    if (
                        isPipActiveFn() &&
                        video &&
                        video.paused
                    ) {
                        shouldBlockResume = true;
                        resumeBlockTime = Date.now();

                        setTimeout(() => {
                            shouldBlockResume = false;
                        }, 500);
                    }
                }
            }
        );
    }

    document.addEventListener(
        'leavepictureinpicture',
        () => {
            document.documentElement
                .removeAttribute('data-pip-selector-locked');
        }
    );

    // -------- SHARED HELPERS (used by platform bridges) --------

    /**
     * Traverses up from a node to find the closest <button> ancestor, or returns the node itself.
     * Identical logic was previously duplicated in TikTok and YouTube bridges.
     */
    function normalizeToButton(node) {
        if (!node) return null;
        if (node.tagName && node.tagName.toLowerCase() === 'button') return node;
        if (node.getAttribute && node.getAttribute('role') === 'button') return node;
        const btn = node.closest ? node.closest('button, [role="button"]') : null;
        return btn || node;
    }

    /**
     * Generic PiP toggle: if already in PiP, exit; otherwise request PiP.
     * @param {Object} opts
     * @param {Function} opts.getVideo - Returns the video element to use
     * @param {Function} [opts.preSync] - Optional pre-sync callback before requesting PiP (e.g. clear caches, monitorState)
     */
    async function handleRequestPip({ getVideo, preSync }) {
        const v = getVideo();
        if (!v) return;
        try {
            if (document.pictureInPictureElement === v) {
                await document.exitPictureInPicture();
            } else {
                if (typeof preSync === 'function') preSync(v);
                if (v.hasAttribute('disablePictureInPicture')) v.removeAttribute('disablePictureInPicture');
                await v.requestPictureInPicture();
                clearNavigation();
            }
        } catch (e) { /* Safe catch */ }
    }

    /**
     * Re-focuses the PiP window by exiting and re-entering PiP.
     * Identical logic in all 3 bridges.
     */
    function handleFocusPip() {
        const pipV = document.pictureInPictureElement;
        if (!pipV) return;
        document.exitPictureInPicture().then(() => {
            setTimeout(() => pipV.requestPictureInPicture().catch(() => { }), 100);
        }).catch(() => { });
    }

    /**
     * Generic mute/unmute handler.
     * @param {HTMLVideoElement} video
     * @param {boolean} shouldMute
     * @param {Function} findMuteBtn - Platform-specific mute button finder: (video) => Element|null
     * @param {Object} [playerApi] - Optional player API object with mute/unMute/isMuted methods (YouTube)
     */
    function handleMuteUnmute(video, shouldMute, findMuteBtn, playerApi) {
        if (!video) return;
        const muteBtn = findMuteBtn(video);
        if (muteBtn) {
            if (video.muted !== shouldMute) muteBtn.click();
        } else if (playerApi) {
            if (shouldMute) {
                if (typeof playerApi.mute === 'function') playerApi.mute(); else video.muted = true;
            } else {
                if (typeof playerApi.unMute === 'function') playerApi.unMute(); else video.muted = false;
            }
        } else {
            video.muted = shouldMute;
        }
    }

    /**
     * Generic volume setter with auto-unmute.
     * @param {HTMLVideoElement} video
     * @param {number} value - Volume 0-100
     * @param {Function} setVolFn - Platform-specific volume setter: (video, volume0to100) => void
     * @param {Function} handleMuteFn - Mute handler for auto-unmute: (video, shouldMute) => void
     */
    function handleSetVolume(video, value, setVolFn, handleMuteFn) {
        if (!video || !Number.isFinite(value)) return;
        const vol = Math.max(0, Math.min(1, value / 100));
        if (vol > 0 && video.muted) handleMuteFn(video, false);
        setVolFn(video, Math.round(vol * 100));
    }

    /**
     * Generalized live-status detector.
     * @param {HTMLVideoElement} video
     * @param {string|string[]} extraSelectors - Platform-specific live indicators
     * @param {Element} [root] - Optional root element to scope the search
     * @returns {boolean}
     */
    function detectIsLive(video, extraSelectors = [], root = null) {
        if (!video) return false;
        const durationIsLive = video.duration === Infinity || !Number.isFinite(video.duration);
        if (durationIsLive) return true;

        const selectors = Array.isArray(extraSelectors) ? extraSelectors : [extraSelectors];
        const searchRoot = root || document;
        for (const sel of selectors) {
            if (searchRoot.querySelector(sel)) return true;
        }
        return false;
    }

    /**
     * Generalized state monitoring block.
     * @param {Object} opts
     * @param {string} opts.platform - e.g. 'tiktok'
     * @param {Function} opts.getLikeStatus - (video) => boolean
     * @param {Function} opts.getFavoriteStatus - (video) => boolean
     * @param {Function} opts.detectIsLive - (video) => boolean
     * @param {Function} opts.extendState - (state, video) => object
     * @param {Function} opts.onStateChange - (state) => void
     * @returns {Function} monitorState function
     */
    function createMonitorState(opts) {
        let lastState = null;

        return (targetVideo, currentPiP, e, forceBroadcast = false) => {
            if (!targetVideo) return;

            // Basic guard: If no PiP and not forcing, ignore.
            if (!currentPiP && !forceBroadcast) return;

            const playing = !targetVideo.paused;
            // Removed the old navigation guard as it was blocking specialized UI states (like TikTok's minimalist loader).
            // Individual platform bridges now manage their own UI stability during transitions.

            const state = {
                playing,
                volume: Math.round(targetVideo.volume * 100),
                muted: targetVideo.muted,
                liked: opts.getLikeStatus ? opts.getLikeStatus(targetVideo) : false,
                favorited: opts.getFavoriteStatus ? opts.getFavoriteStatus(targetVideo) : false,
                isLive: opts.detectIsLive ? opts.detectIsLive(targetVideo) : false
            };

            if (opts.extendState) {
                Object.assign(state, opts.extendState(state, targetVideo) || {});
            }

            if (!forceBroadcast && lastState && Object.keys(state).every(k => state[k] === lastState[k])) return;

            lastState = state;
            opts.onStateChange(state);
        };
    }

    /**
     * Generic seeking handler.
     */
    function handleSeek(video, delta) {
        if (!video || !Number.isFinite(delta)) return;
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
    }

    /**
     * BaseBridge factory to create a unified platform bridge.
     * Encapsulates standard event listeners and message handling.
     */
    function createBaseBridge(options) {
        const {
            platform,
            getVideo,
            onStateChange,
            getLikeStatus,
            getFavoriteStatus,
            detectIsLive,
            extendState,
            findMuteBtn = () => null,
            getPlayer = () => null,
            supportedActions = {}
        } = options;

        let lastAttachedVideo = null;

        const internalMonitorState = createMonitorState({
            getLikeStatus,
            getFavoriteStatus,
            detectIsLive,
            extendState,
            onStateChange
        });

        const monitorState = (e, forceBroadcast = false) => {
            const currentPiP = document.pictureInPictureElement;
            const targetVideo = currentPiP || (e instanceof HTMLVideoElement ? e : (e?.target instanceof HTMLVideoElement ? e.target : getActiveVideoFast()));

            const videoChanged = targetVideo && targetVideo !== lastAttachedVideo;
            const pipClosed = !currentPiP && lastAttachedVideo;

            if (videoChanged || pipClosed) {
                if (lastAttachedVideo) {
                    removeVideoStateListeners(lastAttachedVideo);
                }

                if (currentPiP && targetVideo) {
                    addVideoStateListeners(targetVideo);
                    lastAttachedVideo = targetVideo;
                } else {
                    lastAttachedVideo = null;
                }

                forceBroadcast = true;
            }

            return internalMonitorState(targetVideo, currentPiP, e, forceBroadcast);
        };

        const eventMap = {
            'play': (e) => monitorState(e),
            'playing': (e) => monitorState(e),
            'pause': (e) => monitorState(e),
            'volumechange': (e) => monitorState(e),
            'ratechange': (e) => monitorState(e),
            'seeked': (e) => monitorState(e),
            'enterpictureinpicture': () => monitorState(null, true),
            'leavepictureinpicture': () => monitorState(null, true)
        };

        function addVideoStateListeners(video) {
            if (!video) return;
            for (const [evt, handler] of Object.entries(eventMap)) {
                video.addEventListener(evt, handler);
            }
        }

        function removeVideoStateListeners(video) {
            if (!video) return;
            for (const [evt, handler] of Object.entries(eventMap)) {
                video.removeEventListener(evt, handler);
            }
        }

        return {
            monitorState,
            addVideoStateListeners,
            removeVideoStateListeners,

            // Standard message dispatcher for the bridge
            handleMessage: (msg) => {
                const video = getVideo();
                if (!video) return null;

                // 1. Check if it's a platform-specific action (OR an override)
                if (supportedActions[msg.action]) {
                    const result = supportedActions[msg.action](video, msg);
                    if (result?.handled) return result;
                }

                // 2. Fall back to standard logic
                switch (msg.action) {
                    case ACTIONS.SET_VOLUME:
                        handleSetVolume(video, msg.value, (v, vol) => {
                            const p = getPlayer(v);
                            if (typeof p?.setVolume === 'function') p.setVolume(vol); else v.volume = vol / 100;
                        }, (v, muted) => handleMuteUnmute(v, muted, findMuteBtn, getPlayer(v)));
                        return { handled: true };
                    case ACTIONS.MUTE:
                        handleMuteUnmute(video, true, findMuteBtn, getPlayer(video));
                        return { handled: true };
                    case ACTIONS.UNMUTE:
                        handleMuteUnmute(video, false, findMuteBtn, getPlayer(video));
                        return { handled: true };
                    case ACTIONS.TOGGLE_PLAY:
                        if (video.paused) video.play().catch(() => {}); else video.pause();
                        return { handled: true };
                    case ACTIONS.SEEK:
                        handleSeek(video, msg.delta ?? msg.value ?? msg.offset);
                        return { handled: true };
                    case ACTIONS.REQUEST_PIP:
                        handleRequestPip({ getVideo });
                        return { handled: true };
                    case ACTIONS.EXIT_PIP:
                        if (document.pictureInPictureElement) {
                            const video = document.pictureInPictureElement;
                            document.exitPictureInPicture().catch(() => {});
                            // Force pause for manual selections on exit via button
                            if (_isManualSession && video) {
                                video.pause();
                            }
                        }
                        return { handled: true };
                    case ACTIONS.FOCUS_PIP:
                        handleFocusPip();
                        return { handled: true };
                    default:
                        return null;
                }
            }
        };
    }

    window.BridgeUtils = {
        ACTIONS,
        createBaseBridge,
        getActiveVideo: getActiveVideoFast,
        getClosestCandidate,
        enableAutoSwitching,
        disableAutoSwitching,
        enableFastVideoSwitching,
        enableAntiPause,
        signalNavigation,
        signalInteraction,
        clearNavigation,
        isNavigating,
        isInteracting,
        switchToVideo,
        normalizeToButton,
        handleRequestPip,
        handleFocusPip,
        handleMuteUnmute,
        handleSetVolume,
        detectIsLive,
        createMonitorState,
        _refreshActiveVideo: refreshActiveVideo
    };

})();
    const INTERACTION_GRACE_MS = 1500;
