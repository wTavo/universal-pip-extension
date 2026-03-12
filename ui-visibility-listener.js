(function () {
    'use strict';

    if (window._pipUiVisibilityListenerLoaded) return;
    window._pipUiVisibilityListenerLoaded = true;
    const log = typeof PiPLogger !== 'undefined' ? PiPLogger.create('UIVis') : { info() { }, error() { }, debug() { }, trace() { }, warn() { } };

    const _runtime = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime : (typeof browser !== 'undefined' && browser.runtime ? browser.runtime : null);


    let isUIVisible = true;
    let visibilityVersion = 1;

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
        if (!el.hasAttribute('data-original-display') && !el.hasAttribute('data-pip-processed')) {
            const currentDisplay = el.style.display || getComputedStyle(el).display;
            if (currentDisplay && currentDisplay !== 'none') {
                el.setAttribute('data-original-display', currentDisplay);
            }
        }

        if (isUIVisible) {
            const original = el.getAttribute('data-original-display') || 'flex';
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
        if (!el.isConnected) return;

        const versionStr = String(visibilityVersion);
        if (el.getAttribute('data-pip-processed') !== versionStr) {
            applyVisibility(el);
            el.setAttribute('data-pip-processed', versionStr);
        }
    }

    // Helper to scan and apply to all tagged elements
    function syncAllElements(force = false) {
        if (force) {
            visibilityVersion = (visibilityVersion + 1) % 1000000;
        }
        const uiElements = document.querySelectorAll('[data-pip-ui="true"]');
        uiElements.forEach(syncSingleElement);
    }

    // Listener for global commands
    const onRuntimeMessage = (message, sender, sendResponse) => {
        if (!message || typeof message.type !== 'string') {
            if (typeof sendResponse === 'function') sendResponse({ ignored: true });
            return;
        }
        if (message.type === "HIDE_EXTENSION_UI") {
            log.info('Received HIDE command');
            isUIVisible = false;
            window.__pipUIVisible = false; // Expose globally
            syncAllElements(true);
            sendResponse({ success: true });
        }
        else if (message.type === "SHOW_EXTENSION_UI") {
            log.info('Received SHOW command');
            isUIVisible = true;
            window.__pipUIVisible = true; // Expose globally
            syncAllElements(true);
            sendResponse({ success: true });
        }
        else if (message.type === "SYNC_SESSION_VISIBILITY") {
            // Handle Domain-Specific visibility overrides centrally
            log.info('Syncing session visibility:', message.visible);
            isUIVisible = message.visible;
            window.__pipUIVisible = message.visible;
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
            // Very important: if we don't handle the message, we MUST send a response anyway.
            // Otherwise, since this listener is active, Chrome will throw "The message port 
            // closed before a response was received" to the sender (background.js).
            if (typeof sendResponse === 'function') sendResponse({ ignored: true });
        }
    };

    if (_runtime) _runtime.onMessage.addListener(onRuntimeMessage);

    // Initial state check
    if (_runtime) {
        _runtime.sendMessage({ type: "REQUEST_PIP_STATE" }, (res) => {
            // Priority: effectiveUiVisible (which includes domain exceptions) fallback to state.uiVisible
            const visibleState = (res && res.effectiveUiVisible !== undefined) ? res.effectiveUiVisible : (res && res.state && res.state.uiVisible !== undefined ? res.state.uiVisible : true);

            if (res && res.state) {
                isUIVisible = visibleState;
                window.__pipUIVisible = visibleState; // Expose globally
                log.info('Initial state:', isUIVisible);
                syncAllElements();
            }

            // If PiP is active, request early panel injection for non-origin tabs.
            // Background will validate that this tab is NOT the origin tab.
            // This eliminates the wait for onUpdated + 300ms delay on navigation.
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
                        if (node.getAttribute?.('data-pip-ui') === 'true') {
                            pendingNodes.add(node);
                            hasRelevantChanges = true;
                        }
                        // Search for PiP UI elements within the added subtree
                        const children = node.querySelectorAll?.('[data-pip-ui="true"]');
                        if (children && children.length > 0) {
                            children.forEach(c => pendingNodes.add(c));
                            hasRelevantChanges = true;
                        }
                    }
                });
            } else if (mutation.type === 'attributes') {
                // attributeFilter already ensures we only get 'data-pip-ui' changes
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
        attributeFilter: ['data-pip-ui'] // High-performance filter
    });

    // --- Shared Utilities (PiPUtils) ---
    window.PiPUtils = window.PiPUtils || {};
    window.PiPUtils.PIP_UI_ZINDEX = 2147483647;

    Object.assign(window.PiPUtils, {

        getUIVisibility: function () {
            return isUIVisible;
        },

        clampToViewport: function (element, margin = 10) {
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
            const uiElements = document.querySelectorAll('[data-pip-ui="true"]');
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
            const HOLD_MS = 200; // ms to hold before drag activates

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

                window.requestAnimationFrame(() => { element.style.transition = 'all 0.3s ease'; });
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
                btn.setAttribute('data-pip-ui', 'true');
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
                transition: 'box-shadow 0.3s ease, opacity 0.3s ease, transform 0.1s ease',
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
                        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                            chrome.storage.local.set({ global_pip_btn_position: pos });
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
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get('global_pip_btn_position', (res) => {
                        if (res && res.global_pip_btn_position) {
                            restorePos(res.global_pip_btn_position);
                        }
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
                }, 1000);
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
            const { onEnter, onExit, metadataCollector } = options;
            window.PiPUtils._metadataCollector = metadataCollector;

            document.addEventListener('enterpictureinpicture', (e) => {
                const video = e.target;

                // Collect metadata
                let metadata = {
                    volume: Math.round(video.volume * 100),
                    muted: video.muted,
                    playing: !video.paused
                };

                if (metadataCollector) {
                    const extra = metadataCollector(video);
                    Object.assign(metadata, extra);
                }

                // Notify Background
                window.PiPUtils.safeSendMessage({
                    type: 'PIP_ACTIVATED',
                    ...metadata
                });

                if (onEnter) onEnter(video);

            }, true); // Capture

            document.addEventListener('leavepictureinpicture', (e) => {
                // Debounce exit to allow for "video swapping" (e.g. TikTok scroll)
                // This prevents the UI from flickering (Hide -> Show) if a new video picks up PiP immediately.
                setTimeout(() => {
                    if (document.pictureInPictureElement) {
                        // A new video took over PiP immediately. Squelch the exit event.
                        log.info('Video swapped - suppressing PiP exit.');
                        return;
                    }

                    // Real Exit
                    window.PiPUtils.safeSendMessage({
                        type: 'PIP_DEACTIVATED'
                    });

                    if (onExit) onExit(e.target);
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
                log.info(`Injection of ${bridgeFileName} timed out after 5s. Cleaning up.`);
                cleanup();
            }, 5000);

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
