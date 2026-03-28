(function () {
    'use strict';

    if (window.PIP_UI_ICONS) return;

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
        arrowRight: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { d: "M11.5 8c-4.65 0-8.58 3.03-9.96 7.22l2.37.78c1.05-3.19 4.05-5.5 7.59-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6c-1.85-1.61-4.25-2.6-6.9-2.6z" } }] },
        arrowLeft: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { d: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" } }] },
        up: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { fill: "currentColor", d: "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" } }] },
        down: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { fill: "currentColor", d: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" } }] },
        play: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { d: "M8 5v14l11-7z" } }] },
        pause: { viewBox: "0 0 24 24", children: [{ tag: "path", attrs: { d: "M6 19h4V5H6v14zm8-14v14h4V5h-4z" } }] },
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
                { tag: "path", attrs: { d: "M12 21.5C11 21.5 9.55 20.4 7.75 18.75C4.82 16.07 1.5 12.5 1.5 8.5C1.5 5 4 2.25 7.5 2.25C9.8 2.25 11.3 3.4 12 4.25L10.8 6.2L12.3 8.2L10.6 10.5L12.1 13L10.9 15.2L12 17.5Z", transform: "translate(-0.8, 0.6) rotate(-6 12 12)" } },
                { tag: "path", attrs: { d: "M12 21.5C13 21.5 14.41 20.41 16.25 18.75C19.23 16.07 22.5 12.5 22.5 8.5C22.5 5 20 2.25 16.5 2.25C14.2 2.25 12.7 3.4 12 4.25L13.2 6.4L11.7 8.6L13.4 10.8L11.9 13.1L13.1 15.5L12 17.5Z", transform: "translate(0.8, -0.4) rotate(5 12 12)" } }
            ]
        },
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
                { tag: "line", attrs: { stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", x1: "6", y1: "4", x2: "6", y2: "20", class: "mix-bar b1" } },
                { tag: "circle", attrs: { fill: "currentColor", cx: "6", cy: "14", r: "3", class: "mix-knob k1" } },
                { tag: "line", attrs: { stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", x1: "12", y1: "4", x2: "12", y2: "20", class: "mix-bar b2" } },
                { tag: "circle", attrs: { fill: "currentColor", cx: "12", cy: "8", r: "3", class: "mix-knob k2" } },
                { tag: "line", attrs: { stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", x1: "18", y1: "4", x2: "18", y2: "20", class: "mix-bar b3" } },
                { tag: "circle", attrs: { fill: "currentColor", cx: "18", cy: "16", r: "3", class: "mix-knob k3" } }
            ]
        }
    };

    const ALLOWED_SVG_ATTRS = new Set([
        'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
        'transform', 'fill-rule', 'clip-rule', 'opacity', 'class',
        'fill-opacity', 'width', 'height', 'xmlns'
    ]);
    const _svgCache = new Map();

    const SVG_UTILS = {
        createSVG: (def) => {
            const cacheKey = typeof def === 'object' ? JSON.stringify(def) : null;
            if (cacheKey && _svgCache.has(cacheKey)) {
                return _svgCache.get(cacheKey).cloneNode(true);
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
                if (!el.hasAttribute("viewBox")) el.setAttribute("viewBox", "0 0 24 24");
                if (!el.hasAttribute("width")) el.setAttribute("width", "24");
                if (!el.hasAttribute("height")) el.setAttribute("height", "24");
                if (!el.hasAttribute("fill")) el.setAttribute("fill", "currentColor");
            }

            if (Array.isArray(def.children)) {
                def.children.forEach(c => {
                    if (c && typeof c === 'object') {
                        el.appendChild(SVG_UTILS.createSVG(c));
                    } else if (c !== null && c !== undefined) {
                        el.textContent = c;
                    }
                });
            }

            if (cacheKey) _svgCache.set(cacheKey, el);
            return el.cloneNode(true);
        },

        getSVGString: (def) => {
            const el = SVG_UTILS.createSVG(def);
            return el.outerHTML;
        }
    };

    window.PIP_UI_ICONS = ICONS;
    window.PIP_SVG_UTILS = SVG_UTILS;

})();
