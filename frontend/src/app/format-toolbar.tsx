"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// Formatting toolbar shared by the reply composer and the Compose window. It mirrors
// Gmail's compose toolbar and drives a contentEditable editor through execCommand,
// the editing API browsers expose to webmail composers.

// Same font choices as Gmail's compose toolbar.
export const COMPOSER_FONTS = [
  ["Sans Serif", "Arial, Helvetica, sans-serif"],
  ["Serif", "'Times New Roman', serif"],
  ["Fixed Width", "'Courier New', monospace"],
  ["Wide", "'Arial Black', sans-serif"],
  ["Narrow", "'Arial Narrow', sans-serif"],
  ["Comic Sans MS", "'Comic Sans MS', sans-serif"],
  ["Garamond", "Garamond, serif"],
  ["Georgia", "Georgia, serif"],
  ["Tahoma", "Tahoma, sans-serif"],
  ["Trebuchet MS", "'Trebuchet MS', sans-serif"],
  ["Verdana", "Verdana, sans-serif"],
] as const;
// Point-style sizes like a word processor ("" keeps the editor's normal size).
const SIZES = ["", "10", "12", "14", "16", "18", "20", "24", "32", "48"] as const;
/** Classes the editor needs so quotes and links look like what will be sent. */
export const EDITOR_CONTENT_CLASS = "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-[#0b57d0] [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-[#c7c7c7] [&_blockquote]:pl-3";

const PATHS = {
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z",
  bold: "M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z",
  italic: "M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z",
  underline: "M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z",
  strike: "M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z",
  alignLeft: "M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z",
  alignCenter: "M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z",
  alignRight: "M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z",
  listNumbered: "M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z",
  listBulleted: "M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z",
  outdent: "M11 17h10v-2H11v2zm-8-5l4 4V8l-4 4zm0 9h18v-2H3v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z",
  indent: "M3 21h18v-2H3v2zM3 8v8l4-4-4-4zm8 9h10v-2H11v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z",
  quote: "M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  clear: "M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z",
} as const;

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));

// onMouseDown is cancelled on every button so clicking it does not clear the text selection.
function IconButton({ name, label, onClick }: { name: keyof typeof PATHS; label: string; onClick: () => void }) {
  return (
    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onClick} aria-label={label} title={label} className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-[#1f1f1f14]">
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true"><path d={PATHS[name]} /></svg>
    </button>
  );
}

/** Applies the current colour on click; the small arrow opens the browser's colour picker. */
function ColourButton({ label, glyph, value, onApply, onPick }: { label: string; glyph: string; value: string; onApply: () => void; onPick: (next: string) => void }) {
  return (
    <span className="flex shrink-0 items-center">
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onApply} aria-label={label} title={label} className="flex h-8 w-7 flex-col items-center justify-center rounded-l hover:bg-[#1f1f1f14]">
        <span className="text-sm font-bold leading-4">{glyph}</span><span className="h-1 w-4 rounded-sm" style={{ backgroundColor: value }} />
      </button>
      <label className="flex h-8 w-4 cursor-pointer items-center justify-center rounded-r text-[10px] hover:bg-[#1f1f1f14]" title={`Choose ${label.toLowerCase()}`}>
        ▾<input type="color" value={value} aria-label={`Choose ${label.toLowerCase()}`} onChange={(event) => onPick(event.target.value)} className="sr-only" />
      </label>
    </span>
  );
}

export function FormatToolbar({ editorRef, onChange, className = "" }: { editorRef: RefObject<HTMLDivElement | null>; onChange: () => void; className?: string }) {
  const [font, setFont] = useState<string>(COMPOSER_FONTS[0][1]);
  const [size, setSize] = useState<string>("");
  const [textColor, setTextColor] = useState("#d93025");
  const [highlight, setHighlight] = useState("#fff475");
  // Dropdowns and colour pickers take focus away from the editor. Follow the selection
  // wherever it is made (mouse, keyboard, a drag that ends outside the editor) so it can
  // be put back, and never replace a selection that is still live in the editor.
  const saved = useRef<Range | null>(null);
  useEffect(() => {
    const remember = () => {
      const selection = window.getSelection();
      const editor = editorRef.current;
      if (!selection || selection.rangeCount === 0 || !editor) return;
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) saved.current = range.cloneRange();
    };
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, [editorRef]);

  const run = (action: (editor: HTMLDivElement, collapsed: boolean) => void) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    const live = Boolean(selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).commonAncestorContainer));
    editor.focus();
    if (!live && selection && saved.current && editor.contains(saved.current.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(saved.current);
    }
    action(editor, window.getSelection()?.isCollapsed ?? true);
    onChange();
  };
  const command = (name: string, value?: string) => run(() => {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(name, false, value);
  });
  const applySize = (px: string) => run((editor, collapsed) => {
    if (collapsed) {
      // Nothing selected: start typing at this size from here on.
      if (px) document.execCommand("insertHTML", false, `<span style="font-size:${px}px">​</span>`);
      return;
    }
    // execCommand only knows seven legacy sizes, so mark the selection with one
    // of them and then turn the marks into an exact pixel size.
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("fontSize", false, "7");
    editor.querySelectorAll('font[size="7"]').forEach((node) => {
      node.removeAttribute("size");
      (node as HTMLElement).style.fontSize = px ? `${px}px` : "";
      // Sizes set earlier inside the selection would otherwise win over the new one.
      node.querySelectorAll<HTMLElement>("[style*='font-size']").forEach((inner) => { inner.style.fontSize = ""; });
    });
  });
  const addLink = () => {
    const typed = window.prompt("Link address", "https://");
    if (!typed || !typed.trim() || typed.trim() === "https://") return;
    const url = /^(https?:\/\/|mailto:)/i.test(typed.trim()) ? typed.trim() : `https://${typed.trim()}`;
    run((_editor, collapsed) => {
      if (collapsed) document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
      else document.execCommand("createLink", false, url);
    });
  };

  const select = "h-8 cursor-pointer rounded bg-transparent px-1 text-sm outline-none hover:bg-[#1f1f1f14]";
  const divider = <span className="mx-1 h-5 w-px shrink-0 bg-[#c7c7c7]" aria-hidden="true" />;
  return (
    <div className={`flex flex-wrap items-center gap-0.5 rounded-2xl bg-[#f0f4f9] px-2 py-1 text-[#444746] ${className}`} role="toolbar" aria-label="Formatting options">
      <IconButton name="undo" label="Undo (Ctrl+Z)" onClick={() => command("undo")} />
      <IconButton name="redo" label="Redo (Ctrl+Y)" onClick={() => command("redo")} />
      {divider}
      <select value={font} aria-label="Font" title="Font" onChange={(event) => { setFont(event.target.value); command("fontName", event.target.value); }} className={`${select} max-w-[120px]`}>
        {COMPOSER_FONTS.map(([label, value]) => <option key={label} value={value} style={{ fontFamily: value }}>{label}</option>)}
      </select>
      <select value={size} aria-label="Font size" title="Font size" onChange={(event) => { setSize(event.target.value); applySize(event.target.value); }} className={select}>
        {SIZES.map((value) => <option key={value} value={value}>{value || "Size"}</option>)}
      </select>
      {divider}
      <IconButton name="bold" label="Bold (Ctrl+B)" onClick={() => command("bold")} />
      <IconButton name="italic" label="Italic (Ctrl+I)" onClick={() => command("italic")} />
      <IconButton name="underline" label="Underline (Ctrl+U)" onClick={() => command("underline")} />
      <IconButton name="strike" label="Strikethrough" onClick={() => command("strikeThrough")} />
      <ColourButton label="Text colour" glyph="A" value={textColor} onApply={() => command("foreColor", textColor)} onPick={(next) => { setTextColor(next); command("foreColor", next); }} />
      <ColourButton label="Highlight colour" glyph="H" value={highlight} onApply={() => command("hiliteColor", highlight)} onPick={(next) => { setHighlight(next); command("hiliteColor", next); }} />
      {divider}
      <IconButton name="alignLeft" label="Align left" onClick={() => command("justifyLeft")} />
      <IconButton name="alignCenter" label="Align centre" onClick={() => command("justifyCenter")} />
      <IconButton name="alignRight" label="Align right" onClick={() => command("justifyRight")} />
      {divider}
      <IconButton name="listNumbered" label="Numbered list" onClick={() => command("insertOrderedList")} />
      <IconButton name="listBulleted" label="Bulleted list" onClick={() => command("insertUnorderedList")} />
      <IconButton name="outdent" label="Indent less" onClick={() => command("outdent")} />
      <IconButton name="indent" label="Indent more" onClick={() => command("indent")} />
      <IconButton name="quote" label="Quote" onClick={() => command("formatBlock", "blockquote")} />
      <IconButton name="link" label="Insert link" onClick={addLink} />
      {divider}
      <IconButton name="clear" label="Remove formatting" onClick={() => { command("removeFormat"); command("formatBlock", "div"); setFont(COMPOSER_FONTS[0][1]); setSize(""); }} />
    </div>
  );
}
