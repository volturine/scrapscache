export function renderConsentHtml(params: {
	clientName: string;
	clientId: string;
	redirectUri: string;
	state: string;
	codeChallenge: string;
	codeChallengeMethod: string;
	hasDefaultSyncKey: boolean;
	errorMessage?: string;
}): string {
	const escapedClientName = escapeHtml(params.clientName);
	const escapedError = params.errorMessage
		? `<div class="alert error">${escapeHtml(params.errorMessage)}</div>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize ${escapedClientName} - Scraps Cache</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --danger: #ef4444;
      --border: #334155;
      --radius: 12px;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --text: #0f172a;
        --text-muted: #64748b;
        --primary: #0284c7;
        --primary-hover: #0369a1;
        --border: #e2e8f0;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2);
      max-width: 440px;
      width: 100%;
      padding: 2rem;
    }
    .header {
      text-align: center;
      margin-bottom: 1.5rem;
    }
    .icon-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(56, 189, 248, 0.15);
      color: var(--primary);
      margin-bottom: 1rem;
      font-size: 24px;
    }
    h1 { font-size: 1.35rem; font-weight: 700; margin-bottom: 0.5rem; }
    p { font-size: 0.95rem; color: var(--text-muted); line-height: 1.5; }
    .scopes {
      background: rgba(0, 0, 0, 0.05);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      margin: 1.25rem 0;
      font-size: 0.9rem;
    }
    .scopes ul { list-style: none; }
    .scopes li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.4rem 0;
    }
    .scopes li::before {
      content: "✓";
      color: #10b981;
      font-weight: bold;
    }
    .input-group {
      margin-bottom: 1.25rem;
      text-align: left;
    }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 0.4rem;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg);
      color: var(--text);
      font-size: 0.9rem;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }
    button {
      width: 100%;
      padding: 0.85rem;
      border: none;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn-primary {
      background: var(--primary);
      color: #ffffff;
    }
    .btn-primary:hover {
      background: var(--primary-hover);
    }
    .btn-cancel {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .btn-cancel:hover {
      background: rgba(0, 0, 0, 0.05);
    }
    .alert {
      padding: 0.75rem;
      border-radius: 6px;
      font-size: 0.85rem;
      margin-bottom: 1rem;
    }
    .alert.error {
      background: rgba(239, 68, 68, 0.15);
      color: var(--danger);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .footnote {
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="icon-badge">🔒</div>
      <h1>Connect ${escapedClientName}</h1>
      <p>Authorize <strong>${escapedClientName}</strong> to interact with your private Scraps Cache notes.</p>
    </div>

    ${escapedError}

    <div class="scopes">
      <strong>Permissions requested:</strong>
      <ul>
        <li>Search notes by keyword or label</li>
        <li>Read notes and checklist tasks</li>
        <li>Create and update notes</li>
      </ul>
    </div>

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(params.state)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.codeChallengeMethod)}">

      ${
				params.hasDefaultSyncKey
					? `<div class="input-group">
               <label for="custom_key">Sync Key (leave blank to use default self-hosted vault):</label>
               <input type="password" id="custom_key" name="custom_sync_key" placeholder="Enter friend sync key (optional)">
             </div>`
					: `<div class="input-group">
               <label for="custom_key">Scraps Cache Sync Key:</label>
               <input type="password" id="custom_key" name="custom_sync_key" placeholder="Base64URL sync key" required>
             </div>`
			}

      <div class="actions">
        <button type="submit" name="action" value="allow" class="btn-primary">Authorize ${escapedClientName}</button>
        <button type="submit" name="action" value="deny" class="btn-cancel">Cancel</button>
      </div>
    </form>

    <div class="footnote">
      End-to-end encrypted • Zero knowledge • Self-hosted
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
