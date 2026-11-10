mod common;

use common::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::json;

/// The recipient unregisters from the token before payday, so `ft_transfer`
/// fails. The pot becomes claimable by the recipient and nobody else; a claim
/// that fails again is restored; once re-registered, the recipient claims it.
#[tokio::test]
async fn failed_payout_is_claimable_by_recipient_only() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let id = env.active_circle().await?;
    let (m0, m1) = (&env.members[0], &env.members[1]);
    assert_eq!(env.order(id).await?[0], *m0.id());
    for m in &env.members {
        env.contribute(m, id).await?;
    }
    let pot = 2 * CONTRIBUTION;

    // m0 empties its token account and unregisters.
    let rest = env.balance(m0.id()).await?;
    m0.call(env.ft.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": env.outsider.id(), "amount": rest.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    m0.call(env.ft.id(), "storage_unregister")
        .args_json(json!({}))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    env.settle(m1, id).await?.into_result()?;
    let circle = env.circle_view(id).await?;
    assert_eq!(circle["history"][0]["payout"], "Claimable");
    assert_eq!(circle["members"][0]["claimable"], pot.to_string());
    assert_eq!(
        env.balance(env.circle.id()).await?,
        pot,
        "funds stay in the contract"
    );

    // Nobody else can claim it.
    assert!(failure(claim(m1, &env, id).await).contains("nothing to claim"));
    assert!(failure(claim(&env.outsider, &env, id).await).contains("not a member"));

    // Claiming while still unregistered fails again and the amount is restored.
    claim(m0, &env, id).await?.into_result()?;
    assert_eq!(
        env.circle_view(id).await?["members"][0]["claimable"],
        pot.to_string()
    );

    // After re-registering, the claim goes through.
    m0.call(env.ft.id(), "storage_deposit")
        .args_json(json!({ "account_id": m0.id() }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    claim(m0, &env, id).await?.into_result()?;
    assert_eq!(env.balance(m0.id()).await?, pot);
    assert_eq!(env.circle_view(id).await?["members"][0]["claimable"], "0");
    assert_eq!(env.balance(env.circle.id()).await?, 0);
    Ok(())
}

async fn claim(
    from: &Account,
    env: &Env,
    id: u64,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(from
        .call(env.circle.id(), "claim")
        .args_json(json!({ "circle_id": id.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)
}
