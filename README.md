# Blackjack · Table & Trainer

This repository contains the single-file blackjack/training client plus a small Cloudflare Worker that hosts shared multiplayer rooms.

## Local use

Open `outputs/blackjack.html` directly in a browser. The solo table, strategy solver, statistics, training tools, and side bets work from `file://` without a build step.

## Multiplayer deployment

The committed multiplayer tab is configured for the deployed Worker. If you deploy the Worker under a different URL later, replace the value of `MULTIPLAYER_ENDPOINT` in `work/shell.html`, then rebuild the client into `outputs/blackjack.html` and the repository root `index.html`:

```powershell
$engine = Get-Content -Raw work/engine.js
$shell = Get-Content -Raw work/shell.html
$built = $shell.Replace('/* ENGINE */', $engine)
Set-Content outputs/blackjack.html $built -Encoding utf8
Set-Content index.html $built -Encoding utf8
```

Deploy the room server with:

```powershell
npx wrangler deploy
```

The Worker uses a Durable Object per room code and WebSockets for live state. It is play-money only; no account, payment, or casino connection is involved.

The client can then be hosted by GitHub Pages. `index.html` is the public entry point, while `outputs/blackjack.html` remains the directly opened local copy.

## Verification

```powershell
node work/verify.js
node work/ui-smoke.js
npx wrangler deploy --dry-run
```
