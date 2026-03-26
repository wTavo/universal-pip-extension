// volume-panel-layout.js
// Manages spatial positioning, visibility timers, and viewport synchronization for the PiP Volume Panel.
(function () {
    'use strict';

    if (window.PiPVolumePanelLayout) return;

    const STATE = {
        autoHideTimer: null,
        panelDims: null,
        lastNavPos: { left: null, top: null, right: null },
        dragAnimationFrame: null,
        viewportHandler: null
    };

    const LayoutManager = {
        // --- Visibility / Timers ---

        startAutoHide: (onHide) => {
            if (STATE.autoHideTimer) clearTimeout(STATE.autoHideTimer);
            STATE.autoHideTimer = setTimeout(onHide, 3000);
        },

        stopAutoHide: () => {
            if (STATE.autoHideTimer) {
                clearTimeout(STATE.autoHideTimer);
                STATE.autoHideTimer = null;
            }
        },

        // --- Positioning Core ---

        updatePanelPosition: (panel, toggleBtn, targetDoc) => {
            if (!panel || !toggleBtn) return;

            const vWidth = targetDoc.documentElement.clientWidth;
            const vHeight = targetDoc.documentElement.clientHeight;
            const margin = 15;
            const isHidden = panel.style.display === "none";

            if (isHidden && STATE.panelDims) {
                const coords = LayoutManager.calculatePanelCoords(null, STATE.panelDims.w, STATE.panelDims.h, vWidth, vHeight, margin);
                LayoutManager.applyStyles(panel, coords);
                return;
            }

            const btnRect = toggleBtn.getBoundingClientRect();
            const hasNoRect = btnRect.width === 0 && btnRect.height === 0;

            if (hasNoRect) {
                const w = STATE.panelDims ? STATE.panelDims.w : (panel.offsetWidth || 130);
                const h = STATE.panelDims ? STATE.panelDims.h : (panel.offsetHeight || 100);
                const coords = LayoutManager.calculatePanelCoords(null, w, h, vWidth, vHeight, margin);
                LayoutManager.applyStyles(panel, coords);
                return;
            }

            const prevDisplay = panel.style.display;
            if (prevDisplay === "none") {
                panel.style.visibility = "hidden";
                panel.style.display = "flex";
            }

            const w = panel.offsetWidth || 130;
            const h = panel.offsetHeight || 100;
            STATE.panelDims = { w, h };

            if (prevDisplay === "none") {
                panel.style.display = prevDisplay;
                panel.style.visibility = "";
            }

            const coords = LayoutManager.calculatePanelCoords(btnRect, w, h, vWidth, vHeight, margin);
            LayoutManager.applyStyles(panel, coords);
        },

        calculatePanelCoords: (btnRect, pW, pH, vW, vH, margin) => {
            if (!btnRect) {
                const fallbackRight = 30;
                return {
                    left: Math.round(vW - pW - margin - fallbackRight),
                    top: Math.round((vH - pH) / 2)
                };
            }

            const spaceLeft = btnRect.left;
            const spaceRight = vW - btnRect.right;

            let left = (spaceLeft >= pW + margin) ? (btnRect.left - pW - margin) :
                (spaceRight >= pW + margin) ? (btnRect.right + margin) :
                    (vW - pW - margin);

            let top = Math.max(10, Math.min(btnRect.top + btnRect.height / 2 - pH / 2, vH - pH - 10));

            return { left: Math.round(left), top: Math.round(top) };
        },

        applyStyles: (el, coords) => {
            Object.assign(el.style, {
                position: 'fixed',
                left: `${coords.left}px`,
                top: `${coords.top}px`,
                right: 'auto',
                transform: 'none'
            });
        },

        updateNavPosition: (nav, toggleBtn, targetDoc) => {
            if (!toggleBtn || !nav) return;

            const rect = toggleBtn.getBoundingClientRect();
            const vh = targetDoc.documentElement.clientHeight;
            const coords = LayoutManager.calculateNavCoords(toggleBtn, rect, vh);

            if (STATE.lastNavPos.left === coords.left && STATE.lastNavPos.top === coords.top && STATE.lastNavPos.right === coords.right) return;
            STATE.lastNavPos = coords;

            Object.assign(nav.style, {
                left: coords.left,
                right: coords.right,
                top: coords.top,
                opacity: '1'
            });
        },

        calculateNavCoords: (btn, rect, vh) => {
            let left = btn.style.left, right = btn.style.right;

            if (!left || left === 'auto') {
                if (right && right !== 'auto') {
                    left = 'auto';
                } else {
                    const comp = window.getComputedStyle(btn);
                    left = comp.left !== 'auto' ? comp.left : `${Math.max(8, Math.round(rect.left))}px`;
                    right = comp.left !== 'auto' ? (comp.right || 'auto') : 'auto';
                }
            }

            const top = (((rect.bottom + 5) / vh) * 100) + "%";
            return { left, right, top };
        },

        // --- Viewport Sync ---

        setupViewportListener: (handler) => {
            if (STATE.viewportHandler) {
                window.removeEventListener('resize', STATE.viewportHandler);
            }
            STATE.viewportHandler = () => requestAnimationFrame(handler);
            window.addEventListener('resize', STATE.viewportHandler);
        },

        /**
         * Encapsulated button drag behavior with requestAnimationFrame guarding.
         */
        setupButtonDrag: (btn, onMove, onEnd) => {
            if (!btn) return;

            let isFrameRequested = false;
            const handleMove = () => {
                if (isFrameRequested) return;
                isFrameRequested = true;
                STATE.dragAnimationFrame = requestAnimationFrame(() => {
                    onMove();
                    isFrameRequested = false;
                });
            };

            const handleEnd = () => {
                if (isFrameRequested) {
                    cancelAnimationFrame(STATE.dragAnimationFrame);
                    isFrameRequested = false;
                }
                onEnd();
            };

            btn._pipPointerMoveHandler = handleMove;
            btn._pipPointerUpHandler = handleEnd;
            btn._pipPointerCancelHandler = handleEnd;

            return { handleMove, handleEnd };
        },

        cleanupViewportListener: () => {
            if (STATE.viewportHandler) {
                window.removeEventListener('resize', STATE.viewportHandler);
                STATE.viewportHandler = null;
            }
        },

        // --- HUD / Visual Helpers ---

        showHudMessage: (hudEl, text, color, glow) => {
            if (!hudEl) return;
            hudEl.textContent = '';
            const span = document.createElement('span');
            span.style.filter = `drop-shadow(${glow})`;
            span.textContent = text;
            hudEl.appendChild(span);
            hudEl.style.color = color;
            hudEl.style.opacity = "1";
            hudEl.style.transform = "translate(-50%, -50%) scale(1.1)";
            hudEl.style.textShadow = `0 1px 5px rgba(0,0,0,0.5), ${glow}`;

            if (hudEl._timer) clearTimeout(hudEl._timer);
            hudEl._timer = setTimeout(() => {
                hudEl.style.opacity = "0";
                hudEl.style.transform = "translate(-50%, -50%) scale(0.5)";
                hudEl._timer = null;
            }, 1000);
        },

        animateClick: (btn, onComplete) => {
            btn.style.transform = "scale(0.85)";
            setTimeout(() => {
                btn.style.transform = "scale(1.15)";
                setTimeout(() => {
                    btn.style.transform = btn.matches(':hover') ? "translateY(-1px) scale(1.05)" : "scale(1)";
                    if (onComplete) onComplete();
                }, 100);
            }, 100);
        },

        setVisibility: (el, visible) => {
            if (!el) return;

            // Fast path for unattached elements
            if (!el.isConnected) {
                el.style.display = visible ? (el.tagName === 'DIV' ? 'flex' : 'block') : 'none';
                return;
            }

            const currentDisplay = el.style.display;
            const computedDisplay = window.getComputedStyle(el).display;
            const isCurrentlyVisible = currentDisplay !== 'none' && computedDisplay !== 'none';

            if (visible === isCurrentlyVisible) return;

            if (!visible) {
                if (!el.hasAttribute('data-original-display') && computedDisplay !== 'none') {
                    el.setAttribute('data-original-display', computedDisplay);
                }
                el.style.display = 'none';
            } else {
                if (el.hasAttribute('data-original-display')) {
                    el.style.display = el.getAttribute('data-original-display');
                    el.removeAttribute('data-original-display');
                } else {
                    el.style.display = (el.tagName === 'DIV' ? 'flex' : 'block');
                }
            }
        },

        resetCache: () => {
            STATE.panelDims = null;
            STATE.lastNavPos = { left: null, top: null, right: null };
        },

        /**
         * Unified cleanup for layout-related timers and observers.
         */
        cleanup: () => {
            LayoutManager.stopAutoHide();
            LayoutManager.cleanupViewportListener();
            if (STATE.dragAnimationFrame) {
                cancelAnimationFrame(STATE.dragAnimationFrame);
                STATE.dragAnimationFrame = null;
            }
            LayoutManager.resetCache();
        }
    };

    window.PiPVolumePanelLayout = LayoutManager;
})();
