// Single source of truth for the app version.
//
// Convention (post-1.0): semver-ish. Patch bump (1.0.x) for bug fixes only,
// minor bump (1.x.0) for new features, major bump (x.0.0) for breaking
// changes. Remember to also update CACHE_VERSION in sw.js to match.
// Skipping 0.13 / 1.3 — superstition trumps monotonic numbering.
export const APP_VERSION = "1.1.1";
