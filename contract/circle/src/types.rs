use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Invited members are joining and posting bonds.
    Forming,
    /// Payout order is fixed; rounds are running.
    Active,
    /// Every member has received the pot once.
    Completed,
    /// Members voted unanimously to dissolve; contributions and bonds refunded.
    Dissolved,
}

/// What a creator chooses when opening a circle.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CircleConfig {
    pub name: String,
    /// The NEP-141 token used for contributions and bonds.
    pub token: AccountId,
    /// Exact amount each member pays every round, in the token's smallest unit.
    pub contribution: U128,
    /// Invited members. Every one of them must `join` before the circle can start.
    pub members: Vec<AccountId>,
    pub round_duration_sec: u64,
    pub grace_period_sec: u64,
    /// Bond a member without history posts to take an early slot. 0 disables bonds.
    pub early_slot_bond: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Member {
    pub account_id: AccountId,
    pub joined: bool,
    /// Bond currently held for this member.
    pub bond: U128,
    /// Tokens this member can withdraw with `claim` after a failed transfer.
    pub claimable: U128,
    /// Last round this member contributed to.
    pub paid_round: Option<u32>,
    pub paid_at_ms: Option<u64>,
    /// Contributions missed in this circle.
    pub missed: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayoutStatus {
    /// Nothing was collected, so nothing was sent.
    Empty,
    /// `ft_transfer` is in flight.
    Pending,
    Paid,
    /// The transfer failed; the amount is claimable by the recipient only.
    Claimable,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RoundRecord {
    pub round: u32,
    pub recipient: AccountId,
    /// Contributions plus slashed bonds paid to the recipient.
    pub amount: U128,
    pub contributions: u32,
    pub slashed: U128,
    pub missed: Vec<AccountId>,
    pub settled_at_ms: u64,
    pub settled_by: AccountId,
    pub payout: PayoutStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwapProposal {
    pub proposer: AccountId,
    pub other: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Circle {
    pub id: U64,
    pub name: String,
    pub creator: AccountId,
    pub token: AccountId,
    pub contribution: U128,
    pub early_slot_bond: U128,
    pub round_duration_sec: u64,
    pub grace_period_sec: u64,
    pub status: Status,
    /// Members in invitation order.
    pub members: Vec<Member>,
    /// Payout order, fixed by `start`; `order[r]` receives round `r`.
    pub order: Vec<AccountId>,
    pub current_round: u32,
    pub start_ms: u64,
    pub round_opened_ms: u64,
    pub history: Vec<RoundRecord>,
    pub swaps: Vec<SwapProposal>,
    pub dissolve_votes: Vec<AccountId>,
}

/// Verifiable history for one account, across all circles on this contract.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reputation {
    pub on_time_contributions: u32,
    pub late_contributions: u32,
    pub missed_contributions: u32,
    /// Circles completed without missing a single contribution.
    pub circles_completed: u32,
    /// Missed contributions after the member had already received the pot.
    pub defaults: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RoundStatus {
    pub circle_id: U64,
    pub status: Status,
    pub round: u32,
    pub rounds_total: u32,
    pub recipient: Option<AccountId>,
    pub deadline_ms: u64,
    /// After this time `settle` works even with payments missing.
    pub grace_ends_ms: u64,
    pub now_ms: u64,
    pub paid: Vec<AccountId>,
    pub unpaid: Vec<AccountId>,
    /// Collected so far this round, before any bond slashing.
    pub collected: U128,
    pub can_settle: bool,
}

/// `msg` of `ft_transfer_call`.
#[near(serializers = [json])]
pub struct TransferMsg {
    pub circle_id: U64,
    pub kind: TransferKind,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferKind {
    Contribution,
    Bond,
}
