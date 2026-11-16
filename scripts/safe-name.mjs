// Makes a file name safe to echo into the model context: names are data from disk and can carry control
// characters, bidi overrides, zero-width characters, line breaks or a long injected sentence.
// Strips control/format characters, collapses whitespace, caps the length (default 80, with "...").
// Also: Unicode tag characters (an invisible copy of ASCII), variation selectors, private-use areas and blank fillers.
const STRIP = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\ue000-\uf8ff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}\u{f0000}-\u{10ffff}]/gu;
export function safeName(name, max = 80) {
  const s = String(name).replace(STRIP, " ").replace(/\s+/g, " ").trim().normalize("NFC");
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max - 3).join("") + "..." : s;
}
// A free-text note that comes from a project file (data, not an instruction): control, bidi, zero-width and tag
// characters removed, whitespace collapsed, capped at 300 characters.
export const safeNote = (text, max = 300) => safeName(text, max);
