// Штатные функциональные сценарии не должны случайно тестировать общий burst-лимит.
module.exports = function pacedFetch() {
    let nextSlot = 0;
    return async (url, options) => {
        const slot = Math.max(Date.now(), nextSlot);
        nextSlot = slot + 110;
        await new Promise(resolve => setTimeout(resolve, Math.max(0, slot - Date.now())));
        return globalThis.fetch(url, options);
    };
};
