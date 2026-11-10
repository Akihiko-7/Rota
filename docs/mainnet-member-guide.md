# Joining the Rota mainnet circle: one-page guide

This circle uses **real money**: real USDC and real NEAR. Read it all once before you start.

## The circle

| | |
|---|---|
| Members | **4** |
| Each member pays per round | **1 USDC** |
| A new round every | **30 minutes**, so 4 rounds take about 2 hours. We run it in one sitting on **13 November** |
| Grace period after each round's deadline | **5 minutes** |
| Deposit for an early turn (optional) | **1 USDC**, returned with the last payout |
| Contract | **[mainnet contract id, after deployment]** |
| Telegram group | **[link]**, with the treasurer bot @RotaNear_Bot |

Each round, every member pays 1 USDC, and one member receives the whole pot of 4 USDC. The order is fixed when the circle starts. Members who posted the deposit go first (on mainnet nobody has a payment record yet).

Keep the circle page open for the whole sitting. With 30-minute rounds, you pay once every half hour.

## What you need

**USDC on NEAR:** 4 USDC in total, paid 1 at a time (one per round), plus 1 USDC if you post the deposit, so **5 USDC** to be safe. You get 4 USDC back on your turn and the deposit back at the end. If you'll pay from another chain instead, see "Paying from another chain" below. It must be Circle's native USDC on NEAR, the token `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. The older bridged "USDC.e" is a different token and won't work.

**About 0.2 NEAR for fees** (0.6 if you start the circle). This is what we measured on a real 4-round circle:

| Action | NEAR actually spent |
|---|---|
| Joining | about 0.002 (0.0005 fee + 0.00125 to register you with USDC) |
| Each payment | about 0.0007 |
| A whole 4-round circle, as a member | about 0.005 |
| Starting the circle (creator only) | about 0.012 per member, kept for the circle's storage |

You'll spend only a fraction of the 0.2 NEAR. You need it in your wallet because, before each action, NEAR checks you could cover the highest possible fee: up to 0.1 NEAR for a payment, plus 0.05 NEAR held briefly when you join. What isn't used is refunded straight away.

## Wallets that work

Any wallet in the NEAR Connect list, for example:
- **Meteor Wallet**: browser, phone or Chrome extension.
- **HOT Wallet**: phone, or inside Telegram.
- **Intear Wallet**: browser.
- **MyNearWallet**: browser.
- **NEAR Mobile**: phone.

When you create the wallet, write the secret phrase on paper and keep it safe.

## Steps

1. **Create a wallet** and note your account name (e.g. `yourname.near`). Send it to the person starting the circle.
2. **Add NEAR**: buy about 0.2 NEAR on an exchange that lists it, and withdraw it to your account name on the **NEAR** network.
3. **Add USDC on NEAR**: withdraw USDC from an exchange choosing the **NEAR** network, if it offers that (send a small test amount first). Or swap USDC from another chain at [near-intents.org](https://near-intents.org).
4. **Join**: open the circle's link, choose **Mainnet** at the top, click **Connect wallet**, then **Join the circle**, and approve in your wallet. If there's a deposit and you want an early turn, post it now.
5. **Link Telegram**: in the group, send `/link yourname.near`. Open the signing page the bot sends, approve the message (it's free and gives nobody access to your money), and send the `/verify …` line it shows back to the group.
6. **Pay each round**: when the bot reminds you, or any time during the round, open the circle and press **Pay**. When everyone has paid, the treasurer pays the pot to whoever's turn it is.

## Paying from another chain

You can pay a round with USDC on Base, Arbitrum, Ethereum, Solana or Polygon instead of USDC on NEAR. Rota uses NEAR Intents (the 1Click API) to turn it into USDC on NEAR in your own account, and you then press **Pay** as usual.

1. You still need a NEAR account that has joined the circle, with about 0.2 NEAR for fees.
2. On the other chain, hold about **1.02 USDC** for the round, plus a little of that chain's own coin for the transfer fee (e.g. ETH on Base or Arbitrum, cents' worth). Base or Arbitrum are the cheapest and fastest.
3. On the circle page, open **Pay from another chain**, pick the chain and enter your own address on it (any refund goes there), and press **Get deposit address**.
4. Send exactly the amount shown to the address shown, from your wallet on that chain, before the quote expires.
5. The page shows the swap's progress. It usually takes under a minute. When it says the USDC has arrived on NEAR, press **Pay**.

The quote includes a small safety margin (about 1%). Whatever isn't needed is refunded to your address on the other chain. NEAR Intents charges about 0.2% (0.002 USDC on 1 USDC). Allow a few minutes, so start well before the round's deadline.

## If you miss a payment

After the deadline and the 5-minute grace period, the treasurer pays out what was collected. Your missed payment goes on your public payment record. If you posted a deposit, up to one round's amount is taken from it and added to the pot, so that round's member is still paid. Missing after you've already had your turn counts as a default.

## Safety

- Never share your secret phrase, not with us, the bot, or anyone claiming to help. We never ask for it.
- The treasurer can't take your money: its only key can pay out a round, and the contract decides who gets it. You can check this on the Rota home page.
- Payments can't be reversed. Check the circle and the amount before you approve.
- Only join circles with people you know and trust. The contract enforces the rules, but it can't make anyone keep paying.
