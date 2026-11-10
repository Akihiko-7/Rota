mod common;

use common::*;
use serde_json::json;

const BOND: u128 = 2 * CONTRIBUTION;

/// A bonded member takes the first slot, receives the pot, then stops paying.
/// Settle refuses before the grace period ends; after it, the recipient gets
/// what was collected plus the slashed bond, and every miss is a default.
#[tokio::test]
async fn missed_payment_after_grace_slashes_bond_and_records_default() -> anyhow::Result<()> {
    let env = setup(4).await?;
    let (m0, m1, m2, m3) = (
        &env.members[0],
        &env.members[1],
        &env.members[2],
        &env.members[3],
    );
    let id = env.create_circle(m0, BOND).await?;
    env.join_all(id).await?;

    // Only m3 posts the bond, so m3 takes the first slot.
    let res = env.pay(m3, id, "bond", BOND + 5).await?;
    assert_eq!(used(&res), BOND, "excess bond is refunded");
    env.start(m0, id).await?.into_result()?;
    let order = env.order(id).await?;
    assert_eq!(
        order,
        vec![
            m3.id().clone(),
            m0.id().clone(),
            m1.id().clone(),
            m2.id().clone()
        ]
    );

    let start: Vec<u128> = member_balances(&env).await?;

    // Round 0: everyone pays; m3 receives 40.
    for m in &env.members {
        env.contribute(m, id).await?;
    }
    env.settle(&env.outsider, id).await?.into_result()?;

    // Round 1: m3 doesn't pay. Settle is refused until the grace period ends.
    for m in [m0, m1, m2] {
        env.contribute(m, id).await?;
    }
    let err = failure(env.settle(&env.outsider, id).await);
    assert!(err.contains("can't settle yet: 3 of 4 paid"), "{err}");

    env.pass_grace(id).await?;
    let held = env.balance(m0.id()).await?;
    env.settle(&env.outsider, id).await?.into_result()?;
    assert_eq!(
        env.balance(m0.id()).await?,
        held + 3 * CONTRIBUTION + CONTRIBUTION,
        "30 collected + 10 slashed"
    );

    let circle = env.circle_view(id).await?;
    let rec = &circle["history"][1];
    assert_eq!(rec["missed"], json!([m3.id()]));
    assert_eq!(rec["slashed"], CONTRIBUTION.to_string());
    assert_eq!(
        rec["settled_by"],
        json!(env.outsider.id()),
        "anyone can settle"
    );
    let rep = env.reputation(m3.id()).await?;
    assert_eq!(rep["missed_contributions"], 1);
    assert_eq!(rep["defaults"], 1, "missed after receiving the pot");

    // Rounds 2 and 3: m3 keeps missing. The last 10 of bond goes to round 2;
    // round 3 gets only what was collected.
    for round in 2..4 {
        for m in [m0, m1, m2] {
            env.contribute(m, id).await?;
        }
        env.pass_grace(id).await?;
        env.settle(&env.outsider, id).await?.into_result()?;
        let expected = if round == 2 {
            4 * CONTRIBUTION
        } else {
            3 * CONTRIBUTION
        };
        assert_eq!(
            env.circle_view(id).await?["history"][round]["amount"],
            expected.to_string()
        );
    }

    assert_eq!(env.circle_view(id).await?["status"], "Completed");
    let rep = env.reputation(m3.id()).await?;
    assert_eq!(rep["defaults"], 3);
    assert_eq!(rep["circles_completed"], 0);
    assert_eq!(env.reputation(m0.id()).await?["circles_completed"], 1);

    // Bonds deter default; they don't eliminate it. m3 put in 20 of bond (before
    // `start` was measured) plus 10 and took 40, so +10 overall; the last
    // recipient, m2, is 10 short. Nothing is left in the contract.
    let end = member_balances(&env).await?;
    let delta: Vec<i128> = end
        .iter()
        .zip(&start)
        .map(|(e, s)| *e as i128 - *s as i128)
        .collect();
    let c = CONTRIBUTION as i128;
    assert_eq!(delta, vec![0, 0, -c, 3 * c]);
    assert_eq!(delta[3] - BOND as i128, c, "m3 overall");
    assert_eq!(env.balance(env.circle.id()).await?, 0);
    Ok(())
}

/// A miss before the member's own turn is a missed contribution, not a
/// default. Paying after the deadline but before settle counts as late.
#[tokio::test]
async fn early_miss_is_not_a_default_and_late_payment_is_late() -> anyhow::Result<()> {
    let env = setup(3).await?;
    let id = env.active_circle().await?;
    let (m0, m1, m2) = (&env.members[0], &env.members[1], &env.members[2]);

    // Round 0: m2 misses (its turn is round 2).
    env.contribute(m0, id).await?;
    env.contribute(m1, id).await?;
    env.pass_grace(id).await?;
    env.settle(m1, id).await?.into_result()?;
    let rep = env.reputation(m2.id()).await?;
    assert_eq!(rep["missed_contributions"], 1);
    assert_eq!(rep["defaults"], 0);

    // Round 1: m2 pays after the deadline (no one has settled yet): late.
    env.contribute(m0, id).await?;
    env.contribute(m1, id).await?;
    env.pass_grace(id).await?;
    env.contribute(m2, id).await?;
    assert_eq!(env.reputation(m2.id()).await?["late_contributions"], 1);
    Ok(())
}

/// Settle before the deadline with one payment missing fails, and so does
/// settling a circle that hasn't started.
#[tokio::test]
async fn settle_before_deadline_with_payment_missing_fails() -> anyhow::Result<()> {
    let env = setup(3).await?;
    let forming = env.create_circle(&env.members[0], 0).await?;
    assert!(failure(env.settle(&env.members[0], forming).await).contains("circle is not active"));

    env.join_all(forming).await?;
    env.start(&env.members[1], forming).await?.into_result()?;
    env.contribute(&env.members[0], forming).await?;
    env.contribute(&env.members[1], forming).await?;
    let err = failure(env.settle(&env.members[0], forming).await);
    assert!(err.contains("2 of 3 paid"), "{err}");
    assert_eq!(
        env.round_status(forming).await?["unpaid"],
        json!([env.members[2].id()])
    );
    Ok(())
}

/// Start needs every member to have joined.
#[tokio::test]
async fn start_needs_everyone_joined() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let id = env.create_circle(&env.members[0], 0).await?;
    let err = failure(env.start(&env.members[0], id).await);
    assert!(err.contains("every member must join first"), "{err}");
    Ok(())
}

async fn member_balances(env: &Env) -> anyhow::Result<Vec<u128>> {
    let mut v = Vec::new();
    for m in &env.members {
        v.push(env.balance(m.id()).await?);
    }
    Ok(v)
}
