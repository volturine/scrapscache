<script lang="ts">
	// A server-rendered page's own title and description, for search results and link
	// previews. src/app.html carries the site-wide defaults for the client-only app;
	// hooks.server.ts drops them from any page that renders this instead.
	let { title, description }: { title: string; description: string } = $props();
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
</svelte:head>
