(() => {
    if (window.__TWITCH_PIP_BRIDGE_LOADED__) return;
    window.__TWITCH_PIP_BRIDGE_LOADED__ = true;

    if (!window.BridgeUtils) {
        console.error('[Twitch Bridge] BridgeUtils not found! Aborting.');
        return;
    }

    const { ACTIONS, getActiveVideo, enableAutoSwitching, handleRequestPip, detectIsLive, createBaseBridge } = window.BridgeUtils;

    // -------- CONSTANTS --------

    const SELECTORS = {
        MUTE_BTN: '[data-a-target="player-mute-unmute-button"]',
        LIVE_BADGE: '.live-indicator, [data-a-target="player-overlay-live-indicator"]'
    };

    function findMuteButton(video) {
        return document.querySelector(SELECTORS.MUTE_BTN);
    }

    function detectIsLiveLocal(video) {
        return detectIsLive(video, [SELECTORS.LIVE_BADGE]);
    }

    // -------- BASE BRIDGE INITIALIZATION --------

    const baseBridge = createBaseBridge({
        platform: 'twitch',
        getVideo: getActiveVideo,
        detectIsLive: detectIsLiveLocal,
        findMuteBtn: findMuteButton,
        onStateChange: (state) => {
            document.dispatchEvent(new CustomEvent('Twitch_State_Update', { detail: state }));
        },
        supportedActions: {
            [ACTIONS.CHECK_STATUS]: () => {
                baseBridge.monitorState(null, true);
                return { handled: true };
            }
        }
    });

    // -------- PIP LIFECYCLE --------

    document.addEventListener('enterpictureinpicture', () => {
        baseBridge.addVideoStateListeners(getActiveVideo());
        requestAnimationFrame(() => baseBridge.monitorState(null, true));
    });

    document.addEventListener('leavepictureinpicture', () => {
        baseBridge.removeVideoStateListeners(getActiveVideo());
    });

    if (enableAutoSwitching) {
        enableAutoSwitching(() => baseBridge.monitorState(null, true));
    }

    // -------- CONTROL EVENTS --------

    document.addEventListener('Twitch_Control_Event', (e) => {
        const { action } = e.detail || {};
        if (action === ACTIONS.REQUEST_PIP) {
            handleRequestPip({
                getVideo: getActiveVideo,
                preSync: () => baseBridge.monitorState(null, true)
            });
        } else {
            baseBridge.handleMessage(e.detail);
        }
    });
})();
