//! NEP-297 event logging.
//!
//! Events are written field by field instead of through `serde_json::json!`: building a
//! `serde_json::Value` tree pulled the whole `Value` machinery (maps, drop glue, a second
//! deserializer) into the wasm. Each value is still serialized by serde_json, so strings are
//! escaped exactly as before.

use near_sdk::serde::Serialize;
use near_sdk::{env, serde_json};

use crate::{EVENT_STANDARD, EVENT_VERSION};

/// `EVENT_JSON:{"standard":…,"version":…,"event":<name>,"data":[{<fields>}]}`
pub(crate) struct Event(String);

impl Event {
    /// `name` must be a plain identifier (it is not escaped).
    pub fn new(name: &str) -> Self {
        let mut s = String::with_capacity(320);
        s.push_str("EVENT_JSON:{\"standard\":\"");
        s.push_str(EVENT_STANDARD);
        s.push_str("\",\"version\":\"");
        s.push_str(EVENT_VERSION);
        s.push_str("\",\"event\":\"");
        s.push_str(name);
        s.push_str("\",\"data\":[{");
        Self(s)
    }

    /// Adds `"key": <value as JSON>`. `key` must be a plain identifier.
    pub fn field<T: Serialize + ?Sized>(mut self, key: &str, value: &T) -> Self {
        if !self.0.ends_with('{') {
            self.0.push(',');
        }
        self.0.push('"');
        self.0.push_str(key);
        self.0.push_str("\":");
        // Serializing these plain data types cannot fail.
        let json = serde_json::to_string(value).unwrap_or_else(|_| env::abort());
        self.0.push_str(&json);
        self
    }

    pub fn emit(mut self) {
        self.0.push_str("}]}");
        env::log_str(&self.0);
    }
}
