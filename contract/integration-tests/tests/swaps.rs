mod common;

use common::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::json;

/// A swap changes the order only when both members sign, and only for slots
/// that haven't paid out.
#[tokio::test]
async fn swap_needs_both_members() -> anyhow::Result<()> {
    let env = setup(3).await?;
    let id = env.active_circle().await?;
    let (m0, m1, m2) = (&env.members[0], &env.members[1], &env.members[2]);
    let original = env.ids();

    swap(
        m0,
        &env,
        "propose_swap",
        json!({ "circle_id": id.to_string(), "other": m2.id() }),
        true,
    )
    .await?
    .into_result()?;
    assert_eq!(
        env.order(id).await?,
        original,
        "a proposal alone changes nothing"
    );

    // Only the named member can accept, and the wallet must confirm (1 yocto).
    let accept = json!({ "circle_id": id.to_string(), "proposer": m0.id() });
    let err = failure(swap(m1, &env, "accept_swap", accept.clone(), true).await);
    assert!(err.contains("no pending swap"), "{err}");
    let err = failure(swap(&env.outsider, &env, "accept_swap", accept.clone(), true).await);
    assert!(err.contains("no pending swap"), "{err}");
    let err = failure(swap(m2, &env, "accept_swap", accept.clone(), false).await);
    assert!(
        err.contains("Requires attached deposit of exactly 1 yoctoNEAR"),
        "{err}"
    );
    assert_eq!(env.order(id).await?, original);

    swap(m2, &env, "accept_swap", accept, true)
        .await?
        .into_result()?;
    assert_eq!(
        env.order(id).await?,
        vec![m2.id().clone(), m1.id().clone(), m0.id().clone()]
    );

    // Round 0 pays m2. That slot can no longer be swapped.
    for m in &env.members {
        env.contribute(m, id).await?;
    }
    let held = env.balance(m2.id()).await?;
    env.settle(m0, id).await?.into_result()?;
    assert_eq!(env.balance(m2.id()).await?, held + 3 * CONTRIBUTION);
    let err = failure(
        swap(
            m0,
            &env,
            "propose_swap",
            json!({ "circle_id": id.to_string(), "other": m2.id() }),
            true,
        )
        .await,
    );
    assert!(err.contains("both slots must still be unpaid"), "{err}");

    // Outsiders can't propose.
    let err = failure(
        swap(
            &env.outsider,
            &env,
            "propose_swap",
            json!({ "circle_id": id.to_string(), "other": m1.id() }),
            true,
        )
        .await,
    );
    assert!(err.contains("not a member"), "{err}");
    Ok(())
}

async fn swap(
    from: &Account,
    env: &Env,
    method: &str,
    args: serde_json::Value,
    confirm: bool,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let mut tx = from.call(env.circle.id(), method).args_json(args);
    if confirm {
        tx = tx.deposit(NearToken::from_yoctonear(1));
    }
    Ok(tx.transact().await?)
}
