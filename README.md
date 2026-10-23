# etalabs

Person-to-person NFT trades on Monad. Live app: [etalabs.xyz](https://etalabs.xyz) — switch the network to Monad.

This repo is a **review snapshot** for Chogathon. It is not the production deploy and it does not include live APIs, admin, or keys.

## What is here

- Trade UI (in-wallet and escrow)
- MON and $CHOG on either side of a Monad offer
- Solidity for the in-wallet and escrow programs
- Free-trade copy: Chog on Monad, eta on every chain

## What is not here

- No `.env`, no API keys, no OpenSea or Firebase routes
- No admin or deploy pages
- No scripts and no private keys
- Contract addresses in this snapshot are placeholders. The live programs are on Monad; verify them from a trade on etalabs.xyz / MonadVision.

## Run locally (UI only)

```bash
npm install
cp .env.example .env.local
npm run dev
```

Offers will not persist without your own backend. Use the live site to trade.

## Stack

Next.js, React, TypeScript, Tailwind, Vercel
