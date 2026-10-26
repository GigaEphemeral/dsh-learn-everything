// Volatile config readers shared by the bundle entry and the domain modules.
// The DSH Loader commits volatile settings into the running reference, so a
// read must unwrap the reference on every call instead of caching a snapshot;
// plain values are accepted too so direct callers and tests can pass a
// resolved config object.

/**
 * Read a string setting from a volatile reference or a plain string.
 * @param value - the Config field value.
 * @param fallback - returned when the field carries no string.
 * @returns the effective string.
 */
export function readConfigString(value, fallback = '') {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    const current = value.get()
    if (typeof current === 'string') return current
  }
  return fallback
}

/**
 * Read a boolean setting from a volatile reference or a plain boolean.
 * @param value - the Config field value.
 * @param fallback - returned when the field carries no boolean.
 * @returns the effective boolean.
 */
export function readConfigBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    const current = value.get()
    if (typeof current === 'boolean') return current
  }
  return fallback
}
