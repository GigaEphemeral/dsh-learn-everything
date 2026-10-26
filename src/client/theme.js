// Theme helper (S4 R1): DSH marks dark mode with a dark-only body attribute
// and exposes the resolved palette as --dsw-alias-* tokens that flip per
// theme. The panel and the graph column read the flag through this module so
// the mapping stays unit testable without a browser.

/**
 * Whether the host document currently uses the dark theme.
 * @param body - the host document.body (or any attribute-bearing stand-in).
 * @returns true only when the dark-only attribute is present.
 */
export function isDarkDocument(body) {
  return Boolean(body && typeof body.hasAttribute === 'function' && body.hasAttribute('data-ds-dark-theme'))
}

/**
 * Map the dark flag to the graph page's theme parameter.
 * @param dark - result of isDarkDocument.
 * @returns 'dark' or 'light'.
 */
export function graphPageTheme(dark) {
  return dark ? 'dark' : 'light'
}
