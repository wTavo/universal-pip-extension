(() => {
    if (window.__YOUTUBE_PIP_BRIDGE_LOADED__) return;
    window.__YOUTUBE_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[YouTube Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const {
        ACTIONS,
        getActiveVideo,
        getClosestCandidate,
        enableAutoSwitching,
        signalNavigation,
        touchNavigation,
        normalizeToButton,
        handleRequestPip,
        detectIsLive,
        createBaseBridge
    } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const SELECTORS = {
        LIKE_BTN_GROUP: '#segmented-like-button button:not([data-pip-managed]), like-button-view-model button:not([data-pip-managed]), #top-level-buttons-computed ytd-toggle-button-renderer button:not([data-pip-managed])',
        SHORTS_LIKE_BTN: '#like-button button, like-button-view-model button, #like-button ytd-toggle-button-renderer button',
        SHORTS_RENDERER: 'ytd-reel-video-renderer[is-active]',
        MUTE_BTN: 'button.ytp-mute-button, button.ytdVolumeControlsMuteIconButton',
        PLAYER_CONTAINER: '.html5-video-player',
        LIVE_BADGE: '.ytp-live, [data-layer="badge-label"]',
        PLAYER_AD_MARKER: '.ytp-ad-player-overlay, .ytp-ad-module, .ytp-ad-text, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-preview-container',
        SHORTS_AD_MARKER: 'ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, .ytd-ad-slot-renderer',
        SKIP_AD_BTN: '.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button'
    };




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

    function isVisibleElement(el) {
        if (!el || !el.isConnected) return false;
        const rect = el.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle?.(el);
        return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
    }

    function getActiveShortRoot(video) {
        if (!video) return null;
        return video.closest('ytd-reel-video-renderer') || document.querySelector(SELECTORS.SHORTS_RENDERER);
    }

    function findMuteButton(video) {
        if (!video) return null;
        const candidates = document.querySelectorAll(SELECTORS.MUTE_BTN);
        return getClosestCandidate(video, candidates);
    }

    // Fixed naming convention (detectIsLiveLocal instead of detectIsLive) to avoid shadowing imported helper
    function detectIsLiveLocal(video) {
        return detectIsLive(video, [SELECTORS.LIVE_BADGE]);
    }

    function detectIsAdLocal(video) {
        const player = getPlayer(video);
        if (player?.classList?.contains('ad-showing')) return true;

        if (player) {
            const playerMarkers = Array.from(player.querySelectorAll(SELECTORS.PLAYER_AD_MARKER));
            if (playerMarkers.some(isVisibleElement)) return true;
        }

        const shortRoot = getActiveShortRoot(video);
        if (!shortRoot) return false;

        const shortMarkers = Array.from(shortRoot.querySelectorAll(SELECTORS.SHORTS_AD_MARKER));
        return shortMarkers.some(isVisibleElement);
    }

    // Checking Skip Ad Availability
    function detectCanSkipAd(logPrefix) {
        const buttons = document.querySelectorAll(SELECTORS.SKIP_AD_BTN);
        if (!buttons.length) {
            if (logPrefix) console.debug(`[PiP-Skip ${logPrefix}] no skip btn in DOM`);
            return false;
        }
        for (const btn of buttons) {
            if (!btn.isConnected) continue;
            const rect = btn.getBoundingClientRect?.();
            if (!rect || rect.width <= 0 || rect.height <= 0) continue;
            const style = window.getComputedStyle?.(btn);
            if (!style || style.display === 'none' || style.visibility === 'hidden') continue;
            const opacity = parseFloat(style.opacity);
            if (opacity >= 0.9) {
                if (logPrefix) console.debug(`[PiP-Skip ${logPrefix}] btn found opacity=${opacity} class="${btn.className}" text="${btn.textContent?.trim()}"`);
                return true;
            }
        }
        if (logPrefix) console.debug(`[PiP-Skip ${logPrefix}] no clickable skip btn found among ${buttons.length} candidates`);
        return false;
    }


    let lastReportedAdState = null;
    let lastReportedCanSkipState = null;
    let _skipAdIntervalId = null;
    const documentPip = {
        win: null,
        video: null,
        placeholder: null,
        resizeListener: null,   // managed by BridgeUtils.switchDocumentPipVideo / openDocumentPip
        lastState: null,
        volumeTimer: null,
        closeIsSwitch: false
    };

    // Reference getter for active PiP target
    function getBridgeVideo() {
        return documentPip.video || getActiveVideo();
    }

    function reportAdStateIfChanged(force = false) {
        if (!document.pictureInPictureElement && !documentPip.video) return;
        const video = document.pictureInPictureElement || getBridgeVideo();
        const isAd = detectIsAdLocal(video);
        const canSkipAd = isAd ? detectCanSkipAd() : false;
        if (!force && isAd === lastReportedAdState && canSkipAd === lastReportedCanSkipState) return;
        lastReportedAdState = isAd;
        lastReportedCanSkipState = canSkipAd;
        document.dispatchEvent(new CustomEvent('YouTube_State_Update', { detail: { isAd, canSkipAd } }));
    }

    // -------- BASE BRIDGE INITIALIZATION --------

    const baseBridge = createBaseBridge({
        platform: 'youtube',
        getVideo: getBridgeVideo,
        getLikeStatus,
        detectIsLive: detectIsLiveLocal,
        findMuteBtn: findMuteButton,
        getPlayer,
        extendState: (state, video) => {
            const isShorts = window.location.href.includes('/shorts/');
            return {
                isShorts,
                supportsNavigation: isShorts
            };
        },
        onStateChange: (state) => {
            state.isAd = detectIsAdLocal(document.pictureInPictureElement || getActiveVideo());
            state.canSkipAd = state.isAd ? detectCanSkipAd() : false;
            lastReportedAdState = state.isAd;
            lastReportedCanSkipState = state.canSkipAd;
            updateDocumentPipUi(state);
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
            },
            REQUEST_DOCUMENT_PIP: () => openDocumentPip(),
            CLOSE_DOCUMENT_PIP: () => {
                documentPip.closeIsSwitch = true;
                closeDocumentPip({ notify: false });
                return { handled: true };
            },
            [ACTIONS.EXIT_PIP]: () => {
                if (documentPip.video) {
                    closeDocumentPip();
                    return { handled: true };
                }
                return null;
            },
            [ACTIONS.SKIP_AD]: () => {
                if (signalNavigation) signalNavigation();

                // Clear any existing interval to ensure a fresh click sequence every time the user presses skip
                if (_skipAdIntervalId) {
                    clearInterval(_skipAdIntervalId);
                    _skipAdIntervalId = null;
                }

                const buttons = Array.from(document.querySelectorAll(SELECTORS.SKIP_AD_BTN));
                const vid = getBridgeVideo();

                // Attempts skip mechanisms in priority order.
                function forceAdSkip(bList, v, forceEnd) {
                    if (window.movie_player && typeof window.movie_player.skipAd === 'function') {
                        try { window.movie_player.skipAd(); } catch (_) {}
                    }

                    for (const b of bList) {
                        if (b?.isConnected) {
                            try {
                                b.click();
                            } catch (_) {}
                        }
                    }

                    // For the brand slate, we attempt graceful API bypass and visual hiding.
                    // We DO NOT throw errors or delete DOM nodes, as this breaks PiP and the video session.
                    const interstitial = document.querySelector('.ytp-video-interstitial-buttoned-centered-layout');
                    if (interstitial && interstitial.isConnected) {
                        try {
                            if (window.movie_player && typeof window.movie_player.cancelPlayback === 'function') {
                                window.movie_player.cancelPlayback();
                            }
                            interstitial.style.opacity = '0';
                            interstitial.style.pointerEvents = 'none';
                            document.querySelectorAll('.ytp-black-overlay').forEach(el => {
                                el.style.opacity = '0';
                                el.style.pointerEvents = 'none';
                            });
                        } catch (e) {}
                        return; // Prevent fast-forwarding the main video
                    }

                    // Only force video end if we are sure it's an ad playing.
                    if (forceEnd && v && !v.paused && isFinite(v.duration) && v.duration > 0 && v.duration < 900) {
                        try {
                            v.playbackRate = 16;
                            v.currentTime = v.duration - 0.1;
                        } catch (_) {}
                    }
                }

                // Initial attempt: force instantly for a snappy reaction
                forceAdSkip(buttons, vid, true);

                let remaining = 60;
                _skipAdIntervalId = setInterval(() => {
                    const hasPip = !!document.pictureInPictureElement || !!documentPip.video;
                    if (!hasPip || --remaining <= 0) {
                        clearInterval(_skipAdIntervalId);
                        _skipAdIntervalId = null;
                        return;
                    }
                    const v = getBridgeVideo();
                    const isAd = detectIsAdLocal(v);
                    const canSkip = detectCanSkipAd();
                    if (!isAd && !canSkip) {
                        // The ad sequence is completely gone. Ensure the main video resumes!
                        if (v && v.paused) {
                            try {
                                HTMLMediaElement.prototype.play.call(v);
                            } catch (_) {
                                try { v.play(); } catch (__) {}
                            }
                        }
                        clearInterval(_skipAdIntervalId);
                        _skipAdIntervalId = null;
                        return;
                    }
                    if (touchNavigation) touchNavigation();
                    if (canSkip || isAd) {
                        const bList = Array.from(document.querySelectorAll(SELECTORS.SKIP_AD_BTN));
                        // Always force if it hasn't skipped yet, we don't want the user waiting
                        forceAdSkip(bList, v, true);
                    }
                }, 250);
                return { handled: true };
            }
        }
    });

    function getDocumentPipMetadata() {
        const video = getBridgeVideo();
        const isShorts = window.location.href.includes('/shorts/');
        return {
            platform: 'youtube',
            isShorts,
            supportsNavigation: isShorts,
            pipMode: 'document',
            pipWindowMode: 'document',
            isExtensionTriggered: true,
            isLive: detectIsLiveLocal(video),
            liked: getLikeStatus(video),
            volume: Math.round((video?.volume ?? 1) * 100),
            muted: !!video?.muted,
            playing: video ? !video.paused : false,
            isAd: detectIsAdLocal(video),
            canSkipAd: detectIsAdLocal(video) ? detectCanSkipAd() : false
        };
    }

    function dispatchDocumentPipState(active, extra = {}) {
        const metadata = active ? { ...getDocumentPipMetadata(), ...extra } : null;
        document.dispatchEvent(new CustomEvent('YouTube_State_Update', {
            detail: {
                documentPipActive: active,
                metadata,
                ...(metadata || {})
            }
        }));
    }

    function updateDocumentPipUi(state = {}) {
        if (!documentPip.win || documentPip.win.closed) return;
        documentPip.lastState = { ...(documentPip.lastState || {}), ...state };
        window.YouTubeDocumentPiPUI?.update(documentPip.win.document, documentPip.lastState);
    }

    function restoreDocumentPipVideo() {
        const video = documentPip.video;
        if (video) {
            video.classList.remove('unip-doc-pip-video');
            video.onclick = null;
        }
        if (video && documentPip.placeholder?.parentNode) {
            documentPip.placeholder.parentNode.insertBefore(video, documentPip.placeholder);
            documentPip.placeholder.remove();
        }
        documentPip.video = null;
        documentPip.placeholder = null;
    }


    function closeDocumentPip({ notify = true } = {}) {
        if (documentPip.volumeTimer) {
            clearTimeout(documentPip.volumeTimer);
            documentPip.volumeTimer = null;
        }
        stopAdStatePolling();
        if (documentPip.video) {
            baseBridge.removeVideoStateListeners(documentPip.video);
            if (documentPip.resizeListener) {
                documentPip.video.removeEventListener('resize', documentPip.resizeListener);
                documentPip.video.removeEventListener('loadedmetadata', documentPip.resizeListener);
                documentPip.resizeListener = null;
            }
        }
        restoreDocumentPipVideo();
        const pipWin = documentPip.win;
        documentPip.win = null;
        documentPip.lastState = null;
        if (pipWin && !pipWin.closed) {
            try { pipWin.close(); } catch (_) {}
        }
        if (notify) dispatchDocumentPipState(false);
    }

    function renderDocumentPipWindow(video) {
        const doc = documentPip.win.document;
        const ui = window.YouTubeDocumentPiPUI;
        if (!ui) throw new Error('YouTubeDocumentPiPUI not loaded');
        ui.render(doc, video, {
            previous: () => baseBridge.handleMessage({ action: ACTIONS.NAVIGATE_VIDEO, direction: 'prev' }),
            rewind: () => baseBridge.handleMessage({ action: ACTIONS.SEEK, value: -10 }),
            playPause: () => {
                baseBridge.handleMessage({ action: ACTIONS.TOGGLE_PLAY });
                setTimeout(() => baseBridge.monitorState(null, true), 80);
            },
            forward: () => baseBridge.handleMessage({ action: ACTIONS.SEEK, value: 10 }),
            next: () => baseBridge.handleMessage({ action: ACTIONS.NAVIGATE_VIDEO, direction: 'next' }),
            mute: () => {
                const muted = !documentPip.lastState?.muted;
                baseBridge.handleMessage({ action: muted ? ACTIONS.MUTE : ACTIONS.UNMUTE });
                updateDocumentPipUi({ muted });
            },
            like: () => {
                baseBridge.handleMessage({ action: ACTIONS.TOGGLE_LIKE });
                setTimeout(() => baseBridge.monitorState(null, true), 180);
            },
            skipAd: () => baseBridge.handleMessage({ action: ACTIONS.SKIP_AD }),
            volume: (event) => {
                const value = Number(event.target.value);
                baseBridge.handleMessage({ action: ACTIONS.SET_VOLUME, value });
                updateDocumentPipUi({ volume: value, muted: value === 0 });
                if (documentPip.volumeTimer) clearTimeout(documentPip.volumeTimer);
                documentPip.volumeTimer = setTimeout(() => {
                    baseBridge.monitorState(null, true);
                    documentPip.volumeTimer = null;
                }, 120);
            }
        });
        updateDocumentPipUi(getDocumentPipMetadata());
    }

    async function openDocumentPip() {
        if (!window.documentPictureInPicture?.requestWindow) {
            handleRequestPip({ getVideo: getBridgeVideo });
            return { handled: true };
        }

        const video = getBridgeVideo();
        if (!video) return { handled: true };

        if (document.pictureInPictureElement) {
            try { await document.exitPictureInPicture(); } catch (_) {}
        }
        closeDocumentPip({ notify: false });

        documentPip.placeholder = document.createComment('unip-document-pip-placeholder');
        video.parentNode?.insertBefore(documentPip.placeholder, video);
        documentPip.video = video;

        const { width, height } = window.BridgeUtils.getVideoDimensions(video);

        try {
            // Request the perfect size based on the video's aspect ratio,
            // and force the browser to ignore cached manual dimensions.
            documentPip.win = await window.documentPictureInPicture.requestWindow({
                width,
                height,
                preferInitialWindowPlacement: true
            });
            renderDocumentPipWindow(video);
            baseBridge.addVideoStateListeners(video);
            startAdStatePolling();
            documentPip.win.addEventListener('pagehide', () => {
                const notify = !documentPip.closeIsSwitch;
                documentPip.closeIsSwitch = false;
                closeDocumentPip({ notify });
            }, { once: true });
            dispatchDocumentPipState(true);
        } catch (e) {
            closeDocumentPip({ notify: false });
            handleRequestPip({ getVideo: getBridgeVideo });
            return { handled: true };
        }

        // Attach resize listener via the shared utility.
        // Done OUTSIDE the try/catch so a failed resizeTo() never closes the PiP window.
        const onResize = () => window.BridgeUtils.resizeDocumentPipToVideo(documentPip.win, video);
        documentPip.resizeListener = onResize;
        video.addEventListener('resize', onResize);

        return { handled: true };
    }

    // -------- PIP LIFECYCLE --------

    let _shouldRejoinPip = false;
    let _pipNavStartTime = 0;

    document.addEventListener('enterpictureinpicture', () => {
        _shouldRejoinPip = false;
        _pipNavStartTime = 0;
        connectStructuralObservers();
        requestAnimationFrame(() => baseBridge.monitorState(null, true));
        // First pass: fast state broadcast
        setTimeout(() => {
            monitorInteractiveElements();
            baseBridge.monitorState(null, true);
        }, 150);
        // Second pass: Shorts takes longer to render its active renderer,
        // so we fire an extra sync after a longer delay to ensure the panel appears.
        setTimeout(() => {
            if (document.pictureInPictureElement) {
                monitorInteractiveElements();
                baseBridge.monitorState(null, true);
            }
        }, 800);
    });

    document.addEventListener('leavepictureinpicture', (e) => {
        const wasNavRecent = _pipNavStartTime > 0 && (Date.now() - _pipNavStartTime < 5000);
        const exitingVideo = e.target;
        _shouldRejoinPip = wasNavRecent && exitingVideo && !exitingVideo.isConnected;

        baseBridge.removeVideoStateListeners(getActiveVideo());
        likeBtnObserver?.disconnect();
        likeClickController?.abort();
        disconnectStructuralObservers();
        likeBtnObserver = null;
        likeClickController = null;
        lastActiveLikeBtn = null;
        cachedLikeBtn = null;
        lastLikeVideo = null;
        lastReportedAdState = null;
        lastReportedCanSkipState = null;
    });

    if (enableAutoSwitching) {
        enableAutoSwitching((newVideo) => {
            disconnectStructuralObservers();
            connectStructuralObservers();
            refreshPipStateNow();
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
    let adStateInterval = null;

    function refreshPipStateNow() {
        monitorInteractiveElements();
        baseBridge.monitorState(null, true);
    }

    // Polling for ad-player-overlay attributes
    function startAdStatePolling() {
        stopAdStatePolling();
        adStateInterval = setInterval(() => {
            const hasPip = !!document.pictureInPictureElement || !!documentPip.video;
            if (!hasPip) {
                stopAdStatePolling();
                return;
            }
            const v = document.pictureInPictureElement || documentPip.video || getActiveVideo();
            if (detectIsAdLocal(v) && touchNavigation) {
                touchNavigation();
            }
            reportAdStateIfChanged();
            // also push ad state into Document PiP UI
            if (documentPip.video) {
                const isAd = detectIsAdLocal(documentPip.video);
                const canSkipAd = isAd ? detectCanSkipAd() : false;
                updateDocumentPipUi({ isAd, canSkipAd });
            }
        }, 500);
    }

    function stopAdStatePolling() {
        if (adStateInterval) {
            clearInterval(adStateInterval);
            adStateInterval = null;
        }
    }

    function setupShortsObserver() {
        shortsObserver?.disconnect();
        if (window.BridgeUtils?.enableFastVideoSwitching) {
            shortsObserver = window.BridgeUtils.enableFastVideoSwitching({
                containerSelector: 'ytd-shorts, #shorts-container',
                attribute: 'is-active',
                onSwitch: (v) => {
                    refreshPipStateNow();
                }
            });
        }
    }

    function getEnvironment(url) {
        if (!url) return 'other';
        if (url.includes('/shorts/')) return 'shorts';
        if (url.includes('/watch')) return 'watch';
        return 'other';
    }

    document.addEventListener('yt-navigate-start', (e) => {
        if (!e.detail?.url) return;
        const newEnv = getEnvironment(e.detail.url);

        // --- Traditional PiP ---
        if (document.pictureInPictureElement) {
            const isPipShort = !!document.pictureInPictureElement.closest('ytd-reel-video-renderer');
            const oldEnv = isPipShort ? 'shorts' : 'watch';
            // Strict environment survival: exit on environment change without setting the grace period
            if (oldEnv !== newEnv) {
                try { document.exitPictureInPicture(); } catch (_) {}
                return;
            }
            _pipNavStartTime = Date.now();
            if (signalNavigation) signalNavigation();
        }

        // --- Document PiP ---
        if (documentPip.video) {
            const isDocShort = !!documentPip.video.closest('ytd-reel-video-renderer');
            const oldEnv = isDocShort ? 'shorts' : 'watch';
            // Close Document PiP when environment changes (same rule as traditional PiP)
            if (oldEnv !== newEnv) {
                closeDocumentPip({ notify: true });
            }
        }
    });

    document.addEventListener('yt-navigate-finish', () => {
        if (document.pictureInPictureElement) {
            setupShortsObserver();
            refreshPipStateNow();
        } else if (_shouldRejoinPip) {
            _shouldRejoinPip = false;
            const video = getActiveVideo();
            if (video) {
                const tryPip = () => {
                    video.requestPictureInPicture()
                        .then(() => {
                            connectStructuralObservers();
                            setTimeout(() => {
                                monitorInteractiveElements();
                                baseBridge.monitorState(null, true);
                            }, 150);
                        })
                        .catch(() => {});
                };
                if (video.readyState >= 1) tryPip();
                else video.addEventListener('loadedmetadata', tryPip, { once: true });
            }
        }

        // --- Document PiP: re-attach to the new video after same-environment navigation ---
        if (documentPip.win && !documentPip.win.closed) {
            const newVideo = getBridgeVideo();
            window.BridgeUtils.switchDocumentPipVideo(documentPip, newVideo, {
                addVideoListeners:    (v) => baseBridge.addVideoStateListeners(v),
                removeVideoListeners: (v) => baseBridge.removeVideoStateListeners(v),
                restoreVideo:         ()  => restoreDocumentPipVideo(),
                renderUI:             (v) => renderDocumentPipWindow(v)
            });
            refreshPipStateNow();
        }
    });

    function connectStructuralObservers() {
        if (!rootObserver) {
            rootObserver = new MutationObserver(() => {
                if (rootDebounceTimer) return;
                rootDebounceTimer = setTimeout(() => {
                    rootDebounceTimer = null;
                    refreshPipStateNow();
                }, 300);
            });
        }
        const pipVideo = document.pictureInPictureElement || getActiveVideo();
        const playerContainer = pipVideo ? getPlayer(pipVideo) : null;
        const observeTarget = playerContainer?.parentElement || playerContainer || document.body;
        try {
            rootObserver.observe(observeTarget, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden']
            });
        } catch (e) { }
        setupShortsObserver();
        startAdStatePolling();
    }

    function disconnectStructuralObservers() {
        rootObserver?.disconnect();
        shortsObserver?.disconnect();
        stopAdStatePolling();
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
