# Ubuntu staging deployment

This is a staging recipe for a small Ubuntu server. It keeps Node bound to `127.0.0.1:5173` and puts HTTPS and temporary access control in Nginx.

## 1. Server preparation

Use a non-root deployment account and update the system. Install Node.js 22.13 or newer, Nginx, and the package used to create Basic Auth files. Keep the cloud firewall limited to SSH from the team network plus TCP 80 and 443.

Create the application account and directories:

```bash
sudo useradd --system --home /opt/credilens --shell /usr/sbin/nologin credilens
sudo install -d -o credilens -g credilens /opt/credilens
sudo install -d -o root -g credilens -m 0750 /etc/credilens
```

Copy the complete project into `/opt/credilens`. Do not copy the local `.env`, screenshots containing real data, or development logs.

## 2. Environment file

Create `/etc/credilens/credilens.env` with mode `0600` and owner `root:credilens`:

```dotenv
LLM_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=server-side-secret
LLM_MODEL=your-model-id
LLM_VISION=false
PORT=5173
TAVILY_API_KEY=
```

Use a separate staging model key and a daily budget. Leave `TAVILY_API_KEY` empty until model access and cost limits are confirmed.

## 3. Start the service

Copy `credilens.service.example` to `/etc/systemd/system/credilens.service`, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now credilens
sudo systemctl status credilens --no-pager
curl --fail http://127.0.0.1:5173/api/status
```

The status response must not contain an API key. Check logs only for startup and failure metadata; do not enable request-body logging.

## 4. Configure Nginx

Point the test DNS record to the server, obtain a certificate, and replace `example.test` and the certificate paths in `nginx-credilens.conf.example`. Create a temporary Basic Auth file, copy the config into `/etc/nginx/sites-available/credilens`, enable it, and test:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I https://example.test/
```

The public URL must require HTTPS and Basic Auth. Port 5173 must not be reachable from the internet.

## 5. Staging smoke test

Run the normal tests before inviting anyone:

```bash
node --test tests/engine.test.js tests/server.test.js tests/transcription.test.js tests/search.test.js
node tests/evaluate.cjs
```

Then test through the public URL with fictional text, a fictional screenshot, a normal notice, an insufficient message, a malformed URL, a cancelled request, and a model timeout. Confirm that no original text or image appears in system logs, Nginx logs, exports, or public files.

## 6. Shut down and rotate

Disable the test account and Basic Auth when the feedback window closes. Stop the service or block the domain if a P0 issue appears. Rotate the staging model key if it was ever exposed, and keep the feedback CSV separate from user content.
