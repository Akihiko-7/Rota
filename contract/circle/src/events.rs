//! NEP-297 event logs. The bot and web app read these for history.

use near_sdk::env;
use near_sdk::serde_json::{json, Value};

pub fn emit(event: &str, data: Value) {
    let log = json!({
        "standard": "rota",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{log}"));
}
