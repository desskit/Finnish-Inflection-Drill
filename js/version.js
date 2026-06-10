// Single source of truth for the app version.
//
// Convention (post-1.0): semver-ish. Patch bump (1.0.x) for bug fixes only,
// minor bump (1.x.0) for new features, major bump (x.0.0) for breaking
// changes. Remember to also update CACHE_VERSION in sw.js to match.
// (0.13 was skipped out of superstition; 1.3 ships anyway — owner's call.)
export const APP_VERSION = "1.6.0";
