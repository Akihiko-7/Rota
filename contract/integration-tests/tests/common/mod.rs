//! Shared sandbox setup: a mock USDC, the circle contract, and funded members.
#![allow(dead_code)]

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};
use tokio::sync::OnceCell;

pub const USDC: u128 = 1_000_000; // 6 decimals
pub const CONTRIBUTION: u128 = 10 * USDC;
pub const ROUND_SEC: u64 = 60;
pub const GRACE_SEC: u64 = 30;

static CIRCLE_WASM: OnceCell<Vec<u8>> = OnceCell::const_new();
static FT_WASM: OnceCell<Vec<u8>> = OnceCell::const_new();

pub async fn circle_wasm() -> &'static [u8] {
    CIRCLE_WASM
        .get_or_init(|| async { near_workspaces::compile_project("../circle").await.unwrap() })
        .await
}

pub async fn ft_wasm() -> &'static [u8] {
    FT_WASM
        .get_or_init(|| async {
            near_workspaces::compile_project("../mock-ft")
                .await
                .unwrap()
        })
        .await
}

pub struct Env {
    pub worker: Worker<Sandbox>,
    pub circle: Contract,
    pub ft: Contract,
    pub members: Vec<Account>,
    pub outsider: Account,
}

/// Deploys both contracts and creates `n` members plus one outsider, each
/// holding 1,000 mock USDC.
pub async fn setup(n: usize) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let ft = deploy_ft(&worker).await?;
    let circle = worker.dev_deploy(circle_wasm().await).await?;
    let mut members = Vec::new();
    for _ in 0..n {
        members.push(funded_account(&worker, &ft).await?);
    }
    let outsider = funded_account(&worker, &ft).await?;
    Ok(Env {
        worker,
        circle,
        ft,
        members,
        outsider,
    })
}

pub async fn deploy_ft(worker: &Worker<Sandbox>) -> anyhow::Result<Contract> {
    let ft = worker.dev_deploy(ft_wasm().await).await?;
    ft.call("new")
        .args_json(json!({ "symbol": "USDC", "decimals": 6 }))
        .transact()
        .await?
        .into_result()?;
    Ok(ft)
}

pub async fn funded_account(worker: &Worker<Sandbox>, ft: &Contract) -> anyhow::Result<Account> {
    let a = worker.dev_create_account().await?;
    a.call(ft.id(), "storage_deposit")
        .args_json(json!({ "account_id": a.id() }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    ft.call("mint")
        .args_json(json!({ "account_id": a.id(), "amount": (1_000 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    Ok(a)
}

impl Env {
    pub fn ids(&self) -> Vec<AccountId> {
        self.members.iter().map(|m| m.id().clone()).collect()
    }

    pub async fn create_circle(&self, creator: &Account, bond: u128) -> anyhow::Result<u64> {
        let res = creator
            .call(self.circle.id(), "create_circle")
            .args_json(json!({ "config": {
                "name": "Test circle",
                "token": self.ft.id(),
                "contribution": CONTRIBUTION.to_string(),
                "members": self.ids(),
                "round_duration_sec": ROUND_SEC,
                "grace_period_sec": GRACE_SEC,
                "early_slot_bond": bond.to_string(),
            }}))
            .deposit(NearToken::from_millinear(200))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
        Ok(res.json::<String>()?.parse()?)
    }

    pub async fn join_all(&self, id: u64) -> anyhow::Result<()> {
        for m in &self.members {
            m.call(self.circle.id(), "join")
                .args_json(json!({ "circle_id": id.to_string() }))
                .deposit(NearToken::from_millinear(50))
                .max_gas()
                .transact()
                .await?
                .into_result()?;
        }
        Ok(())
    }

    pub async fn start(&self, by: &Account, id: u64) -> anyhow::Result<ExecutionFinalResult> {
        Ok(by
            .call(self.circle.id(), "start")
            .args_json(json!({ "circle_id": id.to_string() }))
            .transact()
            .await?)
    }

    /// Creates, joins and starts a circle with no bonds.
    pub async fn active_circle(&self) -> anyhow::Result<u64> {
        let id = self.create_circle(&self.members[0], 0).await?;
        self.join_all(id).await?;
        self.start(&self.members[0], id).await?.into_result()?;
        Ok(id)
    }

    /// `ft_transfer_call` from `from` to the circle contract on `token`.
    pub async fn pay_with(
        &self,
        token: &AccountId,
        from: &Account,
        id: u64,
        kind: &str,
        amount: u128,
    ) -> anyhow::Result<ExecutionFinalResult> {
        Ok(from
            .call(token, "ft_transfer_call")
            .args_json(json!({
                "receiver_id": self.circle.id(),
                "amount": amount.to_string(),
                "msg": json!({ "circle_id": id.to_string(), "kind": kind }).to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?)
    }

    pub async fn pay(
        &self,
        from: &Account,
        id: u64,
        kind: &str,
        amount: u128,
    ) -> anyhow::Result<ExecutionFinalResult> {
        self.pay_with(self.ft.id(), from, id, kind, amount).await
    }

    pub async fn contribute(&self, from: &Account, id: u64) -> anyhow::Result<()> {
        let res = self.pay(from, id, "contribution", CONTRIBUTION).await?;
        assert!(res.is_success(), "{res:?}");
        assert_eq!(
            used(&res),
            CONTRIBUTION,
            "contribution not accepted: {:?}",
            res.logs()
        );
        Ok(())
    }

    pub async fn settle(&self, by: &Account, id: u64) -> anyhow::Result<ExecutionFinalResult> {
        Ok(by
            .call(self.circle.id(), "settle")
            .args_json(json!({ "circle_id": id.to_string() }))
            .max_gas()
            .transact()
            .await?)
    }

    pub async fn balance(&self, account: &AccountId) -> anyhow::Result<u128> {
        let v: String = self
            .ft
            .view("ft_balance_of")
            .args_json(json!({ "account_id": account }))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    pub async fn circle_view(&self, id: u64) -> anyhow::Result<Value> {
        Ok(self
            .circle
            .view("get_circle")
            .args_json(json!({ "circle_id": id.to_string() }))
            .await?
            .json()?)
    }

    pub async fn round_status(&self, id: u64) -> anyhow::Result<Value> {
        Ok(self
            .circle
            .view("get_round_status")
            .args_json(json!({ "circle_id": id.to_string() }))
            .await?
            .json()?)
    }

    pub async fn reputation(&self, account: &AccountId) -> anyhow::Result<Value> {
        Ok(self
            .circle
            .view("get_reputation")
            .args_json(json!({ "account_id": account }))
            .await?
            .json()?)
    }

    pub async fn order(&self, id: u64) -> anyhow::Result<Vec<AccountId>> {
        Ok(serde_json::from_value(
            self.circle_view(id).await?["order"].clone(),
        )?)
    }

    pub fn member(&self, id: &AccountId) -> &Account {
        self.members.iter().find(|m| m.id() == id).unwrap()
    }

    /// Moves sandbox time past the current round's grace period.
    pub async fn pass_grace(&self, id: u64) -> anyhow::Result<()> {
        let status = self.round_status(id).await?;
        let target = status["grace_ends_ms"].as_u64().unwrap();
        loop {
            let now = self.worker.view_block().await?.timestamp() / 1_000_000;
            if now > target {
                return Ok(());
            }
            // about 0.3 s of block time per fast-forwarded block
            self.worker.fast_forward((target - now) / 250 + 10).await?;
        }
    }
}

/// Tokens the receiver kept from an `ft_transfer_call` (the call's return value).
pub fn used(res: &ExecutionFinalResult) -> u128 {
    res.clone()
        .json::<String>()
        .map(|s| s.parse().unwrap())
        .unwrap_or(0)
}

/// All logs as one string, for asserting on rejection reasons.
pub fn logs(res: &ExecutionFinalResult) -> String {
    res.logs().join("\n")
}

/// A treasurer account that holds only a function-call key for `settle` on the
/// circle contract (unlimited allowance). Its full-access key is deleted.
pub async fn treasurer(env: &Env) -> anyhow::Result<Account> {
    use near_workspaces::types::{KeyType, SecretKey};
    let t = env.worker.dev_create_account().await?;
    let fc_key = SecretKey::from_random(KeyType::ED25519);
    t.batch(t.id())
        .add_key(
            fc_key.public_key(),
            near_workspaces::AccessKey::function_call_access(env.circle.id(), &["settle"], None),
        )
        .delete_key(t.secret_key().public_key())
        .transact()
        .await?
        .into_result()?;
    Ok(Account::from_secret_key(
        t.id().clone(),
        fc_key,
        &env.worker,
    ))
}

/// Error text of a call that must fail (rejected by RPC or failed in execution).
pub fn failure(res: anyhow::Result<ExecutionFinalResult>) -> String {
    match res {
        Err(e) => format!("{e:?}"),
        Ok(r) if r.is_failure() => format!("{:?}", r.into_result().unwrap_err()),
        Ok(r) => panic!("expected failure, got success: {:?}", r.logs()),
    }
}
