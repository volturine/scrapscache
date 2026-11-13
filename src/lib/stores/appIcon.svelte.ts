import { isNativeApp } from '#lib/native.js';
import {
	AppIcon,
	AUTOMATIC,
	choiceFromMaster,
	masterName,
	type AppIconChoice
} from '#lib/native/appIcon.js';

/**
 * Settings > App icon in the iPhone app: the icon on the home screen, and
 * changing it. The web app has no icon to change, so it stays unsupported.
 */
class AppIconStore {
	/** Whether the row shows: the iPhone app, on a device iOS lets change its icon. */
	supported = $state(false);
	/** What the page shows as chosen; it moves at once, iOS follows. */
	choice = $state<AppIconChoice>(AUTOMATIC);
	/** A sentence when iOS refused the last change. */
	error = $state('');
	#loading: Promise<void> | null = null;
	/** The master iOS shows, and the one last chosen; null is the app's own icon. */
	#showing: string | null = null;
	#wanted: string | null = null;
	#applying = false;

	/** Reads the icon from iOS once; a failed read is tried again next time. */
	load(): Promise<void> {
		if (!isNativeApp()) return Promise.resolve();
		this.#loading ??= AppIcon.get().then(
			({ supported, master }) => {
				this.supported = supported;
				this.#showing = this.#wanted = master ?? null;
				this.choice = choiceFromMaster(master);
			},
			() => {
				this.#loading = null;
			}
		);
		return this.#loading;
	}

	/**
	 * Picks an icon. iOS changes one at a time and alerts for each, so taps made
	 * while it is busy collapse into the last, which is set when it is done.
	 */
	choose(choice: AppIconChoice): Promise<void> {
		this.choice = choice;
		this.error = '';
		this.#wanted = masterName(choice);
		return this.#apply();
	}

	async #apply(): Promise<void> {
		if (this.#applying) return;
		this.#applying = true;
		try {
			while (this.#wanted !== this.#showing) {
				const master = this.#wanted;
				try {
					await AppIcon.set({ master });
					this.#showing = master;
				} catch {
					// A newer choice is tried next; if this was the last, the page goes
					// back to the icon iOS still shows.
					if (this.#wanted !== master) continue;
					this.#wanted = this.#showing;
					this.choice = choiceFromMaster(this.#showing);
					this.error = 'The icon did not change. Try again.';
				}
			}
		} finally {
			this.#applying = false;
		}
	}
}

export const appIconStore = new AppIconStore();
