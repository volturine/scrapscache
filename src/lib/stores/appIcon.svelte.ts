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
	/** The icon iOS shows. */
	choice = $state<AppIconChoice>(AUTOMATIC);
	/** While iOS is changing the icon. */
	applying = $state(false);
	/** A sentence when iOS refused the last change. */
	error = $state('');
	#loading: Promise<void> | null = null;

	/** Reads the icon from iOS once; a failed read is tried again next time. */
	load(): Promise<void> {
		if (!isNativeApp()) return Promise.resolve();
		this.#loading ??= AppIcon.get().then(
			({ supported, master }) => {
				this.supported = supported;
				this.choice = choiceFromMaster(master);
			},
			() => {
				this.#loading = null;
			}
		);
		return this.#loading;
	}

	/** Whether a choice is the icon iOS shows already. */
	isShowing(choice: AppIconChoice): boolean {
		return masterName(choice) === masterName(this.choice);
	}

	/**
	 * Sets the icon, which iOS confirms with an alert of its own. One change at a
	 * time; when iOS refuses, the icon it shows stays and the page says so.
	 */
	async apply(choice: AppIconChoice): Promise<void> {
		if (this.applying || this.isShowing(choice)) return;
		this.applying = true;
		this.error = '';
		try {
			await AppIcon.set({ master: masterName(choice) });
			this.choice = choice;
		} catch {
			this.error = 'The icon did not change. Try again.';
		} finally {
			this.applying = false;
		}
	}
}

export const appIconStore = new AppIconStore();
