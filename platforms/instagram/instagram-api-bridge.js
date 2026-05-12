(() => {
    if (window.__INSTAGRAM_PIP_BRIDGE_LOADED__) return;
    window.__INSTAGRAM_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[Instagram Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const {
        ACTIONS,
        getActiveVideo,
        enableAutoSwitching,
        handleRequestPip,
        detectIsLive,
        createBaseBridge,
        signalNavigation,
        switchToVideo,
        getClosestCandidate,
    } = window.BridgeUtils;

    const SELECTORS = {
        ITEM: 'article, [role="dialog"], main section, section, div[role="presentation"]',
        ACTION_SVG: 'svg:not([data-pip-managed])',
        LIVE_BADGE: '[href*="/live/"]'
    };


    let desiredMuted = null;
    let desiredVolume = null;
    let restoringAudio = false;
    let isUserIntendedPause = false;
    let lastHiddenTime = 0;

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            lastHiddenTime = Date.now();
        } else {
            document.querySelectorAll('video[data-navigating-away]').forEach(v => v.removeAttribute('data-navigating-away'));
        }
    }, true);

    function getCurrentVideo() {
        return document.pictureInPictureElement || getActiveVideo();
    }

    function getSvgPathData(svg) {
        return Array.from(svg?.querySelectorAll?.('path, polygon, polyline') || [])
            .map(el => `${el.tagName}:${el.getAttribute('d') || el.getAttribute('points') || ''}`)
            .join(' ')
            .toLowerCase();
    }

    function isInstagramHeartSvg(svg) {
        const data = getSvgPathData(svg);
        // Not-liked state: path with 16.792, 21.5, 9.122 (viewBox 24x24)
        const isUnliked = data.includes('16.792') ||
            (data.includes('21.5') && data.includes('9.122'));
        // Liked state: path with m34.6, 13.4 (viewBox 48x48)
        // Instagram swaps the entire SVG content when toggling like.
        const isLiked = data.includes('m34.6') && data.includes('13.4');
        return isUnliked || isLiked;
    }

    function isInstagramBookmarkSvg(svg) {
        const data = getSvgPathData(svg);
        // Unsaved state: <polygon points="20 21 12 13.44 4 21 4 3 20 3 20 21">
        const isUnsaved = (data.includes('20 21') && data.includes('12') && data.includes('4 21')) ||
            (data.includes('19.5') && data.includes('21') && data.includes('4.5')) ||
            data.includes('polygon:20 21 12');
        // Saved state: <path d="M20 22a...14.815...6.912...">
        // Instagram swaps the entire SVG content when toggling saved/unsaved.
        const isSaved = data.includes('14.815') && data.includes('6.912');
        return isUnsaved || isSaved;
    }

    function isInstagramAudioSvg(svg) {
        const data = getSvgPathData(svg);
        return data.includes('16.636') || data.includes('1.5 13.3') || data.includes('M1.5');
    }

    function isMutedAudioSvg(svg) {
        const data = getSvgPathData(svg);
        return data.includes('1.5 13.3') || data.includes('M1.5');
    }

    function isInstagramPrevSvg(svg) {
        const data = getSvgPathData(svg);
        return data.includes('21 17.502') && data.includes('12 8.913') && data.includes('9.004');
    }

    function isInstagramNextSvg(svg) {
        const data = getSvgPathData(svg);
        return data.includes('12 17.502') && data.includes('12 15.087') && data.includes('9.004');
    }

    function isVisibleElement(el) {
        if (!el || !el.isConnected) return false;
        const rect = el.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
        const style = window.getComputedStyle?.(el);
        return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && style.pointerEvents !== 'none');
    }

    function getClosestInteractiveCandidate(video, candidates) {
        return getClosestCandidate(video, candidates, {
            maxMultiplier: 3.25,
            checkVisibility: isVisibleElement
        });
    }

    function getActionSvgs(root) {
        return Array.from(root?.querySelectorAll?.(SELECTORS.ACTION_SVG) || [])
            .filter(svg => !svg.closest('[data-pip-managed="true"]'));
    }

    function getActiveContainer(video) {
        if (!video) return null;

        // 1. Semantic anchor: if the video is inside an <article>, use that.
        const article = video.closest('article');
        if (article) return article;

        // 2. Walk up from the VIDEO ITSELF to find the container that holds action buttons.
        //    This is critical because the video parameter is the PiP source — we must find
        //    ITS buttons, not the buttons of whatever Reel is currently "focused" on screen.
        let node = video.parentElement;
        for (let i = 0; i < 15 && node && node !== document.body; i++) {
            const svgs = Array.from(node.querySelectorAll(SELECTORS.ACTION_SVG));
            if (svgs.some(isInstagramHeartSvg) || svgs.some(isInstagramBookmarkSvg)) {
                // Ensure we haven't walked up into the Feed container (multiple videos)
                if (node.querySelectorAll('video').length > 1) {
                    return node.firstElementChild || node;
                }
                return node;
            }
            node = node.parentElement;
        }

        // 3. Poster-image heuristic fallback (for edge cases where the video
        //    isn't a direct descendant of the action-buttons wrapper).
        const activeImg = document.querySelector('img.xuzhngd:not(.x1ptxcow)');
        if (activeImg) {
            const imgArticle = activeImg.closest('article');
            if (imgArticle) return imgArticle;

            let imgNode = activeImg.parentElement;
            for (let i = 0; i < 15 && imgNode && imgNode !== document.body; i++) {
                const svgs = Array.from(imgNode.querySelectorAll(SELECTORS.ACTION_SVG));
                if (svgs.some(isInstagramHeartSvg) || svgs.some(isInstagramBookmarkSvg)) {
                    if (imgNode.querySelectorAll('video').length > 1) {
                        return imgNode.firstElementChild || imgNode;
                    }
                    return imgNode;
                }
                imgNode = imgNode.parentElement;
            }
        }

        return video.parentElement;
    }

    function findButtonInContainer(video, predicate) {
        const container = getActiveContainer(video);
        if (!container) return null;

        // Search strictly inside this Reel's container.
        const svgs = Array.from(container.querySelectorAll(SELECTORS.ACTION_SVG));
        const matchingSvg = svgs.find(predicate);
        if (!matchingSvg) return null;

        // Return the interactive button wrapper so clickButton dispatches on the
        // element Instagram's React listens to. getButtonSvg can still extract the SVG for status checks.
        return matchingSvg.closest('[role="button"]') || matchingSvg;
    }

    function getNextVideo(currentVideo) {
        if (!currentVideo) return null;
        const videos = Array.from(document.querySelectorAll('video')).filter(v => v.isConnected);
        const index = videos.indexOf(currentVideo);
        if (index !== -1 && index + 1 < videos.length) return videos[index + 1];
        return null;
    }

    function getPrevVideo(currentVideo) {
        if (!currentVideo) return null;
        const videos = Array.from(document.querySelectorAll('video')).filter(v => v.isConnected);
        const index = videos.indexOf(currentVideo);
        if (index !== -1 && index - 1 >= 0) return videos[index - 1];
        return null;
    }

    function getLikeButton(video) {
        return findButtonInContainer(video, isInstagramHeartSvg);
    }

    function getFavoriteButton(video) {
        return findButtonInContainer(video, isInstagramBookmarkSvg);
    }

    function getMuteButton(video) {
        let node = video.parentElement;
        for (let i = 0; i < 10 && node && node !== document.body; i++) {
            const svgs = Array.from(node.querySelectorAll('svg'));
            const audioSvg = svgs.find(isInstagramAudioSvg);
            if (audioSvg) {
                if (node.querySelectorAll('video').length > 1) break;
                return audioSvg.closest('[role="button"]') || audioSvg;
            }
            node = node.parentElement;
        }
        return findButtonInContainer(video, isInstagramAudioSvg);
    }

    function getReelsNavButtons(video) {
        const root = document;
        const prev = getClosestInteractiveCandidate(video, getActionSvgs(root).filter(isInstagramPrevSvg));
        const next = getClosestInteractiveCandidate(video, getActionSvgs(root).filter(isInstagramNextSvg));
        return { prev, next };
    }

    function hasReelsNavigation(video) {
        const nav = getReelsNavButtons(video);
        return !!(nav.prev && nav.next);
    }

    function getVisibleNonPiPVideo() {
        const currentPiP = document.pictureInPictureElement;
        const viewportCenterY = window.innerHeight / 2;

        return Array.from(document.querySelectorAll('video'))
            .filter(video => {
                if (!video || video === currentPiP || !video.isConnected) return false;
                const rect = video.getBoundingClientRect?.();
                if (!rect || rect.width < 120 || rect.height < 120) return false;
                return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
            })
            .sort((a, b) => {
                const aRect = a.getBoundingClientRect();
                const bRect = b.getBoundingClientRect();
                const aCenter = aRect.top + aRect.height / 2;
                const bCenter = bRect.top + bRect.height / 2;
                return Math.abs(aCenter - viewportCenterY) - Math.abs(bCenter - viewportCenterY);
            })[0] || null;
    }

    function getPlayPauseOverlay(video) {
        const container = getActiveContainer(video);
        if (!container) return null;
        return container.querySelector('.xcpsgoo.x1c9tyrk');
    }

    function isDomPaused(overlay) {
        if (!overlay) return null;
        // The user discovered that 'xof6966' or 'x4fozk2' indicates a paused state.
        if (overlay.classList.contains('xof6966') || overlay.classList.contains('x4fozk2')) return true;
        // 'xdz8niu' indicates a playing state.
        if (overlay.classList.contains('xdz8niu')) return false;
        return null;
    }

    function syncAfterVideoSwitch(newVideo, skipBroadcast = false) {
        lastScanTs = 0;

        if (!skipBroadcast) {
            document.dispatchEvent(new CustomEvent('Instagram_State_Update', {
                detail: { isAd: false }
            }));
        }

        disconnectStructuralObservers();
        connectStructuralObservers();
        desiredMuted = newVideo ? !!newVideo.muted : desiredMuted;
        desiredVolume = newVideo && Number.isFinite(newVideo.volume) ? newVideo.volume : desiredVolume;
        monitorInteractiveElements();

        if (!skipBroadcast) {
            baseBridge.monitorState(newVideo, true);
        } else {
            // Delay broadcast until smooth scrolling finishes and Instagram's React DOM stabilizes
            setTimeout(() => {
                lastScanTs = 0;
                if (document.pictureInPictureElement) {
                    monitorInteractiveElements();
                    baseBridge.monitorState(null, true);
                }
            }, 800);
        }
    }

    function switchToVisibleVideoAfterNavigation(attempt = 0) {
        const video = getVisibleNonPiPVideo();
        if (video) {
            switchToVideo(video, (v) => syncAfterVideoSwitch(v, true));
            return;
        }
        if (attempt < 8) setTimeout(() => switchToVisibleVideoAfterNavigation(attempt + 1), 120);
    }

    function getButtonSvg(btn) {
        if (!btn) return null;
        return btn.tagName?.toLowerCase() === 'svg' ? btn : btn.querySelector?.('svg');
    }

    function getLikeStatus(video) {
        const btn = getLikeButton(video);
        const svg = getButtonSvg(btn);
        if (!svg) return false;
        // Instagram uses viewBox="0 0 48 48" for the liked (filled) heart
        // and viewBox="0 0 24 24" for the not-liked (outline) heart.
        const viewBox = svg.getAttribute('viewBox') || '';
        return viewBox.includes('48');
    }

    function getFavoriteStatus(video) {
        const btn = getFavoriteButton(video);
        const svg = getButtonSvg(btn);
        if (!svg) return false;
        // Instagram uses <path> for the filled/saved state and <polygon fill="none"> for unsaved.
        // Checking for a <path> element is the most reliable indicator of the saved state.
        return !!svg.querySelector('path');
    }

    function detectIsLiveLocal(video) {
        return window.location.pathname.includes('/live/') || detectIsLive(video, [SELECTORS.LIVE_BADGE], document.body);
    }

    function getDynamicState(video) {
        const likeBtn = getLikeButton(video);
        const favBtn = getFavoriteButton(video);

        let isAd = false;
        if (likeBtn && !favBtn) {
            isAd = true;
        }

        // When the tab is hidden, React suspends DOM updates, freezing the overlay classes.
        // Therefore, we MUST strictly trust the native video.paused property when backgrounded.
        let domPaused = null;
        if (!document.hidden) {
            const overlay = getPlayPauseOverlay(video);
            domPaused = isDomPaused(overlay);
        }

        return {
            supportsNavigation: hasReelsNavigation(video),
            isAd: isAd,
            isPaused: domPaused !== null ? domPaused : video.paused
        };
    }

    function clickButton(btn) {
        if (!btn) return false;
        const rect = btn.getBoundingClientRect?.();
        const clientX = rect ? rect.left + rect.width / 2 : 0;
        const clientY = rect ? rect.top + rect.height / 2 : 0;
        const eventOptions = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, button: 0, buttons: 1 };

        btn.focus?.({ preventScroll: true });
        if (typeof PointerEvent !== 'undefined') {
            btn.dispatchEvent(new PointerEvent('pointerdown', { ...eventOptions, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            btn.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
        }
        btn.dispatchEvent(new MouseEvent('mousedown', eventOptions));
        btn.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, buttons: 0 }));
        btn.dispatchEvent(new MouseEvent('click', { ...eventOptions, buttons: 0 }));
        return true;
    }

    function activateButtonWithKeyboard(btn) {
        if (!btn) return false;
        btn.focus?.({ preventScroll: true });
        btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true, view: window }));
        btn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true, view: window }));
        return true;
    }

    function rememberAudioPreference(video) {
        if (!video) return;
        if (desiredMuted === null) desiredMuted = !!video.muted;
        if (desiredVolume === null && Number.isFinite(video.volume)) desiredVolume = video.volume;
    }

    function restoreAudioIfNeeded(video) {
        if (!video || document.pictureInPictureElement !== video || restoringAudio) return;
        if (desiredMuted !== false) return;
        if (!video.muted && video.volume > 0) return;

        restoringAudio = true;
        try {
            video.muted = false;
            if (desiredVolume && desiredVolume > 0 && video.volume === 0) video.volume = desiredVolume;
        } finally {
            setTimeout(() => { restoringAudio = false; }, 50);
        }
    }

    const baseBridge = createBaseBridge({
        platform: 'instagram',
        getVideo: getCurrentVideo,
        getLikeStatus,
        getFavoriteStatus,
        detectIsLive: detectIsLiveLocal,
        extendState: (_state, video) => getDynamicState(video),
        findMuteBtn: () => null,
        onStateChange: (state) => {
            const video = document.pictureInPictureElement || getCurrentVideo();
            rememberAudioPreference(video);
            restoreAudioIfNeeded(video);
            document.dispatchEvent(new CustomEvent('Instagram_State_Update', { detail: state }));
        },
        supportedActions: {
            [ACTIONS.PLAY_VIDEO]: (video) => {
                isUserIntendedPause = false;
                // Only poke the DOM overlay if visible. Poking it when hidden wakes up React
                // and triggers its malicious background pause safeguards.
                if (!document.hidden) {
                    const overlay = getPlayPauseOverlay(video);
                    if (isDomPaused(overlay) === true) clickButton(overlay.querySelector('[role="button"]') || overlay);
                }
                video.play().catch(() => { });
                return { handled: true };
            },
            [ACTIONS.PAUSE_VIDEO]: (video) => {
                isUserIntendedPause = true;
                if (!document.hidden) {
                    const overlay = getPlayPauseOverlay(video);
                    if (isDomPaused(overlay) === false) clickButton(overlay.querySelector('[role="button"]') || overlay);
                }
                video.pause();
                return { handled: true };
            },
            [ACTIONS.TOGGLE_PLAY]: (video) => {
                isUserIntendedPause = !video.paused;
                if (!document.hidden) {
                    const overlay = getPlayPauseOverlay(video);
                    if (video.paused && isDomPaused(overlay) === true) clickButton(overlay.querySelector('[role="button"]') || overlay);
                    else if (!video.paused && isDomPaused(overlay) === false) clickButton(overlay.querySelector('[role="button"]') || overlay);
                }
                if (video.paused) video.play().catch(() => { });
                else video.pause();
                return { handled: true };
            },
            [ACTIONS.MUTE]: (video) => {
                const btn = getMuteButton(video);
                if (btn) {
                    const isMuted = isMutedAudioSvg(getButtonSvg(btn));
                    if (!isMuted) clickButton(btn);
                }
                video.muted = true;
                return { handled: true };
            },
            [ACTIONS.UNMUTE]: (video) => {
                const btn = getMuteButton(video);
                if (btn) {
                    const isMuted = isMutedAudioSvg(getButtonSvg(btn));
                    if (isMuted) clickButton(btn);
                }
                video.muted = false;
                return { handled: true };
            },
            [ACTIONS.TOGGLE_LIKE]: (video) => {
                const wasLiked = getLikeStatus(video);
                const btn = getLikeButton(video);
                clickButton(btn);
                setTimeout(() => {
                    if (getLikeStatus(video) === wasLiked) activateButtonWithKeyboard(btn);
                    baseBridge.monitorState(null, true);
                }, 180);
                return { handled: true };
            },
            [ACTIONS.TOGGLE_FAVORITE]: (video) => {
                const wasFavorited = getFavoriteStatus(video);
                const btn = getFavoriteButton(video);
                clickButton(btn);
                setTimeout(() => {
                    if (getFavoriteStatus(video) === wasFavorited) activateButtonWithKeyboard(btn);
                    baseBridge.monitorState(null, true);
                }, 180);
                return { handled: true };
            },
            [ACTIONS.NAVIGATE_VIDEO]: (video, msg) => {
                if (signalNavigation) signalNavigation();
                instagramLastNavTime = Date.now();

                // Mute/Pause the old video BEFORE navigating to prevent audio leaks.
                // We permanently tag it so our anti-pause completely ignores it.
                isUserIntendedPause = true;
                video.setAttribute('data-navigating-away', 'true');
                video.muted = true;
                video.pause();

                const nav = getReelsNavButtons(video);
                const btn = msg.direction === 'next' ? nav.next : nav.prev;
                if (btn) clickButton(btn);

                const targetVideo = msg.direction === 'next' ? getNextVideo(video) : getPrevVideo(video);
                if (targetVideo) {
                    // Tag the new video for immediate anti-pause protection before PiP attaches
                    targetVideo.setAttribute('data-target-video', 'true');

                    const doSwitch = async () => {
                        // Secure the PiP session by transferring it to an invisible anchor.
                        // This prevents Chrome from killing the session when React unmounts the old video during scroll.
                        let dummyAnchor = null;
                        if (document.pictureInPictureElement) {
                            try {
                                const canvas = document.createElement('canvas');
                                canvas.width = 1; canvas.height = 1;
                                dummyAnchor = document.createElement('video');
                                dummyAnchor.muted = true;
                                dummyAnchor.autoplay = true;
                                dummyAnchor.style.position = 'absolute';
                                dummyAnchor.style.opacity = '0';
                                dummyAnchor.srcObject = canvas.captureStream();
                                document.body.appendChild(dummyAnchor);

                                await dummyAnchor.play();
                                await dummyAnchor.requestPictureInPicture();
                            } catch (e) {
                                if (dummyAnchor && dummyAnchor.parentNode) dummyAnchor.remove();
                            }
                        }

                        switchToVideo(targetVideo, (v) => {
                            syncAfterVideoSwitch(v, true);
                            if (dummyAnchor && dummyAnchor.parentNode) dummyAnchor.remove();
                        });

                        targetVideo.scrollIntoView({ behavior: 'smooth', block: 'center' });

                        // Cleanup failsafe
                        setTimeout(() => {
                            if (dummyAnchor && dummyAnchor.parentNode) dummyAnchor.remove();
                        }, 3000);
                    };

                    doSwitch();
                } else {
                    switchToVisibleVideoAfterNavigation();
                }
                return { handled: true };
            },
            [ACTIONS.REQUEST_PIP]: () => {
                handleRequestPip({
                    getVideo: getCurrentVideo,
                    preSync: (video) => {
                        desiredMuted = video ? !!video.muted : desiredMuted;
                        desiredVolume = video && Number.isFinite(video.volume) ? video.volume : desiredVolume;
                        monitorInteractiveElements();
                        baseBridge.monitorState(null, true);
                    }
                });
                return { handled: true };
            },
            [ACTIONS.CHECK_STATUS]: (video) => {
                if (video) sessionCache.delete(video);
                monitorInteractiveElements();
                baseBridge.monitorState(null, true);
                return { handled: true };
            }
        }
    });

    document.addEventListener('enterpictureinpicture', () => {
        const video = document.pictureInPictureElement;
        desiredMuted = video ? !!video.muted : desiredMuted;
        desiredVolume = video && Number.isFinite(video.volume) ? video.volume : desiredVolume;
        connectStructuralObservers();
        requestAnimationFrame(() => {
            monitorInteractiveElements();
            baseBridge.monitorState(null, true);
        });
    });

    document.addEventListener('leavepictureinpicture', () => {
        baseBridge.removeVideoStateListeners(getCurrentVideo());
        disconnectInteractiveObservers();
        disconnectStructuralObservers();
        desiredMuted = null;
        desiredVolume = null;
    });

    if (enableAutoSwitching) {
        enableAutoSwitching((newVideo) => {
            syncAfterVideoSwitch(newVideo, true);
        });
    }

    ['ended', 'emptied', 'loadeddata', 'playing', 'timeupdate'].forEach(evt => {
        document.addEventListener(evt, (e) => {
            if (e.target !== document.pictureInPictureElement) return;
            restoreAudioIfNeeded(e.target);
            if (evt === 'ended' || evt === 'emptied') setTimeout(() => e.target.play().catch(() => { }), 60);
        }, true);
    });

    let likeBtnObserver = null;
    let favBtnObserver = null;
    let likeClickController = null;
    let favClickController = null;
    let lastActiveLikeBtn = null;
    let lastActiveFavBtn = null;
    let lastScanTs = 0;

    function disconnectInteractiveObservers() {
        likeBtnObserver?.disconnect();
        favBtnObserver?.disconnect();
        likeClickController?.abort();
        favClickController?.abort();
        likeBtnObserver = favBtnObserver = likeClickController = favClickController = lastActiveLikeBtn = lastActiveFavBtn = null;
    }

    function setupButtonController(newBtn, lastBtn, type) {
        if (newBtn === lastBtn) return lastBtn;
        const isLike = type === 'like';
        (isLike ? likeBtnObserver : favBtnObserver)?.disconnect();
        (isLike ? likeClickController : favClickController)?.abort();

        if (newBtn) {
            const controller = new AbortController();
            const update = () => setTimeout(() => baseBridge.monitorState(null, true), 120);
            newBtn.addEventListener('click', update, { passive: true, signal: controller.signal });

            const observer = new MutationObserver(update);
            observer.observe(getButtonSvg(newBtn) || newBtn, { attributes: true, attributeFilter: ['class', 'style', 'fill', 'stroke', 'color'], childList: true, subtree: true });

            if (isLike) { likeBtnObserver = observer; likeClickController = controller; }
            else { favBtnObserver = observer; favClickController = controller; }
        } else {
            if (isLike) { likeBtnObserver = likeClickController = null; }
            else { favBtnObserver = favClickController = null; }
        }
        baseBridge.monitorState(null, true);
        return newBtn;
    }

    function monitorInteractiveElements() {
        if (!document.pictureInPictureElement) return;
        const now = performance.now();
        if (now - lastScanTs < 100) return;
        lastScanTs = now;
        const video = document.pictureInPictureElement;
        lastActiveLikeBtn = setupButtonController(getLikeButton(video), lastActiveLikeBtn, 'like');
        lastActiveFavBtn = setupButtonController(getFavoriteButton(video), lastActiveFavBtn, 'favorite');
    }

    let rootObserver = null;
    let rootDebounceTimer = null;

    function connectStructuralObservers() {
        if (!rootObserver) {
            rootObserver = new MutationObserver(() => {
                if (rootDebounceTimer) return;
                rootDebounceTimer = setTimeout(() => {
                    rootDebounceTimer = null;
                    lastScanTs = 0;
                    monitorInteractiveElements();
                    baseBridge.monitorState(null, true);
                }, 150);
            });
        }
        try {
            // Since we use global brute-force spatial discovery, observing the body is the safest and most reliable way to catch lazy-loaded buttons.
            rootObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'fill', 'stroke', 'color'] });
        } catch (e) { }
    }

    function disconnectStructuralObservers() {
        rootObserver?.disconnect();
        if (rootDebounceTimer) { clearTimeout(rootDebounceTimer); rootDebounceTimer = null; }
    }

    document.addEventListener('Instagram_Control_Event', (e) => baseBridge.handleMessage(e.detail || {}));

    if (document.pictureInPictureElement) {
        monitorInteractiveElements();
        requestAnimationFrame(() => baseBridge.monitorState(null, true));
    }

    // ==========================================
    // AGGRESSIVE ANTI-PAUSE FOR INSTAGRAM
    // ==========================================
    // Instagram relentlessly pauses the video when the tab is hidden.
    // If we simply call play(), Instagram sees the 'play' event and instantly pauses it again,
    // creating an infinite flickering loop that breaks the PiP UI.
    // SOLUTION: We catch 'pause' and 'play' at the top of the DOM (capture phase).
    // If the tab is hidden, we STOP the event from reaching Instagram's React code.
    // By blinding React to the background playback, we stop the infinite fight.

    document.addEventListener('pause', (e) => {
        if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-navigating-away')) return;

        const activeVideo = getCurrentVideo();
        // Protect both the fully attached PiP video AND the incoming target video
        if (!activeVideo || (e.target !== activeVideo && !(e.target.hasAttribute && e.target.hasAttribute('data-target-video')))) return;

        if (document.hidden && !isUserIntendedPause) {
            // BULLETPROOF SHIELD: Instagram tries to pause the video constantly when hidden.
            // We unconditionally block all unintended background pauses.
            e.stopImmediatePropagation();
            // Force background playback on the specific target
            if (typeof e.target.play === 'function') e.target.play().catch(() => { });
        }
    }, true);

    document.addEventListener('play', (e) => {
        if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-navigating-away')) {
            if (document.hidden) {
                // Old videos from navigation MUST stay dead in the background. If React tries to play them, block it violently!
                e.stopImmediatePropagation();
                if (typeof e.target.pause === 'function') {
                    e.target.muted = true;
                    e.target.pause();
                }
            }
            return;
        }

        const activeVideo = getCurrentVideo();
        if (!activeVideo || (e.target !== activeVideo && !(e.target.hasAttribute && e.target.hasAttribute('data-target-video')))) return;

        if (document.hidden && !isUserIntendedPause) {
            e.stopImmediatePropagation();
        }
    }, true);

    // Sync intended state when entering PiP
    document.addEventListener('enterpictureinpicture', (e) => {
        isUserIntendedPause = e.target.paused;

        // Hook MediaSession to support the Native PiP Window Play/Pause buttons seamlessly
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('pause', () => {
                isUserIntendedPause = true;
                const v = getCurrentVideo();
                if (v) v.pause();
            });
            navigator.mediaSession.setActionHandler('play', () => {
                isUserIntendedPause = false;
                const v = getCurrentVideo();
                if (v) v.play().catch(() => { });
            });
        }
    });

    // Auto-sync DOM mute button if user clicks the native PiP mute control
    document.addEventListener('volumechange', (e) => {
        const activeVideo = getCurrentVideo();
        if (!activeVideo || e.target !== activeVideo) return;

        const btn = getMuteButton(activeVideo);
        if (btn) {
            const domMuted = isMutedAudioSvg(getButtonSvg(btn));
            if (activeVideo.muted !== domMuted) {
                clickButton(btn);
            }
        }
    }, true);

    // Note: We deliberately DO NOT call the generic enableAntiPause from bridge-utils.js 
    // because it conflicts with this highly specialized Instagram immunity architecture.
})();
