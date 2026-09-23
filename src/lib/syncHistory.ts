/** The relay knows only opaque envelope versions and the time they were replaced. */
export type HistoryEntry = { historyId: number; savedAt: number };
export type HistoryPage = { entries: HistoryEntry[]; nextBefore: number | null };
export type HistoryEnvelope = { id: string; slot: string; ciphertext: string };
export type ProfileHistoryPage = { points: number[]; nextBefore: number | null };
export type ProfileSnapshotPage = { envelopes: HistoryEnvelope[]; nextAfter: string | null };

export const HISTORY_DAYS = 30;
export const HISTORY_TTL_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000;
export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_MAX_ENTRIES = 500;
