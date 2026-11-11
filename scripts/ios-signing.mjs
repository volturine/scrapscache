#!/usr/bin/env node
// Make, or renew, what the iPhone apps are signed with for TestFlight, and hand
// it to CI. Run it when the certificate nears its expiry (a year after it was
// made), or after a capability is added below, which invalidates the profiles.
//
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
//       an App Store Connect API key (.p8) with the Admin role, or with access
//       to Certificates, Identifiers & Profiles
//   --keep <dir>
//       also write the certificate (.p12), its password and the profiles there,
//       for uploads from this Mac (scripts/ios-testflight.sh); without it they
//       exist only in the repository's secrets
//
// It enables the capabilities on both App IDs, makes an Apple Distribution
// certificate from a key made here, and an App Store profile per app on it.
// Then it removes the profiles it made before and revokes the certificate they
// were on, and sets the repository secrets with `gh`: IOS_DIST_CERT_P12,
// IOS_DIST_CERT_PASSWORD, IOS_PROFILE_PROD and IOS_PROFILE_DEV. It touches no
// other certificate or profile. The private key never leaves the .p12.

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

const env = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`Set ${name}; see the top of scripts/ios-signing.mjs`);
	return value;
};
const keyId = env('ASC_KEY_ID');
const issuerId = env('ASC_ISSUER_ID');
const apiKey = createPrivateKey(readFileSync(env('ASC_KEY_PATH')));
const keepAt =
	process.argv.indexOf('--keep') > 0 ? process.argv[process.argv.indexOf('--keep') + 1] : null;
if (process.argv.includes('--keep') && !keepAt) throw new Error('--keep needs a directory');

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

const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
// macOS's own LibreSSL writes a .p12 that `security import` reads; OpenSSL 3
// and later need -legacy for that.
const legacyPkcs12 = /^OpenSSL [3-9]/.test(openssl('version').toString()) ? ['-legacy'] : [];

const work = mkdtempSync(join(tmpdir(), 'scraps-signing-'));
try {
	// The App IDs, with the capabilities the app's entitlements ask for.
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

	// The profiles made before, and the certificates they were on.
	const replaced = new Set();
	for (const app of APPS) {
		const found = await api(
			'GET',
			`/v1/profiles?filter[name]=${encodeURIComponent(app.profile)}&include=certificates&limit=20`
		);
		app.old = found.data.filter((p) => p.attributes.name === app.profile).map((p) => p.id);
		for (const profile of found.data.filter((p) => app.old.includes(p.id)))
			for (const certificate of profile.relationships.certificates.data ?? [])
				replaced.add(certificate.id);
	}

	openssl('genrsa', '-out', join(work, 'key.pem'), '2048');
	openssl(
		'req',
		'-new',
		'-key',
		join(work, 'key.pem'),
		'-subj',
		'/CN=Scraps Cache CI',
		'-out',
		join(work, 'request.csr')
	);
	const certificate = (
		await api('POST', '/v1/certificates', {
			type: 'certificates',
			attributes: {
				certificateType: 'DISTRIBUTION',
				csrContent: readFileSync(join(work, 'request.csr'), 'utf8')
			}
		})
	).data;
	writeFileSync(
		join(work, 'certificate.cer'),
		Buffer.from(certificate.attributes.certificateContent, 'base64')
	);
	openssl(
		'x509',
		'-inform',
		'DER',
		'-in',
		join(work, 'certificate.cer'),
		'-out',
		join(work, 'certificate.pem')
	);
	const password = randomBytes(24).toString('base64url');
	writeFileSync(join(work, 'password'), password);
	openssl(
		'pkcs12',
		'-export',
		...legacyPkcs12,
		'-inkey',
		join(work, 'key.pem'),
		'-in',
		join(work, 'certificate.pem'),
		'-name',
		'Scraps Cache CI',
		'-passout',
		`file:${join(work, 'password')}`,
		'-out',
		join(work, 'certificate.p12')
	);
	console.log(
		`Made certificate ${certificate.id}, "${certificate.attributes.name}", until ${certificate.attributes.expirationDate.slice(0, 10)}`
	);

	for (const app of APPS) {
		for (const id of app.old) await api('DELETE', `/v1/profiles/${id}`);
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
		app.content = profile.attributes.profileContent;
		console.log(
			`Made profile "${app.profile}" for ${app.bundleId}${app.old.length ? `, in place of ${app.old.length} before` : ''}`
		);
	}

	const secrets = {
		IOS_DIST_CERT_P12: readFileSync(join(work, 'certificate.p12')).toString('base64'),
		IOS_DIST_CERT_PASSWORD: password,
		...Object.fromEntries(APPS.map((app) => [app.secret, app.content]))
	};
	for (const [name, value] of Object.entries(secrets)) {
		execFileSync('gh', ['secret', 'set', name], {
			input: value,
			stdio: ['pipe', 'ignore', 'inherit']
		});
	}
	console.log(`Set ${Object.keys(secrets).join(', ')}`);

	if (keepAt) {
		mkdirSync(keepAt, { recursive: true, mode: 0o700 });
		writeFileSync(join(keepAt, 'certificate.p12'), readFileSync(join(work, 'certificate.p12')), {
			mode: 0o600
		});
		writeFileSync(join(keepAt, 'certificate.password'), password, { mode: 0o600 });
		for (const app of APPS)
			writeFileSync(
				join(keepAt, `${app.bundleId}.mobileprovision`),
				Buffer.from(app.content, 'base64')
			);
		console.log(`Kept the certificate and profiles in ${keepAt}`);
	}

	replaced.delete(certificate.id);
	for (const id of replaced) await api('DELETE', `/v1/certificates/${id}`);
	if (replaced.size)
		console.log(`Revoked the ${replaced.size} certificate(s) the old profiles were on`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
