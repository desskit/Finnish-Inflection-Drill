// Thin wrapper around localStorage that tolerates private/incognito modes
// and JSON-serializes its values.

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op: storage may be unavailable / full
  }
}
