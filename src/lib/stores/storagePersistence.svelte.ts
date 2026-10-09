/**
 * Persistent storage for this origin. Without it, IndexedDB is "best effort":
 * the browser may clear it under storage pressure, and Safari clears it after
 * seven days without a visit unless the app is installed. Local-only notes have
 * no other copy, so the app asks for persistence when someone writes their
 * first note and again once the app is installed.
 */
export type StoragePersistence = 'persisted' | 'best-effort' | 'unsupported';

function storageManager(): StorageManager | null {
	if (typeof navigator === 'undefined') return null;
	const storage = navigator.storage as Partial<StorageManager> | undefined;
	return typeof storage?.persist === 'function' && typeof storage.persisted === 'function'
		? (storage as StorageManager)
		: null;
}

export class StoragePersistenceStore {
	state = $state<StoragePersistence>('unsupported');
	/** The browser turned down the last request. */
	denied = $state(false);
	#requested = false;

	async refresh(): Promise<StoragePersistence> {
		const storage = storageManager();
		if (!storage) return (this.state = 'unsupported');
		try {
			this.state = (await storage.persisted()) ? 'persisted' : 'best-effort';
		} catch {
			this.state = 'unsupported';
		}
		return this.state;
	}

	/** Ask the browser to keep this origin's data. Chrome and Safari decide silently; Firefox asks. */
	async request(): Promise<StoragePersistence> {
		const storage = storageManager();
		if (!storage) return (this.state = 'unsupported');
		this.#requested = true;
		let granted = false;
		try {
			granted = await storage.persist();
		} catch {
			// Treated as a refusal.
		}
		this.state = granted ? 'persisted' : 'best-effort';
		this.denied = !granted;
		return this.state;
	}

	/** Ask once per page load, the first time someone creates a note. */
	requestOnce(): void {
		if (this.#requested || this.state === 'persisted') return;
		void this.request();
	}
}

export const storagePersistenceStore = new StoragePersistenceStore();

if (typeof window !== 'undefined') {
	void storagePersistenceStore.refresh();
	window.addEventListener('appinstalled', () => void storagePersistenceStore.request());
}
