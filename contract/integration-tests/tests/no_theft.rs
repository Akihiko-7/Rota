mod common;

use common::*;
use near_workspaces::types::NearToken;
use near_workspaces::Account;
use serde_json::{json, Value};

/// Every change method of the contract, called with hostile arguments by an
/// outsider and by a member who is not this round's recipient. Afterwards the
/// pot is still in the contract, and `settle` pays it to `order[0]` only.
#[tokio::test]
async fn no_method_sends_the_pot_anywhere_else() -> anyhow::Result<()> {
    let env = setup(3).await?;
    let id = env.active_circle().await?;
    for m in &env.members {
        env.contribute(m, id).await?;
    }
    let pot = 3 * CONTRIBUTION;
    let recipient = env.order(id).await?[0].clone();
    let thief_member = &env.members[2];
    assert_ne!(thief_member.id(), &recipient);

    let mut before = Vec::new();
    for a in [&env.outsider, thief_member] {
        before.push(env.balance(a.id()).await?);
    }

    for attacker in [&env.outsider, thief_member] {
        let me = attacker.id();
        let cid = id.to_string();
        let attempts: Vec<(&str, Value)> = vec![
            ("claim", json!({ "circle_id": cid })),
            (
                "on_transfer_resolved",
                json!({ "circle_id": cid, "account_id": me, "amount": pot.to_string(), "round": 0 }),
            ),
            (
                "on_transfer_resolved",
                json!({ "circle_id": cid, "account_id": me, "amount": pot.to_string(), "round": null }),
            ),
            (
                "propose_swap",
                json!({ "circle_id": cid, "other": recipient }),
            ),
            (
                "accept_swap",
                json!({ "circle_id": cid, "proposer": recipient }),
            ),
            ("propose_dissolve", json!({ "circle_id": cid })),
            ("vote_dissolve", json!({ "circle_id": cid })),
            ("join", json!({ "circle_id": cid })),
            ("start", json!({ "circle_id": cid })),
            (
                "ft_on_transfer",
                json!({ "sender_id": me, "amount": pot.to_string(), "msg": json!({ "circle_id": cid, "kind": "contribution" }).to_string() }),
            ),
        ];
        for (method, args) in attempts {
            let _ = call(attacker, &env, method, args).await;
        }
    }

    // A dissolve vote by one member is not unanimous, so nothing moved.
    assert_eq!(env.circle_view(id).await?["status"], "Active");
    assert_eq!(env.balance(env.circle.id()).await?, pot);
    for (a, b) in [&env.outsider, thief_member].iter().zip(&before) {
        assert_eq!(env.balance(a.id()).await?, *b, "{} gained nothing", a.id());
    }

    // `settle` has no recipient parameter; an injected one is ignored.
    let held = env.balance(&recipient).await?;
    let res = env
        .outsider
        .call(env.circle.id(), "settle")
        .args_json(
            json!({ "circle_id": id.to_string(), "recipient": env.outsider.id(), "amount": "1" }),
        )
        .max_gas()
        .transact()
        .await?;
    assert!(res.is_success(), "{:?}", res.failures());
    assert_eq!(env.balance(&recipient).await?, held + pot);
    assert_eq!(env.balance(env.outsider.id()).await?, before[0]);
    assert_eq!(env.balance(env.circle.id()).await?, 0);
    Ok(())
}

/// The callback that records failed transfers can only be called by the
/// contract itself.
#[tokio::test]
async fn transfer_callback_is_private() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let id = env.active_circle().await?;
    let m = &env.members[1];
    let err = failure(
        call(m, &env, "on_transfer_resolved",
            json!({ "circle_id": id.to_string(), "account_id": m.id(), "amount": "1000000000", "round": null }))
        .await,
    );
    assert!(
        err.contains("Method on_transfer_resolved is private"),
        "{err}"
    );
    let claimable = &env.circle_view(id).await?["members"][1]["claimable"];
    assert_eq!(claimable, "0");
    Ok(())
}

/// The treasurer's key can call `settle` and nothing else, even on the real
/// circle contract with money in it.
#[tokio::test]
async fn treasurer_key_is_limited_to_settle() -> anyhow::Result<()> {
    let env = setup(2).await?;
    let id = env.active_circle().await?;
    let ai = treasurer(&env).await?;
    let cid = id.to_string();

    for (method, args) in [
        ("claim", json!({ "circle_id": cid })),
        ("propose_dissolve", json!({ "circle_id": cid })),
        ("create_circle", json!({})),
        ("on_transfer_resolved", json!({})),
        ("ft_on_transfer", json!({})),
    ] {
        // No deposit: a function-call key can't attach one, so this isolates
        // the method-name check.
        let err = failure(
            ai.call(env.circle.id(), method)
                .args_json(args)
                .transact()
                .await
                .map_err(Into::into),
        );
        assert!(err.contains("MethodNameMismatch"), "{method}: {err}");
    }
    let err = failure(
        ai.transfer_near(env.outsider.id(), NearToken::from_yoctonear(1))
            .await
            .map_err(Into::into),
    );
    assert!(err.contains("RequiresFullAccess"), "{err}");
    let err = failure(
        ai.call(env.ft.id(), "ft_transfer")
            .args_json(json!({ "receiver_id": ai.id(), "amount": "1" }))
            .transact()
            .await
            .map_err(Into::into),
    );
    assert!(err.contains("ReceiverMismatch"), "{err}");

    // settle itself works once the round is ready.
    for m in &env.members {
        env.contribute(m, id).await?;
    }
    env.settle(&ai, id).await?.into_result()?;

    // The treasurer account has exactly one key.
    let keys = ai.view_access_keys().await?;
    assert_eq!(keys.len(), 1);
    Ok(())
}

async fn call(
    from: &Account,
    env: &Env,
    method: &str,
    args: Value,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let deposit = match method {
        "join" => NearToken::from_millinear(50),
        "on_transfer_resolved" | "start" | "ft_on_transfer" | "create_circle" => {
            NearToken::from_yoctonear(0)
        }
        _ => NearToken::from_yoctonear(1),
    };
    let mut tx = from.call(env.circle.id(), method).args_json(args).max_gas();
    if !deposit.is_zero() {
        tx = tx.deposit(deposit);
    }
    Ok(tx.transact().await?)
}
