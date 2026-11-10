//! Rota Harvest: group staking pots (testnet only for now).
//!
//! Members deposit NEAR into a pot while it's filling. Then the whole pot is
//! staked with one validator pool, fixed when the pot is created, for a fixed
//! number of epochs. After the term it's unstaked, withdrawn once the pool's
//! unstaking delay has passed (4 epochs), and distributed: every depositor
//! gets back their deposit plus rewards, pro-rata by deposit.
//!
//! Safety model, as in the circle contract:
//! - Funds only ever go back to depositors, pro-rata. No method takes a recipient.
//! - The lifecycle steps `stake`, `unstake`, `withdraw` and `distribute` are
//!   permissionless and check their own preconditions, so a settle-style
//!   treasurer key limited to those four methods can drive a pot and do
//!   nothing else.
//! - Depositors can take their deposit back only before staking starts.
//! - Only one pot per pool can be staked or unbonding at a time, so this
//!   contract's balance in a pool always belongs to exactly one pot.
//! - `withdraw` reads the pool's unstaked balance first and withdraws exactly
//!   that amount, so a pot is credited only with what the pool returned.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, Promise, PromiseOrValue};

pub const MAX_DEPOSITORS: usize = 20;
pub const MIN_DEPOSIT: NearToken = NearToken::from_millinear(100);
/// Paid by the pot's creator and kept: covers the pot's storage with 20 depositors.
pub const POT_STORAGE_FEE: NearToken = NearToken::from_millinear(50);
pub const MAX_FILL_SEC: u64 = 30 * 86_400;
pub const MAX_TERM_EPOCHS: u64 = 1_000;
/// The staking pool's unstaking delay (near/core-contracts staking-pool NUM_EPOCHS_TO_UNLOCK).
pub const POOL_UNLOCK_EPOCHS: u64 = 4;

const GAS_POOL_CALL: Gas = Gas::from_tgas(60);
const GAS_POOL_VIEW: Gas = Gas::from_tgas(10);
const GAS_ON_STEP: Gas = Gas::from_tgas(15);
/// The withdraw check also calls the pool's `withdraw` and its callback.
const GAS_ON_WITHDRAW_CHECK: Gas = Gas::from_tgas(100);
const GAS_ON_PAID: Gas = Gas::from_tgas(10);

#[ext_contract(ext_pool)]
#[allow(dead_code)]
trait StakingPool {
    fn deposit_and_stake(&mut self);
    fn unstake_all(&mut self);
    fn withdraw(&mut self, amount: U128);
    fn get_account_unstaked_balance(&self, account_id: AccountId) -> U128;
    fn is_account_unstaked_balance_available(&self, account_id: AccountId) -> bool;
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    /// Deposits open (until `fill_ends_ms`); depositors can take their deposit back.
    Filling,
    /// `deposit_and_stake` sent to the pool.
    Staking,
    /// Staked; `unstake` is allowed from epoch `staked_epoch + term_epochs`.
    Staked,
    /// `unstake_all` sent to the pool.
    Unstaking,
    /// Unstaked; the pool releases it 4 epochs later.
    Unbonding,
    /// Reading the pool's balance and withdrawing it.
    Withdrawing,
    /// Withdrawn from the pool: ready to distribute.
    Ripe,
    /// Everyone has been paid (or has a claimable payout).
    Distributed,
    /// Staking failed or nobody deposited; depositors take their deposits back.
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Deposit {
    pub account_id: AccountId,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PayoutStatus {
    Pending,
    Paid,
    Claimable,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Payout {
    pub account_id: AccountId,
    pub amount: U128,
    pub status: PayoutStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Pot {
    pub id: U64,
    pub name: String,
    pub creator: AccountId,
    pub pool_id: AccountId,
    pub fill_ends_ms: u64,
    pub term_epochs: u64,
    pub stage: Stage,
    pub deposits: Vec<Deposit>,
    pub total: U128,
    pub staked_at_ms: Option<u64>,
    pub staked_epoch: Option<u64>,
    pub unstaked_at_ms: Option<u64>,
    pub unstaked_epoch: Option<u64>,
    /// Exactly what the pool returned on withdraw.
    pub returned: U128,
    pub distributed_at_ms: Option<u64>,
    pub payouts: Vec<Payout>,
}

#[near(serializers = [json])]
pub struct PotStatus {
    pub id: U64,
    pub stage: Stage,
    pub now_ms: u64,
    pub epoch_height: u64,
    pub fill_ends_ms: u64,
    pub can_stake: bool,
    /// The first epoch in which `unstake` is allowed (once staked).
    pub unstake_from_epoch: Option<u64>,
    pub can_unstake: bool,
    /// The epoch from which the pool should release the funds (once unstaked).
    pub withdrawable_from_epoch: Option<u64>,
    pub can_distribute: bool,
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Pots,
    ByAccount,
    BusyPools,
}

#[near(contract_state)]
pub struct Contract {
    pots: LookupMap<u64, Pot>,
    next_id: u64,
    by_account: LookupMap<AccountId, Vec<u64>>,
    /// Pool → the pot currently staked or unbonding there.
    busy_pools: LookupMap<AccountId, u64>,
}

impl Default for Contract {
    fn default() -> Self {
        Self {
            pots: LookupMap::new(StorageKey::Pots),
            next_id: 0,
            by_account: LookupMap::new(StorageKey::ByAccount),
            busy_pools: LookupMap::new(StorageKey::BusyPools),
        }
    }
}

#[near]
impl Contract {
    // ------------------------------------------------------------ setup

    /// Creates a pot. Attach at least 0.05 NEAR (kept for storage).
    /// `fill_sec`: how long deposits stay open. `term_epochs`: how many epochs
    /// the pot stays staked before it can be unstaked.
    #[payable]
    pub fn create_pot(&mut self, name: String, pool_id: AccountId, fill_sec: u64, term_epochs: u64) -> U64 {
        require!(env::attached_deposit() >= POT_STORAGE_FEE, "attach at least 0.05 NEAR for storage");
        require!(!name.trim().is_empty() && name.len() <= 60, "name must be 1 to 60 characters");
        require!(fill_sec >= 60 && fill_sec <= MAX_FILL_SEC, "the filling window must be 1 minute to 30 days");
        require!(term_epochs >= 1 && term_epochs <= MAX_TERM_EPOCHS, "the term must be 1 to 1000 epochs");
        let id = self.next_id;
        self.next_id += 1;
        let creator = env::predecessor_account_id();
        let pot = Pot {
            id: U64(id),
            name,
            creator: creator.clone(),
            pool_id,
            fill_ends_ms: env::block_timestamp_ms() + fill_sec * 1000,
            term_epochs,
            stage: Stage::Filling,
            deposits: vec![],
            total: U128(0),
            staked_at_ms: None,
            staked_epoch: None,
            unstaked_at_ms: None,
            unstaked_epoch: None,
            returned: U128(0),
            distributed_at_ms: None,
            payouts: vec![],
        };
        self.index(&creator, id);
        emit("pot_created", json!({ "pot_id": U64(id), "pool_id": pot.pool_id, "fill_ends_ms": pot.fill_ends_ms, "term_epochs": term_epochs }));
        self.pots.insert(id, pot);
        U64(id)
    }

    /// Deposits the attached NEAR (at least 0.1) into a filling pot.
    #[payable]
    pub fn deposit(&mut self, pot_id: U64) {
        let mut pot = self.pot(pot_id);
        let amount = env::attached_deposit().as_yoctonear();
        let who = env::predecessor_account_id();
        require!(pot.stage == Stage::Filling, "the pot isn't taking deposits");
        require!(env::block_timestamp_ms() < pot.fill_ends_ms, "the filling window has closed");
        require!(amount >= MIN_DEPOSIT.as_yoctonear(), "deposit at least 0.1 NEAR");
        match pot.deposits.iter_mut().find(|d| d.account_id == who) {
            Some(d) => d.amount = U128(d.amount.0 + amount),
            None => {
                require!(pot.deposits.len() < MAX_DEPOSITORS, "the pot already has 20 depositors");
                pot.deposits.push(Deposit { account_id: who.clone(), amount: U128(amount) });
                self.index(&who, pot_id.0);
            }
        }
        pot.total = U128(pot.total.0 + amount);
        emit("deposited", json!({ "pot_id": pot_id, "account_id": who, "amount": U128(amount) }));
        self.pots.insert(pot_id.0, pot);
    }

    /// Takes the caller's whole deposit back. Only before staking starts (or if staking failed).
    pub fn cancel_deposit(&mut self, pot_id: U64) -> U128 {
        let mut pot = self.pot(pot_id);
        let who = env::predecessor_account_id();
        require!(
            pot.stage == Stage::Filling || pot.stage == Stage::Cancelled,
            "deposits can only be taken back before staking starts"
        );
        let i = pot.deposits.iter().position(|d| d.account_id == who).unwrap_or_else(|| env::panic_str("you have no deposit in this pot"));
        let d = pot.deposits.remove(i);
        pot.total = U128(pot.total.0 - d.amount.0);
        self.pots.insert(pot_id.0, pot);
        emit("deposit_cancelled", json!({ "pot_id": pot_id, "account_id": who, "amount": d.amount }));
        let _ = Promise::new(who).transfer(NearToken::from_yoctonear(d.amount.0));
        d.amount
    }

    // ------------------------------------------------------------ lifecycle (permissionless)

    /// After the filling window: stakes the whole pot with its pool.
    pub fn stake(&mut self, pot_id: U64) -> PromiseOrValue<()> {
        let mut pot = self.pot(pot_id);
        require!(pot.stage == Stage::Filling, "the pot isn't filling");
        require!(env::block_timestamp_ms() >= pot.fill_ends_ms, "the filling window is still open");
        if pot.total.0 == 0 {
            pot.stage = Stage::Cancelled;
            self.pots.insert(pot_id.0, pot);
            emit("pot_cancelled", json!({ "pot_id": pot_id, "reason": "no deposits" }));
            return PromiseOrValue::Value(());
        }
        require!(!self.busy_pools.contains_key(&pot.pool_id), "another pot is staked in this pool; try again after it's withdrawn");
        self.busy_pools.insert(pot.pool_id.clone(), pot_id.0);
        pot.stage = Stage::Staking;
        let (pool, total) = (pot.pool_id.clone(), pot.total.0);
        self.pots.insert(pot_id.0, pot);
        PromiseOrValue::Promise(
            ext_pool::ext(pool)
                .with_attached_deposit(NearToken::from_yoctonear(total))
                .with_static_gas(GAS_POOL_CALL)
                .deposit_and_stake()
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_STEP).on_staked(pot_id)),
        )
    }

    /// After the term: unstakes everything from the pool.
    pub fn unstake(&mut self, pot_id: U64) -> Promise {
        let mut pot = self.pot(pot_id);
        require!(pot.stage == Stage::Staked, "the pot isn't staked");
        let from = pot.staked_epoch.unwrap() + pot.term_epochs;
        require!(env::epoch_height() >= from, format!("the term ends at epoch {from}; it's epoch {} now", env::epoch_height()));
        pot.stage = Stage::Unstaking;
        let pool = pot.pool_id.clone();
        self.pots.insert(pot_id.0, pot);
        ext_pool::ext(pool)
            .with_static_gas(GAS_POOL_CALL)
            .unstake_all()
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_STEP).on_unstaked(pot_id))
    }

    /// After the pool's unstaking delay: withdraws exactly the pool's unstaked balance.
    pub fn withdraw(&mut self, pot_id: U64) -> Promise {
        let mut pot = self.pot(pot_id);
        require!(pot.stage == Stage::Unbonding, "the pot isn't waiting to be withdrawn");
        pot.stage = Stage::Withdrawing;
        let pool = pot.pool_id.clone();
        self.pots.insert(pot_id.0, pot);
        let me = env::current_account_id();
        ext_pool::ext(pool.clone())
            .with_static_gas(GAS_POOL_VIEW)
            .get_account_unstaked_balance(me.clone())
            .and(ext_pool::ext(pool).with_static_gas(GAS_POOL_VIEW).is_account_unstaked_balance_available(me))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_WITHDRAW_CHECK).on_withdraw_check(pot_id))
    }

    /// Pays every depositor their share of what the pool returned, pro-rata by deposit.
    pub fn distribute(&mut self, pot_id: U64) {
        let mut pot = self.pot(pot_id);
        require!(pot.stage == Stage::Ripe, "the pot isn't ripe yet");
        let returned = pot.returned.0;
        let storage = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        require!(
            env::account_balance().as_yoctonear() >= returned + storage,
            "the pool's transfer hasn't arrived yet; try again in a few seconds"
        );
        let weights: Vec<u128> = pot.deposits.iter().map(|d| d.amount.0).collect();
        let shares = split(returned, &weights);
        pot.payouts = pot
            .deposits
            .iter()
            .zip(&shares)
            .map(|(d, s)| Payout { account_id: d.account_id.clone(), amount: U128(*s), status: PayoutStatus::Pending })
            .collect();
        pot.stage = Stage::Distributed;
        pot.distributed_at_ms = Some(env::block_timestamp_ms());
        emit("distributed", json!({ "pot_id": pot_id, "returned": pot.returned, "total_deposits": pot.total, "payouts": pot.payouts }));
        let payouts = pot.payouts.clone();
        self.pots.insert(pot_id.0, pot);
        for (i, p) in payouts.iter().enumerate() {
            pay(pot_id, i as u32, &p.account_id, p.amount.0);
        }
    }

    /// Re-sends a payout whose transfer failed, to the depositor only.
    pub fn claim(&mut self, pot_id: U64) {
        let mut pot = self.pot(pot_id);
        let who = env::predecessor_account_id();
        let i = pot
            .payouts
            .iter()
            .position(|p| p.account_id == who && p.status == PayoutStatus::Claimable)
            .unwrap_or_else(|| env::panic_str("nothing to claim"));
        pot.payouts[i].status = PayoutStatus::Pending;
        let amount = pot.payouts[i].amount.0;
        self.pots.insert(pot_id.0, pot);
        pay(pot_id, i as u32, &who, amount);
    }

    // ------------------------------------------------------------ callbacks

    #[private]
    pub fn on_staked(&mut self, pot_id: U64) {
        let mut pot = self.pot(pot_id);
        if env::promise_result_checked(0, 64).is_ok() {
            pot.stage = Stage::Staked;
            pot.staked_at_ms = Some(env::block_timestamp_ms());
            pot.staked_epoch = Some(env::epoch_height());
            emit("staked", json!({ "pot_id": pot_id, "pool_id": pot.pool_id, "amount": pot.total, "epoch": env::epoch_height() }));
        } else {
            // The attached NEAR came back with the failed call; depositors take it back.
            pot.stage = Stage::Cancelled;
            self.busy_pools.remove(&pot.pool_id);
            emit("pot_cancelled", json!({ "pot_id": pot_id, "reason": "the pool refused the stake" }));
        }
        self.pots.insert(pot_id.0, pot);
    }

    #[private]
    pub fn on_unstaked(&mut self, pot_id: U64) {
        let mut pot = self.pot(pot_id);
        if env::promise_result_checked(0, 64).is_ok() {
            pot.stage = Stage::Unbonding;
            pot.unstaked_at_ms = Some(env::block_timestamp_ms());
            pot.unstaked_epoch = Some(env::epoch_height());
            emit("unstaked", json!({ "pot_id": pot_id, "epoch": env::epoch_height() }));
        } else {
            pot.stage = Stage::Staked;
        }
        self.pots.insert(pot_id.0, pot);
    }

    #[private]
    pub fn on_withdraw_check(&mut self, pot_id: U64) -> PromiseOrValue<()> {
        let mut pot = self.pot(pot_id);
        let balance = env::promise_result_checked(0, 64).ok().and_then(|b| near_sdk::serde_json::from_slice::<U128>(&b).ok());
        let available = env::promise_result_checked(1, 64).ok().and_then(|b| near_sdk::serde_json::from_slice::<bool>(&b).ok());
        match (balance, available) {
            (Some(U128(amount)), Some(true)) if amount > 0 => {
                let pool = pot.pool_id.clone();
                self.pots.insert(pot_id.0, pot);
                PromiseOrValue::Promise(
                    ext_pool::ext(pool)
                        .with_static_gas(GAS_POOL_CALL)
                        .withdraw(U128(amount))
                        .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_STEP).on_withdrawn(pot_id, U128(amount))),
                )
            }
            _ => {
                pot.stage = Stage::Unbonding;
                self.pots.insert(pot_id.0, pot);
                emit("not_yet_withdrawable", json!({ "pot_id": pot_id, "epoch": env::epoch_height() }));
                PromiseOrValue::Value(())
            }
        }
    }

    #[private]
    pub fn on_withdrawn(&mut self, pot_id: U64, amount: U128) {
        let mut pot = self.pot(pot_id);
        if env::promise_result_checked(0, 64).is_ok() {
            pot.stage = Stage::Ripe;
            pot.returned = amount;
            self.busy_pools.remove(&pot.pool_id);
            emit("ripe", json!({ "pot_id": pot_id, "returned": amount, "deposits": pot.total }));
        } else {
            pot.stage = Stage::Unbonding;
        }
        self.pots.insert(pot_id.0, pot);
    }

    #[private]
    pub fn on_paid(&mut self, pot_id: U64, index: u32) {
        let mut pot = self.pot(pot_id);
        let p = &mut pot.payouts[index as usize];
        p.status = if env::promise_result_checked(0, 64).is_ok() { PayoutStatus::Paid } else { PayoutStatus::Claimable };
        self.pots.insert(pot_id.0, pot);
    }

    // ------------------------------------------------------------ views

    pub fn get_pot(&self, pot_id: U64) -> Option<Pot> {
        self.pots.get(&pot_id.0).cloned()
    }

    pub fn get_pot_count(&self) -> U64 {
        U64(self.next_id)
    }

    pub fn list_pots_for(&self, account_id: AccountId) -> Vec<U64> {
        self.by_account.get(&account_id).map(|v| v.iter().map(|i| U64(*i)).collect()).unwrap_or_default()
    }

    pub fn get_status(&self, pot_id: U64) -> PotStatus {
        let pot = self.pot(pot_id);
        let now = env::block_timestamp_ms();
        let epoch = env::epoch_height();
        let unstake_from_epoch = pot.staked_epoch.map(|e| e + pot.term_epochs);
        let withdrawable_from_epoch = pot.unstaked_epoch.map(|e| e + POOL_UNLOCK_EPOCHS);
        PotStatus {
            id: pot_id,
            stage: pot.stage,
            now_ms: now,
            epoch_height: epoch,
            fill_ends_ms: pot.fill_ends_ms,
            can_stake: pot.stage == Stage::Filling && now >= pot.fill_ends_ms && !self.busy_pools.contains_key(&pot.pool_id),
            unstake_from_epoch,
            can_unstake: pot.stage == Stage::Staked && unstake_from_epoch.is_some_and(|e| epoch >= e),
            withdrawable_from_epoch,
            can_distribute: pot.stage == Stage::Ripe,
        }
    }

    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

impl Contract {
    fn pot(&self, id: U64) -> Pot {
        self.pots.get(&id.0).cloned().unwrap_or_else(|| env::panic_str("unknown pot"))
    }

    fn index(&mut self, account: &AccountId, id: u64) {
        let mut v = self.by_account.get(account).cloned().unwrap_or_default();
        if !v.contains(&id) {
            v.push(id);
            self.by_account.insert(account.clone(), v);
        }
    }
}

fn pay(pot_id: U64, index: u32, to: &AccountId, amount: u128) {
    if amount == 0 {
        return;
    }
    let _ = Promise::new(to.clone())
        .transfer(NearToken::from_yoctonear(amount))
        .then(Contract::ext(env::current_account_id()).with_static_gas(GAS_ON_PAID).on_paid(pot_id, index));
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "rota-harvest", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

/// Splits `total` pro-rata by `weights`: each share is floor(total * w / sum),
/// and the yoctoNEAR left over by rounding go one each to the largest
/// remainders (ties to the earlier depositor). Shares always sum to `total`.
pub fn split(total: u128, weights: &[u128]) -> Vec<u128> {
    let sum: u128 = weights.iter().sum();
    if sum == 0 {
        return vec![0; weights.len()];
    }
    let mut shares = Vec::with_capacity(weights.len());
    let mut remainders = Vec::with_capacity(weights.len());
    for (i, w) in weights.iter().enumerate() {
        let (q, r) = mul_div(total, *w, sum);
        shares.push(q);
        remainders.push((r, i));
    }
    let dust = total - shares.iter().sum::<u128>();
    remainders.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    for (_, i) in remainders.into_iter().take(dust as usize) {
        shares[i] += 1;
    }
    shares
}

/// floor(a * b / d) and the remainder, with a 256-bit intermediate. Requires a * b / d < 2^128.
pub fn mul_div(a: u128, b: u128, d: u128) -> (u128, u128) {
    const LO: u128 = u64::MAX as u128;
    let (a1, a0) = (a >> 64, a & LO);
    let (b1, b0) = (b >> 64, b & LO);
    let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
    let mid = (p00 >> 64) + (p01 & LO) + (p10 & LO);
    let lo = (p00 & LO) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    require!(hi < d, "mul_div overflow");
    let (mut q, mut r) = (0u128, hi);
    for i in (0..128).rev() {
        let carry = r >> 127;
        r = (r << 1) | ((lo >> i) & 1);
        q <<= 1;
        if carry == 1 || r >= d {
            r = r.wrapping_sub(d);
            q |= 1;
        }
    }
    (q, r)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEAR: u128 = 10u128.pow(24);

    #[test]
    fn split_is_exact_and_pro_rata_with_uneven_deposits() {
        let weights = [3 * NEAR, NEAR + 7, 2 * NEAR / 3, 5 * NEAR + 1];
        let total = weights.iter().sum::<u128>() + 12_345_678_901_234_567_890;
        let shares = split(total, &weights);
        assert_eq!(shares.iter().sum::<u128>(), total, "every yoctoNEAR is handed out");
        let sum: u128 = weights.iter().sum();
        for (s, w) in shares.iter().zip(weights) {
            let (exact, _) = mul_div(total, w, sum);
            assert!(*s == exact || *s == exact + 1, "within 1 yocto of the exact share");
            assert!(*s >= w, "nobody gets back less than they deposited when there are rewards");
        }
    }

    #[test]
    fn rounding_dust_goes_to_the_largest_remainders() {
        // 10 yocto over weights 1:1:1 → 3,3,3 and 1 yocto of dust to the first (all remainders tie).
        assert_eq!(split(10, &[1, 1, 1]), vec![4, 3, 3]);
        // 100 over 1:2 → 33.33 and 66.67: the dust yocto goes to the larger remainder.
        assert_eq!(split(100, &[1, 2]), vec![33, 67]);
        // Losses (the pool returned less) are shared the same way.
        assert_eq!(split(5, &[2, 2, 1]), vec![2, 2, 1]);
        assert_eq!(split(0, &[1, 2]), vec![0, 0]);
    }

    #[test]
    fn mul_div_handles_256_bit_products() {
        let big = 10u128.pow(30); // a million NEAR in yocto
        let (q, r) = mul_div(big, big, big);
        assert_eq!((q, r), (big, 0));
        let (q, r) = mul_div(u128::MAX, 3, 7);
        assert_eq!(q, u128::MAX / 7 * 3 + (u128::MAX % 7) * 3 / 7);
        assert!(r < 7);
    }

    #[test]
    fn many_depositors_never_lose_a_yocto() {
        let weights: Vec<u128> = (1..=20).map(|i| i * NEAR / 7 + i * 13).collect();
        for extra in [0u128, 1, 999, 123_456_789_123_456_789] {
            let total = weights.iter().sum::<u128>() + extra;
            assert_eq!(split(total, &weights).iter().sum::<u128>(), total);
        }
    }
}
