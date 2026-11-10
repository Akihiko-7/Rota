mod common;

use common::*;
use serde_json::json;

/// Four members pay every round; each receives the pot exactly once. The
/// treasurer settles every round with its settle-only key.
#[tokio::test]
async fn full_cycle_each_member_receives_the_pot_once() -> anyhow::Result<()> {
    let env = setup(4).await?;
    let id = env.active_circle().await?;
    let treasurer = treasurer(&env).await?;

    // Nobody has history or a bond, so invitation order stands.
    let order = env.order(id).await?;
    assert_eq!(order, env.ids());

    let mut before = Vec::new();
    for m in &env.members {
        before.push(env.balance(m.id()).await?);
    }

    for round in 0..4u64 {
        let status = env.round_status(id).await?;
        assert_eq!(status["round"], round);
        assert_eq!(status["can_settle"], false);
        for m in &env.members {
            env.contribute(m, id).await?;
        }
        assert_eq!(env.round_status(id).await?["can_settle"], true);

        let recipient = &order[round as usize];
        let held = env.balance(recipient).await?;
        let res = env.settle(&treasurer, id).await?;
        assert!(res.is_success(), "{:?}", res.failures());
        assert_eq!(env.balance(recipient).await?, held + 4 * CONTRIBUTION);
    }

    let circle = env.circle_view(id).await?;
    assert_eq!(circle["status"], "Completed");
    let history = circle["history"].as_array().unwrap();
    assert_eq!(history.len(), 4);
    for (r, rec) in history.iter().enumerate() {
        assert_eq!(rec["recipient"], json!(order[r]));
        assert_eq!(rec["amount"], (4 * CONTRIBUTION).to_string());
        assert_eq!(rec["payout"], "Paid");
        assert_eq!(rec["settled_by"], json!(treasurer.id()));
    }

    // Paid in 4 x 10, received 40 once: everyone ends where they started.
    for (m, b) in env.members.iter().zip(before) {
        assert_eq!(env.balance(m.id()).await?, b);
        assert_eq!(
            env.reputation(m.id()).await?,
            json!({ "on_time_contributions": 4, "late_contributions": 0, "missed_contributions": 0,
                    "circles_completed": 1, "defaults": 0 })
        );
    }
    assert_eq!(env.balance(env.circle.id()).await?, 0);

    // A completed circle can't be settled again.
    assert!(failure(env.settle(&treasurer, id).await).contains("circle is not active"));
    Ok(())
}

/// A clean completed circle earns an early slot in the next circle.
#[tokio::test]
async fn completed_history_earns_an_early_slot() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let first = env.active_circle().await?;
    for _ in 0..2 {
        for m in &env.members {
            env.contribute(m, first).await?;
        }
        env.settle(&env.outsider, first).await?.into_result()?;
    }

    // New circle: the outsider (no history) is invited first, but goes last.
    let newcomer = &env.outsider;
    let veteran = &env.members[1];
    let res = veteran
        .call(env.circle.id(), "create_circle")
        .args_json(json!({ "config": {
            "name": "Second", "token": env.ft.id(), "contribution": CONTRIBUTION.to_string(),
            "members": [newcomer.id(), veteran.id()],
            "round_duration_sec": ROUND_SEC, "grace_period_sec": GRACE_SEC, "early_slot_bond": "0",
        }}))
        .deposit(near_workspaces::types::NearToken::from_millinear(200))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let second: u64 = res.json::<String>()?.parse()?;
    for a in [newcomer, veteran] {
        a.call(env.circle.id(), "join")
            .args_json(json!({ "circle_id": second.to_string() }))
            .deposit(near_workspaces::types::NearToken::from_millinear(50))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    env.start(veteran, second).await?.into_result()?;
    assert_eq!(
        env.order(second).await?,
        vec![veteran.id().clone(), newcomer.id().clone()]
    );
    Ok(())
}
