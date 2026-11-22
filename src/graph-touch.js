export function initGraphTouch(element) {
    const pointers = new Map();
    const blockedClicks = new WeakSet();
    let gesture = false;

    element.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'touch')
            return;
        if (!pointers.size)
            gesture = false;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size > 1)
            gesture = true;
    }, { capture: true, passive: true });

    element.addEventListener('pointermove', event => {
        const start = pointers.get(event.pointerId);
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8)
            gesture = true;
    }, { capture: true, passive: true });

    const endPointer = event => {
        if (!pointers.has(event.pointerId))
            return;
        if (event.type === 'pointercancel')
            gesture = true;
        if (gesture)
            blockedClicks.add(event);
        pointers.delete(event.pointerId);
    };
    window.addEventListener('pointerup', endPointer, { capture: true, passive: true });
    window.addEventListener('pointercancel', endPointer, { capture: true, passive: true });
    window.addEventListener('blur', () => {
        pointers.clear();
        gesture = true;
    });

    return event => blockedClicks.has(event) || (event?.pointerType === 'touch' && gesture);
}
