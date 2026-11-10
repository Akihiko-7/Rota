# Joining the Rota mainnet circle: one-page guide

This circle uses **real money**: real USDC and real NEAR. Read it all once before you start.

## The circle

| | |
|---|---|
| Members | **[to confirm, e.g. 4]** |
| Each member pays per round | **[to confirm, e.g. 5 USDC]** |
| A new round every | **[to confirm]** |
| Deposit for an early turn (optional) | **[to confirm, or none]** |
| Contract | **[mainnet contract id, after deployment]** |
| Telegram group | **[link]**, with the treasurer bot @RotaNear_Bot |

Each round, every member pays the amount above, and one member receives the whole pot. The order is fixed when the circle starts. Members with a deposit or a clean payment record go first.

## What you need

**USDC on NEAR:** the amount per round × the number of rounds, plus the deposit if you post one. With 4 members at 5 USDC, that's 20 USDC in total, paid 5 at a time. It must be Circle's native USDC on NEAR, the token `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. The older bridged "USDC.e" is a different token and won't work.

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

## If you miss a payment

After the deadline and a short grace period, the treasurer pays out what was collected. Your missed payment goes on your public payment record. If you posted a deposit, up to one round's amount is taken from it and added to the pot, so that round's member is still paid. Missing after you've already had your turn counts as a default.

## Safety

- Never share your secret phrase, not with us, the bot, or anyone claiming to help. We never ask for it.
- The treasurer can't take your money: its only key can pay out a round, and the contract decides who gets it. You can check this on the Rota home page.
- Payments can't be reversed. Check the circle and the amount before you approve.
- Only join circles with people you know and trust. The contract enforces the rules, but it can't make anyone keep paying.
