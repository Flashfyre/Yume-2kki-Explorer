export function updateConfig(config) {
    try {
        window.localStorage.config = JSON.stringify(config);
    } catch (error) {
    }
}