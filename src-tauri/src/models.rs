use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: i64,
    pub content_type: String,
    pub content: Option<String>,
    pub title: String,
    pub source_app: Option<String>,
    pub first_copied_at: String,
    pub last_copied_at: String,
    pub copy_count: i64,
    pub is_pinned: bool,
}
