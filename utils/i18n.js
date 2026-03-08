// utils/i18n.js
// Utility script to handle automatic translations in the frontend (HTML files)
document.addEventListener('DOMContentLoaded', () => {
    // Translate text contents
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
        const messageKey = element.getAttribute('data-i18n');
        const translatedMessage = chrome.i18n.getMessage(messageKey);

        if (translatedMessage) {
            // Check if it's HTML, we might need to use innerHTML for the report descriptions.
            if (element.hasAttribute('data-i18n-html')) {
                element.innerHTML = translatedMessage;
            } else {
                element.textContent = translatedMessage;
            }
        }
    });

    // Translate specific attributes like title or placeholder
    const attrElements = document.querySelectorAll('[data-i18n-title]');
    attrElements.forEach(element => {
        const messageKey = element.getAttribute('data-i18n-title');
        const translatedMessage = chrome.i18n.getMessage(messageKey);
        if (translatedMessage) {
            element.title = translatedMessage;
        }
    });
});
