# Crypto Syndicate Wallet Tracker

Multi-chain Telegram wallet tracking bot for **Solana**, **Ethereum**, and **Base**. Admins register tokens (contract addresses) and tied wallets; the bot streams real-time alerts to a Telegram group whenever those wallets buy, sell, transfer, or move tokens to a new linked wallet.

---

## Architecture

```
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│  Helius webhook    │    │ Alchemy webhook ETH│    │ Alchemy webhook BASE│
└─────────┬──────────┘    └─────────┬──────────┘    └─────────┬──────────┘
          │                         │                         │
          ▼                         ▼                         ▼
       ┌──────────────────────────────────────────────────────┐
       │                Express server (HTTPS)                │
       │   /webhooks/solana  /webhooks/ethereum  /webhooks/base│
       └──────────────────────────┬───────────────────────────┘
                                  ▼
                        ┌──────────────────┐
                        │ Chain parsers    │ → ParsedTokenEvent[]
                        └────────┬─────────┘
                                 ▼
                       ┌─────────────────────┐
                       │ transactionService  │ classify, dedupe, persist
                       │  + linked-wallet    │
                       │  + walletStats      │
                       └────────┬────────────┘
                                ▼
                        ┌────────────────┐
                        │ alertDispatcher│ → Telegram group
                        └────────────────┘
                                 │
                                 ▼
                          PostgreSQL (Prisma)
```

```
src/
├── bot/            grammY bot bootstrapping + middleware
├── chains/
│   ├── solana/     Helius client + parser + webhook
│   ├── ethereum/   Alchemy webhook (re-export)
│   ├── base/       Alchemy webhook (re-export)
│   └── evm/        Shared viem client + Alchemy parser/handler
├── commands/       /addtoken, /addwallet, /admin, /pause, /resume, …
├── config/         Env validation (zod)
├── database/       Prisma client singleton
├── services/       token / wallet / linkedWallet / transaction / admin
├── alerts/         Templates + dispatcher
├── utils/          format, duration, retry, rateLimit, logger, explorer
├── server/         Express app + routes
└── types/          Shared TypeScript types
```

## Features

- **Multi-chain**: Solana (Helius), Ethereum + Base (Alchemy / viem)
- **Token tracking**: `/addtoken`, `/removetoken`, `/tokens`
- **Wallet tracking**: `/addwallet`, `/removewallet`, `/wallets`
- **Buy/Sell/Transfer detection** with native (SOL/ETH) cost basis
- **Linked-wallet auto-discovery**: when a tracked wallet sends tokens to a new address, the recipient is automatically tracked and an edge is recorded; combined ownership is reported across the link graph
- **Per-wallet stats**: first/last buy, first/last sell, current balance, total bought/sold, avg entry price, ownership %, last activity
- **Admin system**: bootstrapped from `TELEGRAM_BOOTSTRAP_ADMINS`, then `/admin add`, `/admin remove`, `/admin list`
- **Pause/Resume** alerts per token without deleting tracking data
- **Production guardrails**: zod env validation, fail-fast startup, rate limiting per-user, Alchemy HMAC signature check, Helius auth header check, exponential-backoff retry on Telegram + RPC, Prisma idempotency unique on `(txHash, walletId, type)`, structured pino logging

## Telegram alert examples

```
🟢 BUY DETECTED
Project: Print Club
Chain: Solana
Wallet: Chad Wallet 1
Bought: 500,000 PC
Spent: 1.4 SOL
Current Balance: 2,450,000 PC
Ownership: 1.22%
First Buy: May 10, 2026
Holding Time: 3 days 4 hours
TX: https://solscan.io/tx/…
```

```
🔴 SELL DETECTED
Project: Print Club
Wallet: Chad Wallet 1
Sold: 400,000 PC
Remaining Balance: 2,050,000 PC
Ownership After Sell: 0.97%
Held For: 4 days 2 hours
TX: https://solscan.io/tx/…
```

```
🟡 LINKED WALLET DETECTED
Project: Print Club
Original Wallet: Chad Wallet 1
Transferred: 1,000,000 PC
New Wallet: 0x92F...e1a4
This wallet is now being tracked automatically.
Combined Ownership: 1.44%
TX: https://etherscan.io/tx/…
```

---

## Local development

Requires Node ≥ 20 and Postgres ≥ 14.

```bash
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN, DATABASE_URL, HELIUS_API_KEY, ALCHEMY_API_KEY, ETHERSCAN_API_KEY

npm install
npm run prisma:generate
npx prisma migrate dev --name init   # first time only
npm run dev
```

The bot logs in via long polling and the Express server starts on `PORT` (default 3000). For real on-chain events to reach the bot in dev, expose port 3000 with a tunnel:

```bash
ngrok http 3000
# then set PUBLIC_URL=https://<your-tunnel>.ngrok-free.app in .env and restart
```

## Deployment (Railway)

1. Push the repo to GitHub.
2. Create a new Railway project → Deploy from GitHub.
3. Add a Postgres plugin; Railway will inject `DATABASE_URL` automatically.
4. Set the remaining environment variables (see `.env.example`). `PUBLIC_URL` should be your Railway public domain (`https://<service>.up.railway.app`).
5. The build command (`railway.json`) runs `prisma generate && tsc`. The start command runs `prisma migrate deploy && node dist/index.js`. Healthchecks hit `/health`.

Once deployed, the Solana webhook is created/updated automatically on startup (and whenever a wallet is added). For EVM chains, see below.

### Configuring the EVM webhook (Ethereum + Base)

Alchemy's webhook addresses are managed by their dashboard. Per chain:

1. Go to the Alchemy dashboard → **Notify** → **Create Webhook** → **Address Activity**.
2. Network: `Ethereum Mainnet` (and a separate one for `Base Mainnet`).
3. Webhook URL:
   - Ethereum: `https://<your-app>.up.railway.app/webhooks/ethereum`
   - Base: `https://<your-app>.up.railway.app/webhooks/base`
4. Add at least one address (you can add the actual wallets later).
5. Copy the **Signing Key** for that webhook into `ALCHEMY_WEBHOOK_SIGNING_KEY`. The same key is used for both chain webhooks if you create them under the same Alchemy app.

When you add wallets via `/addwallet`, you can either re-add the addresses to Alchemy manually or wire `alchemyAddAddresses(...)` (in `src/chains/evm/client.ts`) into your `addWallet` flow with the appropriate webhook ID.

### Configuring the Solana webhook (Helius)

Nothing manual is required — `resyncSolanaWebhook()` runs at startup and after each `/addwallet`, syncing the tracked address list to a single Helius enhanced webhook pointing at `${PUBLIC_URL}/webhooks/solana`. Set `HELIUS_WEBHOOK_AUTH_HEADER` to a random secret string (e.g. via `openssl rand -hex 32`) to require an `Authorization` header on incoming webhook calls.

---

## Bootstrapping the first admin

Set `TELEGRAM_BOOTSTRAP_ADMINS` to a comma-separated list of Telegram user IDs:

```
TELEGRAM_BOOTSTRAP_ADMINS=123456789,987654321
```

Those users are seeded into the `admins` table on each startup. From there, use `/admin add <id>` and `/admin remove <id>` to manage admins.

To get your Telegram user id, message [@userinfobot](https://t.me/userinfobot) on Telegram.

---

## Commands reference

| Command | Access | Description |
|---|---|---|
| `/start` | anyone | Show help |
| `/addtoken [chain] [CA] [name]` | admin | Begin tracking a token |
| `/removetoken [chain] [CA]` | admin | Stop tracking a token (cascades wallets) |
| `/tokens` | anyone | List tracked tokens |
| `/addwallet [chain] [CA] [wallet] [label]` | admin | Track a wallet for a token |
| `/removewallet [wallet]` | admin | Stop tracking a wallet |
| `/wallets [CA]` | anyone | List wallets for a token |
| `/pause [chain] [CA]` | admin | Stop alerts for a token |
| `/resume [chain] [CA]` | admin | Resume alerts for a token |
| `/admin add [telegramId]` | admin | Add an admin |
| `/admin remove [telegramId]` | admin | Remove an admin |
| `/admin list` | admin | List admins |

`chain` accepts: `solana` / `sol`, `ethereum` / `eth`, `base`.

---

## Notes & extension points

- **Native (SOL/ETH) attribution on EVM swaps** uses Alchemy's `value` field on the activity entry, which is correct for the swap router contract but not for arbitrary multi-hop trades. For accurate per-trade native cost on Ethereum/Base, fetch the full receipt with `viem`'s `getTransactionReceipt` and decode the WETH `Deposit`/`Withdrawal` logs paired with the `Transfer` event. The hook for this is `parseAlchemyActivity` in `src/chains/evm/parser.ts`.
- **Backfilling first-buy date** for a wallet that already holds tokens before tracking begins isn't done automatically. To backfill, query Helius `getSignaturesForAsset` (Solana) or Etherscan `account.tokentx` (EVM) and replay history through `handleParsedEvents`.
- **Single-instance only** by default. The rate limiter is in-memory; back it with Redis if you scale beyond one Railway replica.
- **Idempotency** is enforced by the unique constraint `(txHash, walletId, type)` on `transactions`, so duplicate webhook deliveries are safe.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Run the bot with hot reload (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | Apply migrations (production) |
| `npm run typecheck` | Type-check without emitting |
