"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export type MailView = "briefing" | "summary" | "calendar" | "inbox" | "all" | "starred" | "sent" | "drafts" | "spam" | "trash";

type Motion = "pulse" | "lift" | "turn" | "write";
type RailItem = { key: MailView | "compose"; label: string; motion: Motion; icon: ReactNode };

// Line icons in the style of the design preview (24px grid, 1.8 stroke).
const items: RailItem[][] = [
  [
    { key: "briefing", label: "Daily Briefing", motion: "pulse", icon: <path d="M4 18h16M6.5 14.5a5.5 5.5 0 0 1 11 0M12 3v3M4.9 7.4 7 9M19.1 7.4 17 9" /> },
    { key: "summary", label: "Summary", motion: "lift", icon: <><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4.5v-.7a.8.8 0 0 1 .8-.8h4.4a.8.8 0 0 1 .8.8v.7M9 10h6M9 14h6M9 18h3" /></> },
    { key: "calendar", label: "Calendar", motion: "turn", icon: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" /></> },
  ],
  [
    { key: "inbox", label: "Inbox", motion: "lift", icon: <><path d="M3 13.5 5.5 5.8a2 2 0 0 1 1.9-1.3h9.2a2 2 0 0 1 1.9 1.3l2.5 7.7V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4.5Z" /><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" /></> },
    { key: "starred", label: "Starred", motion: "pulse", icon: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" /> },
    { key: "sent", label: "Sent", motion: "lift", icon: <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" /> },
    { key: "drafts", label: "Drafts", motion: "write", icon: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></> },
    { key: "all", label: "All Emails", motion: "lift", icon: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></> },
    { key: "spam", label: "Spam", motion: "pulse", icon: <><path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3L8.3 3Z" /><path d="M12 8v4.5M12 16h.01" /></> },
    { key: "trash", label: "Trash", motion: "lift", icon: <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.9 12.2A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.8L17.5 7M10 11v6M14 11v6" /> },
  ],
  [
    { key: "compose", label: "Compose", motion: "write", icon: <><path d="m14.5 5.5 4 4M4 20l3.8-.8L19 8a2.1 2.1 0 0 0-3-3L4.8 16.2 4 20Z" /><path d="m6 15 3 3" /></> },
  ],
];

// ---------------------------------------------------------------------------
// Edge refraction (Liquid Glass): the page behind the dock bends near its rim, so
// content scrolling underneath warps as it passes the edge. Done with an SVG
// displacement filter used as a backdrop filter, which only Chromium browsers
// (Chrome, Edge) support; elsewhere the dock keeps its plain clear glass.
// ---------------------------------------------------------------------------

const REFRACTION_ID = "mailflow-dock-refraction";
/** How far in from the rim the glass bends the view, in CSS pixels. */
const BEZEL = 16;
/** Largest shift at the very rim, in CSS pixels. Kept below BEZEL so the rim bends the
 *  view instead of repeating text from further in. */
const MAX_SHIFT = 10;

type RefractionMap = { href: string; width: number; height: number };

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
function useEdgeRefraction(dock: RefObject<HTMLElement | null>) {
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

/**
 * Navigation as a dock of icon buttons fixed at the bottom centre of the screen, so it
 * stays in place while the page scrolls (a full-width bar on phones). Each button
 * names itself in a tooltip above it on hover or keyboard focus.
 */
export function ActionRail({ view, onSelect, onCompose, composeOpen = false }: {
  view: MailView;
  onSelect: (view: MailView) => void;
  /** Opens the compose window, or closes it when it is already open. */
  onCompose: () => void;
  composeOpen?: boolean;
}) {
  const dock = useRef<HTMLElement>(null);
  const refraction = useEdgeRefraction(dock);
  return (
    <>
    {refraction && (
      <svg width="0" height="0" className="pointer-events-none absolute" aria-hidden="true">
        <filter id={REFRACTION_ID} x="0" y="0" width={refraction.width} height={refraction.height} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feImage href={refraction.href} x="0" y="0" width={refraction.width} height={refraction.height} preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={MAX_SHIFT * 2} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    )}
    <nav ref={dock} aria-label="Mailbox"
      // The refraction runs first, then the same light blur and colour lift as the plain glass.
      style={refraction ? { backdropFilter: `url(#${REFRACTION_ID}) blur(var(--glass-blur)) saturate(180%) brightness(1.04)` } : undefined}
      className="glass-dock fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 overflow-x-auto border-t px-3 py-2 [scrollbar-width:none] sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:gap-1.5 sm:overflow-visible sm:rounded-[26px] sm:border sm:p-2.5 md:gap-[9px]">
      {items.map((group, groupIndex) => (
        <div key={groupIndex} className="contents">
          {groupIndex > 0 && <span className="glass-divider mx-0.5 h-7 w-px shrink-0" aria-hidden="true" />}
          {group.map((item) => {
            const isCompose = item.key === "compose";
            // Compose shows as pressed while its window is open, so a second press reads as "close".
            const active = isCompose ? composeOpen : item.key === view;
            return (
              <button key={item.key} type="button" aria-label={item.label} aria-current={!isCompose && active ? "page" : undefined} aria-pressed={isCompose ? composeOpen : undefined}
                onClick={() => item.key === "compose" ? onCompose() : onSelect(item.key)}
                className={`rail-button group relative grid h-12 w-12 shrink-0 place-items-center rounded-[15px] border transition sm:h-11 sm:w-11 md:h-12 md:w-12 ${active
                  ? "glass-button-active text-mail-accent"
                  : "glass-button text-foreground hover:text-mail-accent"}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  className={`h-6 w-6 rail-icon-${item.motion}`}>{item.icon}</svg>
                <span className="pointer-events-none invisible absolute bottom-[calc(100%+10px)] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#302d38] px-[9px] py-1.5 text-[11px] font-bold text-white opacity-0 shadow-[0_4px_12px_rgba(39,37,32,0.14)] transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100 sm:block">{isCompose && composeOpen ? "Close compose" : item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
    </>
  );
}
