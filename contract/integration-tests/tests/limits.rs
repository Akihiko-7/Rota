mod common;

use common::*;

/// The largest circle (10 members, every one bonded) completes. The last
/// settle pays the pot and returns 10 bonds within 300 Tgas, and the storage
/// reserved at creation covers everything the circle stores afterwards.
#[tokio::test]
async fn largest_circle_fits_gas_and_storage() -> anyhow::Result<()> {
    let env = setup(10).await?;
    let bond = CONTRIBUTION;
    let id = env.create_circle(&env.members[0], bond).await?;
    env.join_all(id).await?;
    for m in &env.members {
        env.pay(m, id, "bond", bond).await?.into_result()?;
    }
    env.start(&env.members[0], id).await?.into_result()?;
    let storage_after_joins = env
        .worker
        .view_account(env.circle.id())
        .await?
        .storage_usage;

    let mut last_gas = 0;
    for _ in 0..10 {
        for m in &env.members {
            env.contribute(m, id).await?;
        }
        let res = env.settle(&env.outsider, id).await?;
        assert!(res.is_success(), "{:?}", res.failures());
        last_gas = res.total_gas_burnt.as_gas();
    }
    println!("final settle burnt {:.1} Tgas", last_gas as f64 / 1e12);

    let circle = env.circle_view(id).await?;
    assert_eq!(circle["status"], "Completed");
    for m in &env.members {
        assert_eq!(
            env.balance(m.id()).await?,
            1_000 * USDC,
            "every bond returned, net zero"
        );
    }
    assert_eq!(env.balance(env.circle.id()).await?, 0);

    let grown = env
        .worker
        .view_account(env.circle.id())
        .await?
        .storage_usage
        - storage_after_joins;
    println!(
        "storage grew {grown} bytes after start (reserved {})",
        1_200 * 10
    );
    assert!(grown <= 1_200 * 10);
    Ok(())
}
