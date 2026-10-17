// jsdom has no DOMMatrix or DOMPoint, which the engine uses for every transform. A 2D version of
// the subset the engine calls, installed for every test file by src/test/setup.ts, only when the
// environment lacks one.

type Abcdef = { a: number; b: number; c: number; d: number; e: number; f: number };

class Matrix2D {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init as [number, number, number, number, number, number];
        else if (typeof init === "string") {
            // A CSS "matrix(a, b, c, d, e, f)" string.
            const m = /matrix\(([^)]+)\)/.exec(init);
            if (m) [this.a, this.b, this.c, this.d, this.e, this.f] = m[1]!.split(",").map(Number) as [number, number, number, number, number, number];
        }
    }
    get m11() {
        return this.a;
    }
    get m12() {
        return this.b;
    }
    get m21() {
        return this.c;
    }
    get m22() {
        return this.d;
    }
    get m41() {
        return this.e;
    }
    get m42() {
        return this.f;
    }
    get is2D() {
        return true;
    }
    get isIdentity() {
        return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
    }
    multiply(o: Abcdef): Matrix2D {
        return new Matrix2D([this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b, this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d, this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f]);
    }
    multiplySelf(o: Abcdef) {
        Object.assign(this, this.multiply(o));
        return this;
    }
    preMultiplySelf(o: Abcdef) {
        Object.assign(this, new Matrix2D([o.a, o.b, o.c, o.d, o.e, o.f]).multiply(this));
        return this;
    }
    translate(x = 0, y = 0) {
        return this.multiply(new Matrix2D([1, 0, 0, 1, x, y]));
    }
    translateSelf(x = 0, y = 0) {
        return this.multiplySelf(new Matrix2D([1, 0, 0, 1, x, y]));
    }
    static fromValues(a: number, b: number, c: number, d: number, e: number, f: number) {
        return new Matrix2D([a, b, c, d, e, f]);
    }
    // DOMMatrix.scale(scaleX, scaleY, scaleZ, originX, originY).
    scale(sx = 1, sy?: number, _sz?: number, ox = 0, oy = 0) {
        return this.translate(ox, oy)
            .multiply(new Matrix2D([sx, 0, 0, sy ?? sx, 0, 0]))
            .translate(-ox, -oy);
    }
    scaleSelf(sx = 1, sy = sx) {
        return this.multiplySelf(new Matrix2D([sx, 0, 0, sy, 0, 0]));
    }
    // DOMMatrix.rotate(angle) or rotate(rotX, rotY, rotZ): only the z rotation is 2D.
    rotate(rx = 0, ry?: number, rz?: number) {
        const deg = ry === undefined && rz === undefined ? rx : (rz ?? 0);
        const r = (deg * Math.PI) / 180;
        return this.multiply(new Matrix2D([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]));
    }
    rotateSelf(deg = 0) {
        Object.assign(this, this.rotate(deg));
        return this;
    }
    skewX(deg = 0) {
        return this.multiply(new Matrix2D([1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0]));
    }
    skewY(deg = 0) {
        return this.multiply(new Matrix2D([1, Math.tan((deg * Math.PI) / 180), 0, 1, 0, 0]));
    }
    flipX() {
        return this.scale(-1, 1);
    }
    flipY() {
        return this.scale(1, -1);
    }
    inverse() {
        const det = this.a * this.d - this.b * this.c;
        if (!det) return new Matrix2D([NaN, NaN, NaN, NaN, NaN, NaN]);
        return new Matrix2D([this.d / det, -this.b / det, -this.c / det, this.a / det, (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det]);
    }
    invertSelf() {
        Object.assign(this, this.inverse());
        return this;
    }
    transformPoint(p: { x?: number; y?: number } = {}) {
        const x = p.x ?? 0;
        const y = p.y ?? 0;
        return new Point2D(this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f);
    }
    toString() {
        return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
    }
}

class Point2D {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }
    matrixTransform(m: Matrix2D) {
        return m.transformPoint(this);
    }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = Matrix2D;
    g.DOMMatrixReadOnly = Matrix2D;
}
if (typeof g.DOMPoint === "undefined") {
    g.DOMPoint = Point2D;
    g.DOMPointReadOnly = Point2D;
}
