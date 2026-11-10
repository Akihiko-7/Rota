# Rota bot: live demo transcript (circle 5, 10 Nov 2026)

The live demo of @RotaNear_Bot in a Telegram test group, recorded by the bot (privacy mode on, so it only sees commands and replies to its own messages). The human member's handle is replaced with @member. Times are UTC. Messages are shown as the group saw them, without formatting. Circle 5 runs on circle-v2.rota-nearhack.testnet with four demo members; the bot made every payout with its settle-only key. The plain @mention sent at about 10:01 does not appear because Telegram does not deliver mentions to privacy-mode bots.

**09:57:55 · @member**

> /circle 5

**09:57:59 · Rota bot**

> ✅ This group now follows Demo circle (circle 5).
>
> • 4 members: dara, amara, bao and carmen
> • Each member pays 10 USDC per round
> • A new round every 2 minutes
> • Status: waiting to start
>
> I'll post here when someone pays, remind anyone who hasn't, and pay out each pot as soon as the rules allow.

**09:58:39 · Rota bot**

> 💸 amara, bao and carmen paid for round 1.
> 3 of 4 members have paid.

**09:58:54 · Rota bot**

> 💸 dara paid for round 1.
> 4 of 4 members have paid.

**09:58:59 · Rota bot**

> ✅ Round 1 of 4 is paid out!
>
> dara received 40 USDC.
>
> Paid out by me, the treasurer.
> 🧾 View on NEAR explorer (https://testnet.nearblocks.io/txns/9PF9pWcs8DVPt8jh4TcefvNso3BKtNMa4sKgs73hVvho)

**09:59:09 · Rota bot**

> 💸 amara and bao paid for round 2.
> 2 of 4 members have paid.

**09:59:21 · @member**

> /status

**09:59:22 · Rota bot**

> 📊 Demo circle, round 2 of 4
>
> 🎁 This round's pot goes to amara
> ⏰ Due in 3 min 2 s (10:02 UTC)
>
> Paid (3 of 4): amara, bao and carmen
> Still to pay: dara
>
> 💰 Collected so far: 30 USDC
>
> The pot is paid out once everyone has paid, or when the grace period ends.

**09:59:24 · Rota bot**

> 💸 carmen paid for round 2.
> 3 of 4 members have paid.

**09:59:25 · @member**

> /order

**09:59:26 · Rota bot**

> 🔢 Payout order for Demo circle
>
> 1. dara - received 40 USDC ✅
> 2. amara - this round ⏳
> 3. bao
> 4. carmen

**09:59:38 · @member**

> /swap bao.rota-nearhack.testnet

**09:59:38 · Rota bot**

> 🔒 You need to confirm your account before asking to swap turns.
>
> Your link to amara.rota-nearhack.testnet isn't confirmed yet. Finish the signing step from /link first.

**09:59:52 · @member**

> /verify ed25519:7fTp4DacTyRDVzMiHgttMM84X4kh5hKGtCg1UGB3TbBu n9lYT1sCLL5ooXw7eiIASYKeETvIoXeoXee+yf94/0rU/vcTchFjtSrREpiuQu8bTW+GqoyxnReL8nkpbCjdBg==

**09:59:53 · Rota bot**

> ✅ Confirmed: @member owns amara.rota-nearhack.testnet.
>
> The wallet signature checks out, so you can now ask other members to swap turns.

**10:00:06 · @member**

> /swap bao.rota-nearhack.testnet

**10:00:07 · Rota bot**

> 🔁 Swap request
>
> amara (@member) (turn 2) would like to swap turns with bao (turn 3).
>
> Nothing changes until both of you approve it in your own wallets:
> 1. amara proposes the swap
> 2. bao accepts it
>
> I can't approve it for either of you.
>
> For wallet experts: propose_swap then accept_swap on circle-v2.rota-nearhack.testnet, each with 1 yoctoNEAR.

**10:00:18 · @member**

> /ask who still has to pay?

**10:00:26 · Rota bot**

> Just dara still has to pay this round. Everyone else — amara, bao, and carmen — has already paid. We can't settle yet until dara's payment comes in.
>
> 🔎 I checked this round's status.

**10:00:52 · @member**

> /redteam

**10:00:53 · Rota bot**

> 🔴 Red team test
>
> I'll try to steal the money in three different ways, using my own real key. Each attempt really goes to the NEAR network, and I'll show you exactly what came back.
>
> The pretend thief's account: thief.treasurer-v2.rota-nearhack.testnet

**10:00:54 · Rota bot**

> 1️⃣ Send the money straight to the thief
>
> I asked the token contract to transfer 40 USDC to the thief.
>
> ❌ Blocked by NEAR before it even ran.
> Why: my key only works on the circle contract, not on the token.
> NEAR's exact words: "Access key receiver circle-v2.rota-nearhack.testnet does not match transaction receiver usdc-mock.rota-nearhack.testnet"

**10:00:54 · Rota bot**

> 2️⃣ Use a function I'm not allowed to use
>
> I tried "claim" on the circle, which members use to withdraw money they're owed.
>
> ❌ Blocked by NEAR before it even ran.
> Why: my key isn't allowed to use "claim"; it can only use "settle".
> NEAR's exact words: "Access key does not allow method claim"

**10:00:57 · Rota bot**

> 3️⃣ Pay out the pot, but to the thief
>
> I used "settle", the one thing I'm allowed to do, and added "send it to the thief".
>
> ❌ The contract refused.
> Why: only 3 of 4 members have paid, and the grace period isn't over yet.
> NEAR's exact words: "round 1 can't settle yet: 3 of 4 paid; settling opens at 1794304973362 ms"
> 🧾 View on NEAR explorer (https://testnet.nearblocks.io/txns/ByBUoUsvDKSXhRc4yiniKYzxwqzEnvFkBc8NdpK9oWQB)
>
> Even when the pot is paid out, nobody can choose who gets it. This round's pot can only go to amara (@member), whose turn it is.

**10:00:58 · Rota bot**

> 🛡️ Result: the thief got nothing.
>
> The only thing my key can do is pay out a round, and the contract always decides who gets paid.

**10:01:15 · @member**

> /attest

**10:01:18 · Rota bot**

> 🔐 Is my AI running on secure hardware?
>
> I just asked NEAR AI Cloud for proof about the model I use (Qwen/Qwen3.8-27B):
>
> ✅ The proof is fresh: it answered a random challenge I sent
> ✅ It includes an Intel TDX hardware report
> ✅ It includes NVIDIA GPU evidence
>
> This shows the hardware evidence is there and current. I don't check the hardware signatures myself.

**10:01:24 · Rota bot**

> ⏰ Reminder: round 2 is due in 1 min (10:02 UTC).
>
> Still to pay: dara
>
> Each member pays 10 USDC. Type /pay to see how.

**10:02:24 · Rota bot**

> ⚠️ Round 2 is past its deadline.
>
> Still to pay: dara
>
> There's a short grace period until 10:02 UTC (30 s from now). After that I'll pay out what was collected. A missed payment goes on that member's record, and up to 10 USDC is taken from their deposit and added to the pot.

**10:03:13 · Rota bot**

> ✅ Round 2 of 4 is paid out!
>
> amara (@member) received 40 USDC.
>
> ❗ dara didn't pay this round. 10 USDC was taken from their deposit and added to the pot.
> dara already had their turn, so this counts as a default on their record.
>
> Paid out by me, the treasurer.
> 🧾 View on NEAR explorer (https://testnet.nearblocks.io/txns/4KqRtRERWxBc3cEpjin3CFGijDHb1QNphhgcMZWntUHR)

**10:03:24 · Rota bot**

> 💸 amara (@member), bao and carmen paid for round 3.
> 3 of 4 members have paid.

**10:03:39 · Rota bot**

> 💸 dara paid for round 3.
> 4 of 4 members have paid.

**10:03:44 · Rota bot**

> ✅ Round 3 of 4 is paid out!
>
> bao received 40 USDC.
>
> Paid out by me, the treasurer.
> 🧾 View on NEAR explorer (https://testnet.nearblocks.io/txns/GTeV9pkVmNCfCujncPUj24rdpr5ff56iaEZBQH4GTvwz)

**10:03:54 · Rota bot**

> 💸 amara (@member) and bao paid for round 4.
> 2 of 4 members have paid.

**10:04:39 · Rota bot**

> 💸 dara and carmen paid for round 4.
> 4 of 4 members have paid.

**10:04:44 · Rota bot**

> ✅ Round 4 of 4 is paid out!
>
> carmen received 40 USDC.
>
> Paid out by me, the treasurer.
> 🧾 View on NEAR explorer (https://testnet.nearblocks.io/txns/FgZXxoJm1x3RKLWJzyuf7k4sJ8K817c4ckkY3QmGLESV)

**10:04:44 · Rota bot**

> 🏁 Demo circle is complete!
>
> All 4 rounds are done, and every member received the pot once. Any deposits left over were returned.
