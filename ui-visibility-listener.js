(function () {
    'use strict';

    if (window._pipUiVisibilityListenerLoaded) return;
    window._pipUiVisibilityListenerLoaded = true;
    const log = typeof PiPLogger !== 'undefined' ? PiPLogger.create('UIVis') : { info() { }, error() { }, debug() { }, trace() { }, warn() { } };

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

    let isUIVisible = true;
    let visibilityVersion = 1;
    const uiElementsCache = new Set(); // Performance: Cache of all tracked UI elements

    // Helper to sync visibility state globally and internally
    function setUIVisibilityState(visible) {
        isUIVisible = visible;
        window.__pipUIVisible = visible;
    }

    // Inject shared Shake Animation (used by multiple content scripts)
    if (!document.getElementById('pipShakeAnimation')) {
        const style = document.createElement('style');
        style.id = 'pipShakeAnimation';
        style.textContent = `
            @keyframes pipShake {
                0%, 100% { transform: translateX(0); }
                10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
                20%, 40%, 60%, 80% { transform: translateX(5px); }
            }
            /* Global Drag Optimization */
            body.pip-dragging .pip-targeted-shield {
                pointer-events: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // Helper to apply visibility to an element
    function applyVisibility(el) {
        if (!el) return;

        // Capture original display only once during the element's first interaction with our system.
        // This avoids capturing 'none' if we ourselves hit the element while the UI is hidden.
        if (!el.hasAttribute(CONSTANTS.ORIGINAL_DISPLAY_ATTR) && !el.hasAttribute(CONSTANTS.PROCESSED_ATTR)) {
            // Optimization: Only use getComputedStyle if inline style is missing
            const currentDisplay = el.style.display || getComputedStyle(el).display;
            if (currentDisplay && currentDisplay !== 'none') {
                el.setAttribute(CONSTANTS.ORIGINAL_DISPLAY_ATTR, currentDisplay);
            }
        }

        if (isUIVisible) {
            const original = el.getAttribute(CONSTANTS.ORIGINAL_DISPLAY_ATTR) || 'flex';
            el.style.display = original;
            el.setAttribute('aria-hidden', 'false');

            // Re-validate position now that it has dimensions (survives resizes while hidden)
            if (window.PiPUtils && typeof window.PiPUtils.reclampSingleUI === 'function') {
                window.PiPUtils.reclampSingleUI(el);
            }
        } else {
            el.style.display = 'none';
            el.setAttribute('aria-hidden', 'true');
        }
    }

    // Single element synchronization with connectivity check
    function syncSingleElement(el) {
        if (!el) return;
        // Skip nodes no longer in the DOM to avoid errors or redundant work
        if (!el.isConnected) {
            uiElementsCache.delete(el);
            return;
        }

        const versionStr = String(visibilityVersion);
        if (el.getAttribute(CONSTANTS.PROCESSED_ATTR) !== versionStr) {
            applyVisibility(el);
            el.setAttribute(CONSTANTS.PROCESSED_ATTR, versionStr);
        }
    }

    // Helper to scan and apply to all tagged elements
    function syncAllElements(force = false) {
        if (force) {
            visibilityVersion = (visibilityVersion + 1) % 1000000;
        }
        // Optimization: Use cache instead of querySelectorAll
        if (uiElementsCache.size === 0) {
            // Safety fallback/initialization
            document.querySelectorAll(`[${CONSTANTS.PIP_UI_ATTR}="true"]`).forEach(el => uiElementsCache.add(el));
        }
        uiElementsCache.forEach(syncSingleElement);
    }

    // Listener for global commands
    const onRuntimeMessage = (message, sender, sendResponse) => {
        if (!message || typeof message.type !== 'string') {
            if (typeof sendResponse === 'function') sendResponse({ ignored: true });
            return;
        }
        if (message.type === "HIDE_EXTENSION_UI") {
            log.info('Received HIDE command');
            setUIVisibilityState(false);
            syncAllElements(true);
            sendResponse({ success: true });
        }
        else if (message.type === "SHOW_EXTENSION_UI") {
            log.info('Received SHOW command');
            setUIVisibilityState(true);
            syncAllElements(true);
            sendResponse({ success: true });
        }
        else if (message.type === "SYNC_SESSION_VISIBILITY") {
            // Handle Domain-Specific visibility overrides centrally
            log.info('Syncing session visibility:', message.visible);
            setUIVisibilityState(!!message.visible);
            syncAllElements(true);
            sendResponse({ success: true });
        }
        else if (message.type === "VISIBILITY_PING") {
            sendResponse({ alive: true });
        }
        else if (message.type === "GET_UI_VISIBILITY") {
            sendResponse({ visible: isUIVisible });
        }
        else {
            if (typeof sendResponse === 'function') sendResponse({ ignored: true });
        }
    };

    if (_runtime) _runtime.onMessage.addListener(onRuntimeMessage);

    // Initial state check
    if (_runtime) {
        _runtime.sendMessage({ type: "REQUEST_PIP_STATE" }, (res) => {
            const visibleState = (res && res.effectiveUiVisible !== undefined) ? res.effectiveUiVisible : (res && res.state && res.state.uiVisible !== undefined ? res.state.uiVisible : true);

            if (res && res.state) {
                setUIVisibilityState(visibleState);
                log.info('Initial state:', isUIVisible);
                syncAllElements();
            }

            if (res && res.state && res.state.active) {
                _runtime.sendMessage({ type: "REQUEST_EARLY_PANEL" });
            }
        });
    }

    // BFCache restoration: when the user hits the browser back/forward button,
    // the browser may restore the page from cache without re-running scripts.
    // The panel DOM is restored with stale state (e.g. old like/favorite status).
    // This listener detects bfcache restoration and re-syncs the panel state.
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted || !_runtime) return;
        _runtime.sendMessage({ type: "REQUEST_EARLY_PANEL" });
    });

    // MutationObserver to catch elements added dynamically or attributes modified surgically
    // This avoids O(N) full-DOM scans on every change (critical for large sites like TikTok/YouTube)
    let moScheduled = false;
    const pendingNodes = new Set();

    function processPendingNodes() {
        pendingNodes.forEach(el => {
            if (el.isConnected) syncSingleElement(el);
        });
        pendingNodes.clear();
        moScheduled = false;
    }

    const observer = new MutationObserver((mutations) => {
        let hasRelevantChanges = false;
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Node.ELEMENT_NODE
                        // Check if the node itself is a PiP UI element
                        if (node.getAttribute?.(CONSTANTS.PIP_UI_ATTR) === 'true') {
                            uiElementsCache.add(node);
                            pendingNodes.add(node);
                            hasRelevantChanges = true;
                        }
                        // Search for PiP UI elements within the added subtree
                        // Optimization: Only scan if it's not a small text/icon node
                        const children = node.querySelectorAll?.(`[${CONSTANTS.PIP_UI_ATTR}="true"]`);
                        if (children && children.length > 0) {
                            children.forEach(c => {
                                uiElementsCache.add(c);
                                pendingNodes.add(c);
                            });
                            hasRelevantChanges = true;
                        }
                    }
                });
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        if (node.getAttribute?.(CONSTANTS.PIP_UI_ATTR) === 'true') {
                            uiElementsCache.delete(node);
                        }
                        const children = node.querySelectorAll?.(`[${CONSTANTS.PIP_UI_ATTR}="true"]`);
                        if (children) children.forEach(c => uiElementsCache.delete(c));
                    }
                });
            } else if (mutation.type === 'attributes') {
                // attributeFilter already ensures we only get 'data-pip-ui' changes
                if (mutation.target.getAttribute(CONSTANTS.PIP_UI_ATTR) === 'true') {
                    uiElementsCache.add(mutation.target);
                } else {
                    uiElementsCache.delete(mutation.target);
                }
                pendingNodes.add(mutation.target);
                hasRelevantChanges = true;
            }
        });

        if (hasRelevantChanges && !moScheduled) {
            moScheduled = true;
            requestAnimationFrame(processPendingNodes);
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [CONSTANTS.PIP_UI_ATTR] // High-performance filter
    });

    // --- Shared Utilities (PiPUtils) ---
    window.PiPUtils = window.PiPUtils || {};
    window.PiPUtils.PIP_UI_ZINDEX = 2147483647;

    Object.assign(window.PiPUtils, {

        getUIVisibility: function () {
            return isUIVisible;
        },

        clampToViewport: function (element, margin = CONSTANTS.MARGIN) {
            // getBoundingClientRect reflects the *visual* size after transforms (e.g. scale)
            // which is what we need to compare against the viewport.
            let rect = element.getBoundingClientRect();

            // Fallback for cases where rect might be zero (e.g. element not yet in layout correctly)
            const width = rect.width || element.offsetWidth || 0;
            const height = rect.height || element.offsetHeight || 0;

            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;

            //maxX and maxY are the maximum top/left coordinates allowed
            const maxX = vw - width - margin;
            const maxY = vh - height - margin;

            // rect.top/left are the current visual coordinates
            const clampedTop = Math.max(margin, Math.min(rect.top, maxY));
            const clampedLeft = Math.max(margin, Math.min(rect.left, maxX));

            return { top: clampedTop, left: clampedLeft, width, height };
        },

        reclampSingleUI: function (el) {
            if (!el || !el.isConnected) return;
            // PiP elements always use inline styles, so no need for getComputedStyle
            if (el.style.display === 'none') return;
            if (el.style.position !== 'fixed') return;

            const clamped = window.PiPUtils.clampToViewport(el);

            // Convert to viewport percentages to maintain relative position during zoom
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;

            el.style.left = `${(clamped.left / vw) * 100}%`;
            el.style.top = `${(clamped.top / vh) * 100}%`;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        },

        reclampAllUI: function () {
            // Optimization: Use cache instead of querySelectorAll
            uiElementsCache.forEach(el => window.PiPUtils.reclampSingleUI(el));
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

            // 1. Explicitly abort any active drag state for this element
            // We use the pointerup handler reference to trigger the internal logic that resets cursors and classes
            // but we call it safely as it expects an event or might have side effects.
            // A more direct way is to just reset the global/element states here.
            document.body.classList.remove('pip-dragging');
            element.style.cursor = '';
            element.style.transition = '';

            try {
                // If the element has a specific pointer capture, release it explicitly
                if (element.releasePointerCapture && h.lastPointerId) {
                    element.releasePointerCapture(h.lastPointerId);
                }
            } catch (e) { log.trace('CSS toggle fail:', e.message); }

            // 2. Remove all listeners using the unique stored references
            element.removeEventListener('pointerdown', h.onPointerDown);
            element.removeEventListener('mouseenter', h.onMouseEnter);
            element.removeEventListener('mouseleave', h.onMouseLeave);
            element.removeEventListener('click', h.onClick, true);

            // Document listeners (using the unique references for this element)
            document.removeEventListener('pointermove', h.onPointerMove);
            document.removeEventListener('pointerup', h.onPointerUp);

            delete element.__pip_handlers;
            log.info('Cleaned up listeners for element:', element.id || element.tagName);
        },

        makeDraggable: function (element, options = {}) {
            const { HOLD_MS = CONSTANTS.HOLD_MS } = options; // ms to hold before drag activates

            let isDragging = false;  // true once drag mode is confirmed
            let holdTimer = null;   // fires after HOLD_MS to confirm intent
            let startX, startY, initialLeft, initialTop;
            let hasMoved = false;
            const { onDragStart, onDragEnd, onMove } = options;

            // Activate drag mode — called either by hold timer or by movement
            const _activateDrag = () => {
                if (isDragging) return;
                isDragging = true;

                // Convert bottom/right to top/left only once
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

                // Movement threshold crossed — activate drag immediately
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

            // Unified Navigation Relay: Detect when the page (BridgeUtils) starts a navigation intent
            // and notify the background script so it can activate its grace period.
            window.addEventListener('PIP_NAVIGATING', () => {
                if (_runtime && _runtime.sendMessage) {
                    _runtime.sendMessage({ type: 'SIGNAL_NAVIGATION' });
                }
            });

            const onPointerUp = (e) => {
                if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);

                if (!isDragging) return; // was a plain click — nothing to clean up

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

                // Hold timer: activate drag visually if still held after HOLD_MS
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
            const { id, text, title, onClick, style = {}, storageKey, disablePipUiAttribute, persist = true } = options;

            const existing = document.getElementById(id);
            if (existing) return existing;

            const btn = document.createElement("button");
            btn.id = id;
            if (title) {
                btn.title = title;
            }
            if (!disablePipUiAttribute) {
                btn.setAttribute(CONSTANTS.PIP_UI_ATTR, 'true');
            }
            btn.innerHTML = text || "";

            // Default Styles
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
                ...style // Override defaults
            };

            Object.assign(btn.style, defaultStyles);

            // Dragging & Persistence
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

                        // 1. Local backup for instant reload (sync)
                        localStorage.setItem('global_pip_btn_position', JSON.stringify(pos));

                        // 2. Global save for cross-domain sync (async)
                        if (_runtime && _runtime.sendMessage) {
                            _runtime.sendMessage({ type: "SYNC_DRAG_POSITION", pos });
                        }
                    }
                    if (options.onDragEnd) options.onDragEnd(data);
                }
            });

            // Restore Position (One for all)
            const restorePos = (saved) => {
                if (saved && typeof saved.topPercent === 'number' && typeof saved.leftPercent === 'number') {
                    btn.style.top = `${saved.topPercent}%`;
                    btn.style.left = `${saved.leftPercent}%`;
                    btn.style.bottom = 'auto';
                    btn.style.right = 'auto';
                }
            };

            // Restore Position (One for all - only if persistent)
            if (persist) {
                // Try localStorage first (fast, synchronous backup)
                try {
                    const localSaved = JSON.parse(localStorage.getItem('global_pip_btn_position') || 'null');
                    if (localSaved) restorePos(localSaved);
                } catch (e) { }

                // Then try chrome.storage (global source of truth, asynchronous)
                if (_runtime && _runtime.sendMessage) {
                    _runtime.sendMessage({ type: "GET_DRAG_POSITION" }, (res) => {
                        if (res && res.pos) restorePos(res.pos);
                    });
                }
            }

            // Click Handler (Safe from Drag)
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
                    // We assume createFn checks if button exists internally, or we can check return
                    if (videoExists) {
                        createFn();
                    }
                    moTimer = null;
                }, CONSTANTS.MAINTENANCE_INTERVAL);
            });
            const targetForObserve = document.body || document.documentElement;
            observer.observe(targetForObserve, { childList: true, subtree: true });
            // Initial check
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
            
            // Store or update callbacks and metadata collector
            window.PiPUtils._metadataCollector = metadataCollector;
            window.PiPUtils._onEnter = onEnter;
            window.PiPUtils._onExit = onExit;
            window.PiPUtils._controlEventName = controlEventName;

            if (window.PiPUtils._trackPiPInitialized) {
                log.debug('trackPiPState already initialized. Only updating callbacks.');
                return;
            }
            window.PiPUtils._trackPiPInitialized = true;

            // Centralized History Navigation Support (Back/Forward arrows)
            // This ensures PiP closes and UI clears when the user uses browser navigation.
            const handlePopState = () => {
                if (window.__pipIgnoreNextPopstate) {
                    window.__pipIgnoreNextPopstate = false;
                    return;
                }

                if (document.pictureInPictureElement) {
                    // 1. Dispatch exit event for the platform bridge to handle cleanup
                    const eventName = window.PiPUtils._controlEventName || 'PIP_Control_Event';
                    document.dispatchEvent(new CustomEvent(eventName, { detail: { action: 'EXIT_PIP' } }));
                    // 2. Natively exit
                    document.exitPictureInPicture().catch(() => {});
                }

                // 3. Force deactivation signal to background.
                // This bypasses the 'logic suppression' in the leavepictureinpicture listener below.
                if (window.PiPFloatingButton?.isActive?.()) {
                    window.PiPUtils.safeSendMessage({ type: 'PIP_DEACTIVATED', force: true });
                    window.PiPUtils.safeSendMessage({ type: 'HIDE_VOLUME_PANEL' });
                }
            };

            window.addEventListener('popstate', handlePopState);

            document.addEventListener('enterpictureinpicture', (e) => {
                const video = e.target;

                // Collect metadata
                let metadata = {
                    volume: Math.round(video.volume * 100),
                    muted: video.muted,
                    playing: !video.paused
                };

                if (window.PiPUtils._metadataCollector) {
                    const extra = window.PiPUtils._metadataCollector(video);
                    Object.assign(metadata, extra);
                }

                // Notify Background
                window.PiPUtils.safeSendMessage({
                    type: 'PIP_ACTIVATED',
                    ...metadata
                });

                if (window.PiPUtils._onEnter) window.PiPUtils._onEnter(video);

            }, true); // Capture

            document.addEventListener('leavepictureinpicture', (e) => {
                const video = e.target;
                // Debounce exit to allow for "video swapping" (e.g. TikTok scroll)
                // This prevents the UI from flickering (Hide -> Show) if a new video picks up PiP immediately.
                setTimeout(() => {
                    if (document.pictureInPictureElement) {
                        // A new video took over PiP immediately. Squelch the exit event.
                        log.info('Video swapped - suppressing PiP exit.');
                        return;
                    }

                    // CHECK FOR MANUAL EXIT: If the video element is still connected to the DOM,
                    // the user likely clicked the 'X' or the extension button. This is NOT 
                    // a navigation-related removal, so we should NOT suppress it.
                    const isManualExit = video && video.isConnected;

                    // CHECK NAVIGATION STATE: If we are in the middle of a swap (scroll/buttons)
                    // don't tell the background that PiP ended. This keeps the panel alive.
                    // We check BOTH the BridgeUtils internal state AND the DOM attribute bridge.
                    const isNavigating = (window.BridgeUtils && typeof window.BridgeUtils.isNavigating === 'function' && window.BridgeUtils.isNavigating()) ||
                                       document.documentElement.hasAttribute(CONSTANTS.NAVIGATING_ATTR);

                    if (isNavigating && !isManualExit) {
                        log.info('Natural navigation exit detected - suppressing PiP deactivation signal.');
                        return;
                    }

                    // Real Exit (or manual exit during navigation)
                    window.PiPUtils.safeSendMessage({
                        type: 'PIP_DEACTIVATED',
                        force: isManualExit // Ensure background honors manual exits immediately
                    });

                    if (window.PiPUtils._onExit) window.PiPUtils._onExit(video);
                }, 100);
            }, true); // Capture
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

            // Store reference for later cleanup
            window.PiPUtils._messageRelays = window.PiPUtils._messageRelays || [];
            window.PiPUtils._messageRelays.push(relay);

            return relay;
        },

        injectBridge: function (bridgeFileName, utilsFileName = 'bridge-utils.js') {
            if (!_runtime || typeof _runtime.getURL !== 'function') {
                log.info(`Cannot inject ${bridgeFileName} — runtime API unavailable.`);
                return;
            }

            // Avoid double injection
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
                if (!_runtime || !_runtime.sendMessage) return;
                let cbCalled = false;
                const safeCallback = (resp) => {
                    if (cbCalled || typeof cb !== 'function') return;
                    cbCalled = true;
                    try { cb(resp); } catch (err) { /* ignore cb errors */ }
                };
                const maybe = _runtime.sendMessage(msg, safeCallback);
                // If a Promise is returned (Firefox / browsers), handle it too
                if (maybe && typeof maybe.then === 'function') {
                    maybe.then(safeCallback).catch(() => { /* ignore */ });
                }
            } catch (err) {
                // ignore
            }
        }
    });


    function cleanup() {
        log.info('Cleaning up listener and observer');
        observer.disconnect();
        try {
            if (_runtime) _runtime.onMessage.removeListener(onRuntimeMessage);
        } catch (e) {
            // Context might be invalidated
        }

        try {
            if (window.PiPUtils && window.PiPUtils._messageRelays && _runtime) {
                window.PiPUtils._messageRelays.forEach(fn => {
                    try { _runtime.onMessage.removeListener(fn); } catch (e) { log.trace('listener cleanup ignore:', e.message); }
                });
                window.PiPUtils._messageRelays = null;
            }
        } catch (e) { log.debug('Event reset failed:', e.message); }

        window._pipUiVisibilityListenerLoaded = false;
        window._pipUiVisibilityListenerCleanup = null;
        window.removeEventListener('pagehide', cleanup);
    }

    window._pipUiVisibilityListenerCleanup = cleanup;
    window.addEventListener('pagehide', cleanup);

    // Default tracking for generic sites (reports basic PiP activation if no specific bridge is present)
    window.PiPUtils.trackPiPState({
        metadataCollector: () => {
            return {
                isExtensionTriggered: !!(window.__pipExt && window.__pipExt.isTriggered),
                isSelector: !!(window.__pipExt && window.__pipExt.isSelector)
            };
        }
    });

    log.info('Listener active and monitoring.');
    // Zoom/Resize resilience: Re-clamp all UI elements to keep them within viewport
    window.addEventListener('resize', () => {
        window.requestAnimationFrame(() => {
            if (window.PiPUtils && typeof window.PiPUtils.reclampAllUI === 'function') {
                window.PiPUtils.reclampAllUI();
            }
        });
    }, { passive: true });
})();
