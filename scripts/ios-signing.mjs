#!/usr/bin/env node
// Make, or renew, what the iPhone apps are signed with for TestFlight, and hand
// it to CI. Run it when the certificate nears its expiry (a year after it was
// made), or after a capability is added below, which invalidates the profiles.
//
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
//       an App Store Connect API key (.p8) with the Admin role, or with access
//       to Certificates, Identifiers & Profiles
//   --keep <dir>
//       write the certificate (.p12), its password and the profiles there and
//       keep them, for uploads from this Mac (scripts/ios-testflight.sh);
//       without it they go to a temporary folder that is removed on success
//
// Run it from a checkout where `gh` can set the repository's secrets. In order:
//
//   1. it checks that, and reads IOS_DIST_CERT_ID, the repository variable that
//      names the certificate it made last time;
//   2. it enables the capabilities on both App IDs;
//   3. it makes an Apple Distribution certificate from a key made here and
//      writes the .p12 and its password to the folder, then, app by app,
//      removes the profile it made before and writes the new one there;
//   4. it sets the secrets IOS_DIST_CERT_P12, IOS_DIST_CERT_PASSWORD,
//      IOS_PROFILE_PROD and IOS_PROFILE_DEV and the variable IOS_DIST_CERT_ID
//      from the folder;
//   5. only then it revokes the certificate it made last time, unless a
//      profile still uses it.
//
// If a step fails, the folder stays with everything made so far and nothing
// is revoked; the old secrets keep working until the profiles they hold are
// replaced. It touches no certificate or profile of its own making but these.

import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APPS = [
	{
		bundleId: 'com.scrapscache.app',
		profile: 'Scraps Cache App Store',
		secret: 'IOS_PROFILE_PROD'
	},
	{
		bundleId: 'com.scrapscache.app.dev',
		profile: 'Scraps Cache Dev App Store',
		secret: 'IOS_PROFILE_DEV'
	}
];
const CAPABILITIES = ['PUSH_NOTIFICATIONS'];
const CERTIFICATE_VARIABLE = 'IOS_DIST_CERT_ID';

const env = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`Set ${name}; see the top of scripts/ios-signing.mjs`);
	return value;
};
const keyId = env('ASC_KEY_ID');
const issuerId = env('ASC_ISSUER_ID');
const apiKey = createPrivateKey(readFileSync(env('ASC_KEY_PATH')));
const keepIndex = process.argv.indexOf('--keep');
const keepAt = keepIndex > 0 ? process.argv[keepIndex + 1] : null;
if (keepIndex > 0 && !keepAt) throw new Error('--keep needs a directory');

function token() {
	const encode = (part) => Buffer.from(JSON.stringify(part)).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	const unsigned = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({
		iss: issuerId,
		iat: now,
		exp: now + 600,
		aud: 'appstoreconnect-v1'
	})}`;
	const signature = sign('sha256', Buffer.from(unsigned), {
		key: apiKey,
		dsaEncoding: 'ieee-p1363'
	});
	return `${unsigned}.${signature.toString('base64url')}`;
}

async function api(method, path, body) {
	const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
		method,
		headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
		body: body ? JSON.stringify({ data: body }) : undefined
	});
	const text = await response.text();
	if (!response.ok) {
		const errors = text ? (JSON.parse(text).errors ?? []) : [];
		throw new Error(
			`${method} ${path}: ${response.status} ${errors.map((e) => e.detail).join('; ')}`
		);
	}
	return text ? JSON.parse(text) : null;
}

const run = (command, args, input) =>
	execFileSync(command, args, {
		input,
		stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
	}).toString();
const openssl = (...args) => run('openssl', args);
// macOS's own LibreSSL writes a .p12 that `security import` reads; OpenSSL 3
// and later need -legacy for that.
const legacyPkcs12 = /^OpenSSL [3-9]/.test(openssl('version')) ? ['-legacy'] : [];

// 1. Where the secrets go, and what this script made last time.
const repo = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();
run('gh', ['secret', 'list', '--repo', repo]);
let previous = null;
try {
	previous = run('gh', ['variable', 'get', CERTIFICATE_VARIABLE, '--repo', repo]).trim() || null;
} catch {
	// Not set yet: this is the first run, and there is nothing to revoke.
}
console.log(`Secrets go to ${repo}${previous ? `; certificate ${previous} is replaced` : ''}`);

const folder = keepAt ?? mkdtempSync(join(tmpdir(), 'scraps-signing-'));
mkdirSync(folder, { recursive: true, mode: 0o700 });
const file = (name) => join(folder, name);
let made = null;

try {
	// 2. The App IDs, with the capabilities the app's entitlements ask for.
	for (const app of APPS) {
		const found = await api('GET', `/v1/bundleIds?filter[identifier]=${app.bundleId}&limit=20`);
		const bundle = found.data.find((b) => b.attributes.identifier === app.bundleId);
		if (!bundle) throw new Error(`No App ID ${app.bundleId}; see docs/development.md › TestFlight`);
		app.bundle = bundle.id;
		const capabilities = await api('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`);
		const enabled = new Set(capabilities.data.map((c) => c.attributes.capabilityType));
		for (const capabilityType of CAPABILITIES.filter((c) => !enabled.has(c))) {
			await api('POST', '/v1/bundleIdCapabilities', {
				type: 'bundleIdCapabilities',
				attributes: { capabilityType },
				relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } }
			});
			console.log(`${app.bundleId}: enabled ${capabilityType}`);
		}
	}

	// 3. The certificate, kept in the folder before anything is replaced.
	openssl('genrsa', '-out', file('key.pem'), '2048');
	openssl(
		'req',
		'-new',
		'-key',
		file('key.pem'),
		'-subj',
		'/CN=Scraps Cache CI',
		'-out',
		file('request.csr')
	);
	const certificate = (
		await api('POST', '/v1/certificates', {
			type: 'certificates',
			attributes: {
				certificateType: 'DISTRIBUTION',
				csrContent: readFileSync(file('request.csr'), 'utf8')
			}
		})
	).data;
	made = certificate.id;
	writeFileSync(
		file('certificate.cer'),
		Buffer.from(certificate.attributes.certificateContent, 'base64')
	);
	openssl(
		'x509',
		'-inform',
		'DER',
		'-in',
		file('certificate.cer'),
		'-out',
		file('certificate.pem')
	);
	writeFileSync(file('certificate.password'), randomBytes(24).toString('base64url'), {
		mode: 0o600
	});
	openssl(
		'pkcs12',
		'-export',
		...legacyPkcs12,
		'-inkey',
		file('key.pem'),
		'-in',
		file('certificate.pem'),
		'-name',
		'Scraps Cache CI',
		'-passout',
		`file:${file('certificate.password')}`,
		'-out',
		file('certificate.p12')
	);
	// The .p12 holds the key from here on.
	for (const name of ['key.pem', 'request.csr', 'certificate.cer', 'certificate.pem'])
		rmSync(file(name));
	console.log(
		`Made certificate ${certificate.id}, "${certificate.attributes.name}", until ${certificate.attributes.expirationDate.slice(0, 10)}`
	);

	// Then the profiles, app by app, each written before the next is replaced.
	for (const app of APPS) {
		const found = await api(
			'GET',
			`/v1/profiles?filter[name]=${encodeURIComponent(app.profile)}&limit=20`
		);
		const old = found.data.filter((p) => p.attributes.name === app.profile);
		for (const profile of old) await api('DELETE', `/v1/profiles/${profile.id}`);
		const profile = (
			await api('POST', '/v1/profiles', {
				type: 'profiles',
				attributes: { name: app.profile, profileType: 'IOS_APP_STORE' },
				relationships: {
					bundleId: { data: { type: 'bundleIds', id: app.bundle } },
					certificates: { data: [{ type: 'certificates', id: certificate.id }] }
				}
			})
		).data;
		writeFileSync(
			file(`${app.bundleId}.mobileprovision`),
			Buffer.from(profile.attributes.profileContent, 'base64')
		);
		console.log(
			`Made profile "${app.profile}" for ${app.bundleId}${old.length ? ', in place of the one before' : ''}`
		);
	}

	// 4. The secrets, from the folder.
	const secrets = {
		IOS_DIST_CERT_P12: readFileSync(file('certificate.p12')).toString('base64'),
		IOS_DIST_CERT_PASSWORD: readFileSync(file('certificate.password'), 'utf8'),
		...Object.fromEntries(
			APPS.map((app) => [
				app.secret,
				readFileSync(file(`${app.bundleId}.mobileprovision`)).toString('base64')
			])
		)
	};
	for (const [name, value] of Object.entries(secrets))
		run('gh', ['secret', 'set', name, '--repo', repo], value);
	run('gh', ['variable', 'set', CERTIFICATE_VARIABLE, '--repo', repo, '--body', certificate.id]);
	console.log(`Set ${Object.keys(secrets).join(', ')} and ${CERTIFICATE_VARIABLE}`);

	// 5. The certificate made last time, once nothing here needs it.
	if (previous && previous !== certificate.id) {
		const profiles = await api('GET', '/v1/profiles?include=certificates&limit=200');
		const inUse = profiles.data.some((p) =>
			(p.relationships.certificates.data ?? []).some((c) => c.id === previous)
		);
		if (inUse) console.log(`Kept certificate ${previous}: a profile still uses it`);
		else {
			await api('DELETE', `/v1/certificates/${previous}`);
			console.log(`Revoked certificate ${previous}`);
		}
	}
} catch (error) {
	console.error(`Stopped; nothing was revoked. What was made so far is in ${folder}`);
	if (made) {
		console.error(
			`Certificate ${made} was made and ${CERTIFICATE_VARIABLE} does not name it: revoke it by hand if this run is abandoned`
		);
	}
	throw error;
}

if (keepAt) console.log(`Kept the certificate and profiles in ${keepAt}`);
else rmSync(folder, { recursive: true, force: true });
