mod common;

/// Rounds last at least 60 s, so tests move sandbox time with `fast_forward`.
#[tokio::test]
async fn fast_forward_moves_block_time() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let t0 = worker.view_block().await?.timestamp();
    worker.fast_forward(100).await?;
    let t1 = worker.view_block().await?.timestamp();
    let secs = (t1 - t0) as f64 / 1e9;
    println!("100 blocks fast-forwarded = {secs:.1} s of block time");
    assert!(secs > 10.0);
    Ok(())
}
