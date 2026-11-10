//! Sandbox-only staking pool for testing Rota Harvest.
//!
//! Mirrors near/core-contracts `staking-pool` (the contract testnet and
//! mainnet pools run) where Harvest depends on it: the same method names and
//! JSON arguments, the same stake-share maths and rounding, the 4-epoch
//! unstaking delay, the same assertions, and rewards detected by `ping` as an
//! increase of the contract's balance (send NEAR to the pool to simulate them).
//! It doesn't run a validator: there is no stake action or locked balance.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const NUM_EPOCHS_TO_UNLOCK: u64 = 4;
const STAKE_SHARE_PRICE_GUARANTEE_FUND: u128 = 1_000_000_000_000;

#[near(serializers = [borsh])]
#[derive(Default, Clone)]
pub struct Account {
    unstaked: u128,
    stake_shares: u128,
    unstaked_available_epoch_height: u64,
}

#[near(serializers = [json])]
pub struct HumanReadableAccount {
    pub account_id: AccountId,
    pub unstaked_balance: U128,
    pub staked_balance: U128,
    pub can_withdraw: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    last_epoch_height: u64,
    last_total_balance: u128,
    total_staked_balance: u128,
    total_stake_shares: u128,
    accounts: LookupMap<AccountId, Account>,
}

#[near]
impl Contract {
    /// Like the real pool, the initial balance becomes stake that can't be withdrawn.
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        let balance = env::account_balance().as_yoctonear();
        let total_staked_balance = balance - STAKE_SHARE_PRICE_GUARANTEE_FUND;
        Self {
            owner_id,
            last_epoch_height: env::epoch_height(),
            last_total_balance: balance,
            total_staked_balance,
            total_stake_shares: total_staked_balance,
            accounts: LookupMap::new(b"u"),
        }
    }

    pub fn ping(&mut self) {
        self.internal_ping();
    }

    #[payable]
    pub fn deposit(&mut self) {
        self.internal_ping();
        self.internal_deposit();
    }

    #[payable]
    pub fn deposit_and_stake(&mut self) {
        self.internal_ping();
        let amount = self.internal_deposit();
        self.internal_stake(amount);
    }

    pub fn withdraw_all(&mut self) {
        self.internal_ping();
        let unstaked = self.account(&env::predecessor_account_id()).unstaked;
        self.internal_withdraw(unstaked);
    }

    pub fn withdraw(&mut self, amount: U128) {
        self.internal_ping();
        self.internal_withdraw(amount.0);
    }

    pub fn stake_all(&mut self) {
        self.internal_ping();
        let unstaked = self.account(&env::predecessor_account_id()).unstaked;
        self.internal_stake(unstaked);
    }

    pub fn stake(&mut self, amount: U128) {
        self.internal_ping();
        self.internal_stake(amount.0);
    }

    pub fn unstake_all(&mut self) {
        self.internal_ping();
        let shares = self.account(&env::predecessor_account_id()).stake_shares;
        let amount = self.staked_amount_from_num_shares_rounded_down(shares);
        self.inner_unstake(amount);
    }

    pub fn unstake(&mut self, amount: U128) {
        self.internal_ping();
        self.inner_unstake(amount.0);
    }

    pub fn get_account_unstaked_balance(&self, account_id: AccountId) -> U128 {
        self.get_account(account_id).unstaked_balance
    }

    pub fn get_account_staked_balance(&self, account_id: AccountId) -> U128 {
        self.get_account(account_id).staked_balance
    }

    pub fn get_account_total_balance(&self, account_id: AccountId) -> U128 {
        let a = self.get_account(account_id);
        U128(a.unstaked_balance.0 + a.staked_balance.0)
    }

    pub fn is_account_unstaked_balance_available(&self, account_id: AccountId) -> bool {
        self.get_account(account_id).can_withdraw
    }

    pub fn get_total_staked_balance(&self) -> U128 {
        U128(self.total_staked_balance)
    }

    pub fn get_owner_id(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_account(&self, account_id: AccountId) -> HumanReadableAccount {
        let a = self.account(&account_id);
        HumanReadableAccount {
            unstaked_balance: U128(a.unstaked),
            staked_balance: U128(self.staked_amount_from_num_shares_rounded_down(a.stake_shares)),
            can_withdraw: a.unstaked_available_epoch_height <= env::epoch_height(),
            account_id,
        }
    }
}

impl Contract {
    fn account(&self, id: &AccountId) -> Account {
        self.accounts.get(id).cloned().unwrap_or_default()
    }

    /// Like the real pool: a balance increase since the last call is a reward
    /// and raises the share price (this mock charges no owner fee).
    fn internal_ping(&mut self) {
        let total_balance = env::account_balance().as_yoctonear() - env::attached_deposit().as_yoctonear();
        if total_balance > self.last_total_balance {
            self.total_staked_balance += total_balance - self.last_total_balance;
        }
        self.last_total_balance = total_balance;
        self.last_epoch_height = env::epoch_height();
    }

    fn internal_deposit(&mut self) -> u128 {
        let id = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        let mut a = self.account(&id);
        a.unstaked += amount;
        self.accounts.insert(id, a);
        self.last_total_balance += amount;
        amount
    }

    fn internal_withdraw(&mut self, amount: u128) {
        require!(amount > 0, "Withdrawal amount should be positive");
        let id = env::predecessor_account_id();
        let mut a = self.account(&id);
        require!(a.unstaked >= amount, "Not enough unstaked balance to withdraw");
        require!(
            a.unstaked_available_epoch_height <= env::epoch_height(),
            "The unstaked balance is not yet available due to unstaking delay"
        );
        a.unstaked -= amount;
        self.accounts.insert(id.clone(), a);
        let _ = Promise::new(id).transfer(NearToken::from_yoctonear(amount));
        self.last_total_balance -= amount;
    }

    fn internal_stake(&mut self, amount: u128) {
        require!(amount > 0, "Staking amount should be positive");
        let id = env::predecessor_account_id();
        let mut a = self.account(&id);
        let num_shares = self.num_shares_from_staked_amount_rounded_down(amount);
        require!(num_shares > 0, "The calculated number of \"stake\" shares received for staking should be positive");
        let charge_amount = self.staked_amount_from_num_shares_rounded_down(num_shares);
        require!(charge_amount > 0, "Invariant violation. Calculated staked amount must be positive");
        require!(a.unstaked >= charge_amount, "Not enough unstaked balance to stake");
        a.unstaked -= charge_amount;
        a.stake_shares += num_shares;
        self.accounts.insert(id, a);
        let stake_amount = self.staked_amount_from_num_shares_rounded_up(num_shares);
        self.total_staked_balance += stake_amount;
        self.total_stake_shares += num_shares;
    }

    fn inner_unstake(&mut self, amount: u128) {
        require!(amount > 0, "Unstaking amount should be positive");
        let id = env::predecessor_account_id();
        let mut a = self.account(&id);
        require!(self.total_staked_balance > 0, "The contract doesn't have staked balance");
        let num_shares = self.num_shares_from_staked_amount_rounded_up(amount);
        require!(num_shares > 0, "Invariant violation. The calculated number of \"stake\" shares for unstaking should be positive");
        require!(a.stake_shares >= num_shares, "Not enough staked balance to unstake");
        let receive_amount = self.staked_amount_from_num_shares_rounded_up(num_shares);
        a.stake_shares -= num_shares;
        a.unstaked += receive_amount;
        a.unstaked_available_epoch_height = env::epoch_height() + NUM_EPOCHS_TO_UNLOCK;
        self.accounts.insert(id, a);
        let unstake_amount = self.staked_amount_from_num_shares_rounded_down(num_shares);
        self.total_staked_balance -= unstake_amount;
        self.total_stake_shares -= num_shares;
    }

    fn num_shares_from_staked_amount_rounded_down(&self, amount: u128) -> u128 {
        mul_div(amount, self.total_stake_shares, self.total_staked_balance).0
    }

    fn num_shares_from_staked_amount_rounded_up(&self, amount: u128) -> u128 {
        let (q, r) = mul_div(amount, self.total_stake_shares, self.total_staked_balance);
        q + (r > 0) as u128
    }

    fn staked_amount_from_num_shares_rounded_down(&self, shares: u128) -> u128 {
        mul_div(shares, self.total_staked_balance, self.total_stake_shares).0
    }

    fn staked_amount_from_num_shares_rounded_up(&self, shares: u128) -> u128 {
        let (q, r) = mul_div(shares, self.total_staked_balance, self.total_stake_shares);
        q + (r > 0) as u128
    }
}

/// floor(a * b / d) and the remainder, with a 256-bit intermediate (the real pool uses U256).
fn mul_div(a: u128, b: u128, d: u128) -> (u128, u128) {
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
