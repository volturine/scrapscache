// Device persistence. IndexedDB is the durable source of truth; localStorage is handled
// separately as a blob-free fast-boot mirror by noteStorage.ts.
// Every workspace has its own database, `scrapscache-profile-<id>`, and none is special.
// One small device database, `scrapscache-device`, lists them for the service worker
// and caches link previews.

// The pieces are in this folder by what they hold; this file is what the rest of
// the app imports.

export {
	DEVICE_DB_NAME,
	NOTES_STORE,
	resolveDbName,
	SYNC_STATE_STORE,
	WORKSPACES_STORE
} from './names.js';

export {
	DeleteBlockedError,
	IMAGES_STORE,
	LABELS_STORE,
	SYNC_OUTBOX_STORE,
	closeDeviceDatabase,
	deleteProfileDatabase,
	dropDatabase,
	forgetReleasedProfiles,
	getCachedLinkPreview,
	getDB,
	getDeviceDB,
	getDeviceState,
	getRegisteredWorkspaces,
	isProfileReleased,
	onProfileDeleted,
	onWorkspaceOutdated,
	putCachedLinkPreview,
	releaseProfile,
	resumeProfile,
	setDeviceState,
	setRegisteredWorkspaces,
	waitForDeviceWrites,
	type RegisteredWorkspace
} from './connection.js';

export {
	clearSyncOutbox,
	commitSyncControl,
	getOutboxGeneration,
	getSyncOutboxKeys,
	markSyncOutbox,
	uploadGeneration
} from './outbox.js';

export {
	attachmentWritesLock,
	bulkPutNotes,
	deleteNote,
	getAllNotesMetadata,
	getNote,
	getStoredAttachmentVersions,
	holdAttachmentWrites,
	hydrateNoteAttachments,
	mergeNote,
	pruneOrphanImageBlobs,
	putNote,
	saveNote
} from './notes.js';

export {
	addFiredReminderKeys,
	claimFiredReminderKey,
	deleteLabelRecordingIt,
	deleteSyncState,
	estimateProfileBytes,
	getAllLabels,
	getFiredReminderKeys,
	getSyncState,
	mergeStoredLabels,
	mergeWorkspaceState,
	rewriteWorkspace,
	saveLabel,
	setSyncState,
	type RewritePlan,
	type StoredWorkspace,
	type WorkspaceRewrite
} from './workspace.js';
