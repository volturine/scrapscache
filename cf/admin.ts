type AppService = {
	fetch(request: Request): Promise<Response>;
};

type Env = {
	APP: AppService;
};

/** The admin API and the Prometheus scrape; everything else here is the dashboard's files. */
function forApp(pathname: string): boolean {
	return pathname.startsWith('/api/admin/') || pathname === '/metrics';
}

/**
 * The operator dashboard's Worker. Its static build is served before this runs,
 * the page itself at `/`; what reaches it is the admin API, handed to the app
 * over the service binding as it arrived, so the app sees the admin origin and
 * Cloudflare Access's signed header and checks them itself. Nothing else is
 * forwarded. `/admin`, where a Node server keeps the dashboard, leads to `/`.
 */
export default {
	fetch(request: Request, env: Env): Promise<Response> | Response {
		const { pathname } = new URL(request.url);
		if (forApp(pathname)) return env.APP.fetch(request);
		if (pathname === '/admin' || pathname.startsWith('/admin/'))
			return new Response(null, { status: 308, headers: { location: '/' } });
		return new Response('Not found\n', { status: 404 });
	}
};
