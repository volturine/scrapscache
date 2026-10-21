import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

/** Where `npm run build:admin` puts the dashboard, relative to the server's directory. */
const DASHBOARD_DIR = resolve('build/admin');
const PREFIX = '/admin/';

const CONTENT_TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.png': 'image/png',
	'.woff2': 'font/woff2'
};

type Dashboard = { files: Map<string, string>; headers: [string, string][] };
let dashboard: Dashboard | null | undefined;

function listFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]
	);
}

/** The `/*` block of the build's `_headers`, the same file Cloudflare reads. */
function parseHeaders(text: string): [string, string][] {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line.trim() === '/*');
	const headers: [string, string][] = [];
	if (start === -1) return headers;
	for (const line of lines.slice(start + 1)) {
		if (!/^\s+\S/.test(line)) break;
		const split = line.indexOf(':');
		headers.push([line.slice(0, split).trim(), line.slice(split + 1).trim()]);
	}
	return headers;
}

/**
 * The built files, listed once. Only a listed file is ever read, so no request
 * path can reach outside the build. Null when there is no build, as under
 * `vite dev`, where `npm run dev:admin` serves the dashboard instead.
 */
function load(): Dashboard | null {
	if (dashboard !== undefined) return dashboard;
	try {
		const files = new Map(
			listFiles(DASHBOARD_DIR).map((path) => [relative(DASHBOARD_DIR, path), path])
		);
		dashboard = {
			files,
			headers: parseHeaders(readFileSync(join(DASHBOARD_DIR, '_headers'), 'utf8'))
		};
	} catch {
		dashboard = null;
		return dashboard;
	}
	// A build whose headers did not parse would go out with no policy at all.
	if (!dashboard.headers.some(([name]) => name.toLowerCase() === 'content-security-policy')) {
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'admin_dashboard_unprotected',
				message: 'build/admin/_headers sets no Content-Security-Policy; the dashboard is off'
			})
		);
		dashboard = null;
	}
	return dashboard;
}

/**
 * The operator dashboard at /admin/, for a Node server that runs the whole relay.
 * It is the same static build Cloudflare serves from its own Worker, sent with
 * that build's own headers rather than the notes app's.
 */
export async function adminDashboard(pathname: string): Promise<Response | null> {
	if (pathname === '/admin')
		return new Response(null, { status: 308, headers: { location: PREFIX } });
	if (!pathname.startsWith(PREFIX)) return null;
	const built = load();
	const name = pathname.slice(PREFIX.length) || 'index.html';
	const path = built?.files.get(name);
	if (!built || !path || name === '_headers') return null;
	const headers = new Headers(built.headers);
	headers.set('content-type', CONTENT_TYPES[extname(name)] ?? 'application/octet-stream');
	headers.set(
		'cache-control',
		name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store'
	);
	return new Response(await readFile(path), { headers });
}
