//! Rota Harvest in the sandbox, against a mock staking pool that mirrors
//! near/core-contracts staking-pool (methods, share maths, 4-epoch unlock).

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccessKey, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};
use tokio::sync::OnceCell;

const NEAR: u128 = 10u128.pow(24);

static HARVEST: OnceCell<Vec<u8>> = OnceCell::const_new();
static POOL: OnceCell<Vec<u8>> = OnceCell::const_new();

struct Env {
    worker: Worker<Sandbox>,
    harvest: Contract,
    pool: Contract,
    members: Vec<Account>,
    outsider: Account,
}

async fn setup(n: usize) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let harvest_wasm = HARVEST.get_or_try_init(|| async { near_workspaces::compile_project("../harvest").await }).await?;
    let pool_wasm = POOL.get_or_try_init(|| async { near_workspaces::compile_project("../mock-pool").await }).await?;
    let harvest = worker.dev_deploy(harvest_wasm).await?;
    let pool = worker.dev_deploy(pool_wasm).await?;
    pool.call("new").args_json(json!({ "owner_id": pool.id() })).transact().await?.into_result()?;
    let mut members = Vec::new();
    for _ in 0..n {
        members.push(worker.dev_create_account().await?);
    }
    let outsider = worker.dev_create_account().await?;
    Ok(Env { worker, harvest, pool, members, outsider })
}

impl Env {
    async fn create(&self, by: &Account, pool: &str, fill_sec: u64) -> anyhow::Result<String> {
        self.create_with_term(by, pool, fill_sec, 1).await
    }

    async fn create_with_term(&self, by: &Account, pool: &str, fill_sec: u64, term_epochs: u64) -> anyhow::Result<String> {
        let res = by
            .call(self.harvest.id(), "create_pot")
            .args_json(json!({ "name": "Test harvest", "pool_id": pool, "fill_sec": fill_sec, "term_epochs": term_epochs }))
            .deposit(NearToken::from_millinear(50))
            .transact()
            .await?
            .into_result()?;
        Ok(res.json::<String>()?)
    }

    async fn deposit(&self, from: &Account, id: &str, yocto: u128) -> anyhow::Result<ExecutionFinalResult> {
        Ok(from
            .call(self.harvest.id(), "deposit")
            .args_json(json!({ "pot_id": id }))
            .deposit(NearToken::from_yoctonear(yocto))
            .transact()
            .await?)
    }

    async fn step(&self, by: &Account, method: &str, id: &str) -> anyhow::Result<ExecutionFinalResult> {
        Ok(by.call(self.harvest.id(), method).args_json(json!({ "pot_id": id })).max_gas().transact().await?)
    }

    async fn pot(&self, id: &str) -> anyhow::Result<Value> {
        Ok(self.harvest.view("get_pot").args_json(json!({ "pot_id": id })).await?.json()?)
    }

    async fn status(&self, id: &str) -> anyhow::Result<Value> {
        Ok(self.harvest.view("get_status").args_json(json!({ "pot_id": id })).await?.json()?)
    }

    async fn stage(&self, id: &str) -> anyhow::Result<String> {
        Ok(self.pot(id).await?["stage"].as_str().unwrap().to_string())
    }

    async fn balance(&self, a: &Account) -> anyhow::Result<u128> {
        Ok(a.view_account().await?.balance.as_yoctonear())
    }

    /// Moves block time forward by at least `secs`.
    async fn wait_secs(&self, id: &str, secs: u64) -> anyhow::Result<()> {
        let target = self.status(id).await?["now_ms"].as_u64().unwrap() + secs * 1000;
        while self.status(id).await?["now_ms"].as_u64().unwrap() <= target {
            self.worker.fast_forward(200).await?;
        }
        Ok(())
    }

    /// Moves forward until the epoch height reaches `epoch`.
    async fn wait_epoch(&self, id: &str, epoch: u64) -> anyhow::Result<()> {
        while self.status(id).await?["epoch_height"].as_u64().unwrap() < epoch {
            self.worker.fast_forward(200).await?;
        }
        Ok(())
    }

    async fn pool_total(&self) -> anyhow::Result<u128> {
        let v: String = self.pool.view("get_account_total_balance").args_json(json!({ "account_id": self.harvest.id() })).await?.json()?;
        Ok(v.parse()?)
    }
}

fn failure(res: anyhow::Result<ExecutionFinalResult>) -> String {
    match res {
        Err(e) => format!("{e:?}"),
        Ok(r) if r.is_failure() => format!("{:?}", r.into_result().unwrap_err()),
        Ok(r) => panic!("expected failure, got success: {:?}", r.logs()),
    }
}

fn amount(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

/// Deposits are uneven and can be topped up; a depositor can take theirs back
/// only before staking starts; late deposits are refused.
#[tokio::test]
async fn deposits_and_early_withdrawal() -> anyhow::Result<()> {
    let env = setup(3).await?;
    let (a, b, c) = (&env.members[0], &env.members[1], &env.members[2]);
    let id = env.create(a, env.pool.id().as_str(), 60).await?;

    env.deposit(a, &id, NEAR).await?.into_result()?;
    env.deposit(a, &id, NEAR / 2).await?.into_result()?;
    env.deposit(b, &id, 2 * NEAR + 7).await?.into_result()?;
    env.deposit(c, &id, NEAR / 3).await?.into_result()?;
    assert!(failure(env.deposit(c, &id, NEAR / 100).await).contains("deposit at least 0.1 NEAR"));

    let pot = env.pot(&id).await?;
    assert_eq!(amount(&pot["deposits"][0]["amount"]), NEAR + NEAR / 2, "top-ups add up");
    assert_eq!(amount(&pot["total"]), NEAR + NEAR / 2 + 2 * NEAR + 7 + NEAR / 3);

    // c takes the deposit back while filling, and gets all of it.
    let before = env.balance(c).await?;
    env.step(c, "cancel_deposit", &id).await?.into_result()?;
    let after = env.balance(c).await?;
    assert!(after <= before + NEAR / 3 && after + NEAR / 100 >= before + NEAR / 3, "refunded the whole deposit, minus the call's fee");
    assert_eq!(amount(&env.pot(&id).await?["total"]), NEAR + NEAR / 2 + 2 * NEAR + 7);
    assert!(failure(env.step(&env.outsider, "cancel_deposit", &id).await).contains("you have no deposit in this pot"));

    // After the window: no new deposits; once staked, nobody can take theirs back.
    env.wait_secs(&id, 61).await?;
    assert!(failure(env.deposit(c, &id, NEAR).await).contains("the filling window has closed"));
    env.step(&env.outsider, "stake", &id).await?.into_result()?;
    assert_eq!(env.stage(&id).await?, "Staked");
    assert!(failure(env.step(a, "cancel_deposit", &id).await).contains("deposits can only be taken back before staking starts"));
    Ok(())
}

/// The whole lifecycle with the mock pool: stake, rewards, unstake after the
/// term, wait 4 epochs, withdraw exactly what the pool holds, distribute
/// pro-rata to the yoctoNEAR.
#[tokio::test]
async fn full_lifecycle_pays_principal_plus_rewards_pro_rata() -> anyhow::Result<()> {
    let env = setup(4).await?;
    let deposits = [3 * NEAR, NEAR + 123, 7 * NEAR / 10, 2 * NEAR + NEAR / 3];
    // Sandbox epochs are short, so this pot's term is 5 epochs to make "too early" observable.
    let id = env.create_with_term(&env.members[0], env.pool.id().as_str(), 60, 5).await?;
    for (m, d) in env.members.iter().zip(deposits) {
        env.deposit(m, &id, d).await?.into_result()?;
    }
    let total: u128 = deposits.iter().sum();

    assert!(failure(env.step(&env.outsider, "stake", &id).await).contains("the filling window is still open"));
    env.wait_secs(&id, 61).await?;
    env.step(&env.outsider, "stake", &id).await?.into_result()?;
    assert_eq!(env.stage(&id).await?, "Staked");
    let staked_in_pool = env.pool_total().await?;
    assert!(staked_in_pool <= total && total - staked_in_pool < 10, "the pool holds the pot, minus share rounding");
    let staked_epoch = env.pot(&id).await?["staked_epoch"].as_u64().unwrap();
    assert!(failure(env.step(&env.outsider, "unstake", &id).await).contains(&format!("the term ends at epoch {}", staked_epoch + 5)));

    // A second pot can't use the same pool while this one is in it.
    let other = env.create(&env.members[1], env.pool.id().as_str(), 60).await?;
    env.deposit(&env.members[1], &other, NEAR).await?.into_result()?;
    env.wait_secs(&other, 61).await?;
    assert!(failure(env.step(&env.outsider, "stake", &other).await).contains("another pot is staked in this pool"));

    // A reward, the way a real pool sees one: its balance grows, and the next call distributes it by shares.
    env.outsider.transfer_near(env.pool.id(), NearToken::from_near(1)).await?.into_result()?;
    env.wait_epoch(&id, staked_epoch + 5).await?;
    env.step(&env.outsider, "unstake", &id).await?.into_result()?;
    assert_eq!(env.stage(&id).await?, "Unbonding");
    let in_pool = env.pool_total().await?;
    assert!(in_pool > total, "the pot earned part of the reward: {in_pool} > {total}");

    // Not withdrawable for 4 epochs: the step leaves it waiting.
    let unstaked_epoch = env.pot(&id).await?["unstaked_epoch"].as_u64().unwrap();
    env.step(&env.outsider, "withdraw", &id).await?.into_result()?;
    assert_eq!(env.stage(&id).await?, "Unbonding");
    assert!(failure(env.step(&env.outsider, "distribute", &id).await).contains("the pot isn't ripe yet"));

    env.wait_epoch(&id, unstaked_epoch + 4).await?;
    env.step(&env.outsider, "withdraw", &id).await?.into_result()?;
    let pot = env.pot(&id).await?;
    assert_eq!(pot["stage"], "Ripe");
    let returned = amount(&pot["returned"]);
    assert_eq!(returned, in_pool, "credited exactly what the pool held");
    assert_eq!(env.pool_total().await?, 0);

    let before: Vec<u128> = futures_balances(&env).await?;
    env.step(&env.outsider, "distribute", &id).await?.into_result()?;
    let pot = env.pot(&id).await?;
    assert_eq!(pot["stage"], "Distributed");
    let after: Vec<u128> = futures_balances(&env).await?;
    let mut paid = 0u128;
    for (i, d) in deposits.iter().enumerate() {
        let payout = amount(&pot["payouts"][i]["amount"]);
        assert_eq!(pot["payouts"][i]["status"], "Paid");
        assert_eq!(after[i] - before[i], payout, "member {i} received exactly their payout");
        // Pro-rata: payout / returned == deposit / total, to within one yoctoNEAR.
        let exact = returned as f64 * (*d as f64 / total as f64);
        assert!((payout as f64 - exact).abs() <= exact * 1e-12 + 2.0, "member {i}: {payout} vs {exact}");
        assert!(payout > *d, "member {i} got their deposit back plus rewards");
        paid += payout;
    }
    assert_eq!(paid, returned, "not a yoctoNEAR lost or created");

    // The pool is free again for the other pot.
    env.step(&env.outsider, "stake", &other).await?.into_result()?;
    assert_eq!(env.stage(&other).await?, "Staked");
    Ok(())
}

async fn futures_balances(env: &Env) -> anyhow::Result<Vec<u128>> {
    let mut v = Vec::new();
    for m in &env.members {
        v.push(env.balance(m).await?);
    }
    Ok(v)
}

/// Nobody can redirect funds: the treasurer key can only call the four steps,
/// injected recipient arguments are ignored, callbacks are private, and an
/// outsider can't take anyone's deposit.
#[tokio::test]
async fn nobody_can_redirect_funds() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let (a, b) = (&env.members[0], &env.members[1]);
    let id = env.create(a, env.pool.id().as_str(), 60).await?;
    env.deposit(a, &id, 2 * NEAR).await?.into_result()?;
    env.deposit(b, &id, NEAR).await?.into_result()?;

    // A treasurer account whose only key may call stake/unstake/withdraw/distribute on the harvest contract.
    let t = env.worker.dev_create_account().await?;
    let key = SecretKey::from_random(KeyType::ED25519);
    t.batch(t.id())
        .add_key(key.public_key(), AccessKey::function_call_access(env.harvest.id(), &["stake", "unstake", "withdraw", "distribute"], None))
        .delete_key(t.secret_key().public_key())
        .transact()
        .await?
        .into_result()?;
    let treasurer = Account::from_secret_key(t.id().clone(), key, &env.worker);
    for method in ["cancel_deposit", "claim", "create_pot"] {
        let err = failure(treasurer.call(env.harvest.id(), method).args_json(json!({ "pot_id": id })).transact().await.map_err(Into::into));
        assert!(err.contains("MethodNameMismatch") || err.contains("does not allow method"), "{method}: {err}");
    }
    let err = failure(treasurer.transfer_near(env.outsider.id(), NearToken::from_yoctonear(1)).await.map_err(Into::into));
    assert!(err.contains("RequiresFullAccess") || err.contains("full access"), "{err}");

    // Injected recipients are ignored: the outsider gets nothing.
    let outsider_before = env.balance(&env.outsider).await?;
    env.wait_secs(&id, 61).await?;
    treasurer
        .call(env.harvest.id(), "stake")
        .args_json(json!({ "pot_id": id, "recipient": env.outsider.id(), "account_id": env.outsider.id() }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    assert_eq!(env.stage(&id).await?, "Staked");

    // Private callbacks can't be called from outside to credit a fake amount.
    let err = failure(
        env.outsider
            .call(env.harvest.id(), "on_withdrawn")
            .args_json(json!({ "pot_id": id, "amount": (1000 * NEAR).to_string() }))
            .transact()
            .await
            .map_err(Into::into),
    );
    assert!(err.contains("is private"), "{err}");
    assert!(failure(env.step(&env.outsider, "cancel_deposit", &id).await).contains("before staking starts"));
    assert!(failure(env.step(&env.outsider, "claim", &id).await).contains("nothing to claim"));
    assert!(env.balance(&env.outsider).await? <= outsider_before, "the outsider received nothing");
    Ok(())
}

/// If the pool refuses the stake, the pot is cancelled, the NEAR comes back,
/// and every depositor can take theirs back.
#[tokio::test]
async fn refused_stake_cancels_and_refunds() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let (a, b) = (&env.members[0], &env.members[1]);
    // A pool account with no contract: the stake call fails.
    let id = env.create(a, env.outsider.id().as_str(), 60).await?;
    env.deposit(a, &id, NEAR).await?.into_result()?;
    env.deposit(b, &id, 2 * NEAR).await?.into_result()?;
    env.wait_secs(&id, 61).await?;
    let _ = env.step(&env.outsider, "stake", &id).await?;
    assert_eq!(env.stage(&id).await?, "Cancelled");
    for (m, d) in [(a, NEAR), (b, 2 * NEAR)] {
        let before = env.balance(m).await?;
        env.step(m, "cancel_deposit", &id).await?.into_result()?;
        let after = env.balance(m).await?;
        assert!(after > before + d - NEAR / 100, "refunded");
    }
    assert_eq!(amount(&env.pot(&id).await?["total"]), 0);
    Ok(())
}
