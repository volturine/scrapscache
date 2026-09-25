import type { RequestHandler } from './$types';
import { turnstileChallenge } from '$lib/server/turnstile';
import { TURNSTILE_MESSAGE } from '$lib/turnstileMessage';

const TURNSTILE = 'https://challenges.cloudflare.com';
/** Actions a token may be requested for. The server checks the same name. */
const ACTIONS = new Set(['register']);

function nonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes));
}

/** JSON that is safe inside a <script> element: no `<` can close it. */
function scriptValue(value: string): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}

const notFound = () => new Response('Not found\n', { status: 404 });

/**
 * The only page that runs Turnstile's script, served only on the challenge
 * origin. It holds no keys and no notes, can be framed only by the app, and
 * tells the app one thing: the token.
 */
export const GET: RequestHandler = ({ url }) => {
	const challenge = turnstileChallenge();
	if (!challenge || url.origin.toLowerCase() !== challenge.origin.toLowerCase()) return notFound();
	const action = url.searchParams.get('action') ?? '';
	if (!ACTIONS.has(action)) return new Response('Unknown action\n', { status: 400 });

	const scriptNonce = nonce();
	const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Human verification</title>
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:100%;height:100%;display:flex;justify-content:center;align-items:center}#widget{transform-origin:center center;transition:transform 0.1s ease}</style>
<script nonce="${scriptNonce}">
(function () {
	var appOrigin = ${scriptValue(challenge.appOrigin)};
	function send(token) {
		parent.postMessage({ type: ${scriptValue(TURNSTILE_MESSAGE)}, token: token }, appOrigin);
	}
	function fitWidget() {
		var el = document.getElementById('widget');
		if (!el) return;
		var w = window.innerWidth;
		if (w > 0 && w < 300) {
			var scale = Math.max(0.6, w / 300);
			el.style.transform = 'scale(' + scale + ')';
		} else {
			el.style.transform = '';
		}
	}
	window.addEventListener('resize', fitWidget);
	window.onTurnstileLoad = function () {
		fitWidget();
		turnstile.render('#widget', {
			sitekey: ${scriptValue(challenge.sitekey)},
			action: ${scriptValue(action)},
			theme: 'auto',
			size: 'flexible',
			callback: send,
			'expired-callback': function () { send(''); },
			'error-callback': function () { send(''); }
		});
		setTimeout(fitWidget, 50);
	};
})();
</script>
<script nonce="${scriptNonce}" src="${TURNSTILE}/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit" async defer></script>
</head>
<body><div id="widget"></div></body>
</html>
`;

	const policy = [
		"default-src 'none'",
		`script-src 'nonce-${scriptNonce}' ${TURNSTILE}`,
		`frame-src ${TURNSTILE}`,
		`connect-src ${TURNSTILE}`,
		`img-src ${TURNSTILE}`,
		"style-src 'unsafe-inline'",
		"base-uri 'none'",
		"form-action 'none'",
		`frame-ancestors ${challenge.appOrigin}`
	].join('; ');

	return new Response(html, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'content-security-policy': policy,
			'cache-control': 'no-store'
		}
	});
};
