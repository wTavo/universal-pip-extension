// volume-panel-ui.js
// Provides window.PiPVolumePanelUI — all DOM creation logic for the volume control panel.
// Injected before volume-panel.js by background.js.
(function () {
    'use strict';
    const log = typeof PiPLogger !== 'undefined' ? PiPLogger.create('PanelUI') : { warn() { } };

    // Protect against double injection
    if (window.PiPVolumePanelUI) return;

    const ALLOWED_SVG_ATTRS = new Set([
        'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
        'transform', 'fill-rule', 'clip-rule', 'opacity', 'class',
        'fill-opacity', 'width', 'height', 'xmlns'
    ]);
    // Cache for DOM nodes to avoid redundant element creation on every hover event
    const _svgCache = new Map();

    function createSVG(def) {
        // Fast paths caching: convert object ref to a string key if possible
        const cacheKey = typeof def === 'object' ? JSON.stringify(def) : null;
        if (cacheKey && _svgCache.has(cacheKey)) {
            return _svgCache.get(cacheKey).cloneNode(true); // Super fast C++ side clone
        }

        const ns = "http://www.w3.org/2000/svg";
        const tag = def.tag || "svg";
        const el = document.createElementNS(ns, tag);

        if (def.viewBox) el.setAttribute("viewBox", def.viewBox);
        if (def.attrs) {
            for (const [k, v] of Object.entries(def.attrs)) {
                if (ALLOWED_SVG_ATTRS.has(k) || k.startsWith('data-') || k.startsWith('aria-')) {
                    el.setAttribute(k, v);
                }
            }
        }
        if (tag === "svg") {
            if (!el.hasAttribute("viewBox")) el.setAttribute("viewBox", def.viewBox || "0 0 24 24");
            if (!el.hasAttribute("width")) el.setAttribute("width", "24");
            if (!el.hasAttribute("height")) el.setAttribute("height", "24");
            if (!el.hasAttribute("fill")) el.setAttribute("fill", "currentColor");
        }

        if (Array.isArray(def.children)) {
            def.children.forEach(c => {
                if (c && typeof c === 'object') {
                    el.appendChild(createSVG(c)); // Recursion doesn't use cache by design (parent handles it)
                } else if (c !== null && c !== undefined) {
                    el.textContent = c;
                }
            });
        }

        if (cacheKey) _svgCache.set(cacheKey, el);
        return el.cloneNode(true); // Return clone so the cached instance is never mutated
    }

    const ICONS = {
        // Volume icons
        volumeOff: {
            viewBox: "0 0 24 24",
            children: [{ tag: "path", attrs: { d: "M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H3v6h4l5 5v-6.95l3.25 3.25c-1.13.63-2.35 1.1-3.65 1.34v2.04c1.86-.34 3.59-1.07 5.07-2.09l2.27 2.27a.996.996 0 001.41 0 .996.996 0 000-1.41L5.05 3.63a.996.996 0 00-1.42 0zM19 12c0 .82-.15 1.58-.42 2.29l1.47 1.47c.59-1.12.95-2.41.95-3.76 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-4.25 2.15L12 11.4V4l3.33 3.33c.48 1.42.52 2.96-.58 4.82z" } }]
        },
        volumeLow: {
            viewBox: "0 0 24 24",
            children: [
                { tag: "path", attrs: { d: "M3 9v6h4l5 5V4L7 9H3z" } },
                { tag: "path", attrs: { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", d: "M14.5 9.5c.5.5.5 2.5 0 5" } }
            ]
        },
        volumeMedium: {
            viewBox: "0 0 24 24",
            children: [
                { tag: "path", attrs: { d: "M3 9v6h4l5 5V4L7 9H3z" } },
                { tag: "path", attrs: { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", d: "M14.5 9.5c.5.5.5 2.5 0 5" } },
                { tag: "path", attrs: { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", d: "M17 7c1.5 1.5 1.5 6.5 0 10" } }
            ]
        },
        volumeHigh: {
            viewBox: "0 0 24 24",
            children: [
                { tag: "path", attrs: { d: "M3 9v6h4l5 5V4L7 9H3z" } },
                { tag: "path", attrs: { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", d: "M14.5 9.5c.5.5.5 2.5 0 5" } },
                { tag: "path", attrs: { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", d: "M17 7c1.5 1.5 1.5 6.5 0 10" } },
                { tag: "path", attrs: { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", d: "M19.5 4.5c2.5 2.5 2.5 10.5 0 15" } }
            ]
        },
        // Seek icons
        arrowRight: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { d: "M11.5 8c-4.65 0-8.58 3.03-9.96 7.22l2.37.78c1.05-3.19 4.05-5.5 7.59-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6c-1.85-1.61-4.25-2.6-6.9-2.6z" } }] },
        arrowLeft: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { d: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" } }] },
        // Nav collapse icons
        up: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { fill: "currentColor", d: "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" } }] },
        down: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { fill: "currentColor", d: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" } }] },
        // Playback icons
        play: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { d: "M8 5v14l11-7z" } }] },
        pause: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { d: "M6 19h4V5H6v14zm8-14v14h4V5h-4z" } }] },
        // Like icons
        likeBase: {
            viewBox: "0 0 24 24",
            children: [{
                tag: "path",
                attrs: {
                    "fill-rule": "evenodd",
                    "clip-rule": "evenodd",
                    d: "M7.5 2.25C10.5 2.25 12 4.25 12 4.25C12 4.25 13.5 2.25 16.5 2.25C20 2.25 22.5 4.99999 22.5 8.5C22.5 12.5 19.2311 16.0657 16.25 18.75C14.4095 20.4072 13 21.5 12 21.5C11 21.5 9.55051 20.3989 7.75 18.75C4.81949 16.0662 1.5 12.5 1.5 8.5C1.5 4.99999 4 2.25 7.5 2.25Z",
                    class: "pip-like-icon-base"
                }
            }]
        },
        likeBroken: {
            viewBox: "0 0 24 24",
            children: [
                {
                    tag: "path",
                    attrs: {
                        d: "M12 21.5C11 21.5 9.55 20.4 7.75 18.75C4.82 16.07 1.5 12.5 1.5 8.5C1.5 5 4 2.25 7.5 2.25C9.8 2.25 11.3 3.4 12 4.25L10.8 6.2L12.3 8.2L10.6 10.5L12.1 13L10.9 15.2L12 17.5Z",
                        transform: "translate(-0.8, 0.6) rotate(-6 12 12)"
                    }
                },
                {
                    tag: "path",
                    attrs: {
                        d: "M12 21.5C13 21.5 14.41 20.41 16.25 18.75C19.23 16.07 22.5 12.5 22.5 8.5C22.5 5 20 2.25 16.5 2.25C14.2 2.25 12.7 3.4 12 4.25L13.2 6.4L11.7 8.6L13.4 10.8L11.9 13.1L13.1 15.5L12 17.5Z",
                        transform: "translate(0.8, -0.4) rotate(5 12 12)"
                    }
                }
            ]
        },
        // Favorite icons
        favoriteBase: {
            viewBox: "0 0 24 24",
            children: [
                { tag: "path", attrs: { d: "M4 4.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v15.13a1 1 0 0 1-1.555.831l-6.167-4.12a.5.5 0 0 0-.556 0l-6.167 4.12A1 1 0 0 1 4 19.63z" } },
                { tag: "path", attrs: { "fill-opacity": "0.03", d: "M4.032 4.144Q4 4.317 4 4.5v15.13a1 1 0 0 0 1.555.831l6.167-4.12a.5.5 0 0 1 .41-.066l-.427-.198a1.49 1.49 0 0 0-1.377.063c-.581.339-1.45.85-2.25 1.339-.59.359-1.427.695-2.187.962-.929.325-1.86-.387-1.86-1.37zm8.251 12.202 6.162 4.115A1 1 0 0 0 20 19.63V4.5a2 2 0 0 0-1.123-1.798c.21.254.334.58.33.936a117 117 0 0 1-.896 13.408c-.124.99-1.17 1.553-2.076 1.133z" } }
            ]
        },
        favoriteBroken: {
            viewBox: "0 0 24 24",
            children: [
                { tag: "path", attrs: { d: "M4 4.5a2 2 0 0 1 2-2h6v4.2l-1.2 1.8l1.1 1.9l-1.3 2.1l1.2 2l-1.1 2v5.1l-4.2 2.8A1 1 0 0 1 4 19.63Z", transform: "translate(-0.8, 0.6) rotate(-4 12 12)" } },
                { tag: "path", attrs: { d: "M20 4.5a2 2 0 0 0-2-2h-6v4.1l1.2 1.7l-1.1 1.9l1.3 2.1l-1.2 2l1.1 2v5.2l4.2 2.8A1 1 0 0 0 20 19.63Z", transform: "translate(0.8, -0.4) rotate(4 12 12)" } }
            ]
        },
        mixer: {
            viewBox: "0 0 24 24",
            children: [
                {
                    tag: "style", attrs: {
                        textContent: `
                    .mix-bar { stroke: currentColor; stroke-width: 2; stroke-linecap: round; transition: all 0.3s ease; }
                    .mix-knob { fill: currentColor; transition: all 0.3s cubic-bezier(0.2, 1, 0.3, 1); }
                    button:hover .mix-bar.b1 { stroke: rgba(255,255,255,0.5); }
                    button:hover .mix-bar.b2 { stroke: rgba(255,255,255,0.5); }
                    button:hover .mix-bar.b3 { stroke: rgba(255,255,255,0.5); }
                    button:hover .mix-knob.k1 { transform: translateY(-3px) scale(1.1); fill: #fff; }
                    button:hover .mix-knob.k2 { transform: translateY(3px) scale(1.1); fill: #fff; }
                    button:hover .mix-knob.k3 { transform: translateY(-2px) scale(1.1); fill: #fff; }
                `}
                },
                { tag: "line", attrs: { class: "mix-bar b1", x1: "6", y1: "4", x2: "6", y2: "20" } },
                { tag: "circle", attrs: { class: "mix-knob k1", cx: "6", cy: "14", r: "3" } },

                { tag: "line", attrs: { class: "mix-bar b2", x1: "12", y1: "4", x2: "12", y2: "20" } },
                { tag: "circle", attrs: { class: "mix-knob k2", cx: "12", cy: "8", r: "3" } },

                { tag: "line", attrs: { class: "mix-bar b3", x1: "18", y1: "4", x2: "18", y2: "20" } },
                { tag: "circle", attrs: { class: "mix-knob k3", cx: "18", cy: "16", r: "3" } }
            ]
        }
    };

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
        if (title) btn.setAttribute('aria-label', title);
        if (iconDef) {
            const svg = createSVG(iconDef);
            if (iconKey) svg.dataset.icon = iconKey;
            btn.appendChild(svg);
        }
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
            btn.setAttribute('aria-label', title);
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
            btn.appendChild(renderIcon(doc, ICONS.mixer, '24px'));
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
                ariaLabel: chrome.i18n.getMessage("pipVolumeSliderAria"), role: 'slider', ariaOrientation: 'vertical',
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
            btn.setAttribute('aria-label', title);
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
            // Intentionally omit data-pip-ui='true' to bypass local-tab-only visibility.

            const toggleNavBtn = createEl(doc, 'button', {
                id: 'pipNavCollapseBtn', title: chrome.i18n.getMessage("pipNavHideBtnTitle")
            }, BTN_THEMES.ARC.base);
            toggleNavBtn.setAttribute('aria-label', chrome.i18n.getMessage("pipNavHideBtnTitle"));
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
