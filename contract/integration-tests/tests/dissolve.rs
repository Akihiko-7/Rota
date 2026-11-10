//! Unanimous dissolution is the escape hatch: the contract account is locked
//! after deployment, so there is no upgrade path.

mod common;

use common::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::json;

const BOND: u128 = 2 * CONTRIBUTION;

/// Mid-round, everyone votes: whoever paid this round gets it back, and every
/// bond is returned. Pots already paid out stay paid.
#[tokio::test]
async fn unanimous_dissolve_refunds_round_and_bonds() -> anyhow::Result<()> {
    let env = setup(3).await?;
    let (m0, m1, m2) = (&env.members[0], &env.members[1], &env.members[2]);
    let id = env.create_circle(m0, BOND).await?;
    env.join_all(id).await?;
    env.pay(m2, id, "bond", BOND).await?.into_result()?;
    env.start(m0, id).await?.into_result()?;

    let mut start = Vec::new();
    for m in &env.members {
        start.push(env.balance(m.id()).await? as i128);
    }

    // Round 0 completes (m2, bonded, goes first). In round 1 only m0 and m1 pay.
    for m in &env.members {
        env.contribute(m, id).await?;
    }
    env.settle(m0, id).await?.into_result()?;
    env.contribute(m0, id).await?;
    env.contribute(m1, id).await?;

    vote(m0, &env, id, "propose_dissolve")
        .await?
        .into_result()?;
    let err = failure(vote(m0, &env, id, "vote_dissolve").await);
    assert!(err.contains("already voted"), "{err}");
    let err = failure(vote(&env.outsider, &env, id, "vote_dissolve").await);
    assert!(err.contains("only members who joined can vote"), "{err}");
    vote(m1, &env, id, "vote_dissolve").await?.into_result()?;
    assert_eq!(
        env.circle_view(id).await?["status"],
        "Active",
        "2 of 3 is not unanimous"
    );

    vote(m2, &env, id, "vote_dissolve").await?.into_result()?;
    assert_eq!(env.circle_view(id).await?["status"], "Dissolved");

    // m0, m1: paid 10 in round 0 (to m2), round 1 refunded => -10.
    // m2 (measured after posting the bond): paid 10, received 30, bond 20
    // returned => +40.
    let mut delta = Vec::new();
    for (m, s) in env.members.iter().zip(&start) {
        delta.push(env.balance(m.id()).await? as i128 - s);
    }
    let c = CONTRIBUTION as i128;
    assert_eq!(delta, vec![-c, -c, 4 * c]);
    assert_eq!(env.balance(env.circle.id()).await?, 0);

    assert!(failure(env.settle(m0, id).await).contains("circle is not active"));
    let err = failure(vote(m0, &env, id, "propose_dissolve").await);
    assert!(err.contains("can no longer be dissolved"), "{err}");
    Ok(())
}

/// While forming, the members who joined can dissolve and get their bonds back.
#[tokio::test]
async fn forming_circle_dissolve_returns_bonds() -> anyhow::Result<()> {
    let env = setup(3).await?;
    let (m0, m1) = (&env.members[0], &env.members[1]);
    let id = env.create_circle(m0, BOND).await?;
    for m in [m0, m1] {
        m.call(env.circle.id(), "join")
            .args_json(json!({ "circle_id": id.to_string() }))
            .deposit(NearToken::from_millinear(50))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    env.pay(m1, id, "bond", BOND).await?.into_result()?;
    let held = env.balance(m1.id()).await?;

    // m2 never joined, so it doesn't vote.
    vote(m1, &env, id, "propose_dissolve")
        .await?
        .into_result()?;
    let err = failure(vote(&env.members[2], &env, id, "vote_dissolve").await);
    assert!(err.contains("only members who joined can vote"), "{err}");
    vote(m0, &env, id, "vote_dissolve").await?.into_result()?;

    assert_eq!(env.circle_view(id).await?["status"], "Dissolved");
    assert_eq!(env.balance(m1.id()).await?, held + BOND);
    assert_eq!(env.balance(env.circle.id()).await?, 0);
    Ok(())
}

async fn vote(
    from: &Account,
    env: &Env,
    id: u64,
    method: &str,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(from
        .call(env.circle.id(), method)
        .args_json(json!({ "circle_id": id.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)
}
