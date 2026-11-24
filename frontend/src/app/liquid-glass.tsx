"use client";

import { useEffect, useState, type RefObject } from "react";

// ---------------------------------------------------------------------------
// Edge refraction (Liquid Glass): the page behind the dock bends near its rim, so
// content scrolling underneath warps as it passes the edge. Done with an SVG
// displacement filter used as a backdrop filter, which only Chromium browsers
// (Chrome, Edge) support; elsewhere the docks keep their plain clear glass. Shared by the
// desktop dock and the phone tab and action bars; each draws a map for its own size.
// ---------------------------------------------------------------------------

/** How far in from the rim the glass bends the view, in CSS pixels. */
const BEZEL = 16;
/** Largest shift at the very rim, in CSS pixels. Kept below BEZEL so the rim bends the
 *  view instead of repeating text from further in. */
const MAX_SHIFT = 10;

export type RefractionMap = { href: string; width: number; height: number };

function supportsBackdropRefraction() {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
  return brands.some(({ brand }) => brand === "Chromium") && CSS.supports("backdrop-filter", "blur(1px)");
}

/**
 * A displacement map for a rounded rectangle: neutral grey (no shift) in the middle,
 * and within BEZEL of the rim a shift that grows towards the edge and points inwards,
 * so the rim shows the page from a little further in, as a lens edge would.
 * Red carries the horizontal shift, green the vertical one.
 */
function drawRefractionMap(width: number, height: number, radius: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const image = context.createImageData(width, height);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const r = Math.min(radius, halfWidth, halfHeight);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - halfWidth;
      const py = y + 0.5 - halfHeight;
      // Signed distance to the rounded rectangle (negative inside).
      const qx = Math.abs(px) - (halfWidth - r);
      const qy = Math.abs(py) - (halfHeight - r);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const distance = outside + Math.min(Math.max(qx, qy), 0) - r;
      const depth = -distance;
      let dx = 0;
      let dy = 0;
      if (depth > 0 && depth < BEZEL) {
        // Outward normal of the nearest edge (or corner).
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) { nx = Math.sign(px) * qx / (outside || 1); ny = Math.sign(py) * qy / (outside || 1); }
        else if (qx > qy) { nx = Math.sign(px); ny = 0; }
        else { nx = 0; ny = Math.sign(py); }
        const strength = (1 - depth / BEZEL) ** 2;
        dx = -nx * strength;
        dy = -ny * strength;
      }
      const index = (y * width + x) * 4;
      image.data[index] = Math.round(128 + dx * 127);
      image.data[index + 1] = Math.round(128 + dy * 127);
      image.data[index + 2] = 128;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/** Keeps a refraction map sized to the dock, or null where the browser cannot use it. */
export function useEdgeRefraction(dock: RefObject<HTMLElement | null>) {
  const [map, setMap] = useState<RefractionMap | null>(null);
  useEffect(() => {
    const element = dock.current;
    if (!element || !supportsBackdropRefraction()) return;
    let drawn = "";
    // The observer also reports the starting size, so this draws the first map too.
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      const w = Math.round(width);
      const h = Math.round(height);
      const key = `${w}x${h}r${radius}`;
      if (!w || !h || key === drawn) return;
      drawn = key;
      setMap({ href: drawRefractionMap(w, h, radius), width: w, height: h });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [dock]);
  return map;
}

/** The SVG filter a dock's backdrop-filter points at; renders nothing until its map is drawn. */
export function RefractionFilter({ id, map }: { id: string; map: RefractionMap | null }) {
  if (!map) return null;
  return (
    <svg width="0" height="0" className="pointer-events-none absolute" aria-hidden="true">
      <filter id={id} x="0" y="0" width={map.width} height={map.height} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage href={map.href} x="0" y="0" width={map.width} height={map.height} preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale={MAX_SHIFT * 2} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

/** Backdrop filter for a dock: the refraction first, then the same light blur and colour lift as the plain glass. */
export function refractionStyle(id: string, map: RefractionMap | null) {
  return map ? { backdropFilter: `url(#${id}) blur(var(--glass-blur)) saturate(180%) brightness(1.04)` } : undefined;
}
