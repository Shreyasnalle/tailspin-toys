import { createServer } from 'node:http';
import { URL } from 'node:url';
import { createCanvas, joinSession } from '@github/copilot-sdk/extension';

const repository = 'Shreyasnalle/tailspin-toys';
const servers = new Map();

const priority = new Map([
    [1, { score: 100, reason: 'Highest immediate user impact: visitors cannot quickly find a known game without scanning the full catalog.' }],
    [6, { score: 90, reason: 'A foundational browsing improvement that keeps the catalog usable as it grows and pairs naturally with search and sorting.' }],
    [2, { score: 80, reason: 'A high-value discovery feature that gives users control over the catalog and complements the other list-page improvements.' }],
]);

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

async function fetchIssues() {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues?state=open&per_page=100`, {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'issue-triage-board',
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub returned ${response.status} while loading open issues.`);
    }
    const issues = await response.json();
    return issues
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
            number: issue.number,
            title: issue.title,
            body: issue.body || 'No description provided.',
            url: issue.html_url,
            updatedAt: issue.updated_at,
            score: priority.get(issue.number)?.score ?? 0,
            reason: priority.get(issue.number)?.reason ?? 'No urgent signal is configured; kept below the explicitly prioritized work.',
        }))
        .sort((left, right) => right.score - left.score || new Date(right.updatedAt) - new Date(left.updatedAt));
}

function renderIssue(issue) {
    return `
        <article class="card" data-testid="issue-card-${issue.number}">
            <div class="card-header">
                <span class="issue-number">#${issue.number}</span>
                <a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a>
            </div>
            <p class="description">${escapeHtml(issue.body)}</p>
            <p class="reason"><strong>Why this is prioritized:</strong> ${escapeHtml(issue.reason)}</p>
            <button type="button" data-testid="add-issue-${issue.number}" data-issue-number="${issue.number}">
                Add to current context
            </button>
        </article>`;
}

function renderHtml(issues, errorMessage = '') {
    const topIssues = issues.slice(0, 3);
    const remainingIssues = issues.slice(3);
    const error = errorMessage
        ? `<p class="error" role="alert" data-testid="load-error">${escapeHtml(errorMessage)}</p>`
        : '';
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Issue triage board</title>
    <style>
        :root { color-scheme: light dark; }
        body { margin: 0; padding: 24px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font-family: var(--font-sans, system-ui, sans-serif); line-height: 1.5; }
        main { max-width: 980px; margin: 0 auto; }
        h1 { margin: 0 0 6px; font-size: 26px; }
        .intro { color: var(--text-color-muted, #656d76); margin: 0 0 24px; }
        section { margin-top: 28px; }
        h2 { font-size: 18px; margin: 0 0 12px; }
        .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 14px; }
        .card { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 10px; padding: 16px; background: var(--background-color-muted, #f6f8fa); }
        .card-header { display: flex; gap: 8px; align-items: baseline; }
        .card-header a { color: var(--text-color-default, #1f2328); font-weight: 600; }
        .issue-number { color: var(--text-color-muted, #656d76); font-family: var(--font-mono, monospace); }
        .description { white-space: pre-wrap; max-height: 180px; overflow: auto; }
        .reason { border-left: 3px solid var(--true-color-blue, #0969da); padding-left: 10px; }
        button { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 6px; padding: 8px 12px; background: var(--true-color-blue, #0969da); color: var(--color-white, #fff); cursor: pointer; font: inherit; }
        button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
        button[disabled] { opacity: .65; cursor: wait; }
        .status { min-height: 24px; color: var(--text-color-muted, #656d76); }
        .error { color: var(--true-color-red, #cf222e); }
    </style>
</head>
<body>
<main>
    <h1>Issue triage board</h1>
    <p class="intro">The three issues most likely to need attention now are separated from the remaining open work.</p>
    ${error}
    <p class="status" id="status" role="status" aria-live="polite"></p>
    <section aria-labelledby="priority-heading">
        <h2 id="priority-heading">Needs attention now</h2>
        <div class="board">${topIssues.length ? topIssues.map(renderIssue).join('') : '<p>No open issues found.</p>'}</div>
    </section>
    <section aria-labelledby="remaining-heading">
        <h2 id="remaining-heading">Remaining open issues</h2>
        <div class="board">${remainingIssues.length ? remainingIssues.map(renderIssue).join('') : '<p>No remaining issues.</p>'}</div>
    </section>
</main>
<script>
    document.querySelectorAll('button[data-issue-number]').forEach((button) => {
        button.addEventListener('click', async () => {
            button.disabled = true;
            document.querySelector('#status').textContent = 'Adding issue to the current context…';
            try {
                const response = await fetch('/add-issue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ number: Number(button.dataset.issueNumber) }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Unable to add issue.');
                document.querySelector('#status').textContent = 'Issue added to the current context.';
            } catch (error) {
                document.querySelector('#status').textContent = error.message;
                button.disabled = false;
            }
        });
    });
</script>
</body>
</html>`;
}

async function addIssueToContext(issue) {
    await session.send({
        prompt: `Add GitHub issue #${issue.number} to the current work context and prepare to address it. Issue: ${issue.title}\n\n${issue.body}\n\nURL: ${issue.url}`,
    });
}

async function startServer(instanceId) {
    const issues = await fetchIssues();
    const server = createServer(async (request, response) => {
        try {
            const requestUrl = new URL(request.url, 'http://127.0.0.1');
            if (request.method === 'POST' && requestUrl.pathname === '/add-issue') {
                let body = '';
                for await (const chunk of request) body += chunk;
                const issueNumber = JSON.parse(body).number;
                const issue = issues.find((candidate) => candidate.number === issueNumber);
                if (!issue) {
                    response.writeHead(404, { 'Content-Type': 'application/json' });
                    response.end(JSON.stringify({ error: 'Issue is no longer in the loaded open-issue list.' }));
                    return;
                }
                await addIssueToContext(issue);
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ ok: true }));
                return;
            }
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(renderHtml(issues));
        } catch (error) {
            response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(renderHtml([], error.message));
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: 'issue-triage-board',
            displayName: 'Issue triage board',
            description: 'Kanban board that ranks open repository issues and adds a selected issue to the current session context.',
            actions: [
                {
                    name: 'add_issue_to_context',
                    description: 'Add an open repository issue to the current session context.',
                    inputSchema: {
                        type: 'object',
                        properties: { number: { type: 'integer', minimum: 1 } },
                        required: ['number'],
                        additionalProperties: false,
                    },
                    handler: async (ctx) => {
                        const issues = await fetchIssues();
                        const issue = issues.find((candidate) => candidate.number === ctx.input.number);
                        if (!issue) throw new Error(`Open issue #${ctx.input.number} was not found.`);
                        await addIssueToContext(issue);
                        return { ok: true, issueNumber: issue.number };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: 'Issue triage board', url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
