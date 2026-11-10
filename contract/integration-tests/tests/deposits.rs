mod common;

use common::*;
use serde_json::json;

/// Every bad deposit is refused in full and the sender keeps the tokens.
#[tokio::test]
async fn bad_deposits_are_refunded() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let (m0, m1) = (&env.members[0], &env.members[1]);
    let forming = env.create_circle(m0, 0).await?;
    env.join_all(forming).await?;

    // Contribution while forming; bond on a circle without bonds.
    for kind in ["contribution", "bond"] {
        let before = env.balance(m0.id()).await?;
        let res = env.pay(m0, forming, kind, CONTRIBUTION).await?;
        assert_eq!(used(&res), 0, "{kind}: {}", logs(&res));
        assert_eq!(env.balance(m0.id()).await?, before);
    }

    env.start(m0, forming).await?.into_result()?;
    let id = forming;

    let cases: Vec<(&str, near_workspaces::Account, String, u128)> = vec![
        (
            "not a member",
            env.outsider.clone(),
            contribution_msg(id),
            CONTRIBUTION,
        ),
        (
            "contribution is 10000000, received 5000000",
            m0.clone(),
            contribution_msg(id),
            CONTRIBUTION / 2,
        ),
        (
            "unknown circle",
            m0.clone(),
            contribution_msg(99),
            CONTRIBUTION,
        ),
        (
            "invalid msg",
            m0.clone(),
            "pay me".to_string(),
            CONTRIBUTION,
        ),
        (
            "invalid msg",
            m0.clone(),
            json!({ "circle_id": id.to_string(), "kind": "gift" }).to_string(),
            CONTRIBUTION,
        ),
    ];
    for (reason, from, msg, amount) in cases {
        let before = env.balance(from.id()).await?;
        let res = from
            .call(env.ft.id(), "ft_transfer_call")
            .args_json(
                json!({ "receiver_id": env.circle.id(), "amount": amount.to_string(), "msg": msg }),
            )
            .deposit(near_workspaces::types::NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?;
        assert!(res.is_success());
        assert_eq!(used(&res), 0, "{reason}");
        assert!(
            logs(&res).contains(reason),
            "expected '{reason}' in {}",
            logs(&res)
        );
        assert_eq!(env.balance(from.id()).await?, before, "{reason}: refunded");
    }

    // Overpaying keeps exactly the contribution and refunds the rest.
    let before = env.balance(m1.id()).await?;
    let res = env.pay(m1, id, "contribution", CONTRIBUTION + 7).await?;
    assert_eq!(used(&res), CONTRIBUTION);
    assert_eq!(env.balance(m1.id()).await?, before - CONTRIBUTION);

    // Paying twice in a round is refused.
    let res = env.pay(m1, id, "contribution", CONTRIBUTION).await?;
    assert_eq!(used(&res), 0);
    assert!(logs(&res).contains("already paid round 0"));

    assert_eq!(env.balance(env.circle.id()).await?, CONTRIBUTION);
    Ok(())
}

/// A token the circle doesn't use is refused, even with a valid msg.
#[tokio::test]
async fn wrong_token_is_refunded() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let id = env.active_circle().await?;
    let fake = deploy_ft(&env.worker).await?;
    let m0 = &env.members[0];
    // Register both sides so the transfer reaches the circle's own check.
    for account in [m0.id(), env.circle.id()] {
        m0.call(fake.id(), "storage_deposit")
            .args_json(json!({ "account_id": account }))
            .deposit(near_workspaces::types::NearToken::from_millinear(10))
            .transact()
            .await?
            .into_result()?;
    }
    fake.call("mint")
        .args_json(json!({ "account_id": m0.id(), "amount": CONTRIBUTION.to_string() }))
        .transact()
        .await?
        .into_result()?;

    let res = env
        .pay_with(fake.id(), m0, id, "contribution", CONTRIBUTION)
        .await?;
    assert_eq!(used(&res), 0);
    assert!(logs(&res).contains("only accepts"), "{}", logs(&res));
    assert_eq!(env.round_status(id).await?["paid"], json!([]));
    Ok(())
}

/// Calling `ft_on_transfer` directly (no tokens moved) credits nothing.
#[tokio::test]
async fn forged_ft_on_transfer_credits_nothing() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let id = env.active_circle().await?;
    let res = env
        .outsider
        .call(env.circle.id(), "ft_on_transfer")
        .args_json(json!({
            "sender_id": env.members[0].id(),
            "amount": CONTRIBUTION.to_string(),
            "msg": contribution_msg(id),
        }))
        .transact()
        .await?;
    assert_eq!(used(&res), CONTRIBUTION, "returned as unused");
    assert!(logs(&res).contains("only accepts"));
    assert_eq!(env.round_status(id).await?["paid"], json!([]));
    Ok(())
}

fn contribution_msg(id: u64) -> String {
    json!({ "circle_id": id.to_string(), "kind": "contribution" }).to_string()
}
