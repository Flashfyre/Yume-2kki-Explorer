const galleries = new Map();
const pairedItems = new WeakMap();

export function getGalleryItem(border) {
    return pairedItems.get(border);
}

export function restoreGallery(items) {
    galleries.get(items)?.destroy();
}

export function virtualizeGallery(items, borders) {
    if (!items || !borders || items.children.length < 24 || items.children.length !== borders.children.length)
        return;
    const gallery = new VirtualGallery(items, borders);
    galleries.set(items, gallery);
}

export function refreshGalleries(modal) {
    for (const gallery of galleries.values())
        if (modal.contains(gallery.items))
            gallery.measure();
}

export function restoreGalleries() {
    for (const gallery of galleries.values())
        gallery.mountAll();
}

class VirtualGallery {
    constructor(items, borders) {
        this.items = items;
        this.borders = borders;
        items.classList.add('virtual-gallery');
        borders.classList.add('virtual-gallery');
        this.viewport = items.closest('.modal__content');
        this.images = Array.from(items.children);
        this.links = Array.from(borders.children);
        this.rows = [];
        this.start = this.end = -1;
        this.schedule = () => {
            if (!this.frame)
                this.frame = requestAnimationFrame(() => {
                    this.frame = null;
                    this.update();
                });
        };
        this.images.forEach((item, index) => {
            const border = this.links[index];
            pairedItems.set(border, item);
            border.querySelectorAll('a').forEach(link => pairedItems.set(link, item));
        });
        this.viewport.addEventListener('scroll', this.schedule, { passive: true });
        this.onResize = () => {
            if (this.items.getClientRects().length)
                this.measure();
        };
        this.observer = new ResizeObserver(entries => {
            const width = entries[0].contentRect.width;
            if (width !== this.width) {
                this.width = width;
                this.onResize();
            }
        });
        this.observer.observe(this.viewport);
        this.onTransition = event => {
            if (event.propertyName === 'width' || event.propertyName === 'margin-right')
                this.onResize();
        };
        borders.addEventListener('transitionend', this.onTransition);
        if (items.getClientRects().length)
            this.measure();
        else {
            items.replaceChildren();
            borders.replaceChildren();
        }
    }

    mountAll() {
        this.items.replaceChildren(...this.images);
        this.borders.replaceChildren(...this.links);
        this.start = this.end = -1;
    }

    measure() {
        this.mountAll();
        if (!this.items.getClientRects().length) {
            this.items.replaceChildren();
            this.borders.replaceChildren();
            this.rows = [];
            return;
        }
        // The existing details panel can change both column count and row height.
        // Keep its layout intact until it is collapsed again.
        if (this.borders.querySelector('.collectable-entry--content.expanded')) {
            this.rows = [];
            return;
        }
        const measureList = (parent, elements) => {
            const top = parent.getBoundingClientRect().top;
            return elements.map(element => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    top: rect.top - top - parseFloat(style.marginTop),
                    bottom: rect.bottom - top + parseFloat(style.marginBottom)
                };
            });
        };
        this.imageBounds = measureList(this.items, this.images);
        this.linkBounds = measureList(this.borders, this.links);
        this.imageHeight = this.items.getBoundingClientRect().height;
        this.linkHeight = this.borders.getBoundingClientRect().height;
        this.rows = [];
        for (let i = 0; i < this.images.length; i++) {
            const bounds = this.imageBounds[i];
            const previous = this.rows[this.rows.length - 1];
            if (previous && Math.abs(bounds.top - previous.top) < 1) {
                previous.end = i + 1;
                previous.bottom = Math.max(previous.bottom, bounds.bottom);
            } else
                this.rows.push({ start: i, end: i + 1, ...bounds });
        }
        this.update();
    }

    update() {
        if (!this.rows.length || !this.items.getClientRects().length)
            return;
        // Keep an extra screen on either side so fast scrolling remains smooth.
        const viewport = this.viewport.getBoundingClientRect();
        const top = this.items.getBoundingClientRect().top;
        const min = viewport.top - top - viewport.height;
        const max = viewport.bottom - top + viewport.height;
        let first = this.rows.findIndex(row => row.bottom >= min);
        if (first < 0)
            first = this.rows.length - 1;
        let last = first;
        while (last + 1 < this.rows.length && this.rows[last + 1].top <= max)
            last++;
        const start = this.rows[first].start;
        const end = this.rows[last].end;
        if (start === this.start && end === this.end)
            return;
        const render = (parent, elements, bounds, height) => {
            const spacer = size => {
                const element = document.createElement('div');
                element.className = 'virtual-gallery-spacer';
                element.style.height = `${Math.max(0, size)}px`;
                element.setAttribute('aria-hidden', 'true');
                return element;
            };
            const bottom = Math.max(...bounds.slice(start, end).map(bound => bound.bottom));
            parent.replaceChildren(spacer(bounds[start].top), ...elements.slice(start, end), spacer(height - bottom));
        };
        render(this.items, this.images, this.imageBounds, this.imageHeight);
        render(this.borders, this.links, this.linkBounds, this.linkHeight);
        this.start = start;
        this.end = end;
    }

    destroy() {
        cancelAnimationFrame(this.frame);
        this.observer.disconnect();
        this.viewport.removeEventListener('scroll', this.schedule);
        this.borders.removeEventListener('transitionend', this.onTransition);
        this.mountAll();
        this.items.classList.remove('virtual-gallery');
        this.borders.classList.remove('virtual-gallery');
        galleries.delete(this.items);
    }
}
