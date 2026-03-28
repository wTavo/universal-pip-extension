// volume-panel-ui.js
// Provides window.PiPVolumePanelUI — all DOM creation logic for the volume control panel.
// Injected before volume-panel.js by background.js.
(function () {
    'use strict';
    const log = typeof PiPLogger !== 'undefined' ? PiPLogger.create('PanelUI') : { warn() { } };

    // Protect against double injection
    if (window.PiPVolumePanelUI) return;

    // Use centralized icons and utilities
    const ICONS = window.PIP_UI_ICONS;
    const createSVG = window.PIP_SVG_UTILS.createSVG;

    const BASE_RESET_CSS = `
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 0 !important;
        outline: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const BTN_THEMES = {
        PREMIUM: {
            base: (height = "45px") => `
                ${BASE_RESET_CSS}
                width: 45px;
                height: ${height};
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.18);
                background: rgba(20, 20, 28, 0.6);
                color: #ffffff;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            `,
            hover: {
                background: "rgba(50, 50, 65, 0.75)",
                transform: "translateY(-1px)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                color: "#ffffff"
            },
            normal: {
                background: "rgba(20, 20, 28, 0.6)",
                transform: "translateY(0)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                color: "#ffffff"
            }
        },
        NAV: {
            base: `
                ${BASE_RESET_CSS}
                width: 45px;
                height: 45px;
                border-radius: 50%;
                background: rgba(0, 0, 0, 0.65);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.25);
                color: white;
                font-size: 24px;
                transition: all 0.2s;
                box-shadow: 0 4px 14px rgba(0,0,0,0.45);
            `,
            hover: {
                transform: "scale(1.1)",
                background: "rgba(0,0,0,0.82)"
            },
            normal: {
                transform: "scale(1)",
                background: "rgba(0,0,0,0.65)"
            }
        },
        ARC: {
            base: `
                ${BASE_RESET_CSS}
                width: 100%;
                height: 22px;
                background: transparent;
                border: none;
                color: white;
                transition: transform 0.2s, opacity 0.2s;
                opacity: 0.8;
                filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5));
            `,
            hover: { opacity: "1", transform: "scale(1.1)" },
            normal: { opacity: "0.8", transform: "scale(1)" }
        },
        TOGGLE_FALLBACK: `
            position: fixed;
            background: rgba(0, 0, 0, 0.5);
            width: 45px;
            height: 45px;
            font-size: 20px;
            z-index: 2147483647;
            display: none;
            opacity: 0;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            cursor: pointer;
            color: white;
            align-items: center;
            justify-content: center;
            top: 40%;
            right: 30px;
            transition: opacity 0.3s ease;
        `
    };

    const PANEL_STYLES = {
        MAIN: `
            position: fixed;
            width: 65px;
            background: rgba(15, 15, 20, 0.72);
            backdrop-filter: blur(16px) saturate(180%);
            border-radius: 18px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.06);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 15px 0;
            opacity: 0;
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), visibility 0s 0.3s;
            box-sizing: border-box !important;
            margin: 0 !important;
            z-index: ${window.PiPUtils?.PIP_UI_ZINDEX || 2147483647};
            pointer-events: auto;
            visibility: hidden;
        `,
        SLIDER_CONTAINER: `
            position: relative;
            width: 6px;
            height: 140px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            margin: 8px 0;
        `,
        SLIDER: `
            -webkit-appearance: none;
            appearance: none;
            position: absolute;
            width: 140px;
            height: 6px;
            background: linear-gradient(90deg, #77afff, #ffffff40);
            border-radius: 4px;
            cursor: pointer;
            outline: none;
            transform: rotate(-90deg);
            transform-origin: center;
            pointer-events: all;
        `,
        SEPARATOR: `
            width: 35px;
            height: 1px;
            background: rgba(255, 255, 255, 0.15);
            margin: 4px 0;
        `,
        NAV_CONTAINER: `
            position: fixed;
            z-index: ${window.PiPUtils?.PIP_UI_ZINDEX || 2147483647};
            display: flex;
            flex-direction: column;
            gap: 10px;
            opacity: 0;
            transition: opacity 0.5s ease;
            width: 45px;
            align-items: center;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 0 !important;
        `,
        NAV_WRAPPER: `
            flex-direction: column;
            align-items: center;
            width: 100%;
            gap: 10px;
            transition: opacity 0.3s ease;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 0 !important;
        `,
        HUD: `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.5);
            color: #ffffff;
            font-size: 20px;
            font-weight: 700;
            font-family: 'Segoe UI', system-ui, sans-serif;
            opacity: 0;
            pointer-events: none;
            transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
            z-index: 200;
            white-space: nowrap;
            text-shadow: 0 2px 10px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
        `,
        SLIDER_CSS: `
            #globalPipVolumeSlider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: white;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                transition: transform 0.2s;
            }
            #globalPipVolumeSlider::-webkit-slider-thumb:hover {
                transform: scale(1.2);
            }
            #globalPipVolumeSlider::-moz-range-thumb {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: white;
                cursor: pointer;
                border: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
            .pip-like-icon-base {
                filter: drop-shadow(0px 1.2px 1.2px rgba(0,0,0,0.15));
            }
        `
    };

    // --- Internal helpers ---

    function createEl(doc, tag, props = {}, style = '') {
        const el = doc.createElement(tag);
        Object.assign(el, props);
        if (style) el.style.cssText = style;
        return el;
    }

    function applyBtnTheme(btn, theme, height) {
        const base = typeof theme.base === 'function' ? theme.base(height) : theme.base;
        btn.style.cssText = base;
        btn.addEventListener('mouseenter', () => {
            if (theme.hover) {
                Object.assign(btn.style, theme.hover);
            }
        });
        btn.addEventListener('mouseleave', () => {
            if (theme.normal) {
                Object.assign(btn.style, theme.normal);
            }
        });
    }

    function createBasePipBtn(doc, id, title, iconDef, iconKey) {
        const btn = createEl(doc, 'button', { id: id || '', title: title || '' });
        if (title) btn.title = title;
        if (iconDef) {
            const svg = createSVG(iconDef);
            if (iconKey) svg.dataset.icon = iconKey;
            btn.appendChild(svg);
        }
        btn.setAttribute('data-pip-managed', 'true');
        return btn;
    }

    function createSeparator(doc) {
        return createEl(doc, 'div', { className: 'pip-separator' }, PANEL_STYLES.SEPARATOR);
    }

    // --- Public API ---

    window.PiPVolumePanelUI = {
        ICONS,
        BTN_THEMES,
        PANEL_STYLES,
        createSVG,
        createSeparator,
        applyBtnTheme,

        /**
         * Updates the mute button icon and state.
         */
        updateMuteButton: (muteBtn, muted, volume = 100) => {
            if (!muteBtn) return;
            const svg = muteBtn.querySelector('svg');
            const isMuted = Boolean(muted);
            let icon = ICONS.volumeHigh, iconKey = 'high';
            if (isMuted || volume === 0) { icon = ICONS.volumeOff; iconKey = 'off'; }
            else if (volume < 40) { icon = ICONS.volumeLow; iconKey = 'low'; }
            else if (volume < 75) { icon = ICONS.volumeMedium; iconKey = 'medium'; }

            if (svg && svg.dataset.icon === iconKey) {
                muteBtn.setAttribute('aria-pressed', String(isMuted));
                return;
            }
            const newSvg = createSVG(icon);
            newSvg.dataset.icon = iconKey;
            if (!svg) {
                muteBtn.appendChild(newSvg);
            } else {
                svg.replaceWith(newSvg);
            }
            muteBtn.setAttribute('aria-pressed', String(isMuted));
        },

        /**
         * Updates Like button style (vibrant gradient when active).
         */
        updateLikeStatus: (btn, isLiked, isHovering) => {
            if (!btn || isHovering) return;
            btn.innerHTML = '';
            btn.appendChild(createSVG(ICONS.likeBase));
            if (isLiked) {
                btn.style.background = "linear-gradient(145deg, rgba(254, 44, 85, 0.85), rgba(200, 20, 60, 0.7))";
                btn.style.boxShadow = "0 4px 14px rgba(254, 44, 85, 0.6)";
            } else {
                btn.style.background = "rgba(0,0,0,0.65)";
                btn.style.boxShadow = "0 4px 14px rgba(0,0,0,0.45)";
            }
            btn.setAttribute('aria-pressed', String(isLiked));
        },

        /**
         * Updates Favorite button style (vibrant gradient when active).
         */
        updateFavoriteStatus: (btn, isFavorited, isHovering) => {
            if (!btn || isHovering) return;
            btn.innerHTML = '';
            btn.appendChild(createSVG(ICONS.favoriteBase));
            if (isFavorited) {
                btn.style.background = "linear-gradient(145deg, rgba(255, 180, 0, 0.9), rgba(200, 130, 0, 0.75))";
                btn.style.boxShadow = "0 4px 14px rgba(255, 180, 0, 0.6)";
            } else {
                btn.style.background = "rgba(0,0,0,0.65)";
                btn.style.boxShadow = "0 4px 14px rgba(0,0,0,0.45)";
            }
            btn.setAttribute('aria-pressed', String(isFavorited));
        },

        /**
         * Updates Play/Pause button icon.
         */
        updatePlayPauseStatus: (btn, isPlaying) => {
            if (!btn) return;
            btn.innerHTML = '';
            btn.appendChild(createSVG(isPlaying ? ICONS.pause : ICONS.play));
            btn.setAttribute('aria-pressed', String(isPlaying));
        },

        /**
         * Updates Nav collapse button icon and labels.
         */
        updateNavCollapse: (btn, isExpanded) => {
            if (!btn) return;
            const title = isExpanded ? chrome.i18n.getMessage("pipNavHideBtnTitle") : chrome.i18n.getMessage("pipNavShowBtnTitle");
            btn.innerHTML = '';
            btn.appendChild(createSVG(isExpanded ? ICONS.up : ICONS.down));
            btn.title = title;
            btn.setAttribute('aria-pressed', String(isExpanded));
        },

        /**
         * Safe recursive cleanup of elements and their extension-added properties.
         */
        cleanupElement: (el) => {
            if (!el) return;

            if (!(el instanceof Element)) {
                try {
                    if (typeof el.destroy === 'function') el.destroy();
                    if (typeof el.remove === 'function') el.remove();
                } catch (e) { }
                return;
            }

            try {
                if (el.children && el.children.length) {
                    Array.from(el.children).forEach(child => window.PiPVolumePanelUI.cleanupElement(child));
                }

                const props = [
                    '_pipClickHandler', '_themeMouseEnter', '_themeMouseLeave',
                    '_pipHoverEnter', '_pipHoverLeave', '_pipMouseMoveHandler',
                    '_pipInputHandler', '_pipPointerDownHandler', '_pipPointerUpHandler',
                    '_pipPointerCancelHandler', '_pipChangeHandler'
                ];

                props.forEach(p => {
                    if (el[p]) {
                        const event = p.replace('_pip', '').replace('_theme', '').toLowerCase().replace('handler', '');
                        try { el.removeEventListener(event, el[p]); } catch (e) { }
                        el[p] = null;
                    }
                });

                if (el._observer) {
                    try { el._observer.disconnect(); } catch (e) { }
                    el._observer = null;
                }
                if (el._timer) { clearTimeout(el._timer); el._timer = null; }
                if (el._interval) { clearInterval(el._interval); el._interval = null; }
                if (el._animationFrame) { cancelAnimationFrame(el._animationFrame); el._animationFrame = null; }
            } catch (e) {
                log.warn('Cleanup error:', e);
            }
        },

        /**
         * Creates the main floating toggle button.
         * @param {Function} onClick  - Click handler
         * @param {Document} doc      - Target document
         * @param {boolean}  isFallback  - Whether this is a plain CSS button (true) or PiPUtils draggable (false)
         * @param {Object}   [pipOptions]  - Options to pass to PiPUtils.createFloatingButton when isFallback=false
         */
        createToggleButton: (onClick, doc, isFallback, pipOptions = {}) => {
            // Need the string version for the PiPUtils button, and the ICONS version for the fallback.

            if (!isFallback && window.PiPUtils) {
                const mixerSvgString = `
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" style="pointer-events: none;">
                        <style>
                            .mix-bar { stroke: currentColor; stroke-width: 2; stroke-linecap: round; transition: all 0.3s ease; }
                            .mix-knob { fill: currentColor; transition: all 0.3s cubic-bezier(0.2, 1, 0.3, 1); }
                            button:hover .mix-bar.b1 { stroke: rgba(255,255,255,0.5); }
                            button:hover .mix-bar.b2 { stroke: rgba(255,255,255,0.5); }
                            button:hover .mix-bar.b3 { stroke: rgba(255,255,255,0.5); }
                            button:hover .mix-knob.k1 { transform: translateY(-3px) scale(1.1); fill: #fff; }
                            button:hover .mix-knob.k2 { transform: translateY(3px) scale(1.1); fill: #fff; }
                            button:hover .mix-knob.k3 { transform: translateY(-2px) scale(1.1); fill: #fff; }
                        </style>
                        <line class="mix-bar b1" x1="6" y1="4" x2="6" y2="20" />
                        <circle class="mix-knob k1" cx="6" cy="14" r="3" />
                        <line class="mix-bar b2" x1="12" y1="4" x2="12" y2="20" />
                        <circle class="mix-knob k2" cx="12" cy="8" r="3" />
                        <line class="mix-bar b3" x1="18" y1="4" x2="18" y2="20" />
                        <circle class="mix-knob k3" cx="18" cy="16" r="3" />
                    </svg>
                `;
                const btn = window.PiPUtils.createFloatingButton({
                    id: 'pipPanelToggle',
                    text: mixerSvgString,
                    style: {
                        width: '45px',
                        height: '45px',
                        fontSize: '20px',
                        zIndex: String(window.PiPUtils.PIP_UI_ZINDEX || 2147483647),
                        display: 'none',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        boxShadow: 'none',
                        transition: 'box-shadow 0.3s ease, transform 0.1s ease, opacity 0.3s ease',
                        top: '40%',
                        right: '30px',
                        bottom: 'auto'
                    },
                    disablePipUiAttribute: true,
                    onClick,
                    persist: false,
                    ...pipOptions
                });
                btn.title = chrome.i18n.getMessage("pipToggleBtnTitle");
                // Intentionally omit data-pip-ui='true' so the origin domain logic in volume-panel.js manages it.
                btn.setAttribute('data-original-display', 'flex');
                return btn;
            }

            const btn = createEl(doc, 'button', {
                id: 'pipPanelToggle',
                title: chrome.i18n.getMessage("pipToggleBtnBasicTitle")
            }, BTN_THEMES.TOGGLE_FALLBACK);
            btn.setAttribute('data-pip-managed', 'true');
            btn.appendChild(createSVG(ICONS.mixer));
            btn.setAttribute('data-pip-fallback', 'true');
            // Intentionally omit data-pip-ui='true'
            btn.setAttribute('data-original-display', 'flex');
            btn.addEventListener('click', onClick);
            return btn;
        },

        /**
         * Creates the main control panel container div.
         * Returns { panel } with the div ready to be populated and appended.
         */
        createControlPanelHost: (doc) => {
            const panel = doc.createElement('div');
            panel.id = 'globalPipControlPanel';
            panel.setAttribute('data-pip-managed', 'true');
            // Important: We intentionally DO NOT set data-pip-ui='true' here.
            // The Volume Panel is a global session UI element, so its visibility is controlled
            // by pipState.originDomain rules, not the local tab's ui-visibility-listener.
            panel.style.cssText = PANEL_STYLES.MAIN;
            return { panel };
        },

        /**
         * Creates the volume slider + mute button group.
         * Returns { volumeContainer, volumeSlider, muteBtn }
         */
        buildVolumeGroup: (doc) => {
            const volumeContainer = createEl(doc, 'div', {}, PANEL_STYLES.SLIDER_CONTAINER);
            const volumeSlider = createEl(doc, 'input', {
                type: 'range', min: '0', max: '100', value: '100',
                id: 'globalPipVolumeSlider'
            }, PANEL_STYLES.SLIDER);

            Object.assign(volumeSlider, {
                role: 'slider', ariaOrientation: 'vertical',
                ariaValueMin: '0', ariaValueMax: '100', ariaValueNow: '100'
            });

            volumeContainer.appendChild(volumeSlider);
            const muteBtn = createBasePipBtn(doc, 'globalPipMute', chrome.i18n.getMessage("pipMuteBtnTitle"), ICONS.volumeHigh, 'high');
            applyBtnTheme(muteBtn, BTN_THEMES.PREMIUM);

            return { volumeContainer, volumeSlider, muteBtn };
        },

        /**
         * Injects the slider thumb CSS into the target document.
         */
        injectSliderStyles: (doc) => {
            if (doc.getElementById("globalPipSliderStyle")) return;
            const style = doc.createElement('style');
            style.id = "globalPipSliderStyle";
            style.textContent = PANEL_STYLES.SLIDER_CSS;
            doc.head.appendChild(style);
        },

        /**
         * Creates a seek HUD indicator element.
         */
        buildHUD: (doc) => {
            const hud = doc.createElement("div");
            hud.style.cssText = PANEL_STYLES.HUD;
            return hud;
        },

        /**
         * Creates a seek button with the premium theme applied.
         * @param {Document} doc
         * @param {Object} iconDef   - SVG icon definition object
         * @param {string} title     - Accessibility label
         */
        buildSeekBtn: (doc, iconDef, title) => {
            const btn = doc.createElement("button");
            btn.title = title;
            btn.appendChild(createSVG(iconDef));
            applyBtnTheme(btn, BTN_THEMES.PREMIUM, "35px");
            return btn;
        },

        /**
         * Creates the navigation button group.
         * All buttons are already themed with BTN_THEMES.NAV.
         * Returns { container, toggleNavBtn, wrapper, prevBtn, playPauseBtn, nextBtn, likeBtn, favBtn }
         */
        buildNavGroup: (doc) => {
            const container = createEl(doc, 'div', { id: 'globalPipNavContainer' }, PANEL_STYLES.NAV_CONTAINER);
            container.setAttribute('data-pip-managed', 'true');
            // Intentionally omit data-pip-ui='true' to bypass local-tab-only visibility.

            const toggleNavBtn = createEl(doc, 'button', {
                id: 'pipNavCollapseBtn', title: chrome.i18n.getMessage("pipNavHideBtnTitle")
            }, BTN_THEMES.ARC.base);
            toggleNavBtn.appendChild(createSVG(ICONS.down));
            applyBtnTheme(toggleNavBtn, BTN_THEMES.ARC);
            container.appendChild(toggleNavBtn);

            const wrapper = createEl(doc, 'div', { id: 'pipNavButtonsWrapper' }, PANEL_STYLES.NAV_WRAPPER);
            const buttons = [
                { id: null, title: chrome.i18n.getMessage("pipNavPrevVideoTitle"), icon: ICONS.up },
                { id: null, title: chrome.i18n.getMessage("pipNavPauseTitle"), icon: ICONS.pause, key: 'pause' },
                { id: null, title: chrome.i18n.getMessage("pipNavNextVideoTitle"), icon: ICONS.down },
                { id: 'globalPipNavContainer_like', title: chrome.i18n.getMessage("pipNavLikeTitle"), icon: ICONS.likeBase },
                { id: 'globalPipNavContainer_favorite', title: chrome.i18n.getMessage("pipNavFavTitle"), icon: ICONS.favoriteBase }
            ].map(b => {
                const btn = createBasePipBtn(doc, b.id, b.title, b.icon, b.key);
                applyBtnTheme(btn, BTN_THEMES.NAV);
                wrapper.appendChild(btn);
                return btn;
            });

            container.appendChild(wrapper);
            return {
                container, toggleNavBtn, wrapper,
                prevBtn: buttons[0], playPauseBtn: buttons[1], nextBtn: buttons[2],
                likeBtn: buttons[3], favBtn: buttons[4]
            };
        }
    };
})();
