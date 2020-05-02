export function updateConfig() {
    try {
        window.localStorage.config = JSON.stringify(config);
    } catch (error) {
    }
}