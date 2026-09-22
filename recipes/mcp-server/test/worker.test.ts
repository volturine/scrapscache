import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
	base64UrlToBytes,
	bytesToBase64Url,
	randomBytes,
	sha256,
	sha256Base64Url
} from '../src/crypto.js';
import { McpOAuthState, type DurableObjectStateLike } from '../src/oauthState.js';
import worker from '../src/worker.js';

class MemoryState implements DurableObjectStateLike {
	private readonly entries = new Map<string, unknown>();

	readonly storage = {
		get: async <T>(key: string) => this.entries.get(key) as T | undefined,
		list: async <T>(options: { prefix: string; limit: number }) =>
			new Map(
				[...this.entries.entries()]
					.filter(([key]) => key.startsWith(options.prefix))
					.slice(0, options.limit) as [string, T][]
			),
		put: async <T>(key: string, value: T) => {
			this.entries.set(key, value);
		},
		delete: async (key: string) => this.entries.delete(key)
	};

	blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
		return callback();
	}
}

describe('Cloudflare Worker OAuth request boundaries', () => {
	it('completes the callback, token exchange, and MCP request with request-bound Durable Object stubs', async () => {
		const state = new McpOAuthState(new MemoryState());
		let currentRequest = 0;
		const env = {
			MCP_SECRET: 'test-mcp-secret-012345678901234567890123456789',
			OAUTH_STATE: {
				idFromName: (name: string) => ({ toString: () => name }),
				get: () => {
					const createdIn = currentRequest;
					return {
						fetch: (input: RequestInfo | URL, init?: RequestInit) => {
							if (createdIn !== currentRequest) throw new Error('Cross-request I/O object reuse');
							return state.fetch(new Request(input, init));
						}
					};
				}
			}
		};
		const send = (request: Request) => {
			currentRequest += 1;
			return worker.fetch(request, env);
		};

		const verifier = 'v'.repeat(43);
		const redirectUri = 'https://chatgpt.com/connector/oauth/test-connection';
		const authorizeUrl = new URL('http://localhost/oauth/authorize');
		for (const [key, value] of Object.entries({
			client_id: 'chatgpt',
			redirect_uri: redirectUri,
			response_type: 'code',
			state: 'test-state',
			code_challenge: sha256Base64Url(verifier),
			code_challenge_method: 'S256'
		})) {
			authorizeUrl.searchParams.set(key, value);
		}
		const authorize = await send(new Request(authorizeUrl));
		expect(authorize.status).toBe(302);
		const approvalUrl = new URL(authorize.headers.get('Location')!);
		const sessionId = approvalUrl.searchParams.get('session_id')!;
		const mcpPublicKey = approvalUrl.searchParams.get('mcp_public_key')!;

		const clientPrivateKey = randomBytes(32);
		const clientPublicKey = bytesToBase64Url(x25519.getPublicKey(clientPrivateKey));
		const sharedSecret = x25519.getSharedSecret(clientPrivateKey, base64UrlToBytes(mcpPublicKey));
		const handshakeKey = sha256(
			new TextEncoder().encode(`scrapscache-mcp-handshake:v1:${bytesToBase64Url(sharedSecret)}`)
		);
		const nonce = randomBytes(24);
		const syncKey = bytesToBase64Url(randomBytes(32));
		const grant = JSON.stringify({ v: 1, workspaces: [{ name: 'Personal', syncKey }] });
		const ciphertext = bytesToBase64Url(
			xchacha20poly1305(handshakeKey, nonce).encrypt(new TextEncoder().encode(grant))
		);
		const callbackRequest = () =>
			new Request('http://localhost/oauth/callback', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sessionId,
					clientPublicKey,
					ciphertext,
					nonce: bytesToBase64Url(nonce)
				})
			});
		const callback = await send(callbackRequest());
		expect(callback.status).toBe(200);
		const callbackBody = (await callback.json()) as { redirectTo: string };
		const code = new URL(callbackBody.redirectTo).searchParams.get('code')!;
		expect((await send(callbackRequest())).status).toBe(400);

		const exchange = await send(
			new Request('http://localhost/oauth/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					client_id: 'chatgpt',
					redirect_uri: redirectUri,
					code,
					code_verifier: verifier
				})
			})
		);
		expect(exchange.status).toBe(200);
		const { access_token } = (await exchange.json()) as { access_token: string };

		const rpc = await send(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${access_token}`
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'list_workspaces', arguments: {} }
				})
			})
		);
		expect(rpc.status).toBe(200);
		const response = (await rpc.json()) as {
			result: { content: Array<{ text: string }> };
		};
		expect(JSON.parse(response.result.content[0].text)).toEqual({
			workspaces: [{ workspace: 'Personal' }]
		});
	});
});
