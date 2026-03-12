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
        if (centerVideo) {
            cachedActiveVideo = centerVideo;
            return cachedActiveVideo;
        }

        const videos = document.getElementsByTagName('video');
        if (!videos.length) return cachedActiveVideo;

        const items = [];

        for (const v of videos) {
            const r = v.getBoundingClientRect();

            if (
                r.width > 0 &&
                r.height > 0 &&
                r.bottom > 0 &&
                r.top < window.innerHeight
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

    function getClosestCandidate(video, candidates) {
        if (!video || !candidates || candidates.length === 0) return null;

        let closestBtn = null;
        let closestDistanceSq = Infinity;

        const videoRect = video.getBoundingClientRect();
        const centerX = videoRect.left + videoRect.width / 2;
        const centerY = videoRect.top + videoRect.height / 2;

        for (const candidate of candidates) {
            // IGNORE extension UI to prevent feedback loops
            if (candidate.hasAttribute?.('data-pip-managed')) continue;

            const btn =
                candidate.tagName === 'BUTTON'
                    ? candidate
                    : candidate.closest('button');

            if (!btn || btn.hasAttribute('data-pip-managed')) continue;

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
            Math.max(videoRect.height, videoRect.width) ** 2 * 2.25;

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

    function enableAutoSwitching(onSwitchCallback) {
        if (_pipObserver) return;

        let isSwitchingVideo = false;

        const feed = findFeedContainer() || null;
        const observed = new WeakSet();

        _pipObserver = new IntersectionObserver((entries) => {
            if (!document.pictureInPictureElement) return;

            const isLocked =
                document.documentElement
                    .hasAttribute('data-pip-selector-locked');

            if (isLocked) return;

            const visibleEntry = entries
                .filter(e => e.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

            if (!visibleEntry) return;

            const newVideo = visibleEntry.target;
            const currentPiP = document.pictureInPictureElement;

            if (
                currentPiP &&
                newVideo !== currentPiP &&
                !isSwitchingVideo
            ) {
                isSwitchingVideo = true;

                const performSwitch = () => {
                    newVideo.removeAttribute('disablePictureInPicture');

                    newVideo.requestPictureInPicture()
                        .then(() => {
                            newVideo.play().catch(() => { });

                            setTimeout(() => {
                                isSwitchingVideo = false;
                            }, 150);

                            onSwitchCallback?.(newVideo);

                        })
                        .catch(() => {
                            isSwitchingVideo = false;
                        });
                };

                if (newVideo.readyState >= 1) performSwitch();
                else newVideo.addEventListener(
                    'loadedmetadata',
                    performSwitch,
                    { once: true }
                );
            }

        }, {
            root: feed,
            threshold: 0.45
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
                    timeSinceHide < 1000 &&
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

    window.BridgeUtils = {
        ACTIONS,
        getActiveVideo: getActiveVideoFast,
        getClosestCandidate,
        enableAutoSwitching,
        disableAutoSwitching,
        enableAntiPause,
        _refreshActiveVideo: refreshActiveVideo
    };

})();
