/** Cloudflare serves the dashboard from its own Worker (cf/wrangler.admin.jsonc), not the app. */
export async function adminDashboard(_pathname: string): Promise<Response | null> {
	return null;
}
