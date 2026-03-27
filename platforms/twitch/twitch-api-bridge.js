(() => {
    if (window.__TWITCH_PIP_BRIDGE_LOADED__) return;
    window.__TWITCH_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[Twitch Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, enableAutoSwitching, handleRequestPip, handleFocusPip, handleMuteUnmute, handleSetVolume, detectIsLive, createMonitorState } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const VIDEO_STATE_EVENTS = ['play', 'pause', 'volumechange'];

    const SELECTORS = {
        MUTE_BTN: '[data-a-target="player-mute-unmute-button"]',
        LIVE_BADGE: '.live-indicator, [data-a-target="player-overlay-live-indicator"]'
    };

    // -------- PLAYER HELPERS (Twitch-specific) --------
    function setVolume(video, volume) {
        if (!video) return;
        video.volume = volume / 100;
    }

    function findMuteButton(video) {
        return document.querySelector(SELECTORS.MUTE_BTN);
    }

    function detectIsLiveLocal(video) {
        return detectIsLive(video, [SELECTORS.LIVE_BADGE]);
    }

    // -------- STATE --------

    const monitorState = createMonitorState({
        platform: 'twitch',
        detectIsLive: detectIsLiveLocal,
        onStateChange: (state) => {
            document.dispatchEvent(new CustomEvent('Twitch_State_Update', { detail: state }));
        }
    });

    function forceMonitorSync() {
        monitorState(null, true);
    }

    function addVideoStateListeners() {
        VIDEO_STATE_EVENTS.forEach(evt => {
            document.addEventListener(evt, monitorState, { capture: true, passive: true });
        });
    }
    function removeVideoStateListeners() {
        VIDEO_STATE_EVENTS.forEach(evt => {
            document.removeEventListener(evt, monitorState, { capture: true });
        });
    }

    // Reset state when PiP enters so the UI gets a fresh update.
    document.addEventListener('enterpictureinpicture', () => {
        addVideoStateListeners();
        requestAnimationFrame(forceMonitorSync);
    });

    // Clean up when PiP exits
    document.addEventListener('leavepictureinpicture', () => {
        removeVideoStateListeners();
    });

    if (enableAutoSwitching) {
        enableAutoSwitching(forceMonitorSync);
    }

    // -------- CONTROL EVENTS --------

    function handleTogglePlay(video) {
        if (video) video.paused ? video.play() : video.pause();
    }

    function handleRequestPipLocal() {
        return handleRequestPip({
            getVideo: getActiveVideo,
            preSync: () => forceMonitorSync()
        });
    }

    function handleMuteLocal(video, shouldMute) {
        handleMuteUnmute(video, shouldMute, findMuteButton);
    }

    function handleSetVolumeLocal(video, value) {
        handleSetVolume(video, value, setVolume, handleMuteLocal);
    }



    document.addEventListener('Twitch_Control_Event', (e) => {
        const { action, value } = e.detail || {};
        const video = getActiveVideo();

        switch (action) {
            case ACTIONS.TOGGLE_PLAY: handleTogglePlay(video); break;
            case ACTIONS.PAUSE: if (video) video.pause(); break;
            case ACTIONS.REQUEST_PIP: handleRequestPipLocal(); break;
            case ACTIONS.EXIT_PIP: if (document.pictureInPictureElement) document.exitPictureInPicture(); break;
            case ACTIONS.FOCUS_PIP: handleFocusPip(); break;
            case ACTIONS.SEEK:
                if (video && Number.isFinite(value)) {
                    video.currentTime = Math.max(0, Math.min(video.currentTime + value, video.duration || Infinity));
                }
                break;
            case ACTIONS.MUTE: handleMuteLocal(video, true); break;
            case ACTIONS.UNMUTE: handleMuteLocal(video, false); break;
            case ACTIONS.SET_VOLUME: handleSetVolumeLocal(video, value); break;
            case ACTIONS.CHECK_STATUS: forceMonitorSync(); break;
        }
    });
})();
