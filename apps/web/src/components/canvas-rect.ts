// The main canvas element (the largest one on the page), to place on-canvas handles over it.
export function canvasRect(): DOMRect | null {
    const canvases = [...document.querySelectorAll("canvas")];
    const main = canvases.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    return main ? main.getBoundingClientRect() : null;
}
