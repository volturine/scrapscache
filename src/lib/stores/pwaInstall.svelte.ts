export interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export class PwaInstallStore {
	deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
	isStandalone = $state(false);
	showIOSHelp = $state(false);

	constructor() {
		if (typeof window !== 'undefined') {
			this.checkStandalone();

			window.addEventListener('beforeinstallprompt', (e) => {
				this.checkStandalone();
				if (this.isStandalone) return;
				e.preventDefault();
				this.deferredPrompt = e as BeforeInstallPromptEvent;
			});

			window.addEventListener('appinstalled', () => {
				this.deferredPrompt = null;
				this.isStandalone = true;
			});
		}
	}

	checkStandalone() {
		if (typeof window === 'undefined') return;
		const isStandaloneMode =
			window.matchMedia?.('(display-mode: standalone)')?.matches ||
			Boolean((navigator as unknown as { standalone?: boolean }).standalone);
		this.isStandalone = Boolean(isStandaloneMode);
	}

	get isIOS(): boolean {
		if (typeof navigator === 'undefined') return false;
		return (
			/iPad|iPhone|iPod/.test(navigator.userAgent) &&
			!(window as unknown as { MSStream?: unknown }).MSStream
		);
	}

	get canPrompt(): boolean {
		if (this.isStandalone) return false;
		return Boolean(this.deferredPrompt) || this.isIOS;
	}

	async promptInstall() {
		if (this.deferredPrompt) {
			await this.deferredPrompt.prompt();
			try {
				const choice = await this.deferredPrompt.userChoice;
				if (choice.outcome === 'accepted') {
					this.deferredPrompt = null;
				}
			} catch {
				// handle choice promise rejection
			}
		} else if (this.isIOS) {
			this.showIOSHelp = true;
		}
	}

	closeIOSHelp() {
		this.showIOSHelp = false;
	}
}

export const pwaInstallStore = new PwaInstallStore();
