(function () {
    'use strict';
    const log = PiPLogger.create('Selector');

    if (window.__pipSelectorLoaded) return;
    window.__pipSelectorLoaded = true;

    log.info('Logic loaded.');

    let isSelecting = false;
    let highlightOverlay = null;
    // Selector ball is created/managed by pip-floating-button.js
    let targetVideo = null;
    let isSupportedPlatform = false;

    // Internal state variables (localized)
    let lastMousePos = { x: 0, y: 0 };
    let stopSelectionInternal = null;
    let pipShieldObserver = null;
    let revealGlobalBtn = null;

    // Global communication flags (namespaced)
    window.__pipExt = window.__pipExt || {
        isSelector: false,
        isTriggered: false
    };

    const SUPPORTED_DOMAINS = [
        'tiktok.com', 'youtube.com', 'twitch.tv', 'netflix.com',
        'hbomax.com', 'max.com', 'disneyplus.com', 'primevideo.com',
        'instagram.com'
    ];

    const _pipSelectorState = {
        observers: [],
        intervals: [],
        timeouts: [],
        listeners: [], // [{ target, type, listener, options }]
        runtimeListeners: []
    };

    function cleanupSelectorInternals() {
        log.info('Cleaning up internals...');

        if (pipShieldObserver) {
            pipShieldObserver.disconnect();
            pipShieldObserver = null;
        }

        _pipSelectorState.observers.forEach(o => o.disconnect());
        _pipSelectorState.observers.length = 0;

        _pipSelectorState.intervals.forEach(i => clearInterval(i));
        _pipSelectorState.intervals.length = 0;

        _pipSelectorState.timeouts.forEach(t => clearTimeout(t));
        _pipSelectorState.timeouts.length = 0;

        _pipSelectorState.listeners.forEach(({ target, type, listener, options }) => {
            try {
                target.removeEventListener(type, listener, options);
            } catch (e) { log.trace('pointer cleanup failed:', e.message); }
        });
        _pipSelectorState.listeners.length = 0;

        _pipSelectorState.runtimeListeners.forEach(fn => {
            try {
                chrome.runtime.onMessage.removeListener(fn);
            } catch (e) { log.debug('Event cleanup failed:', e.message); }
        });
        _pipSelectorState.runtimeListeners.length = 0;

        const ball = document.getElementById('pipSelectorBall');
        if (ball) ball.remove();
        if (highlightOverlay) {
            highlightOverlay.remove();
            highlightOverlay = null;
        }

        // Cleanup any residual TikTok shields from DOM
        document.querySelectorAll('.pip-targeted-shield').forEach(s => s.remove());
        document.querySelectorAll('[data-has-pip-shield]').forEach(el => delete el.dataset.hasPipShield);
    }

    // Helper to track listeners
    function trackListener(target, type, listener, options) {
        target.addEventListener(type, listener, options);
        _pipSelectorState.listeners.push({ target, type, listener, options });
    }

    // Robust options comparison (key-order independent)
    function optionsEqual(a, b) {
        if (a === b) return true;
        if (!a || !b) return !a && !b;
        const ka = Object.keys(a).sort();
        const kb = Object.keys(b).sort();
        return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
    }

    // Helper to reliably remove tracked listeners
    function removeTrackedListener(target, type, listener, options) {
        const index = _pipSelectorState.listeners.findIndex(l =>
            l.target === target &&
            l.type === type &&
            l.listener === listener &&
            optionsEqual(l.options, options)
        );
        if (index !== -1) {
            const l = _pipSelectorState.listeners[index];
            try {
                l.target.removeEventListener(l.type, l.listener, l.options);
            } catch (e) { log.debug('Runtime message failed:', e.message); }
            _pipSelectorState.listeners.splice(index, 1);
        }
    }

    function trackRuntimeListener(fn) {
        chrome.runtime.onMessage.addListener(fn);
        _pipSelectorState.runtimeListeners.push(fn);
    }

    // Check if any PiP UI element exists at the given coordinates
    function isPipUIAtPoint(x, y) {
        const elements = document.elementsFromPoint(x, y);
        for (const el of elements) {
            if (el.getAttribute('data-pip-ui') === 'true' ||
                el.id === 'pipPanelToggle' ||
                el.id === 'tiktokPipBtn' ||
                el.closest('[data-pip-ui="true"]')) {
                return true;
            }
        }
        return false;
    }

    // [Bfcache Fix] Do NOT cleanup on pagehide.
    // window.addEventListener('pagehide', cleanupSelectorInternals);


    function checkPlatformSupport() {
        // Force fallback logic (generic button) if inside an iframe
        if (window !== window.top) {
            isSupportedPlatform = false;
            return;
        }

        const host = window.location.hostname;
        isSupportedPlatform = SUPPORTED_DOMAINS.some(domain =>
            host === domain || host.endsWith(`.${domain}`)
        );
    }

    checkPlatformSupport();

    // --- UI Helpers ---

    function showErrorFeedback(btn, message) {
        if (window.PiPUtils) window.PiPUtils.showErrorFeedback(btn, message);
    }

    // --- UI Creation ---

    // Selector ball creation moved to pip-floating-button.js

    let isPipActive = false;

    function onRuntimeMessage(message) {
        switch (message.type) {
            case 'START_SELECTION_MODE': startSelectionMode(); break;
            case 'STOP_SELECTION_MODE': stopSelectionMode(); break;
            case 'SYNC_PIP_STATE': window.PiPFloatingButton?.updateFallbackUI?.(message.active); break;
            case 'EXIT_PIP':
                if (document.pictureInPictureElement) {
                    document.exitPictureInPicture().catch(e => log.error('exitPiP failed:', e));
                }
                break;

            // ---- Generic video controls (non-supported platforms only) ----
            case 'CHANGE_VOLUME':
            case 'TOGGLE_MUTE_VIDEO':
            case 'TOGGLE_PLAY':
            case 'SEEK_VIDEO':
            case 'NAVIGATE_VIDEO': {
                if (isSupportedPlatform) break;
                const video = document.pictureInPictureElement || document.querySelector('video');
                if (!video) break;

                if (message.type === 'CHANGE_VOLUME') {
                    const vol = Math.max(0, Math.min(1, message.volume / 100));
                    if (vol > 0 && video.muted) video.muted = false;
                    video.volume = vol;
                } else if (message.type === 'TOGGLE_MUTE_VIDEO') {
                    video.muted = !!message.muted;
                } else if (message.type === 'TOGGLE_PLAY') {
                    video.paused ? video.play() : video.pause();
                } else if (message.type === 'SEEK_VIDEO') {
                    if (Number.isFinite(message.offset)) {
                        video.currentTime = Math.max(0, Math.min(video.currentTime + message.offset, video.duration || Infinity));
                    }
                } else if (message.type === 'NAVIGATE_VIDEO') {
                    const delta = message.direction === 'next' ? 10 : -10;
                    video.currentTime = Math.max(0, Math.min(video.currentTime + delta, video.duration || Infinity));
                }
                break;
            }
        }
    }

    trackRuntimeListener(onRuntimeMessage);

    // ---- Generic state feedback (non-supported platforms) ----
    // When a video enters PiP on a generic page, attach listeners so the panel
    // stays in sync with the actual video state (volume, mute, play/pause).
    document.addEventListener('enterpictureinpicture', (e) => {
        if (isSupportedPlatform) return;
        const video = e.target;
        if (!video) return;

        const sendState = () => {
            chrome.runtime.sendMessage({
                type: 'UPDATE_VOLUME_STATE',
                volume: Math.round(video.volume * 100),
                muted: video.muted
            });
        };

        const sendPlay = () => chrome.runtime.sendMessage({ type: 'UPDATE_PLAYBACK_STATE', playing: !video.paused });

        video.addEventListener('volumechange', sendState);
        video.addEventListener('play', sendPlay);
        video.addEventListener('pause', sendPlay);

        video.addEventListener('leavepictureinpicture', () => {
            video.removeEventListener('volumechange', sendState);
            video.removeEventListener('play', sendPlay);
            video.removeEventListener('pause', sendPlay);
        }, { once: true });

        // Send initial state so panel opens with correct values
        sendState();
        sendPlay();
    }, true);

    // Fallback button creation moved to pip-floating-button.js

    // --- Selection Mode Logic ---

    function startSelectionMode() {
        if (isSelecting) return;
        isSelecting = true;
        if (window === window.top) {
            log.info('Selection mode active.');
        }

        const activeBall = document.getElementById('pipSelectorBall');
        if (activeBall) {
            activeBall.style.opacity = '1';
            activeBall.style.transform = 'scale(1)';
            activeBall.style.pointerEvents = 'all';
        }

        highlightOverlay = document.createElement('div');
        highlightOverlay.id = 'pipSelectionHighlight';
        highlightOverlay.style.cssText = `
            position: fixed;
            pointer-events: none; /* DO NOT BLOCK HOVER */
            background: rgba(79, 172, 254, 0.3);
            border: 2px solid #4facfe;
            border-radius: 8px;
            z-index: 2147483647;
            transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1);
            display: none;
            box-shadow: 0 0 25px rgba(79, 172, 254, 0.6);
        `;
        document.body.appendChild(highlightOverlay);

        const curtain = document.createElement('div');
        curtain.id = 'pipSelectionCurtain';
        curtain.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.3); /* Slightly lighter for better visibility */
            z-index: 2147483645;
            cursor: crosshair;
            pointer-events: none; /* CRITICAL: Allow site to receive hover events */
        `;
        document.body.appendChild(curtain);

        const detectVideoAt = (x, y, targetHint) => {
            // Get all elements at point (ignoring our tool overlays)
            const elements = document.elementsFromPoint(x, y);

            // If hovering over our own controls OR any PiP UI, clear highlight and do nothing
            // We use targetHint if provided (e.g. from the event) or fallback to elements[0]
            const checkEl = targetHint || elements[0];
            if (checkEl && (
                checkEl.closest('#pipSelectorBall') ||
                checkEl.closest('#universalSelectorBtn') ||
                checkEl.closest('[data-pip-ui="true"]') ||
                checkEl.id === 'pipPanelToggle'
            )) {
                highlightOverlay.style.display = 'none';
                targetVideo = null;
                return;
            }

            let videoFound = null;
            for (const el of elements) {
                if (el.id === 'pipSelectionHighlight' || el.id === 'pipSelectionCurtain') continue;

                const video = el.tagName === 'VIDEO' ? el : (el.closest('video') || el.closest('.video-container, .player-container, [class*="player"]')?.querySelector('video') || el.querySelector('video'));

                if (video && video.offsetWidth > 40 && video.offsetHeight > 40 && video.readyState >= 1) {
                    // Strict coordinate check: Ensure the found video is ACTUALLY beneath the mouse
                    const rect = video.getBoundingClientRect();
                    // Allow 10px margin of error for rounded overflow or tight wrappers
                    if (x >= rect.left - 10 && x <= rect.right + 10 && y >= rect.top - 10 && y <= rect.bottom + 10) {
                        videoFound = video;
                        break;
                    }
                }
            }

            if (videoFound) {
                targetVideo = videoFound;
                const rect = videoFound.getBoundingClientRect();
                highlightOverlay.style.top = `${rect.top}px`;
                highlightOverlay.style.left = `${rect.left}px`;
                highlightOverlay.style.width = `${rect.width}px`;
                highlightOverlay.style.height = `${rect.height}px`;
                highlightOverlay.style.display = 'block';
            } else {
                highlightOverlay.style.display = 'none';
                targetVideo = null;
            }
        };

        let rafPending = false;
        const onMouseMove = (e) => {
            // Update position immediately so the first frame isn't at {0,0}
            lastMousePos.x = e.clientX;
            lastMousePos.y = e.clientY;

            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => {
                detectVideoAt(lastMousePos.x, lastMousePos.y, e.target);
                rafPending = false;
            });
        };

        // Also trigger highlight update when videos start playing or load metadata (for preview detection)
        const onVideoReadyOrPlay = (e) => {
            if (e.target && e.target.tagName === 'VIDEO') {
                // Directly call detectVideoAt with last known position (allow x=0, y=0)
                if (lastMousePos.x !== undefined && lastMousePos.y !== undefined) {
                    detectVideoAt(lastMousePos.x, lastMousePos.y, e.target);
                }
            }
        };

        const onClick = async (e) => {
            if (!isSelecting) return;

            // Ignore clicks on our own controls
            if (e.target.closest('#pipSelectorBall') || e.target.closest('#universalSelectorBtn')) return;

            // Defensive: If clicking quickly without moving mouse, targetVideo might be null.
            // Re-evaluate at the click point using the same detection logic.
            if (!targetVideo) {
                detectVideoAt(e.clientX, e.clientY, e.target);
            }

            // If we have a target video, stop the click from reaching the page and enter PiP
            if (targetVideo) {
                e.preventDefault();
                e.stopPropagation();

                if (targetVideo.readyState === 0) {
                    log.info('Video metadata not loaded.');
                    return;
                }

                // Proactive PiP support validation
                if (!('requestPictureInPicture' in HTMLVideoElement.prototype)) {
                    showErrorFeedback(selectorBall, 'PiP no soportado');
                    return;
                }

                try {
                    // Ensure unmuted start for selective PiP
                    if (targetVideo.muted) {
                        targetVideo.muted = false;
                    }
                    if (targetVideo.volume === 0) {
                        targetVideo.volume = 0.5; // Default to 50% if it was muted/zero
                    }

                    // Signal to the platform inject (e.g. youtube-inject.js) that this PiP
                    // was triggered by the selector ball, so it can pass pipMode:'manual' in PIP_ACTIVATED.
                    window.__pipExt.isSelector = true;
                    // Flag that this PiP was triggered by the extension to show the control panel
                    window.__pipExt.isTriggered = true;
                    await targetVideo.requestPictureInPicture();
                    // Clear flags shortly after — the inject reads them synchronously on enterpictureinpicture
                    window.__pipExt.isSelector = false;
                    setTimeout(() => { window.__pipExt.isTriggered = false; }, 500);

                    // --- TARGETED SHIELDS (TikTok): Block only video previews, allow everything else ---
                    if (window.location.hostname.includes('tiktok.com')) {
                        let _shieldAbortCtrl = null;
                        const toggleShields = (enable) => {
                            const shieldsMap = new Map(); // parent -> shield

                            const syncShields = () => {
                                shieldsMap.forEach((shield, parent) => {
                                    if (!document.contains(parent)) {
                                        shield.remove();
                                        shieldsMap.delete(parent);
                                        return;
                                    }
                                    const rect = parent.getBoundingClientRect();
                                    shield.style.top = `${rect.top}px`;
                                    shield.style.left = `${rect.left}px`;
                                    shield.style.width = `${rect.width}px`;
                                    shield.style.height = `${rect.height}px`;
                                });
                            };

                            const addShield = (parent) => {
                                if (parent.dataset.hasPipShield) return;

                                // CRITICAL: Don't add shields to elements containing PiP UI
                                if (parent.querySelector('[data-pip-ui="true"]') ||
                                    parent.querySelector('#pipPanelToggle') ||
                                    parent.closest('[data-pip-ui="true"]') ||
                                    parent.id === 'pipPanelToggle') {
                                    log.info('Shield: Skipping element containing PiP UI');
                                    return;
                                }

                                const rect = parent.getBoundingClientRect();
                                const shield = document.createElement('div');
                                shield.className = 'pip-targeted-shield';
                                shield.style.cssText = `
                                    position: fixed;
                                    top: ${rect.top}px; 
                                    left: ${rect.left}px; 
                                    width: ${rect.width}px; 
                                    height: ${rect.height}px;
                                    z-index: 2147483646; /* High but below PiP UI */
                                    background: rgba(0,0,0,0); /* Ensure hit-test */
                                    cursor: pointer;
                                    pointer-events: auto;
                                `;

                                // CLICK LOGIC: Forward click and close PiP
                                shield.addEventListener('click', (e) => {
                                    // If PiP UI is underneath, let the click through
                                    if (isPipUIAtPoint(e.clientX, e.clientY)) return;

                                    e.preventDefault();
                                    e.stopPropagation();
                                    log.info('Shield: Click detected. Navigating...');

                                    // Find the actual link to navigate
                                    const actualLink = parent.tagName === 'A' ? parent : parent.closest('a') || parent.querySelector('a');

                                    if (document.exitPictureInPicture) {
                                        document.exitPictureInPicture().catch(() => { });
                                    }

                                    if (actualLink) {
                                        log.info('Shield: Forwarding click to link');
                                        actualLink.click();
                                    } else {
                                        parent.click();
                                    }
                                });

                                // BLOCK ALL HOVER EVENTS (Capture phase for maximum safety)
                                // BUT dynamically check if PiP UI is underneath
                                const block = (e) => {
                                    if (isPipUIAtPoint(e.clientX, e.clientY)) return;
                                    e.stopPropagation();
                                    e.stopImmediatePropagation();
                                };
                                shield.addEventListener('mouseenter', block, true);
                                shield.addEventListener('mouseover', block, true);
                                shield.addEventListener('mousemove', block, true);
                                shield.addEventListener('mousedown', block, true);

                                document.body.appendChild(shield);
                                shieldsMap.set(parent, shield);
                                parent.dataset.hasPipShield = 'true';
                            };

                            if (enable) {
                                // 1. Shield specific grid items and individual video links
                                // REMOVED: DivVideoFeed (Too broad, covers whole grid)
                                const selectors = [
                                    'a[href*="/video/"]',
                                    '[data-e2e="user-post-item"]',
                                    '[data-e2e="music-item"]',
                                    '[data-e2e="challenge-item"]',
                                    '[class*="DivItemContainer"]',
                                    '[class*="DivVideoWrapper"]'
                                ];

                                // Optimized: Use a single query for initial activation scoped to body
                                const initialTargets = document.body.querySelectorAll(selectors.join(','));
                                initialTargets.forEach(addShield);

                                // 2. Watch for infinite scroll
                                pipShieldObserver = new MutationObserver(mutations => {
                                    mutations.forEach(m => {
                                        m.addedNodes.forEach(node => {
                                            if (node.nodeType !== 1) return;

                                            // Check node itself
                                            selectors.forEach(sel => {
                                                if (node.matches(sel)) addShield(node);
                                            });

                                            // Check children
                                            node.querySelectorAll(selectors.join(',')).forEach(addShield);
                                        });
                                    });
                                });
                                pipShieldObserver.observe(document.body, { childList: true, subtree: true });
                                syncShields();

                                _shieldAbortCtrl = new AbortController();
                                window.addEventListener('scroll', syncShields, { passive: true, capture: true, signal: _shieldAbortCtrl.signal });
                                window.addEventListener('resize', syncShields, { signal: _shieldAbortCtrl.signal });

                                log.info('Targeted Shields ACTIVE.');

                            } else {
                                // Disable
                                if (pipShieldObserver) {
                                    pipShieldObserver.disconnect();
                                    pipShieldObserver = null;
                                }
                                document.querySelectorAll('.pip-targeted-shield').forEach(s => s.remove());
                                document.querySelectorAll('[data-has-pip-shield]').forEach(el => delete el.dataset.hasPipShield);
                                shieldsMap.clear();

                                if (_shieldAbortCtrl) { _shieldAbortCtrl.abort(); _shieldAbortCtrl = null; }

                                log.info('🔓 Targeted Shields REMOVED.');
                            }
                        };

                        // Activate shields
                        toggleShields(true);

                        // Cleanup hook
                        targetVideo.addEventListener('leavepictureinpicture', () => {
                            document.documentElement.removeAttribute('data-pip-selector-locked');
                            toggleShields(false);
                        }, { once: true });
                    } else {
                        targetVideo.addEventListener('leavepictureinpicture', () => {
                            document.documentElement.removeAttribute('data-pip-selector-locked');
                        }, { once: true });
                    }

                    if (!isSupportedPlatform) {
                        chrome.runtime.sendMessage({
                            type: 'PIP_ACTIVATED',
                            platform: 'generic',
                            isSelectorMode: true,
                            pipMode: "manual",
                            isExtensionTriggered: true,
                            volume: Math.round(targetVideo.volume * 100),
                            muted: targetVideo.muted,
                            playing: !targetVideo.paused
                        });
                    }

                } catch (err) {
                    log.error('Failed to activate PiP:', err);
                    showErrorFeedback(document.getElementById('pipSelectorBall'), "PiP Request Failed");
                }

                // CRITICAL: Cleanup globally!
                chrome.runtime.sendMessage({ type: 'STOP_SELECTION_MODE_GLOBAL' });
                // Cleanup immediately after action locally too
                stopSelectionMode();
            }
        };

        const onKey = (e) => {
            if (e.key === 'Escape') stopSelectionMode();
        };

        const syncHighlight = () => {
            if (targetVideo && highlightOverlay && highlightOverlay.style.display !== 'none') {
                const rect = targetVideo.getBoundingClientRect();
                highlightOverlay.style.top = `${rect.top}px`;
                highlightOverlay.style.left = `${rect.left}px`;
                highlightOverlay.style.width = `${rect.width}px`;
                highlightOverlay.style.height = `${rect.height}px`;
            }
        };

        // Use Capture phase to stay on top of other listeners
        trackListener(window, 'mousemove', onMouseMove, { capture: true, passive: true });
        trackListener(window, 'click', onClick, { capture: true });
        trackListener(window, 'keydown', onKey, { capture: true });
        // Handle various stages of video loading for dynamically injected previews (e.g., TikTok Grid)
        trackListener(document, 'play', onVideoReadyOrPlay, { capture: true });
        trackListener(document, 'playing', onVideoReadyOrPlay, { capture: true });
        trackListener(document, 'loadedmetadata', onVideoReadyOrPlay, { capture: true });
        trackListener(document, 'loadeddata', onVideoReadyOrPlay, { capture: true });
        trackListener(window, 'scroll', syncHighlight, { capture: true, passive: true });
        trackListener(window, 'resize', syncHighlight, { passive: true });

        stopSelectionInternal = () => {
            if (pipShieldObserver) {
                pipShieldObserver.disconnect();
                pipShieldObserver = null;
            }
            if (curtain) curtain.remove();
            if (highlightOverlay) highlightOverlay.remove();

            // We use the helper to ensure exact matching of option objects used during add
            removeTrackedListener(window, 'mousemove', onMouseMove, { capture: true, passive: true });
            removeTrackedListener(window, 'click', onClick, { capture: true });
            removeTrackedListener(window, 'keydown', onKey, { capture: true });
            removeTrackedListener(document, 'play', onVideoReadyOrPlay, { capture: true });
            removeTrackedListener(document, 'playing', onVideoReadyOrPlay, { capture: true });
            removeTrackedListener(document, 'loadedmetadata', onVideoReadyOrPlay, { capture: true });
            removeTrackedListener(document, 'loadeddata', onVideoReadyOrPlay, { capture: true });
            removeTrackedListener(window, 'scroll', syncHighlight, { capture: true, passive: true });
            removeTrackedListener(window, 'resize', syncHighlight, { passive: true });

            isSelecting = false;
        };
    }

    function stopSelectionMode() {
        if (stopSelectionInternal) {
            stopSelectionInternal();
        } else {
            // Force cleanup of orphaned elements if reference lost
            const c = document.getElementById('pipSelectionCurtain');
            const h = document.getElementById('pipSelectionHighlight');
            if (c) c.remove();
            if (h) h.remove();
            isSelecting = false;
        }

        // Ensure ball hides if not hovered after selection ends
        const exitBall = document.getElementById('pipSelectorBall');
        if (exitBall) {
            setTimeout(() => {
                if (!exitBall.matches(':hover') && !isSelecting) {
                    exitBall.style.opacity = '0';
                    exitBall.style.transform = 'scale(0)';
                    exitBall.style.pointerEvents = 'none';
                }
            }, 100);
        }
    }

    // Expose API so pip-floating-button.js can integrate without chrome.runtime round-trips
    window.PiPSelectorAPI = {
        get isSelecting() { return isSelecting; },
        stopSelection: stopSelectionMode
    };

    // --- Initialization ---

    function init() {

        if (isSupportedPlatform) {
            // Find the specific button for the platform
            const findMainButton = () => {
                const platforms = ['tiktok', 'youtube', 'twitch', 'hbo', 'disney', 'primevideo', 'instagram'];
                for (const p of platforms) {
                    const btn = document.getElementById(`${p}PipBtn`);
                    if (btn) return btn;
                }
                return null;
            };

            const poll = setInterval(() => {
                // Ball may have already been created by PiPFloatingButton.init()
                if (document.getElementById('pipSelectorBall')) {
                    clearInterval(poll);
                    return;
                }
                const btn = findMainButton();
                if (btn) {
                    clearInterval(poll);
                    // For legacy scripts not using PiPFloatingButton yet, we can't create
                    // the ball here anymore because we removed createSelectorBall.
                    // Instead, we just let them work without the ball until they are updated,
                    // or let window.PiPFloatingButton do it if possible.
                    if (window.PiPFloatingButton && typeof window.PiPFloatingButton._attachBall === 'function') {
                        window.PiPFloatingButton._attachBall(btn);
                    }
                }
            }, 1000);
            _pipSelectorState.intervals.push(poll);
        } else {
            window.PiPFloatingButton?.initFallback?.();
        }
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        const onReady = () => {
            init();
            removeTrackedListener(document, 'DOMContentLoaded', onReady, { once: true });
        };
        trackListener(document, 'DOMContentLoaded', onReady, { once: true });
    } else {
        init();
    }

})();
