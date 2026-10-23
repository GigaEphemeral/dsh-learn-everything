// Shared LIMIT handling for learning-history queries. SQLite treats a negative
// LIMIT as "no limit", so an invalid caller value must fall back to a bounded
// default instead of silently dumping the whole history table.
export function safeLimit(limit, fallback) {
    return typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : fallback;
}
