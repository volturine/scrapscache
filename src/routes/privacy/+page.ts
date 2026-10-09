// Rendered on the server so crawlers and link previews read the page itself; the
// notes app stays client-only (src/routes/+layout.ts). Not prerendered: each
// response carries its own CSP nonce.
export const ssr = true;
