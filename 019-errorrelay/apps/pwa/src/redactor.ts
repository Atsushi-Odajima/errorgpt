/**
 * Solid-box image redaction on a canvas. Produces a NEW PNG (metadata-free by re-encoding);
 * the original bytes are never modified. Boxes are numbered and outlined so they are not
 * identified by colour alone, and can be created/moved/resized with the keyboard.
 */
export interface Box { x: number; y: number; w: number; h: number }

export class Redactor {
  boxes: Box[] = [];
  private img: HTMLImageElement | null = null;
  private drawing: { x: number; y: number } | null = null;
  private scale = 1;
  selected = -1;
  onChange: () => void = () => undefined;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "img");
    canvas.addEventListener("pointerdown", (e) => this.start(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.end(e));
    canvas.addEventListener("pointercancel", () => (this.drawing = null));
    canvas.addEventListener("keydown", (e) => this.key(e));
  }

  async load(bytes: Uint8Array, mimeType: string): Promise<void> {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
    try {
      this.img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("cannot decode image"));
        i.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    this.canvas.width = this.img.naturalWidth;
    this.canvas.height = this.img.naturalHeight;
    this.boxes = [];
    this.draw();
  }

  private pos(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.scale = this.canvas.width / r.width;
    return { x: (e.clientX - r.left) * this.scale, y: (e.clientY - r.top) * this.scale };
  }
  private start(e: PointerEvent) {
    if (!this.img) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.drawing = this.pos(e);
  }
  private move(e: PointerEvent) {
    if (!this.drawing) return;
    const p = this.pos(e);
    this.draw({ x: Math.min(p.x, this.drawing.x), y: Math.min(p.y, this.drawing.y), w: Math.abs(p.x - this.drawing.x), h: Math.abs(p.y - this.drawing.y) });
  }
  private end(e: PointerEvent) {
    if (!this.drawing) return;
    const p = this.pos(e);
    const b = { x: Math.min(p.x, this.drawing.x), y: Math.min(p.y, this.drawing.y), w: Math.abs(p.x - this.drawing.x), h: Math.abs(p.y - this.drawing.y) };
    this.drawing = null;
    if (b.w > 4 && b.h > 4) {
      this.boxes.push(b);
      this.selected = this.boxes.length - 1;
    }
    this.draw();
    this.onChange();
  }
  private key(e: KeyboardEvent) {
    if (!this.img) return;
    const step = e.shiftKey ? 20 : 5;
    if (e.key === "Enter" || e.key === "a") {
      this.addCenteredBox();
      e.preventDefault();
      return;
    }
    if (this.selected < 0) return;
    const b = this.boxes[this.selected]!;
    const resize = e.altKey || e.ctrlKey || e.metaKey;
    if (e.key === "ArrowLeft") resize ? (b.w = Math.max(8, b.w - step)) : (b.x -= step);
    else if (e.key === "ArrowRight") resize ? (b.w += step) : (b.x += step);
    else if (e.key === "ArrowUp") resize ? (b.h = Math.max(8, b.h - step)) : (b.y -= step);
    else if (e.key === "ArrowDown") resize ? (b.h += step) : (b.y += step);
    else if (e.key === "Delete" || e.key === "Backspace") this.remove(this.selected);
    else if (e.key === "Tab" && this.boxes.length > 1) {
      this.selected = (this.selected + 1) % this.boxes.length;
    } else return;
    e.preventDefault();
    this.draw();
    this.onChange();
  }
  addCenteredBox() {
    const w = Math.round(this.canvas.width * 0.3);
    const h = Math.round(this.canvas.height * 0.08);
    this.boxes.push({ x: Math.round((this.canvas.width - w) / 2), y: Math.round((this.canvas.height - h) / 2), w, h });
    this.selected = this.boxes.length - 1;
    this.draw();
    this.onChange();
  }
  remove(i: number) {
    this.boxes.splice(i, 1);
    this.selected = Math.min(this.selected, this.boxes.length - 1);
    this.draw();
    this.onChange();
  }
  select(i: number) {
    this.selected = i;
    this.draw();
  }
  draw(temp?: Box) {
    const ctx = this.canvas.getContext("2d")!;
    if (!this.img) return;
    ctx.drawImage(this.img, 0, 0);
    const all = temp ? [...this.boxes, temp] : this.boxes;
    all.forEach((b, i) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Not colour-only: numbered label + dashed outline (selected: thicker).
      ctx.strokeStyle = "#fff";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = i === this.selected ? 4 : 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.max(12, Math.round(this.canvas.width / 60))}px sans-serif`;
      ctx.fillText(`#${i + 1}`, b.x + 4, b.y + Math.max(14, Math.round(this.canvas.width / 60)));
    });
  }
  /** Export flattened PNG with boxes burned in. Re-encoding drops EXIF and other metadata. */
  async exportPng(): Promise<Uint8Array> {
    if (!this.img) throw new Error("no image");
    const off = document.createElement("canvas");
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(this.img, 0, 0);
    ctx.fillStyle = "#000";
    for (const b of this.boxes) ctx.fillRect(b.x, b.y, b.w, b.h);
    const blob = await new Promise<Blob | null>((res) => off.toBlob(res, "image/png"));
    if (!blob) throw new Error("export failed");
    return new Uint8Array(await blob.arrayBuffer());
  }
  /** Crop to a box (keeps only the region). */
  async cropPng(b: Box): Promise<Uint8Array> {
    if (!this.img) throw new Error("no image");
    const off = document.createElement("canvas");
    off.width = Math.round(b.w);
    off.height = Math.round(b.h);
    off.getContext("2d")!.drawImage(this.img, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    const blob = await new Promise<Blob | null>((res) => off.toBlob(res, "image/png"));
    if (!blob) throw new Error("crop failed");
    return new Uint8Array(await blob.arrayBuffer());
  }
}
