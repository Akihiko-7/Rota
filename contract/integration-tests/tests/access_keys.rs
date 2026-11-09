//! Protocol-level guarantees of the treasurer's function-call key.
//!
//! The treasurer holds a key restricted to receiver = circle contract and
//! method_names = ["settle"]. These checks happen during transaction
//! validation, before any contract code runs, so they hold no matter what
//! the contract does.

use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{AccessKey, Account};

/// Flattens a rejected RPC call or a failed execution into one string.
fn failure(res: anyhow::Result<ExecutionFinalResult>) -> String {
    match res {
        Err(e) => format!("{e:?}"),
        Ok(outcome) if outcome.is_failure() => format!("{:?}", outcome.into_result().unwrap_err()),
        Ok(_) => panic!("expected the transaction to fail, but it succeeded"),
    }
}

#[tokio::test]
async fn treasurer_key_can_only_call_settle_on_the_circle() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let treasurer = worker.dev_create_account().await?;
    let circle = worker.dev_create_account().await?;
    let attacker = worker.dev_create_account().await?;

    let fc_key = SecretKey::from_random(KeyType::ED25519);
    let added = treasurer
        .batch(treasurer.id())
        .add_key(
            fc_key.public_key(),
            AccessKey::function_call_access(circle.id(), &["settle"], Some(NearToken::from_near(1))),
        )
        .transact()
        .await?;
    assert!(added.is_success(), "{added:?}");

    let ai = Account::from_secret_key(treasurer.id().clone(), fc_key, &worker);

    // 1. A plain Transfer needs a full-access key. (1 yocto, so the allowance
    //    check can't be what rejects it.)
    let err = failure(ai.transfer_near(attacker.id(), NearToken::from_yoctonear(1)).await.map_err(Into::into));
    assert!(err.contains("RequiresFullAccess"), "{err}");

    // 2. Any other method on the circle contract.
    let err = failure(ai.call(circle.id(), "withdraw").transact().await.map_err(Into::into));
    assert!(err.contains("MethodNameMismatch"), "{err}");

    // 3. `settle` on any other contract.
    let err = failure(ai.call(attacker.id(), "settle").transact().await.map_err(Into::into));
    assert!(err.contains("ReceiverMismatch"), "{err}");

    // 4. `settle` with tokens attached.
    let err = failure(
        ai.call(circle.id(), "settle")
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await
            .map_err(Into::into),
    );
    assert!(err.contains("DepositWithFunctionCall"), "{err}");

    // 5. Adding itself a stronger key.
    let err = failure(
        ai.batch(treasurer.id())
            .add_key(SecretKey::from_random(KeyType::ED25519).public_key(), AccessKey::full_access())
            .transact()
            .await
            .map_err(Into::into),
    );
    assert!(err.contains("RequiresFullAccess"), "{err}");

    // 6. The one allowed call passes key validation. The circle account has no
    //    code yet, so execution fails later with a different error.
    let err = failure(ai.call(circle.id(), "settle").transact().await.map_err(Into::into));
    assert!(!err.contains("InvalidAccessKeyError"), "{err}");

    Ok(())
}
