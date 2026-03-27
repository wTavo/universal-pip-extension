(function () {
    'use strict';
    const log = typeof PiPLogger !== 'undefined' ? PiPLogger.create('PiPUtils') : { info() { }, error() { }, debug() { }, trace() { }, warn() { } };
    const _runtime = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime : (typeof browser !== 'undefined' && browser.runtime ? browser.runtime : null);

    const CONSTANTS = {
        HOLD_MS: 200,
        MARGIN: 10,
        INJECTION_TIMEOUT: 5000,
        MAINTENANCE_INTERVAL: 1000,
        TRANSITION: 'all 0.3s ease',
        DRAG_THRESHOLD: 3,
        PIP_UI_ATTR: 'data-pip-ui',
        ORIGINAL_DISPLAY_ATTR: 'data-original-display',
        PROCESSED_ATTR: 'data-pip-processed',
        NAVIGATING_ATTR: 'data-pip-navigating'
    };

    // Unified Message Types from constants.js
    const { MSG } = window.PIP_CONSTANTS || { MSG: {} };

    window.PiPUtils = window.PiPUtils || {};
    window.PiPUtils.CONSTANTS = CONSTANTS;
    window.PiPUtils.MSG = MSG;
    window.PiPUtils.PIP_UI_ZINDEX = 2147483647;

    Object.assign(window.PiPUtils, {

        getUIVisibility: function () {
            return window.__pipUIVisible !== false;
        },

        clampToViewport: function (element, margin = CONSTANTS.MARGIN) {
            let rect = element.getBoundingClientRect();
            const width = rect.width || element.offsetWidth || 0;
            const height = rect.height || element.offsetHeight || 0;

            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;

            const maxX = vw - width - margin;
            const maxY = vh - height - margin;

            const clampedTop = Math.max(margin, Math.min(rect.top, maxY));
            const clampedLeft = Math.max(margin, Math.min(rect.left, maxX));

            return { top: clampedTop, left: clampedLeft, width, height };
        },

        reclampSingleUI: function (el) {
            if (!el || !el.isConnected) return;
            if (el.style.display === 'none') return;
            if (el.style.position !== 'fixed') return;

            const clamped = window.PiPUtils.clampToViewport(el);
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;

            el.style.left = `${(clamped.left / vw) * 100}%`;
            el.style.top = `${(clamped.top / vh) * 100}%`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        },

        reclampAllUI: function () {
            const uiElements = document.querySelectorAll(`[${CONSTANTS.PIP_UI_ATTR}="true"]`);
            uiElements.forEach(el => window.PiPUtils.reclampSingleUI(el));
        },

        safeAppendToBody: function (element) {
            if (document.body) {
                document.body.appendChild(element);
                return;
            }
            document.addEventListener('DOMContentLoaded', () => {
                if (document.body) document.body.appendChild(element);
            }, { once: true });
        },

        cleanupElement: function (element) {
            if (!element || !element.__pip_handlers) return;
            const h = element.__pip_handlers;

            document.body.classList.remove('pip-dragging');
            element.style.cursor = '';
            element.style.transition = '';

            try {
                if (element.releasePointerCapture && h.lastPointerId) {
                    element.releasePointerCapture(h.lastPointerId);
                }
            } catch (e) { log.trace('CSS toggle fail:', e.message); }

            element.removeEventListener('pointerdown', h.onPointerDown);
            element.removeEventListener('mouseenter', h.onMouseEnter);
            element.removeEventListener('mouseleave', h.onMouseLeave);
            element.removeEventListener('click', h.onClick, true);

            document.removeEventListener('pointermove', h.onPointerMove);
            document.removeEventListener('pointerup', h.onPointerUp);

            delete element.__pip_handlers;
            log.info('Cleaned up listeners for element:', element.id || element.tagName);
        },

        makeDraggable: function (element, options = {}) {
            const { HOLD_MS = CONSTANTS.HOLD_MS } = options;
            let isDragging = false;
            let holdTimer = null;
            let startX, startY, initialLeft, initialTop;
            let hasMoved = false;
            const { onDragStart, onDragEnd, onMove } = options;

            const _activateDrag = () => {
                if (isDragging) return;
                isDragging = true;

                const needsConversion = !element.style.top || element.style.top === 'auto' ||
                    element.style.bottom !== 'auto';
                if (needsConversion) {
                    element.style.left = `${initialLeft}px`;
                    element.style.top = `${initialTop}px`;
                    element.style.right = 'auto';
                    element.style.bottom = 'auto';
                }

                element.style.transition = 'none';
                element.style.transform = 'scale(0.95)';
                element.style.cursor = 'grabbing';
                document.body.classList.add('pip-dragging');

                if (onDragStart) onDragStart({ element });
            };

            const onPointerMove = (e) => {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;

                if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                _activateDrag();

                if (!isDragging) return;
                hasMoved = true;

                const newLeft = initialLeft + dx;
                const newTop = initialTop + dy;
                element.style.left = `${newLeft}px`;
                element.style.top = `${newTop}px`;

                if (onMove) onMove({ x: newLeft, y: newTop, element });
                if (e.cancelable) e.preventDefault();
            };

            const onPointerUp = (e) => {
                if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);

                if (!isDragging) return;

                isDragging = false;
                document.body.classList.remove('pip-dragging');
                element.style.cursor = 'pointer';
                element.style.transform = 'none';
                element.style.transition = 'none';

                try {
                    const pid = element.__pip_handlers?.lastPointerId || e.pointerId;
                    if (element.releasePointerCapture && pid) element.releasePointerCapture(pid);
                } catch (err) { /* ignore */ }
                if (element.__pip_handlers) element.__pip_handlers.lastPointerId = null;

                if (window.PiPUtils?.reclampSingleUI) window.PiPUtils.reclampSingleUI(element);
                if (onDragEnd) onDragEnd({ hasMoved, element });

                window.requestAnimationFrame(() => { element.style.transition = CONSTANTS.TRANSITION; });
            };

            const onPointerDown = (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;

                hasMoved = false;
                isDragging = false;
                startX = e.clientX;
                startY = e.clientY;

                const rect = element.getBoundingClientRect();
                initialLeft = rect.left;
                initialTop = rect.top;

                if (element.setPointerCapture) {
                    element.setPointerCapture(e.pointerId);
                    if (element.__pip_handlers) element.__pip_handlers.lastPointerId = e.pointerId;
                }

                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);

                holdTimer = setTimeout(_activateDrag, HOLD_MS);
            };

            const onMouseEnter = () => {
                if (!isDragging) {
                    element.style.opacity = "1";
                    element.style.boxShadow = "0 0 10px rgba(255,255,255,0.5)";
                }
            };
            const onMouseLeave = () => {
                if (!isDragging) {
                    element.style.opacity = "0.7";
                    element.style.boxShadow = "0 4px 15px rgba(0,0,0,0.3)";
                }
            };
            const onClick = (e) => {
                if (hasMoved) { e.stopImmediatePropagation(); e.preventDefault(); }
            };

            element.__pip_handlers = { onPointerDown, onPointerMove, onPointerUp, onMouseEnter, onMouseLeave, onClick };
            element.addEventListener('pointerdown', onPointerDown);
            element.addEventListener('mouseenter', onMouseEnter);
            element.addEventListener('mouseleave', onMouseLeave);
            element.addEventListener('click', onClick, true);
        },

        createFloatingButton: function (options) {
            const { id, text, title, onClick, style = {}, persist = true } = options;

            const existing = document.getElementById(id);
            if (existing) return existing;

            const btn = document.createElement("button");
            btn.id = id;
            if (title) btn.title = title;
            btn.setAttribute(CONSTANTS.PIP_UI_ATTR, 'true');
            btn.innerHTML = text || "";

            const defaultStyles = {
                position: 'fixed',
                bottom: '100px',
                right: '20px',
                zIndex: String(window.PiPUtils.PIP_UI_ZINDEX),
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                color: 'white',
                opacity: '0.7',
                background: 'rgba(0, 0, 0, 0.5)',
                fontSize: '24px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0',
                userSelect: 'none',
                boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                transition: CONSTANTS.TRANSITION,
                backdropFilter: 'blur(10px)',
                touchAction: 'none',
                outline: 'none',
                ...style
            };

            Object.assign(btn.style, defaultStyles);

            window.PiPUtils.makeDraggable(btn, {
                onMove: options.onMove,
                onDragStart: options.onDragStart,
                onDragEnd: (data) => {
                    const { hasMoved } = data;
                    if (hasMoved && persist) {
                        const rect = btn.getBoundingClientRect();
                        const topPercent = (rect.top / window.innerHeight) * 100;
                        const leftPercent = (rect.left / window.innerWidth) * 100;
                        const pos = { topPercent, leftPercent };

                        localStorage.setItem('global_pip_btn_position', JSON.stringify(pos));
                        if (_runtime && _runtime.sendMessage) {
                            _runtime.sendMessage({ type: "SYNC_DRAG_POSITION", pos });
                        }
                    }
                    if (options.onDragEnd) options.onDragEnd(data);
                }
            });

            const restorePos = (saved) => {
                if (saved && typeof saved.topPercent === 'number' && typeof saved.leftPercent === 'number') {
                    btn.style.top = `${saved.topPercent}%`;
                    btn.style.left = `${saved.leftPercent}%`;
                    btn.style.bottom = 'auto';
                    btn.style.right = 'auto';
                }
            };

            if (persist) {
                try {
                    const localSaved = JSON.parse(localStorage.getItem('global_pip_btn_position') || 'null');
                    if (localSaved) restorePos(localSaved);
                } catch (e) { }

                if (_runtime && _runtime.sendMessage) {
                    _runtime.sendMessage({ type: "GET_DRAG_POSITION" }, (res) => {
                        if (res && res.pos) restorePos(res.pos);
                    });
                }
            }

            btn.onclick = (e) => {
                if (document.body.classList.contains('pip-dragging')) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (onClick) onClick(e);
            };

            window.PiPUtils.safeAppendToBody(btn);
            return btn;
        },

        maintainButton: function (createFn, checkVideo = true) {
            let moTimer = null;
            const observer = new MutationObserver(() => {
                if (moTimer) return;
                moTimer = setTimeout(() => {
                    const videoExists = !checkVideo || document.querySelector('video');
                    if (videoExists) {
                        createFn();
                    }
                    moTimer = null;
                }, CONSTANTS.MAINTENANCE_INTERVAL);
            });
            const targetForObserve = document.body || document.documentElement;
            observer.observe(targetForObserve, { childList: true, subtree: true });
            if (!checkVideo || document.querySelector('video')) createFn();

            return observer;
        },

        showErrorFeedback: function (btn, message) {
            if (!btn || btn.dataset.isError === 'true') return;
            log.error(message);

            btn.dataset.isError = 'true';
            const originalText = btn.innerHTML;
            const originalBg = btn.style.background;

            btn.innerHTML = "";
            btn.style.background = "linear-gradient(45deg, #ff4444, #cc0000)";
            btn.style.animation = "pipShake 0.5s";

            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = originalBg;
                btn.style.animation = "";
                btn.dataset.isError = 'false';
            }, 1000);
        },

        trackPiPState: function (options) {
            const { onEnter, onExit, metadataCollector, controlEventName } = options;
            
            window.PiPUtils._metadataCollector = metadataCollector;
            window.PiPUtils._onEnter = onEnter;
            window.PiPUtils._onExit = onExit;
            window.PiPUtils._controlEventName = controlEventName;

            if (window.PiPUtils._trackPiPInitialized) {
                log.debug('trackPiPState already initialized. Only updating callbacks.');
                return;
            }
            window.PiPUtils._trackPiPInitialized = true;

            const handlePopState = () => {
                if (window.__pipIgnoreNextPopstate) {
                    window.__pipIgnoreNextPopstate = false;
                    return;
                }

                // [Fix] TikTok Navigation: If we are in a known navigation grace period (e.g. toggling comments),
                // do NOT force exit PiP. The browser/DOM will naturally end PiP if the element is destroyed.
                const isNavigating = (window.BridgeUtils && typeof window.BridgeUtils.isNavigating === 'function' && window.BridgeUtils.isNavigating()) ||
                                   document.documentElement.hasAttribute(CONSTANTS.NAVIGATING_ATTR);

                if (isNavigating) {
                    log.debug('Popstate detected during known navigation - suppressing force exit.');
                    return;
                }

                if (document.pictureInPictureElement) {
                    const eventName = window.PiPUtils._controlEventName || 'PIP_Control_Event';
                    document.dispatchEvent(new CustomEvent(eventName, { detail: { action: 'EXIT_PIP' } }));
                    document.exitPictureInPicture().catch(() => {});
                }

                if (window.PiPFloatingButton?.isActive?.()) {
                    window.PiPUtils.safeSendMessage({ type: 'PIP_DEACTIVATED', force: true });
                    window.PiPUtils.safeSendMessage({ type: 'HIDE_VOLUME_PANEL' });
                }
            };

            window.addEventListener('popstate', handlePopState);

            document.addEventListener('enterpictureinpicture', (e) => {
                const video = e.target;
                let metadata = {
                    volume: Math.round(video.volume * 100),
                    muted: video.muted,
                    playing: !video.paused
                };

                if (window.PiPUtils._metadataCollector) {
                    const extra = window.PiPUtils._metadataCollector(video);
                    Object.assign(metadata, extra);
                }

                window.PiPUtils.safeSendMessage({
                    type: 'PIP_ACTIVATED',
                    ...metadata
                });

                if (window.PiPUtils._onEnter) window.PiPUtils._onEnter(video);

            }, true);

            document.addEventListener('leavepictureinpicture', (e) => {
                const video = e.target;
                setTimeout(() => {
                    if (document.pictureInPictureElement) {
                        log.info('Video swapped - suppressing PiP exit.');
                        return;
                    }

                    const isManualExit = video && video.isConnected;
                    const isNavigating = (window.BridgeUtils && typeof window.BridgeUtils.isNavigating === 'function' && window.BridgeUtils.isNavigating()) ||
                                       document.documentElement.hasAttribute(CONSTANTS.NAVIGATING_ATTR);

                    if (isNavigating && !isManualExit) {
                        log.info('Natural navigation exit detected - suppressing PiP deactivation signal.');
                        return;
                    }

                    window.PiPUtils.safeSendMessage({
                        type: 'PIP_DEACTIVATED',
                        force: isManualExit
                    });

                    if (window.PiPUtils._onExit) window.PiPUtils._onExit(video);
                }, 100);
            }, true);
        },

        setupMessageRelay: function (eventName, supportedActions = {}) {
            if (!_runtime) return;

            const relay = function onRelayMessage(message, sender, sendResponse) {
                if (!message || typeof message.type !== 'string') {
                    if (typeof sendResponse === 'function') sendResponse({ ignored: true });
                    return;
                }
                if (supportedActions[message.type]) {
                    const actionData = supportedActions[message.type](message);
                    if (actionData) {
                        document.dispatchEvent(new CustomEvent(eventName, { detail: actionData }));
                    }
                    sendResponse({ success: true });
                } else if (message.type === 'VALIDATE_PIP_STATUS') {
                    const video = document.pictureInPictureElement;
                    const isActive = !!video;
                    let metadata = {};
                    if (isActive && window.PiPUtils._metadataCollector) {
                        try {
                            metadata = window.PiPUtils._metadataCollector(video);
                        } catch (e) { }
                    }
                    sendResponse({ success: true, isActive: isActive, metadata: metadata });
                }
            };

            _runtime.onMessage.addListener(relay);
            window.PiPUtils._messageRelays = window.PiPUtils._messageRelays || [];
            window.PiPUtils._messageRelays.push(relay);

            return relay;
        },

        injectBridge: function (bridgeFileName, utilsFileName = 'bridge-utils.js') {
            if (!_runtime || typeof _runtime.getURL !== 'function') {
                log.info(`Cannot inject ${bridgeFileName} — runtime API unavailable.`);
                return;
            }

            if (document.querySelector(`script[src*="${bridgeFileName}"]`)) return;

            const utilsScript = document.createElement('script');
            try {
                utilsScript.src = _runtime.getURL(utilsFileName);
            } catch (e) {
                log.info(`getURL failed for ${utilsFileName}`, e);
                return;
            }

            let failSafeTimeout = null;
            const cleanup = () => {
                if (utilsScript.parentNode) utilsScript.remove();
                const bridgeScript = document.querySelector(`script[src*="${bridgeFileName}"]`);
                if (bridgeScript) bridgeScript.remove();
                if (failSafeTimeout) clearTimeout(failSafeTimeout);
            };

            failSafeTimeout = setTimeout(() => {
                log.info(`Injection of ${bridgeFileName} timed out after ${CONSTANTS.INJECTION_TIMEOUT / 1000}s. Cleaning up.`);
                cleanup();
            }, CONSTANTS.INJECTION_TIMEOUT);

            utilsScript.onload = () => {
                const bridgeScript = document.createElement('script');
                try {
                    bridgeScript.src = _runtime.getURL(bridgeFileName);
                } catch (e) {
                    log.info(`getURL failed for ${bridgeFileName}`, e);
                    cleanup();
                    return;
                }
                bridgeScript.onload = function () {
                    log.info(`Successfully injected ${bridgeFileName}`);
                    cleanup();
                };
                bridgeScript.onerror = function () {
                    log.info(`Failed to load bridge script: ${bridgeFileName} (CSP or 404)`);
                    cleanup();
                };
                (document.head || document.documentElement).appendChild(bridgeScript);
            };

            utilsScript.onerror = function () {
                log.info(`Failed to load utils script: ${utilsFileName} (CSP or 404)`);
                cleanup();
            };

            (document.head || document.documentElement).appendChild(utilsScript);
        },

        safeSendMessage: function (msg, cb) {
            try {
                if (!_runtime || typeof _runtime.sendMessage !== 'function') return;
                
                // If the context is invalidated, this will throw
                if (typeof chrome !== 'undefined' && !chrome.runtime?.id) {
                    return;
                }

                let cbCalled = false;
                const safeCallback = (resp) => {
                    if (cbCalled || typeof cb !== 'function') return;
                    cbCalled = true;
                    try {
                        const err = _runtime.lastError;
                        if (err && err.message?.includes('context invalidated')) {
                            log.debug('Context invalidated - suppressing callback');
                            return;
                        }
                        cb(resp);
                    } catch (err) { }
                };

                const maybe = _runtime.sendMessage(msg, safeCallback);
                if (maybe && typeof maybe.then === 'function') {
                    maybe.then(safeCallback).catch((err) => {
                        if (err?.message?.includes('context invalidated')) {
                            log.debug('Context invalidated - suppressing promise catch');
                        }
                    });
                }
            } catch (err) {
                if (err?.message?.includes('context invalidated')) {
                    log.debug('Context invalidated - caught synchronously');
                }
            }
        },

        /**
         * Creates a togglePiP function for a platform inject file.
         * Identical logic was previously copy-pasted across TikTok, YouTube, and Twitch injects.
         * @param {string} controlEventName - e.g. 'TikTok_Control_Event'
         * @returns {Function} togglePiP function
         */
        createTogglePiP: function (controlEventName) {
            return function togglePiP() {
                if (window.PiPFloatingButton?.isActive?.()) {
                    window.PiPUtils.safeSendMessage({ type: 'EXIT_PIP' });
                    return;
                }
                window.__pipExt = window.__pipExt || { isSelector: false, isTriggered: false };
                window.__pipExt.isTriggered = true;
                document.dispatchEvent(new CustomEvent(controlEventName, { detail: { action: 'REQUEST_PIP' } }));
            };
        },

        /**
         * Creates a NAVIGATE_VIDEO relay handler with the popstate guard pattern.
         * Identical logic was previously copy-pasted across all inject files.
         * @returns {Function} relay mapper: (msg) => action detail
         */
        createNavigateRelay: function () {
            return (msg) => {
                window.__pipIgnoreNextPopstate = true;
                setTimeout(() => { window.__pipIgnoreNextPopstate = false; }, 1000);
                return { action: 'NAVIGATE_VIDEO', direction: msg.direction };
            };
        }
    });

    window.addEventListener('PIP_NAVIGATING', () => {
        window.PiPUtils.safeSendMessage({ type: 'SIGNAL_NAVIGATION' });
    });

    /**
     * [Bfcache Fix] Centralized restoration handler.
     * When a page is restored from bfcache, the extension's message port is often broken.
     * A 'poke' (sendMessage) from the content script to the background repairs it.
     */
    window.addEventListener('pageshow', (event) => {
        if (event.persisted && _runtime && _runtime.sendMessage) {
            log.info('Page restored from bfcache. Repairing port and re-syncing...');
            window.PiPUtils.safeSendMessage({ type: 'GET_PIP_STATE' }, (res) => {
                if (res?.state) {
                    // Notify all local components that we are back and have fresh state
                    document.dispatchEvent(new CustomEvent('UNIP_BFCACHE_RESTORED', { 
                        detail: { state: res.state } 
                    }));
                }
            });
        }
    });
})();
