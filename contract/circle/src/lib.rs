//! Rota circle contract.
//!
//! Holds contributions and bonds for rotating savings circles and pays each
//! round's pot to the member the payout order names. There is no owner and no
//! admin method. Tokens leave the contract only through:
//!
//! 1. `settle`: the round's pot to `order[current_round]`, plus remaining bonds
//!    to their owners when the last round settles;
//! 2. `claim`: a member withdrawing what a failed transfer left them;
//! 3. a unanimous dissolve: refunds of the current round's contributions and of
//!    all bonds;
//! 4. bond slashing, which moves a defaulter's bond into the round's pot (and so
//!    out through 1).
//!
//! No method takes a recipient argument.

mod events;
mod types;

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    Promise, PromiseOrValue,
};

pub use types::*;

pub const MIN_MEMBERS: usize = 2;
pub const MAX_MEMBERS: usize = 10;
pub const MIN_ROUND_DURATION_SEC: u64 = 60;
pub const MAX_ROUND_DURATION_SEC: u64 = 366 * 24 * 3600;
pub const MAX_GRACE_PERIOD_SEC: u64 = 30 * 24 * 3600;
const MAX_NAME_LEN: usize = 64;

/// What standard NEP-141 tokens (including USDC on NEAR) charge to register an account.
pub const TOKEN_STORAGE_DEPOSIT: NearToken = NearToken::from_micronear(1_250);
/// Storage reserved per member at creation for state that grows later
/// (round history, swap proposals, dissolve votes). Worst case with 64-byte
/// account names is about 1,005 bytes per member.
const RESERVED_BYTES_PER_MEMBER: u64 = 1_200;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_ON_TRANSFER_RESOLVED: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Circles,
    Reputation,
    CirclesByAccount,
}

#[near(contract_state)]
pub struct Contract {
    circles: LookupMap<u64, Circle>,
    next_id: u64,
    reputation: LookupMap<AccountId, Reputation>,
    circles_by_account: LookupMap<AccountId, Vec<u64>>,
}

impl Default for Contract {
    fn default() -> Self {
        Self {
            circles: LookupMap::new(StorageKey::Circles),
            next_id: 0,
            reputation: LookupMap::new(StorageKey::Reputation),
            circles_by_account: LookupMap::new(StorageKey::CirclesByAccount),
        }
    }
}

#[near]
impl Contract {
    // ---------------------------------------------------------------- forming

    /// Opens a circle in `Forming` status and returns its id.
    ///
    /// Attach NEAR for storage (0.2 NEAR covers 10 members); the excess is
    /// refunded.
    #[payable]
    pub fn create_circle(&mut self, config: CircleConfig) -> U64 {
        let n = config.members.len();
        require!(
            (MIN_MEMBERS..=MAX_MEMBERS).contains(&n),
            "a circle has 2 to 10 members"
        );
        for (i, a) in config.members.iter().enumerate() {
            require!(!config.members[..i].contains(a), "duplicate member");
        }
        require!(config.contribution.0 > 0, "contribution must be positive");
        require!(
            (MIN_ROUND_DURATION_SEC..=MAX_ROUND_DURATION_SEC).contains(&config.round_duration_sec),
            "round duration must be between 60 seconds and 366 days"
        );
        require!(
            config.grace_period_sec <= MAX_GRACE_PERIOD_SEC,
            "grace period is at most 30 days"
        );
        require!(
            !config.name.is_empty() && config.name.len() <= MAX_NAME_LEN,
            "name must be 1 to 64 bytes"
        );

        let before = env::storage_usage();
        let id = self.next_id;
        self.next_id += 1;
        let creator = env::predecessor_account_id();
        let circle = Circle {
            id: U64(id),
            name: config.name,
            creator: creator.clone(),
            token: config.token.clone(),
            contribution: config.contribution,
            early_slot_bond: config.early_slot_bond,
            round_duration_sec: config.round_duration_sec,
            grace_period_sec: config.grace_period_sec,
            status: Status::Forming,
            members: config
                .members
                .iter()
                .map(|a| Member {
                    account_id: a.clone(),
                    joined: false,
                    bond: U128(0),
                    claimable: U128(0),
                    paid_round: None,
                    paid_at_ms: None,
                    missed: 0,
                })
                .collect(),
            order: Vec::new(),
            current_round: 0,
            start_ms: 0,
            round_opened_ms: 0,
            history: Vec::new(),
            swaps: Vec::new(),
            dissolve_votes: Vec::new(),
        };
        self.circles.insert(id, circle);
        let mut indexed = config.members.clone();
        if !indexed.contains(&creator) {
            indexed.push(creator.clone());
        }
        for a in indexed {
            self.circles_by_account.entry(a).or_default().push(id);
        }
        self.flush();
        charge_storage(
            before,
            RESERVED_BYTES_PER_MEMBER * n as u64,
            TOKEN_STORAGE_DEPOSIT,
        );

        // Make sure this contract can receive the token.
        let _ = ext_ft::ext(config.token)
            .with_attached_deposit(TOKEN_STORAGE_DEPOSIT)
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(env::current_account_id()), Some(true));

        events::emit(
            "circle_created",
            json!({ "circle_id": U64(id), "creator": creator, "members": config.members }),
        );
        U64(id)
    }

    /// An invited member accepts. Registers the member on the circle's token
    /// so payouts can't fail on registration. Attach about 0.01 NEAR; the
    /// excess is refunded.
    #[payable]
    pub fn join(&mut self, circle_id: U64) {
        let account = env::predecessor_account_id();
        let mut c = self.circle(circle_id);
        require!(c.status == Status::Forming, "circle is not forming");
        let m = member_mut(&mut c, &account);
        require!(!m.joined, "already joined");
        m.joined = true;
        let token = c.token.clone();

        let before = env::storage_usage();
        self.save(c);
        if !self.reputation.contains_key(&account) {
            self.reputation
                .insert(account.clone(), Reputation::default());
        }
        self.flush();
        charge_storage(before, 0, TOKEN_STORAGE_DEPOSIT);

        let _ = ext_ft::ext(token)
            .with_attached_deposit(TOKEN_STORAGE_DEPOSIT)
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(account.clone()), Some(true));

        events::emit(
            "member_joined",
            json!({ "circle_id": circle_id, "account_id": account }),
        );
    }

    /// Fixes the payout order and starts round 0. Any member (or the creator)
    /// can call it once every member has joined.
    ///
    /// Early slots go to members who posted the bond or who have completed a
    /// circle with no missed contribution and no default. Everyone else goes
    /// last. Within each group, invitation order is kept.
    pub fn start(&mut self, circle_id: U64) {
        let caller = env::predecessor_account_id();
        let mut c = self.circle(circle_id);
        require!(c.status == Status::Forming, "circle is not forming");
        require!(
            caller == c.creator || c.members.iter().any(|m| m.account_id == caller),
            "only the creator or a member can start the circle"
        );
        require!(
            c.members.iter().all(|m| m.joined),
            "every member must join first"
        );

        let bond = c.early_slot_bond.0;
        let (early, late): (Vec<&Member>, Vec<&Member>) = c
            .members
            .iter()
            .partition(|m| (bond > 0 && m.bond.0 >= bond) || self.has_clean_history(&m.account_id));
        c.order = early
            .iter()
            .chain(late.iter())
            .map(|m| m.account_id.clone())
            .collect();

        let now = env::block_timestamp_ms();
        c.status = Status::Active;
        c.start_ms = now;
        c.round_opened_ms = now;
        events::emit(
            "circle_started",
            json!({ "circle_id": circle_id, "order": c.order, "early_slots": early.len() }),
        );
        self.save(c);
    }

    // ----------------------------------------------------------------- money in

    /// NEP-141 receiver. `msg` is `{"circle_id": "<id>", "kind": "contribution" | "bond"}`.
    /// Accepts exactly the required amount and returns the rest. A rejected
    /// transfer is returned in full.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        match self.receive(&token, &sender_id, amount.0, &msg) {
            Ok(unused) => PromiseOrValue::Value(U128(unused)),
            Err(reason) => {
                events::emit(
                    "transfer_rejected",
                    json!({ "token": token, "sender_id": sender_id, "amount": amount, "reason": reason }),
                );
                PromiseOrValue::Value(amount)
            }
        }
    }

    // ---------------------------------------------------------------- money out

    /// Pays the current round's pot to `order[current_round]` and opens the
    /// next round. Anyone can call it: the AI treasurer, a member or a cron job.
    ///
    /// Allowed once every member has paid, or once the deadline plus the
    /// grace period has passed. In the second case each missing member's
    /// contribution is recorded as missed, up to one contribution of their
    /// bond is slashed into the pot, and a miss after the member already
    /// received the pot is recorded as a default.
    ///
    /// Takes no deposit so a function-call key can call it. Attach 300 Tgas:
    /// the last round also returns every remaining bond.
    pub fn settle(&mut self, circle_id: U64) -> RoundRecord {
        let mut c = self.circle(circle_id);
        require!(c.status == Status::Active, "circle is not active");
        let now = env::block_timestamp_ms();
        let r = c.current_round;
        let n = c.members.len() as u32;
        let paid = c.members.iter().filter(|m| m.paid_round == Some(r)).count() as u32;
        let grace_ends = grace_ends_ms(&c);
        if paid < n && now <= grace_ends {
            env::panic_str(&format!(
                "round {r} can't settle yet: {paid} of {n} paid; settling opens at {grace_ends} ms"
            ));
        }

        let recipient = c.order[r as usize].clone();
        let contribution = c.contribution.0;
        let mut slashed = 0u128;
        let mut missed = Vec::new();
        for m in c.members.iter_mut().filter(|m| m.paid_round != Some(r)) {
            m.missed += 1;
            let s = m.bond.0.min(contribution);
            m.bond = U128(m.bond.0 - s);
            slashed += s;
            missed.push((m.account_id.clone(), s));
        }
        for (account, s) in &missed {
            let had_received = c.order.iter().position(|a| a == account).unwrap() < r as usize;
            self.update_reputation(account, |rep| {
                rep.missed_contributions += 1;
                if had_received {
                    rep.defaults += 1;
                }
            });
            events::emit(
                "contribution_missed",
                json!({ "circle_id": circle_id, "round": r, "account_id": account,
                        "bond_slashed": U128(*s), "default": had_received }),
            );
        }

        let amount = paid as u128 * contribution + slashed;
        let record = RoundRecord {
            round: r,
            recipient: recipient.clone(),
            amount: U128(amount),
            contributions: paid,
            slashed: U128(slashed),
            missed: missed.into_iter().map(|(a, _)| a).collect(),
            settled_at_ms: now,
            settled_by: env::predecessor_account_id(),
            payout: if amount > 0 {
                PayoutStatus::Pending
            } else {
                PayoutStatus::Empty
            },
        };
        c.history.push(record.clone());
        c.current_round += 1;
        c.round_opened_ms = now;
        events::emit(
            "round_settled",
            json!({ "circle_id": circle_id, "round": r, "recipient": recipient,
                    "amount": U128(amount), "slashed": U128(slashed) }),
        );

        let mut transfers = Vec::new();
        if amount > 0 {
            transfers.push((recipient, amount, Some(r)));
        }
        if c.current_round == n {
            c.status = Status::Completed;
            c.swaps.clear();
            c.dissolve_votes.clear();
            for m in c.members.iter_mut() {
                if m.bond.0 > 0 {
                    transfers.push((m.account_id.clone(), m.bond.0, None));
                    m.bond = U128(0);
                }
            }
            let clean: Vec<AccountId> = c
                .members
                .iter()
                .filter(|m| m.missed == 0)
                .map(|m| m.account_id.clone())
                .collect();
            for a in &clean {
                self.update_reputation(a, |rep| rep.circles_completed += 1);
            }
            events::emit(
                "circle_completed",
                json!({ "circle_id": circle_id, "completed_clean": clean }),
            );
        }

        let token = c.token.clone();
        self.save(c);
        for (to, amount, round) in transfers {
            send(&token, circle_id, to, amount, round);
        }
        record
    }

    /// Withdraws what failed transfers left to the caller in this circle.
    #[payable]
    pub fn claim(&mut self, circle_id: U64) {
        assert_one_yocto();
        let account = env::predecessor_account_id();
        let mut c = self.circle(circle_id);
        let m = member_mut(&mut c, &account);
        let amount = m.claimable.0;
        require!(amount > 0, "nothing to claim");
        m.claimable = U128(0);
        let token = c.token.clone();
        self.save(c);
        events::emit(
            "claimed",
            json!({ "circle_id": circle_id, "account_id": account, "amount": U128(amount) }),
        );
        send(&token, circle_id, account, amount, None);
    }

    /// Records a token transfer's outcome. A failed transfer becomes claimable
    /// by the same account; nothing is lost and nothing is redirected.
    #[private]
    pub fn on_transfer_resolved(
        &mut self,
        circle_id: U64,
        account_id: AccountId,
        amount: U128,
        round: Option<u32>,
    ) -> bool {
        let ok = env::promise_result_checked(0, 64).is_ok();
        let mut c = self.circle(circle_id);
        if let Some(r) = round {
            c.history[r as usize].payout = if ok {
                PayoutStatus::Paid
            } else {
                PayoutStatus::Claimable
            };
        }
        if !ok {
            let m = member_mut(&mut c, &account_id);
            m.claimable = U128(m.claimable.0 + amount.0);
            events::emit(
                "transfer_failed",
                json!({ "circle_id": circle_id, "account_id": account_id, "amount": amount, "round": round }),
            );
        }
        self.save(c);
        ok
    }

    // -------------------------------------------------------------------- swaps

    /// Proposes swapping payout slots with `other`. Both slots must still be
    /// unpaid. Replaces the caller's earlier proposal in this circle, if any.
    #[payable]
    pub fn propose_swap(&mut self, circle_id: U64, other: AccountId) {
        assert_one_yocto();
        let proposer = env::predecessor_account_id();
        let mut c = self.circle(circle_id);
        require!(proposer != other, "can't swap with yourself");
        check_swappable(&c, &proposer, &other);
        c.swaps.retain(|s| s.proposer != proposer);
        c.swaps.push(SwapProposal {
            proposer: proposer.clone(),
            other: other.clone(),
        });
        events::emit(
            "swap_proposed",
            json!({ "circle_id": circle_id, "proposer": proposer, "other": other }),
        );
        self.save(c);
    }

    /// The other member approves a pending swap; the two slots trade places.
    #[payable]
    pub fn accept_swap(&mut self, circle_id: U64, proposer: AccountId) {
        assert_one_yocto();
        let other = env::predecessor_account_id();
        let mut c = self.circle(circle_id);
        let proposal = SwapProposal {
            proposer: proposer.clone(),
            other: other.clone(),
        };
        let i = c
            .swaps
            .iter()
            .position(|s| *s == proposal)
            .unwrap_or_else(|| env::panic_str("no pending swap from that proposer to you"));
        let (a, b) = check_swappable(&c, &proposer, &other);
        c.order.swap(a, b);
        c.swaps.remove(i);
        events::emit(
            "swap_accepted",
            json!({ "circle_id": circle_id, "proposer": proposer, "other": other, "order": c.order }),
        );
        self.save(c);
    }

    // ----------------------------------------------------------------- dissolve

    /// Opens a dissolve vote with the caller's yes. Voters are the members who
    /// have joined (`Forming`) or all members (`Active`).
    #[payable]
    pub fn propose_dissolve(&mut self, circle_id: U64) {
        assert_one_yocto();
        let mut c = self.circle(circle_id);
        self.add_dissolve_vote(&mut c, true);
    }

    /// Adds the caller's yes to the open dissolve vote. When every voter has
    /// voted, the circle dissolves: the current round's contributions and all
    /// bonds go back to the members who paid them.
    #[payable]
    pub fn vote_dissolve(&mut self, circle_id: U64) {
        assert_one_yocto();
        let mut c = self.circle(circle_id);
        self.add_dissolve_vote(&mut c, false);
    }

    // -------------------------------------------------------------------- views

    pub fn get_circle(&self, circle_id: U64) -> Option<Circle> {
        self.circles.get(&circle_id.0).cloned()
    }

    pub fn get_round_status(&self, circle_id: U64) -> RoundStatus {
        let c = self.circle(circle_id);
        let now = env::block_timestamp_ms();
        let active = c.status == Status::Active;
        let r = c.current_round;
        let (paid, unpaid): (Vec<&Member>, Vec<&Member>) = c
            .members
            .iter()
            .partition(|m| active && m.paid_round == Some(r));
        let grace_ends = if active { grace_ends_ms(&c) } else { 0 };
        RoundStatus {
            circle_id,
            status: c.status,
            round: r,
            rounds_total: c.members.len() as u32,
            recipient: if active {
                Some(c.order[r as usize].clone())
            } else {
                None
            },
            deadline_ms: if active { deadline_ms(&c) } else { 0 },
            grace_ends_ms: grace_ends,
            now_ms: now,
            collected: U128(paid.len() as u128 * c.contribution.0),
            can_settle: active && (unpaid.is_empty() || now > grace_ends),
            paid: paid.into_iter().map(|m| m.account_id.clone()).collect(),
            unpaid: if active {
                unpaid.into_iter().map(|m| m.account_id.clone()).collect()
            } else {
                vec![]
            },
        }
    }

    pub fn get_reputation(&self, account_id: AccountId) -> Reputation {
        self.reputation
            .get(&account_id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn list_circles_for(&self, account_id: AccountId) -> Vec<U64> {
        self.circles_by_account
            .get(&account_id)
            .map(|ids| ids.iter().map(|id| U64(*id)).collect())
            .unwrap_or_default()
    }

    /// Tokens this contract holds for a circle: current-round contributions,
    /// bonds and claimable amounts. In-flight transfers are not included.
    pub fn get_circle_balance(&self, circle_id: U64) -> U128 {
        let c = self.circle(circle_id);
        let contributions = if c.status == Status::Active {
            let paid = c
                .members
                .iter()
                .filter(|m| m.paid_round == Some(c.current_round))
                .count();
            paid as u128 * c.contribution.0
        } else {
            0
        };
        let held: u128 = c.members.iter().map(|m| m.bond.0 + m.claimable.0).sum();
        U128(contributions + held)
    }

    pub fn get_circle_count(&self) -> U64 {
        U64(self.next_id)
    }

    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}

impl Contract {
    fn circle(&self, circle_id: U64) -> Circle {
        self.circles
            .get(&circle_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown circle"))
    }

    fn save(&mut self, c: Circle) {
        self.circles.insert(c.id.0, c);
    }

    fn flush(&mut self) {
        self.circles.flush();
        self.reputation.flush();
        self.circles_by_account.flush();
    }

    fn update_reputation(&mut self, account: &AccountId, f: impl FnOnce(&mut Reputation)) {
        let mut rep = self.get_reputation(account.clone());
        f(&mut rep);
        self.reputation.insert(account.clone(), rep);
    }

    fn has_clean_history(&self, account: &AccountId) -> bool {
        let rep = self.get_reputation(account.clone());
        rep.circles_completed > 0 && rep.missed_contributions == 0 && rep.defaults == 0
    }

    /// Body of `ft_on_transfer`. Returns the unused amount, or why the whole
    /// transfer is refused.
    fn receive(
        &mut self,
        token: &AccountId,
        sender: &AccountId,
        amount: u128,
        msg: &str,
    ) -> Result<u128, String> {
        let msg: TransferMsg =
            serde_json::from_str(msg).map_err(|e| format!("invalid msg: {e}"))?;
        let mut c = self
            .circles
            .get(&msg.circle_id.0)
            .cloned()
            .ok_or_else(|| "unknown circle".to_string())?;
        if &c.token != token {
            return Err(format!("circle {} only accepts {}", c.id.0, c.token));
        }
        let deadline = deadline_ms(&c);
        let now = env::block_timestamp_ms();
        let status = c.status;
        let round = c.current_round;
        let (contribution, bond_required) = (c.contribution.0, c.early_slot_bond.0);
        let m = c
            .members
            .iter_mut()
            .find(|m| &m.account_id == sender)
            .ok_or_else(|| "sender is not a member of this circle".to_string())?;

        let unused = match msg.kind {
            TransferKind::Bond => {
                if status != Status::Forming {
                    return Err("bonds are only accepted while the circle is forming".into());
                }
                if bond_required == 0 {
                    return Err("this circle does not use bonds".into());
                }
                if !m.joined {
                    return Err("join the circle before posting a bond".into());
                }
                if m.bond.0 > 0 {
                    return Err("bond already posted".into());
                }
                if amount < bond_required {
                    return Err(format!("bond is {bond_required}, received {amount}"));
                }
                m.bond = U128(bond_required);
                events::emit(
                    "bond_posted",
                    json!({ "circle_id": msg.circle_id, "account_id": sender, "amount": U128(bond_required) }),
                );
                amount - bond_required
            }
            TransferKind::Contribution => {
                if status != Status::Active {
                    return Err("circle is not active".into());
                }
                if m.paid_round == Some(round) {
                    return Err(format!("already paid round {round}"));
                }
                if amount < contribution {
                    return Err(format!("contribution is {contribution}, received {amount}"));
                }
                let on_time = now <= deadline;
                m.paid_round = Some(round);
                m.paid_at_ms = Some(now);
                self.update_reputation(sender, |rep| {
                    if on_time {
                        rep.on_time_contributions += 1
                    } else {
                        rep.late_contributions += 1
                    }
                });
                events::emit(
                    "contribution",
                    json!({ "circle_id": msg.circle_id, "round": round, "account_id": sender,
                            "amount": U128(contribution), "on_time": on_time }),
                );
                amount - contribution
            }
        };
        self.save(c);
        Ok(unused)
    }

    fn add_dissolve_vote(&mut self, c: &mut Circle, opening: bool) {
        let voter = env::predecessor_account_id();
        require!(
            matches!(c.status, Status::Forming | Status::Active),
            "circle can no longer be dissolved"
        );
        if opening {
            require!(
                c.dissolve_votes.is_empty(),
                "a dissolve vote is already open"
            );
        } else {
            require!(!c.dissolve_votes.is_empty(), "no dissolve vote is open");
        }
        let voters = dissolve_voters(c);
        require!(voters.contains(&voter), "only members who joined can vote");
        require!(!c.dissolve_votes.contains(&voter), "already voted");
        c.dissolve_votes.push(voter.clone());
        events::emit(
            "dissolve_vote",
            json!({ "circle_id": c.id, "account_id": voter, "votes": c.dissolve_votes.len(), "needed": voters.len() }),
        );
        if !voters.iter().all(|v| c.dissolve_votes.contains(v)) {
            self.save(c.clone());
            return;
        }

        // Unanimous: refund the current round's contributions and all bonds.
        let refund_round = (c.status == Status::Active).then_some(c.current_round);
        let mut refunds = Vec::new();
        for m in c.members.iter_mut() {
            let mut amount = m.bond.0;
            if refund_round.is_some() && m.paid_round == refund_round {
                amount += c.contribution.0;
            }
            m.bond = U128(0);
            if amount > 0 {
                refunds.push((m.account_id.clone(), amount));
            }
        }
        c.status = Status::Dissolved;
        c.swaps.clear();
        events::emit(
            "circle_dissolved",
            json!({ "circle_id": c.id, "refunds": refunds.len() }),
        );
        let (id, token) = (c.id, c.token.clone());
        self.save(c.clone());
        for (to, amount) in refunds {
            send(&token, id, to, amount, None);
        }
    }
}

fn member_mut<'a>(c: &'a mut Circle, account: &AccountId) -> &'a mut Member {
    c.members
        .iter_mut()
        .find(|m| &m.account_id == account)
        .unwrap_or_else(|| env::panic_str("not a member of this circle"))
}

/// Deadline for the current round: the scheduled date, or one full round after
/// the round opened if the previous settle came late.
fn deadline_ms(c: &Circle) -> u64 {
    let d = c.round_duration_sec * 1000;
    let scheduled = c.start_ms + (c.current_round as u64 + 1) * d;
    scheduled.max(c.round_opened_ms + d)
}

fn grace_ends_ms(c: &Circle) -> u64 {
    deadline_ms(c) + c.grace_period_sec * 1000
}

fn dissolve_voters(c: &Circle) -> Vec<AccountId> {
    c.members
        .iter()
        .filter(|m| c.status == Status::Active || m.joined)
        .map(|m| m.account_id.clone())
        .collect()
}

/// Both accounts must be members whose slots haven't paid out. Returns their
/// positions in the payout order.
fn check_swappable(c: &Circle, a: &AccountId, b: &AccountId) -> (usize, usize) {
    require!(c.status == Status::Active, "swaps need an active circle");
    let pos = |x: &AccountId| {
        c.order
            .iter()
            .position(|o| o == x)
            .unwrap_or_else(|| env::panic_str("not a member of this circle"))
    };
    let (i, j) = (pos(a), pos(b));
    let current = c.current_round as usize;
    require!(
        i >= current && j >= current,
        "both slots must still be unpaid"
    );
    (i, j)
}

/// Charges the caller for storage this call added plus `extra_bytes` reserved
/// for later, plus `extra`; refunds the rest of the attached deposit.
fn charge_storage(before: u64, extra_bytes: u64, extra: NearToken) {
    let used = env::storage_usage().saturating_sub(before) + extra_bytes;
    let cost = env::storage_byte_cost()
        .saturating_mul(used as u128)
        .saturating_add(extra);
    let attached = env::attached_deposit();
    if attached < cost {
        env::panic_str(&format!(
            "attach at least {} yoctoNEAR for storage",
            cost.as_yoctonear()
        ));
    }
    let refund = attached.saturating_sub(cost);
    if !refund.is_zero() {
        let _ = Promise::new(env::predecessor_account_id()).transfer(refund);
    }
}

/// `ft_transfer` with a callback that turns a failure into a claimable balance
/// for the same account.
fn send(token: &AccountId, circle_id: U64, to: AccountId, amount: u128, round: Option<u32>) {
    let _ = ext_ft::ext(token.clone())
        .with_attached_deposit(NearToken::from_yoctonear(1))
        .with_static_gas(GAS_FT_TRANSFER)
        .ft_transfer(
            to.clone(),
            U128(amount),
            Some(format!("rota circle {}", circle_id.0)),
        )
        .then(
            Contract::ext(env::current_account_id())
                .with_static_gas(GAS_ON_TRANSFER_RESOLVED)
                .on_transfer_resolved(circle_id, to, U128(amount), round),
        );
}
