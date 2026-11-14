// Photo and signature tools: a touch-friendly cropper and a JPEG encoder that hits Teletalk's limits.
// Teletalk (js/imageup.js): photo exactly 300x300 px, 4-100 KB; signature exactly 300x80 px, 3-60 KB; .jpg only.

export const SPECS = {
  photo: { w: 300, h: 300, minKB: 4, maxKB: 100 },
  signature: { w: 300, h: 80, minKB: 3, maxKB: 60 },
};

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img); // browsers apply the photo's EXIF rotation themselves
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not-an-image'));
    };
    img.src = url;
  });
}

/**
 * Crop box over an image. Drag to move, pinch / wheel / slider to zoom, rotate in 90° steps.
 * The visible canvas shows exactly what will be saved.
 */
export class Cropper {
  constructor(canvas, spec) {
    this.canvas = canvas;
    this.spec = spec;
    this.scaleUp = 2; // draw the preview at 2x for sharp phones
    canvas.width = spec.w * this.scaleUp;
    canvas.height = spec.h * this.scaleUp;
    this.ctx = canvas.getContext('2d');
    this.img = null;
    this.zoom = 1;
    this.rot = 0;
    this.panX = 0;
    this.panY = 0;
    this.pointers = new Map();
    this.onchange = null;
    this.bind();
  }

  setImage(img) {
    this.img = img;
    this.zoom = 1;
    this.rot = 0;
    this.panX = 0;
    this.panY = 0;
    this.draw();
  }

  dims() {
    const turned = this.rot % 180 !== 0;
    return { iw: turned ? this.img.naturalHeight : this.img.naturalWidth, ih: turned ? this.img.naturalWidth : this.img.naturalHeight };
  }

  scaleFor(w, h) {
    const { iw, ih } = this.dims();
    return Math.max(w / iw, h / ih) * this.zoom; // "cover" times zoom
  }

  clamp(w, h) {
    // Keep the crop box fully covered by the image (no empty edges). Pan is stored in output pixels.
    const { iw, ih } = this.dims();
    const s = this.scaleFor(w, h);
    const maxX = Math.max(0, (iw * s - w) / 2);
    const maxY = Math.max(0, (ih * s - h) / 2);
    const k = w / this.spec.w;
    this.panX = Math.min(maxX / k, Math.max(-maxX / k, this.panX));
    this.panY = Math.min(maxY / k, Math.max(-maxY / k, this.panY));
  }

  paint(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    if (this.img) {
      this.clamp(w, h);
      const k = w / this.spec.w;
      const s = this.scaleFor(w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(w / 2 + this.panX * k, h / 2 + this.panY * k);
      ctx.rotate((this.rot * Math.PI) / 180);
      ctx.scale(s, s);
      ctx.drawImage(this.img, -this.img.naturalWidth / 2, -this.img.naturalHeight / 2);
    }
    ctx.restore();
  }

  draw() {
    this.paint(this.ctx, this.canvas.width, this.canvas.height);
  }

  setZoom(z) {
    this.zoom = Math.min(5, Math.max(1, z));
    this.draw();
    this.onchange?.();
  }

  rotate() {
    this.rot = (this.rot + 90) % 360;
    this.panX = this.panY = 0;
    this.draw();
    this.onchange?.();
  }

  bind() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * this.spec.w, y: ((e.clientY - r.top) / r.height) * this.spec.h };
    };
    let pinch = null;
    c.addEventListener('pointerdown', (e) => {
      if (!this.img) return;
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, pos(e));
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom };
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      const now = pos(e);
      this.pointers.set(e.pointerId, now);
      if (this.pointers.size === 2 && pinch) {
        const [a, b] = [...this.pointers.values()];
        this.setZoom((pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / (pinch.d || 1));
      } else if (this.pointers.size === 1) {
        this.panX += now.x - prev.x;
        this.panY += now.y - prev.y;
        this.draw();
      }
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) pinch = null;
      this.onchange?.();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.img) return;
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
      },
      { passive: false },
    );
  }

  /** The crop at the exact Teletalk size, on white. */
  output() {
    const out = document.createElement('canvas');
    out.width = this.spec.w;
    out.height = this.spec.h;
    this.paint(out.getContext('2d'), out.width, out.height);
    return out;
  }
}

/** Make paper white and ink dark (for photographed signatures). */
export function cleanSignature(canvas) {
  const ctx = canvas.getContext('2d');
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = im.data;
  // Paper level = bright end of the luminance range.
  const lums = new Uint8Array(p.length / 4);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) lums[j] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
  const sorted = Array.from(lums).sort((a, b) => a - b);
  const paper = sorted[Math.floor(sorted.length * 0.6)];
  const hi = Math.max(60, paper - 25);
  const lo = Math.max(0, hi - 110);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const t = Math.min(1, Math.max(0, (lums[j] - lo) / (hi - lo)));
    const v = Math.round(255 * t * t);
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return canvas;
}

/** Average colourfulness 0..1; Teletalk rejects black & white photos. */
export function colourfulness(canvas) {
  const p = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < p.length; i += 16) {
    sum += (Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2])) / 255;
    n++;
  }
  return n ? sum / n : 0;
}

const toBlob = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));

function addNoise(canvas, amp) {
  const ctx = canvas.getContext('2d');
  const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = im.data;
  for (let i = 0; i < p.length; i += 4) {
    const n = Math.round((Math.random() * 2 - 1) * amp);
    p[i] = Math.min(255, Math.max(0, p[i] + n));
    p[i + 1] = Math.min(255, Math.max(0, p[i + 1] + n));
    p[i + 2] = Math.min(255, Math.max(0, p[i + 2] + n));
  }
  ctx.putImageData(im, 0, 0);
}

/**
 * Best-quality JPEG whose size is inside [minKB, maxKB] (KB = 1024 bytes, as Teletalk counts).
 * Very plain images (a white signature) can come out too small; faint noise fixes that invisibly.
 */
export async function encodeJpeg(canvas, { minKB, maxKB }) {
  const min = minKB * 1024 + 64; // small safety margins
  const max = maxKB * 1024 - 256;
  let blob = await toBlob(canvas, 0.92);
  if (blob.size > max) {
    let lo = 0.2;
    let hi = 0.92;
    let best = null;
    for (let i = 0; i < 8; i++) {
      const q = (lo + hi) / 2;
      const b = await toBlob(canvas, q);
      if (b.size <= max) {
        best = b;
        lo = q;
      } else hi = q;
    }
    blob = best || (await toBlob(canvas, 0.1));
  }
  if (blob.size < min) {
    blob = await toBlob(canvas, 1);
    const work = document.createElement('canvas');
    work.width = canvas.width;
    work.height = canvas.height;
    for (let amp = 2; blob.size < min && amp <= 14; amp += 3) {
      work.getContext('2d').drawImage(canvas, 0, 0);
      addNoise(work, amp);
      blob = await toBlob(work, 1);
    }
  }
  if (blob.size < minKB * 1024 || blob.size > maxKB * 1024) throw new Error('size-out-of-range');
  return blob;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64, type = 'image/jpeg') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
