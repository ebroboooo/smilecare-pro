# Deploy

## Vercel (public demo website)

Vercel hosts the **Vite SPA only**. The clinic API uses SQLite, better-sqlite3, and long-running Telegram/WhatsApp loops, so it does **not** run on Vercel serverless.

Deploy the marketing/demo site with browser demo mode:

```powershell
npx vercel --prod --yes
```

Project env on Vercel (Production):

- `VITE_DEMO_MODE=true`

That build shows the demo banner and keeps data in the browser. It is not a real clinic install.

For a real clinic, use Docker or `npm start` on a VPS (below) so the API and SQLite stay on one persistent host.

## Docker

Create a `SESSION_SECRET` of at least 32 characters and do not commit it.

```powershell
$env:SESSION_SECRET = "replace-with-a-long-random-string"
docker compose up --build
```

The sample compose file publishes port 8080 and stores the database in a volume. Set `CLIENT_ORIGIN` to the public site URL before you rely on cookies.

`Caddyfile` is a sample reverse proxy. Point it at the `smilecare` service and terminate HTTPS on the host. An equivalent nginx site proxies `/` to `127.0.0.1:8080`.

```nginx
server {
  listen 80;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `TRUST_PROXY=1` when a proxy is in front of the API. The compose file does that.

## This computer

`start.bat` and `start.sh` install, build, and start the server. Production mode serves the built website from the API, so the browser uses the same origin as the cookie.

The first launch still needs an owner account. Open the site and complete the setup screen. `scripts/setup-clinic.ps1` only prepares `server/.env`.
