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
 * The operator dashboard's Worker. Its static build is served before this runs;
 * what reaches it is the admin API, handed to the app over the service binding
 * as it arrived, so the app sees the admin origin and Cloudflare Access's signed
 * header and checks them itself. Nothing else is forwarded.
 */
export default {
	fetch(request: Request, env: Env): Promise<Response> | Response {
		if (forApp(new URL(request.url).pathname)) return env.APP.fetch(request);
		return new Response('Not found\n', { status: 404 });
	}
};
