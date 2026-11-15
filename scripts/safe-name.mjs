// Makes a file name safe to echo into the model context: names are data from disk and can carry control
// characters, bidi overrides, zero-width characters, line breaks or a long injected sentence.
// Strips control/format characters, collapses whitespace, caps the length (default 80, with "...").
const STRIP = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;
export function safeName(name, max = 80) {
  const s = String(name).replace(STRIP, " ").replace(/\s+/g, " ").trim().normalize("NFC");
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max - 3).join("") + "..." : s;
}
