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
        _runtime.sendMessage({ type: "GET_PIP_STATE" }, (res) => {
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
    // MOVED to utils/pip-utils.js

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

    // [Bfcache Fix] Do NOT cleanup on pagehide. 
    // This script should persist to maintain visibility sync after back-navigation.
    window._pipUiVisibilityListenerCleanup = cleanup;
    // window.addEventListener('pagehide', cleanup); // REMOVED: Breaks bfcache restoration


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
