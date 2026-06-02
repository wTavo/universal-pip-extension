(() => {
    if (window.YouTubeDocumentPiPUI) return;

    /* ───────── helpers ───────── */
    function fmtTime(s) {
        if (!isFinite(s) || s < 0) return '0:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${m}:${String(sec).padStart(2, '0')}`;
    }

    /* ───────── CSS ───────── */
    const CSS = `
        :root { color-scheme: dark; }
        [hidden] { display: none !important; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            width: 100vw; height: 100vh;
            overflow: hidden; background: #000;
            font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
            user-select: none; color: #eee;
        }

        /* ── shell ── */
        .shell {
            position: relative; width: 100%; height: 100%;
            display: flex; align-items: center; justify-content: center;
            background: #000;
        }

        /* ── video ── */
        .unip-doc-pip-video {
            width: 100% !important; height: 100% !important;
            min-width: 0 !important; min-height: 0 !important;
            position: relative !important;
            top: 0 !important; left: 0 !important;
            object-fit: contain !important;
            background: #000 !important;
            cursor: default;
        }

        /* ── bottom overlay ── */
        .overlay {
            position: absolute; bottom: 0; left: 0; right: 0;
            display: flex; flex-direction: column;
            background: linear-gradient(0deg, rgba(0,0,0,.88) 0%, rgba(0,0,0,.45) 55%, transparent 100%);
            padding: 28px 14px 10px;
            opacity: 0; pointer-events: none;
            transform: translateY(6px);
            transition: opacity .28s ease, transform .28s ease;
            z-index: 10;
        }
        .shell.show .overlay {
            opacity: 1; pointer-events: auto; transform: translateY(0);
        }

        /* ── timeline row ── */
        .tl-row {
            display: flex; align-items: center; gap: 8px;
            padding: 0 2px 6px;
        }
        .tl-time {
            font-size: 11px; font-variant-numeric: tabular-nums;
            color: rgba(255,255,255,.75); white-space: nowrap;
            min-width: 32px;
        }
        .tl-time.right { text-align: right; }

        /* timeline slider */
        .tl-slider {
            -webkit-appearance: none; appearance: none;
            flex: 1; height: 4px; border-radius: 2px;
            background: rgba(255,255,255,.18);
            outline: none; cursor: pointer;
            transition: height .15s ease;
        }
        .tl-slider:hover { height: 6px; }
        .tl-slider::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 12px; height: 12px; border-radius: 50%;
            background: #fff; cursor: pointer;
            box-shadow: 0 0 4px rgba(0,0,0,.5);
            transition: transform .12s ease;
        }
        .tl-slider:hover::-webkit-slider-thumb { transform: scale(1.25); }
        .tl-slider::-moz-range-thumb {
            width: 12px; height: 12px; border: none;
            border-radius: 50%; background: #fff; cursor: pointer;
        }

        /* ── controls row ── */
        .ctrl-row {
            display: flex; align-items: center;
            justify-content: space-between;
            gap: 4px;
        }
        .ctrl-group { display: flex; align-items: center; gap: 6px; }

        /* ── button base ── */
        .btn {
            width: 32px; height: 32px;
            display: inline-flex; align-items: center; justify-content: center;
            border: none; border-radius: 50%;
            background: transparent; color: rgba(255,255,255,.85);
            cursor: pointer; padding: 0;
            transition: color .18s, background .18s, transform .12s;
            outline: none;
        }
        .btn:hover {
            color: #fff; background: rgba(255,255,255,.12);
            transform: scale(1.1);
        }
        .btn:active { transform: scale(.92); }
        .btn svg { width: 20px; height: 20px; fill: currentColor; pointer-events: none; }

        /* play/pause — larger */
        .btn.play { width: 38px; height: 38px; }
        .btn.play svg { width: 24px; height: 24px; }

        /* like active */
        .btn.like-on { color: #ff4b72; }
        .btn.like-on:hover { color: #ff7697; background: rgba(255,75,114,.15); }

        /* skip-ad pill */
        .btn.skip {
            border-radius: 14px; width: auto; padding: 0 10px; gap: 4px;
            font-size: 11px; font-weight: 600; letter-spacing: .3px;
        }
        .btn.skip.can-skip {
            background: rgba(255,180,0,.85); color: #000;
        }
        .btn.skip.can-skip:hover {
            background: rgba(255,195,40,1);
        }
        .btn.skip.waiting {
            background: rgba(255,255,255,.08); color: rgba(255,255,255,.5);
            cursor: default; pointer-events: none;
        }

        /* ── volume hover-expand ── */
        .vol-wrap {
            display: flex; align-items: center; gap: 0;
            position: relative;
        }
        .vol-slider {
            -webkit-appearance: none; appearance: none;
            width: 0; height: 3px; border-radius: 99px;
            background: rgba(255,255,255,.2);
            outline: none; cursor: pointer;
            opacity: 0;
            transition: width .25s cubic-bezier(.4,0,.2,1), opacity .2s ease, margin .25s cubic-bezier(.4,0,.2,1);
            margin-left: 0;
        }
        .vol-wrap:hover .vol-slider,
        .vol-slider:focus {
            width: 60px; opacity: 1; margin-left: 6px;
        }
        .vol-slider::-webkit-slider-runnable-track {
            height: 3px; border-radius: 99px; background: transparent;
        }
        .vol-slider::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 12px; height: 12px; border-radius: 50%;
            background: #fff; cursor: pointer;
            margin-top: -4.5px;
            box-shadow: 0 1px 4px rgba(0,0,0,.35);
            transition: transform .12s ease;
        }
        .vol-slider:hover::-webkit-slider-thumb { transform: scale(1.2); }
        .vol-slider::-moz-range-track {
            height: 3px; border-radius: 99px; background: transparent;
        }
        .vol-slider::-moz-range-thumb {
            width: 12px; height: 12px; border: none;
            border-radius: 50%; background: #fff; cursor: pointer;
            box-shadow: 0 1px 4px rgba(0,0,0,.35);
        }
        .vol-slider::-moz-range-progress {
            background: #fff; border-radius: 99px; height: 3px;
        }
    `;

    /* ───────── SVG factory ───────── */
    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svg(doc, paths) {
        const el = doc.createElementNS(SVG_NS, 'svg');
        el.setAttribute('viewBox', '0 0 24 24');
        el.setAttribute('aria-hidden', 'true');
        paths.forEach(d => {
            const p = doc.createElementNS(SVG_NS, 'path');
            p.setAttribute('d', d);
            el.appendChild(p);
        });
        return el;
    }
    function svgStroke(doc, paths) {
        const el = doc.createElementNS(SVG_NS, 'svg');
        el.setAttribute('viewBox', '0 0 24 24');
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', 'currentColor');
        el.setAttribute('stroke-width', '2');
        el.setAttribute('stroke-linecap', 'round');
        paths.forEach(d => {
            const p = doc.createElementNS(SVG_NS, 'path');
            p.setAttribute('d', d);
            el.appendChild(p);
        });
        return el;
    }

    const ICONS = {
        play:     d => svg(d, ['M8 5v14l11-7z']),
        pause:    d => svg(d, ['M6 5h4v14H6z', 'M14 5h4v14h-4z']),
        prev:     d => svg(d, ['M15 6l-6 6 6 6V6z', 'M7 6h2v12H7z']),
        next:     d => svg(d, ['M9 18l6-6-6-6v12z', 'M15 6h2v12h-2z']),
        rew:      d => svg(d, ['M11 7l-7 5 7 5V7z', 'M20 7l-7 5 7 5V7z']),
        fwd:      d => svg(d, ['M13 17l7-5-7-5v10z', 'M4 17l7-5-7-5v10z']),
        vol:      d => svg(d, ['M3 9v6h4l5 5V4L7 9H3z']),
        volHi:    d => {
            const el = svg(d, ['M3 9v6h4l5 5V4L7 9H3z']);
            const arcs = [
                'M16 8.5c1.2 1.9 1.2 5.1 0 7',
                'M19 6c2.1 3.4 2.1 8.6 0 12'
            ];
            arcs.forEach(ad => {
                const p = d.createElementNS(SVG_NS, 'path');
                p.setAttribute('d', ad);
                p.setAttribute('fill', 'none');
                p.setAttribute('stroke', 'currentColor');
                p.setAttribute('stroke-width', '2');
                p.setAttribute('stroke-linecap', 'round');
                el.appendChild(p);
            });
            return el;
        },
        muted:    d => svg(d, ['M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z']),
        like:     d => svg(d, ['M12 21s-7.5-4.4-9.4-9.2C1.1 8 3.6 4.8 7.2 4.8c2 0 3.6 1 4.8 2.5 1.2-1.5 2.8-2.5 4.8-2.5 3.6 0 6.1 3.2 4.6 7C19.5 16.6 12 21 12 21z']),
        skipAd:   d => svg(d, ['M5 6l9 6-9 6V6z', 'M16 6h3v12h-3z']),
        adWait:   d => svg(d, ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z'])
    };

    /* ───────── DOM helpers ───────── */
    function btn(doc, id, title, iconFn, cls, onClick) {
        const b = doc.createElement('button');
        b.id = id; b.type = 'button'; b.title = title;
        b.setAttribute('aria-label', title);
        b.className = 'btn' + (cls ? ' ' + cls : '');
        b.appendChild(iconFn(doc));
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    function setIcon(el, iconFn) {
        const doc = el.ownerDocument;
        el.replaceChildren(iconFn(doc));
    }

    function rangeInput(doc, id, cls, min, max, val) {
        const r = doc.createElement('input');
        r.id = id; r.type = 'range'; r.className = cls;
        r.min = String(min); r.max = String(max); r.value = String(val);
        r.setAttribute('aria-label', id);
        return r;
    }

    /* ───────── timeline gradient helper ───────── */
    function setTrackGradient(slider, pct) {
        slider.style.background =
            `linear-gradient(to right, rgba(255,0,0,.85) ${pct}%, rgba(255,255,255,.18) ${pct}%)`;
    }

    /* ───────── volume gradient helper ───────── */
    function setVolGradient(slider) {
        const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
        slider.style.background =
            `linear-gradient(to right, rgba(255,255,255,.85) ${pct}%, rgba(255,255,255,.2) ${pct}%)`;
    }

    /* ───────── render ───────── */
    function render(doc, video, actions) {
        // styles
        const oldStyle = doc.head.querySelector('#unipDocPipCSS');
        if (oldStyle) oldStyle.remove();
        const style = doc.createElement('style');
        style.id = 'unipDocPipCSS';
        style.textContent = CSS;
        doc.head.appendChild(style);

        doc.body.textContent = '';

        const shell = doc.createElement('div');
        shell.className = 'shell';

        // video
        video.classList.add('unip-doc-pip-video');
        video.onclick = actions.playPause;
        shell.appendChild(video);

        // overlay
        const overlay = doc.createElement('div');
        overlay.className = 'overlay';

        /* ---- timeline ---- */
        const tlRow = doc.createElement('div');
        tlRow.className = 'tl-row';

        const tlCur = doc.createElement('span');
        tlCur.className = 'tl-time'; tlCur.id = 'tlCur';
        tlCur.textContent = fmtTime(video.currentTime || 0);

        const tlSlider = rangeInput(doc, 'tlSlider', 'tl-slider', 0,
            Math.floor(video.duration || 0), Math.floor(video.currentTime || 0));

        const tlDur = doc.createElement('span');
        tlDur.className = 'tl-time right'; tlDur.id = 'tlDur';
        tlDur.textContent = fmtTime(video.duration || 0);

        tlRow.append(tlCur, tlSlider, tlDur);
        overlay.appendChild(tlRow);

        // timeline ↔ video sync
        let seeking = false;

        video.addEventListener('timeupdate', () => {
            if (seeking) return;
            const t = Math.floor(video.currentTime);
            tlSlider.value = String(t);
            tlCur.textContent = fmtTime(video.currentTime);
            const pct = video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0;
            setTrackGradient(tlSlider, pct);
        });
        video.addEventListener('durationchange', () => {
            const dur = Math.floor(video.duration || 0);
            tlSlider.max = String(dur);
            tlDur.textContent = fmtTime(video.duration);
        });
        tlSlider.addEventListener('input', () => {
            seeking = true;
            const t = Number(tlSlider.value);
            tlCur.textContent = fmtTime(t);
            const pct = video.duration > 0 ? (t / video.duration) * 100 : 0;
            setTrackGradient(tlSlider, pct);
        });
        tlSlider.addEventListener('change', () => {
            video.currentTime = Number(tlSlider.value);
            seeking = false;
        });

        // init gradient
        const initPct = video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0;
        setTrackGradient(tlSlider, initPct);

        /* ---- controls ---- */
        const ctrlRow = doc.createElement('div');
        ctrlRow.className = 'ctrl-row';

        // left group
        const left = doc.createElement('div');
        left.className = 'ctrl-group';

        const prevBtn = btn(doc, 'dpPrev', 'Previous', ICONS.prev, '', actions.previous);
        prevBtn.hidden = true;
        const rewBtn  = btn(doc, 'dpRew',  'Rewind 10s', ICONS.rew, '', actions.rewind);
        const playBtn = btn(doc, 'dpPlay', 'Play / Pause', ICONS.pause, 'play', actions.playPause);
        const fwdBtn  = btn(doc, 'dpFwd',  'Forward 10s', ICONS.fwd, '', actions.forward);
        const nextBtn = btn(doc, 'dpNext', 'Next', ICONS.next, '', actions.next);
        nextBtn.hidden = true;

        left.append(prevBtn, rewBtn, playBtn, fwdBtn, nextBtn);

        // right group
        const right = doc.createElement('div');
        right.className = 'ctrl-group';

        const likeBtn = btn(doc, 'dpLike', 'Like', ICONS.like, '', actions.like);

        const skipBtn = btn(doc, 'dpSkip', 'Skip Ad', ICONS.skipAd, 'skip', actions.skipAd);
        skipBtn.hidden = true;

        // volume wrap
        const volWrap = doc.createElement('div');
        volWrap.className = 'vol-wrap';
        const muteBtn = btn(doc, 'dpMute', 'Mute / Unmute', ICONS.volHi, '', actions.mute);
        const volSlider = rangeInput(doc, 'dpVol', 'vol-slider', 0, 100,
            Math.round((video.volume ?? 1) * 100));
        volSlider.addEventListener('input', (e) => {
            setVolGradient(volSlider);
            actions.volume(e);
        });
        setVolGradient(volSlider);
        volWrap.append(muteBtn, volSlider);

        right.append(likeBtn, skipBtn, volWrap);

        ctrlRow.append(left, right);
        overlay.appendChild(ctrlRow);

        shell.appendChild(overlay);
        doc.body.appendChild(shell);

        /* ---- auto-fade controls ---- */
        let hideTimer;
        const show = () => {
            shell.classList.add('show');
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => shell.classList.remove('show'), 2500);
        };
        shell.addEventListener('mousemove', show);
        shell.addEventListener('click', show);
        overlay.addEventListener('mouseenter', () => { if (hideTimer) clearTimeout(hideTimer); });
        overlay.addEventListener('mouseleave', show);
        show();
    }

    /* ───────── update ───────── */
    function update(doc, state) {
        if (!state) return;
        const playBtn = doc.getElementById('dpPlay');
        const muteBtn = doc.getElementById('dpMute');
        const likeBtn = doc.getElementById('dpLike');
        const prevBtn = doc.getElementById('dpPrev');
        const nextBtn = doc.getElementById('dpNext');
        const skipBtn = doc.getElementById('dpSkip');
        const volSlider = doc.getElementById('dpVol');

        if (playBtn) setIcon(playBtn, state.playing === false ? ICONS.play : ICONS.pause);

        if (muteBtn) {
            setIcon(muteBtn, state.muted ? ICONS.muted : ICONS.volHi);
        }

        if (likeBtn) {
            likeBtn.classList.toggle('like-on', !!state.liked);
        }

        // navigation — only visible on Shorts
        if (prevBtn) prevBtn.hidden = !state.supportsNavigation;
        if (nextBtn) nextBtn.hidden = !state.supportsNavigation;

        // skip ad — only visible during ads
        if (skipBtn) {
            if (!state.isAd) {
                skipBtn.hidden = true;
            } else {
                skipBtn.hidden = false;
                if (state.canSkipAd) {
                    skipBtn.className = 'btn skip can-skip';
                    setIcon(skipBtn, ICONS.skipAd);
                    skipBtn.title = 'Skip Ad';
                } else {
                    skipBtn.className = 'btn skip waiting';
                    setIcon(skipBtn, ICONS.adWait);
                    skipBtn.title = 'Ad in progress…';
                }
            }
        }

        if (volSlider && typeof state.volume === 'number' && doc.activeElement !== volSlider) {
            volSlider.value = String(state.muted ? 0 : state.volume);
            setVolGradient(volSlider);
        }
    }

    window.YouTubeDocumentPiPUI = { render, update };
})();
