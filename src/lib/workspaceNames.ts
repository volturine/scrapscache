// Memorable two-word names for new workspaces, so a device with several sync
// keys reads as "Brave Otter" and "Quiet Heron" rather than "Sync key 2" and
// "Sync key 3". Cosmetic only: nothing here is a secret or an identifier, and
// the user can rename any workspace afterwards.

const ADJECTIVES = [
	'Amber',
	'Bold',
	'Brave',
	'Bright',
	'Calm',
	'Clever',
	'Cosmic',
	'Crisp',
	'Dapper',
	'Eager',
	'Gentle',
	'Golden',
	'Happy',
	'Hidden',
	'Humble',
	'Jolly',
	'Keen',
	'Kind',
	'Lively',
	'Lucky',
	'Mellow',
	'Merry',
	'Nimble',
	'Noble',
	'Patient',
	'Placid',
	'Prime',
	'Quiet',
	'Rapid',
	'Royal',
	'Rustic',
	'Silent',
	'Silver',
	'Snowy',
	'Solar',
	'Steady',
	'Stellar',
	'Sunny',
	'Swift',
	'Wise'
] as const;

const ANIMALS = [
	'Badger',
	'Beaver',
	'Bison',
	'Crane',
	'Egret',
	'Falcon',
	'Ferret',
	'Finch',
	'Gecko',
	'Gibbon',
	'Hare',
	'Heron',
	'Ibex',
	'Jackal',
	'Kestrel',
	'Lynx',
	'Magpie',
	'Marten',
	'Newt',
	'Osprey',
	'Otter',
	'Owl',
	'Panda',
	'Pelican',
	'Puffin',
	'Quail',
	'Raven',
	'Robin',
	'Seal',
	'Shrew',
	'Sparrow',
	'Stoat',
	'Swallow',
	'Tapir',
	'Teal',
	'Vole',
	'Walrus',
	'Weasel',
	'Wombat',
	'Wren'
] as const;

/** Every pair the lists can produce, for tests and for sizing the retry budget. */
export const WORKSPACE_NAME_COMBINATIONS = ADJECTIVES.length * ANIMALS.length;

function pick(list: readonly string[]): string {
	return list[Math.floor(Math.random() * list.length)];
}

/**
 * A two-word name that no existing workspace is using. Drawing at random keeps
 * names independent of creation order, so removing a workspace never makes the
 * next one reuse a name that is still on screen elsewhere.
 */
export function randomWorkspaceName(taken: readonly string[] = []): string {
	const used = new Set(taken);
	// Enough draws to almost always land a free pair while the list is far from
	// exhausted, without looping over a device that somehow holds most of them.
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const name = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
		if (!used.has(name)) return name;
	}
	// Every draw collided. Number a fresh pair rather than return a duplicate.
	const base = `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
	let suffix = 2;
	while (used.has(`${base} ${suffix}`)) suffix += 1;
	return `${base} ${suffix}`;
}
