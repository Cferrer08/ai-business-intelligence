"use client";

/** Download helpers. Charts are SVG, so SVG export is lossless and PNG is rendered from it. */

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(title: string) {
  return (title || "chart").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chart";
}

/** Standalone SVG with a white background, the title, and inline font settings. */
function standaloneSvg(container: HTMLElement, title: string): { svg: string; width: number; height: number } | null {
  const source = container.querySelector("svg.recharts-surface") as SVGSVGElement | null;
  if (!source) return null;
  const { width, height } = source.getBoundingClientRect();
  const header = 32;
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("x", "0");
  clone.setAttribute("y", String(header));
  const ns = "http://www.w3.org/2000/svg";
  const root = document.createElementNS(ns, "svg");
  root.setAttribute("xmlns", ns);
  root.setAttribute("width", String(Math.ceil(width)));
  root.setAttribute("height", String(Math.ceil(height + header)));
  root.setAttribute("font-family", "Public Sans, Arial, sans-serif");
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#ffffff");
  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", "8");
  text.setAttribute("y", "22");
  text.setAttribute("font-size", "15");
  text.setAttribute("font-weight", "600");
  text.setAttribute("fill", "#16202E");
  text.textContent = title;
  root.append(bg, text, clone);
  return { svg: new XMLSerializer().serializeToString(root), width: Math.ceil(width), height: Math.ceil(height + header) };
}

export function exportSvg(container: HTMLElement, title: string): boolean {
  const out = standaloneSvg(container, title);
  if (!out) return false;
  download(new Blob([out.svg], { type: "image/svg+xml" }), `${safeFilename(title)}.svg`);
  return true;
}

export async function exportPng(container: HTMLElement, title: string): Promise<boolean> {
  const out = standaloneSvg(container, title);
  if (!out) return false;
  const scale = 2;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([out.svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = out.width * scale;
    canvas.height = out.height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return false;
    download(blob, `${safeFilename(title)}.png`);
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportCsv(csv: string, title: string) {
  // BOM so Excel on Windows opens UTF-8 correctly.
  download(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `${safeFilename(title)}.csv`);
}
