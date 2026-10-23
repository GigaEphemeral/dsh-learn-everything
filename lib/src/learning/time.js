// Canonical timestamp handling shared by the learning stores (A12/A29). Both
// the append-only attempt history and the review schedule require canonical UTC
// ISO-8601 (the exact string Date#toISOString() produces) so lexicographic
// timestamp comparisons and cross-process scheduling stay correct.
// Validate an ISO-8601 timestamp and require it to be canonical UTC. Returns
// the value unchanged so callers can bind it to SQL directly.
export function toCanonicalIso(value, label) {
    if (typeof value !== 'string' || value === '') {
        throw new Error(`${label} must be a non-empty ISO-8601 string, got ${typeof value}`);
    }
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) {
        throw new Error(`${label} is not a valid ISO-8601 timestamp: "${value}"`);
    }
    const canonical = new Date(ms).toISOString();
    if (canonical !== value) {
        throw new Error(`${label} must be canonical UTC ISO-8601 ("${canonical}"), got "${value}"`);
    }
    return canonical;
}
