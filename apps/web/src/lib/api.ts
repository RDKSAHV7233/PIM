// Backward-compatible re-export.
// New code should import directly from @/lib/api/<domain>.
// This file exists to avoid a big-bang import migration across the codebase.
export * from './api/index';
