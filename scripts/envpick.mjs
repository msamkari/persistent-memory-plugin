// Reads ONLY the named environment variables and returns them as a small object. Scripts and hooks use this
// instead of handing the whole process.env object around, so no unrelated variable (a token, a key) is ever read.
export function pick(keys) {
  const out = {};
  for (const k of keys) if (process.env[k] !== undefined) out[k] = process.env[k];
  return out;
}
