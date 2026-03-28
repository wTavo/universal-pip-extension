document.addEventListener('DOMContentLoaded', () => {
    const log = PiPLogger.create('Popup');
    log.info('Popup loaded');

    // ── Shared Modal System ──────────────────────────────────
    const modalOverlay = document.getElementById('modal-overlay');
    const modalViews = document.querySelectorAll('.modal-view');
    const settingsBtn = document.getElementById('settings-toggle-btn');
    const reportBtn = document.getElementById('open-report-btn');

    function openModal(viewName) {
        modalViews.forEach(v => v.style.display = 'none');
        const target = document.getElementById(`modal-view-${viewName}`);
        if (target) target.style.display = 'block';
        modalOverlay.classList.add('open');
        settingsBtn.classList.toggle('active', viewName === 'settings');
        if (viewName === 'settings') updateStorageSize();
    }

    function closeModal() {
        modalOverlay.classList.remove('open');
        settingsBtn.classList.remove('active');
    }

    settingsBtn.addEventListener('click', () => {
        if (modalOverlay.classList.contains('open')) {
            closeModal();
        } else {
            openModal('settings');
        }
    });

    reportBtn.addEventListener('click', () => openModal('report'));

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    // ── Debug Mode Toggle ──────────────────────────────────────
    const debugToggle = document.getElementById('debug-mode-toggle');

    // Load current debug state
    chrome.storage.local.get(['logLevel'], (result) => {
        const isDebug = result.logLevel === 'DEBUG';
        debugToggle.checked = isDebug;
    });

    debugToggle.addEventListener('change', (e) => {
        const newLevel = e.target.checked ? 'DEBUG' : 'NONE';
        PiPLogger.setLevel(newLevel);
        log.info('Debug mode:', e.target.checked ? 'ON' : 'OFF');
    });

    // ── Storage Management ────────────────────────────────────
    const storageSizeLabel = document.getElementById('storage-size-label');
    const clearStorageBtn = document.getElementById('clear-storage-btn');

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        return (bytes / 1024).toFixed(1) + ' KB';
    }

    async function updateStorageSize() {
        const size = await PiPLogger.getStorageSize();
        storageSizeLabel.textContent = chrome.i18n.getMessage("bytesUsed", formatBytes(size));
    }

    clearStorageBtn.addEventListener('click', async () => {
        await PiPLogger.clearLogs();
        await updateStorageSize();
    });

    // ── Generate Diagnostic Report ────────────────────────────
    const generateBtn = document.getElementById('generate-report-btn');

    generateBtn.addEventListener('click', async () => {
        const manifest = chrome.runtime.getManifest();

        // ── Get full browser build info ──
        let browserBuild = navigator.userAgent;
        try {
            if (navigator.userAgentData) {
                const hv = await navigator.userAgentData.getHighEntropyValues([
                    'fullVersionList', 'architecture', 'bitness', 'platform', 'platformVersion'
                ]);
                // Find the actual browser brand (not Chromium)
                const brands = hv.fullVersionList || [];
                const edge = brands.find(b => b.brand === 'Microsoft Edge');
                const chrome = brands.find(b => b.brand === 'Google Chrome');
                const opera = brands.find(b => b.brand === 'Opera');
                const match = edge || opera || chrome || brands[0];
                if (match) {
                    const bits = hv.bitness ? `${hv.bitness}-bit` : '';
                    browserBuild = `${match.brand} ${match.version} (Official Build) ${bits ? `(${bits})` : ''}`.trim();
                }
            }
        } catch (e) { /* fallback to raw UA */ }

        const logData = await PiPLogger.getReportData();

        const report = [
            '═══════════════════════════════════════════════════',
            '  Universal PiP — Diagnostic Report',
            '═══════════════════════════════════════════════════',
            '',
            '─── Environment ───────────────────────────────────',
            `  Extension Version:  ${manifest.version}`,
            `  Browser:            ${browserBuild}`,
            `  Language:           ${navigator.language}`,
            `  Platform:           ${navigator.platform}`,
            '',
            '─── Internal State ────────────────────────────────',
            `  Manifest Version:   MV${manifest.manifest_version}`,
            `  Permissions:        ${(manifest.permissions || []).join(', ')}`,
            `  Content Scripts:    ${(manifest.content_scripts || []).length} entries`,
            '',
            '─── Debug Logs ────────────────────────────────────',
            '',
            logData || '(No debug logs captured — enable Debug Mode to record logs)',
            '',
            '═══════════════════════════════════════════════════',
            `  Generated: ${new Date().toISOString()}`,
            '═══════════════════════════════════════════════════',
        ].join('\n');

        const blob = new Blob([report], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `UniversalPiP_Report_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        closeModal();
    });

    // ── Scope Toggle (All Pages / Platform) ────────────────────
    const cards = document.querySelectorAll('.command-card');
    const hideScopeToggle = document.getElementById('hide-scope-toggle');

    chrome.storage.local.get(['hideUiScope'], (result) => {
        if (result.hideUiScope === 'global') {
            hideScopeToggle.checked = true;
            document.querySelectorAll('.ui-control').forEach(card => {
                card.classList.add('global-mode');
            });
        } else {
            document.querySelectorAll('.ui-control').forEach(card => {
                card.classList.remove('global-mode');
            });
        }
    });

    hideScopeToggle.addEventListener('change', (e) => {
        const scope = e.target.checked ? 'global' : 'platform';
        chrome.storage.local.set({ hideUiScope: scope });
        log.info('Hide UI scope set to:', scope);

        const uiControlCards = document.querySelectorAll('.ui-control');
        uiControlCards.forEach(card => {
            if (e.target.checked) {
                card.classList.add('global-mode');
            } else {
                card.classList.remove('global-mode');
            }
        });

        e.stopPropagation();
    });

    // ── Status Indicators ──────────────────────────────────────
    async function updateStatusIndicators() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const globalBadge = document.getElementById('global-status');
            const currentBadge = document.getElementById('current-status');

            const { MSG } = window.PIP_CONSTANTS;
            chrome.runtime.sendMessage({ type: MSG.GET_UI_STATE }, (response) => {
                if (response && response.uiVisible !== undefined) {
                    if (response.uiVisible) {
                        globalBadge.classList.remove('hidden');
                        globalBadge.querySelector('.status-value').textContent = chrome.i18n.getMessage("statusVisible");
                    } else {
                        globalBadge.classList.add('hidden');
                        globalBadge.querySelector('.status-value').textContent = chrome.i18n.getMessage("statusHidden");
                    }
                }
            });

            if (tab && tab.id) {
                const { MSG } = window.PIP_CONSTANTS;
                chrome.tabs.sendMessage(tab.id, { type: MSG.GET_UI_VISIBILITY }, (response) => {
                    if (chrome.runtime.lastError) {
                        currentBadge.classList.remove('hidden');
                        currentBadge.querySelector('.status-value').textContent = chrome.i18n.getMessage("statusNA");
                        return;
                    }

                    if (response && response.visible !== undefined) {
                        if (response.visible) {
                            currentBadge.classList.remove('hidden');
                            currentBadge.querySelector('.status-value').textContent = chrome.i18n.getMessage("statusVisible");
                        } else {
                            currentBadge.classList.add('hidden');
                            currentBadge.querySelector('.status-value').textContent = chrome.i18n.getMessage("statusHidden");
                        }
                    }
                });
            }
        } catch (error) {
            log.error('Error updating status:', error);
        }
    }

    updateStatusIndicators();

    // ── Command Cards ──────────────────────────────────────────
    cards.forEach(card => {
        const command = card.getAttribute('data-command');
        if (!command) return;

        card.style.cursor = 'pointer';

        card.addEventListener('click', async (e) => {
            log.info('Executing command:', command);

            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const distX = Math.max(x, rect.width - x);
            const distY = Math.max(y, rect.height - y);
            const radius = Math.sqrt(distX * distX + distY * distY);

            const ripple = document.createElement("span");
            ripple.classList.add("ripple");

            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;

            const size = 20;
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.marginLeft = ripple.style.marginTop = `-${size / 2}px`;

            const scale = (radius * 2) / size;
            ripple.style.setProperty("--ripple-scale", scale);

            const oldRipple = card.querySelector(".ripple");
            if (oldRipple) oldRipple.remove();

            card.appendChild(ripple);

            ripple.addEventListener("animationend", () => {
                ripple.remove();
            });

            try {
                if (!chrome.runtime?.id) return;
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

                const { MSG } = window.PIP_CONSTANTS;
                if (command === 'hide_ui') {
                    const scope = hideScopeToggle.checked ? 'global' : 'platform';
                    chrome.runtime.sendMessage({
                        type: MSG.EXECUTE_COMMAND,
                        command: 'hide_ui',
                        scope: scope,
                        tabUrl: tab.url
                    });
                    setTimeout(() => updateStatusIndicators(), 200);
                } else if (command === 'show_ui') {
                    const scope = hideScopeToggle.checked ? 'global' : 'platform';
                    chrome.runtime.sendMessage({
                        type: MSG.EXECUTE_COMMAND,
                        command: 'show_ui',
                        scope: scope,
                        tabUrl: tab.url
                    });
                    setTimeout(() => updateStatusIndicators(), 200);
                } else if (command === 'focus_pip') {
                    chrome.runtime.sendMessage({ type: MSG.EXECUTE_COMMAND, command: 'focus_pip' });
                } else if (command === 'close_pip') {
                    chrome.runtime.sendMessage({ type: MSG.EXIT_PIP });
                }

                log.info('Command executed:', command);
            } catch (error) {
                log.error('Error executing command:', error);
            }
        });
    });
});
