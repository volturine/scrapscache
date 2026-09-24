/** The relay knows only opaque envelope versions and when they were uploaded. */
export type HistoryVersion = { historyId: number; savedAt: number; id: string; ciphertext: string };
/** A record's retained versions, newest first. */
export type HistoryList = { versions: HistoryVersion[] };
export type HistoryEnvelope = { id: string; slot: string; ciphertext: string };
