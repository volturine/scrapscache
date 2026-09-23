/** The relay knows only opaque envelope versions and when they were uploaded. */
export type HistoryEntry = { historyId: number; savedAt: number };
export type HistoryPage = { entries: HistoryEntry[]; nextBefore: number | null };
export type HistoryEnvelope = { id: string; slot: string; ciphertext: string };

export const HISTORY_DAYS = 30;
export const HISTORY_TTL_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000;
export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_MAX_ENTRIES = 500;
