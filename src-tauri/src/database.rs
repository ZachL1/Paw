use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

use crate::models::HistoryItem;

/// Max characters of `content` returned by list/search/get_item_by_id.
/// Full content is fetched lazily via get_content_by_id / get_item_content.
/// Keeps IPC payloads small when history holds large texts.
pub const CONTENT_PREVIEW_LEN: usize = 2048;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let db_path = Self::db_path()?;
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&db_path)?;
        let db = Self::with_connection(conn)?;
        db.refresh_image_thumbnails()?;
        Ok(db)
    }

    fn with_connection(conn: Connection) -> Result<Self, Box<dyn std::error::Error>> {
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn db_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let data_dir = dirs::data_dir().ok_or("Cannot find data directory")?;
        Ok(data_dir.join("paw").join("history.db"))
    }

    fn init_tables(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL DEFAULT 'text',
                content TEXT,
                title TEXT NOT NULL,
                source_app TEXT,
                first_copied_at DATETIME NOT NULL DEFAULT (datetime('now')),
                last_copied_at DATETIME NOT NULL DEFAULT (datetime('now')),
                copy_count INTEGER NOT NULL DEFAULT 1,
                is_pinned BOOLEAN NOT NULL DEFAULT 0,
                pin_key TEXT,
                thumbnail TEXT,
                content_blob BLOB
            );
            CREATE INDEX IF NOT EXISTS idx_last_copied ON history_items(last_copied_at DESC);
            CREATE INDEX IF NOT EXISTS idx_pinned ON history_items(is_pinned);
            CREATE INDEX IF NOT EXISTS idx_pin_time ON history_items(is_pinned, last_copied_at);",
        )?;

        // Schema migration: add thumbnail column if missing
        let mut cols: Vec<String> = conn
            .prepare("PRAGMA table_info(history_items)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        if !cols.iter().any(|name| name == "thumbnail") {
            conn.execute("ALTER TABLE history_items ADD COLUMN thumbnail TEXT", [])?;
            cols.push("thumbnail".into());
        }

        // In SQLite's record format everything after a large column lives
        // behind that column's overflow chain. Legacy layouts stored
        // content_blob (multi-MB per image) before title/thumbnail, so every
        // row lookup walked megabytes of blob pages (~2s per ordered page of
        // history). Rebuild the table with the BLOB columns last.
        let blob_cid = cols.iter().position(|name| name == "content_blob");
        let pin_cid = cols.iter().position(|name| name == "pin_key");
        if let (Some(blob), Some(pin)) = (blob_cid, pin_cid) {
            if blob < pin {
                conn.execute_batch(
                    "BEGIN IMMEDIATE;
                    CREATE TABLE history_items_migrated (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        content_type TEXT NOT NULL DEFAULT 'text',
                        content TEXT,
                        title TEXT NOT NULL,
                        source_app TEXT,
                        first_copied_at DATETIME NOT NULL DEFAULT (datetime('now')),
                        last_copied_at DATETIME NOT NULL DEFAULT (datetime('now')),
                        copy_count INTEGER NOT NULL DEFAULT 1,
                        is_pinned BOOLEAN NOT NULL DEFAULT 0,
                        pin_key TEXT,
                        thumbnail TEXT,
                        content_blob BLOB
                    );
                    INSERT INTO history_items_migrated
                        (id, content_type, content, title, source_app, first_copied_at,
                         last_copied_at, copy_count, is_pinned, pin_key, thumbnail, content_blob)
                      SELECT id, content_type, content, title, source_app, first_copied_at,
                             last_copied_at, copy_count, is_pinned, pin_key, thumbnail, content_blob
                        FROM history_items;
                    DROP TABLE history_items;
                    ALTER TABLE history_items_migrated RENAME TO history_items;
                    CREATE INDEX IF NOT EXISTS idx_last_copied ON history_items(last_copied_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_pinned ON history_items(is_pinned);
                    CREATE INDEX IF NOT EXISTS idx_pin_time ON history_items(is_pinned, last_copied_at);
                    COMMIT;",
                )?;
            }
        }

        Ok(())
    }

    /// Remove expired items based on auto_clear_days config
    pub fn clear_expired(&self, days: u32) -> Result<usize, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute(
            "DELETE FROM history_items WHERE is_pinned = 0 AND last_copied_at < datetime('now', ?1)",
            params![format!("-{} days", days)],
        )?;
        Ok(deleted)
    }

    /// Trim history to keep at most max_items unpinned entries
    pub fn trim_to_max(&self, max_items: usize) -> Result<usize, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let unpinned_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM history_items WHERE is_pinned = 0",
            [],
            |row| row.get(0),
        )?;
        if unpinned_count as usize <= max_items {
            return Ok(0);
        }
        let to_delete = unpinned_count as usize - max_items;
        let deleted = conn.execute(
            "DELETE FROM history_items WHERE id IN (
                SELECT id FROM history_items WHERE is_pinned = 0
                ORDER BY last_copied_at ASC LIMIT ?1
            )",
            params![to_delete],
        )?;
        Ok(deleted)
    }

    pub fn add_item(
        &self,
        content: &str,
        content_type: &str,
        source_app: Option<&str>,
    ) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let title = truncate_title(content, 200);

        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM history_items WHERE content = ?1 AND content_type = ?2",
                params![content, content_type],
                |row| row.get(0),
            )
            .ok();

        if let Some(id) = existing {
            conn.execute(
                "UPDATE history_items SET last_copied_at = datetime('now'), copy_count = copy_count + 1, source_app = COALESCE(?2, source_app) WHERE id = ?1",
                params![id, source_app],
            )?;
            Ok(id)
        } else {
            conn.execute(
                "INSERT INTO history_items (content_type, content, title, source_app) VALUES (?1, ?2, ?3, ?4)",
                params![content_type, content, title, source_app],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }

    /// Store an image item. `hash` is used for dedup, `png_bytes` stored as BLOB.
    pub fn add_image_item(
        &self,
        png_bytes: &[u8],
        hash: &str,
        width: u32,
        height: u32,
        source_app: Option<&str>,
    ) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let title = format!("Image {}×{}", width, height);

        // Use hash in `content` field for dedup
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM history_items WHERE content = ?1 AND content_type = 'image'",
                params![hash],
                |row| row.get(0),
            )
            .ok();

        if let Some(id) = existing {
            conn.execute(
                "UPDATE history_items SET last_copied_at = datetime('now'), copy_count = copy_count + 1, source_app = COALESCE(?2, source_app) WHERE id = ?1",
                params![id, source_app],
            )?;
            Ok(id)
        } else {
            let thumb = generate_thumbnail_base64(png_bytes);
            conn.execute(
                "INSERT INTO history_items (content_type, content, content_blob, thumbnail, title, source_app) VALUES ('image', ?1, ?2, ?3, ?4, ?5)",
                params![hash, png_bytes, thumb, title, source_app],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }

    fn refresh_image_thumbnails(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Two-phase: only rows missing a thumbnail get their content_blob
        // (multi-MB PNGs) fetched at all. Reading the blob column for healthy
        // rows walks megabytes of overflow pages per row and slows startup.
        let stale_ids: Vec<i64> = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT id, thumbnail FROM history_items
                 WHERE content_type = 'image'
                   AND content_blob IS NOT NULL
                 ORDER BY last_copied_at DESC
                 LIMIT 200",
            )?;
            let ids = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
                })?
                .filter_map(|r| {
                    let (id, thumbnail) = r.ok()?;
                    thumbnail_needs_refresh(thumbnail.as_deref()).then_some(id)
                })
                .collect::<Vec<_>>();
            ids
        };

        if stale_ids.is_empty() {
            return Ok(());
        }

        let conn = self.conn.lock().unwrap();
        for id in stale_ids {
            let blob: Option<Vec<u8>> = conn
                .query_row(
                    "SELECT content_blob FROM history_items WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .ok();
            if let Some(blob) = blob {
                if let Some(thumbnail) = generate_thumbnail_base64(&blob) {
                    conn.execute(
                        "UPDATE history_items SET thumbnail = ?1 WHERE id = ?2",
                        params![thumbnail, id],
                    )?;
                }
            }
        }

        Ok(())
    }

    pub fn get_all(&self, max_items: usize) -> Result<Vec<HistoryItem>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT id, content_type, SUBSTR(content, 1, {CONTENT_PREVIEW_LEN}), thumbnail, title, source_app,
                    first_copied_at, last_copied_at, copy_count, is_pinned
              FROM history_items
             WHERE is_pinned = 1
                OR id IN (
                    SELECT id FROM history_items
                    WHERE is_pinned = 0
                    ORDER BY last_copied_at DESC
                    LIMIT ?1
                )
             ORDER BY is_pinned DESC, last_copied_at DESC"
        ))?;

        let items = stmt
            .query_map(params![max_items], |row| {
                Ok(HistoryItem {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    content: row.get(2)?,
                    title: row.get(4)?,
                    source_app: row.get(5)?,
                    first_copied_at: row.get(6)?,
                    last_copied_at: row.get(7)?,
                    copy_count: row.get(8)?,
                    is_pinned: row.get(9)?,
                    thumbnail: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(items)
    }

    /// Search history items by query string (case-insensitive substring match on content and title)
    pub fn search(&self, query: &str, max_items: usize) -> Result<Vec<HistoryItem>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        // Escape LIKE wildcards so user input is treated as literal text
        let escaped = query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{}%", escaped);
        let mut stmt = conn.prepare(&format!(
            "SELECT id, content_type, SUBSTR(content, 1, {CONTENT_PREVIEW_LEN}), title, source_app,
                    first_copied_at, last_copied_at, copy_count, is_pinned
              FROM history_items
             WHERE (
                    is_pinned = 1
                    AND (title LIKE ?1 ESCAPE '\\' OR content LIKE ?1 ESCAPE '\\')
                  )
                OR id IN (
                    SELECT id FROM history_items
                    WHERE is_pinned = 0
                      AND (title LIKE ?2 ESCAPE '\\' OR content LIKE ?2 ESCAPE '\\')
                    ORDER BY last_copied_at DESC
                    LIMIT ?3
                )
             ORDER BY is_pinned DESC, last_copied_at DESC
             "
        ))?;

        let items = stmt
            .query_map(params![pattern, pattern, max_items], |row| {
                Ok(HistoryItem {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    content: row.get(2)?,
                    title: row.get(3)?,
                    source_app: row.get(4)?,
                    first_copied_at: row.get(5)?,
                    last_copied_at: row.get(6)?,
                    copy_count: row.get(7)?,
                    is_pinned: row.get(8)?,
                    // Thumbnails dominate the payload (tens of MB for broad
                    // queries, re-shipped on every keystroke). The frontend
                    // hydrates them from the history it already loaded.
                    thumbnail: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(items)
    }

    /// Fetch a single item by ID (used for incremental updates)
    pub fn get_item_by_id(&self, id: i64) -> Result<Option<HistoryItem>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let item = conn
            .query_row(
                &format!(
                    "SELECT id, content_type, SUBSTR(content, 1, {CONTENT_PREVIEW_LEN}), thumbnail, title, source_app,
                            first_copied_at, last_copied_at, copy_count, is_pinned
                     FROM history_items WHERE id = ?1"
                ),
                params![id],
                |row| {
                    Ok(HistoryItem {
                        id: row.get(0)?,
                        content_type: row.get(1)?,
                        content: row.get(2)?,
                        title: row.get(4)?,
                        source_app: row.get(5)?,
                        first_copied_at: row.get(6)?,
                        last_copied_at: row.get(7)?,
                        copy_count: row.get(8)?,
                        is_pinned: row.get(9)?,
                        thumbnail: row.get(3)?,
                    })
                },
            )
            .ok();
        Ok(item)
    }

    pub fn get_image_blob(&self, id: i64) -> Result<Option<Vec<u8>>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let blob = conn
            .query_row(
                "SELECT content_blob FROM history_items WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .ok();
        Ok(blob)
    }

    pub fn get_content_type(&self, id: i64) -> Result<String, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let ct = conn.query_row(
            "SELECT content_type FROM history_items WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(ct)
    }

    pub fn toggle_pin(&self, id: i64) -> Result<bool, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let is_pinned: bool = conn.query_row(
            "SELECT is_pinned FROM history_items WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        let new_state = !is_pinned;
        conn.execute(
            "UPDATE history_items SET is_pinned = ?1 WHERE id = ?2",
            params![new_state, id],
        )?;
        Ok(new_state)
    }

    /// Update last_copied_at and increment copy_count (used when pasting from history)
    pub fn touch_item(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE history_items SET last_copied_at = datetime('now'), copy_count = copy_count + 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn get_content_by_id(
        &self,
        id: i64,
    ) -> Result<Option<String>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let content = conn
            .query_row(
                "SELECT content FROM history_items WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .ok();
        Ok(content)
    }

    pub fn delete_item(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM history_items WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_all(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM history_items WHERE is_pinned = 0", [])?;
        Ok(())
    }
}

fn truncate_title(s: &str, max_len: usize) -> String {
    let normalized = s.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let first_non_empty = lines
        .iter()
        .enumerate()
        .find(|(_, line)| !line.trim().is_empty());

    let Some((index, line)) = first_non_empty else {
        return String::new();
    };

    let mut title = if index > 0 {
        format!("⏎{}", line.trim())
    } else {
        line.trim().to_string()
    };

    if title.chars().count() > max_len {
        title = format!("{}…", title.chars().take(max_len).collect::<String>());
    }

    title
}

/// Generate a list thumbnail that preserves enough detail for inline previews.
fn generate_thumbnail_base64(png_bytes: &[u8]) -> Option<String> {
    use image::ImageReader;
    use std::io::Cursor;

    let img = ImageReader::new(Cursor::new(png_bytes))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;

    let thumb = img.thumbnail(520, 160);
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    thumb
        .write_to(&mut cursor, image::ImageFormat::Png)
        .ok()?;

    Some(BASE64.encode(&buf))
}

fn thumbnail_needs_refresh(thumbnail: Option<&str>) -> bool {
    let Some(thumbnail) = thumbnail else {
        return true;
    };

    let Ok(bytes) = BASE64.decode(thumbnail) else {
        return true;
    };

    let Ok(img) = image::load_from_memory(&bytes) else {
        return true;
    };

    let width = img.width();
    let height = img.height();
    width < 180 && height < 90
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::io::Cursor;

    fn test_db() -> Database {
        Database::with_connection(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn tiny_png() -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([10u8, 20, 30, 255]));
        let mut buf = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut buf, image::ImageFormat::Png)
            .unwrap();
        buf.into_inner()
    }

    #[test]
    fn get_all_truncates_long_content() {
        let db = test_db();
        let id = db.add_item(&"x".repeat(100_000), "text", None).unwrap();
        let item = db
            .get_all(100)
            .unwrap()
            .into_iter()
            .find(|i| i.id == id)
            .unwrap();
        assert_eq!(item.content.as_ref().unwrap().chars().count(), CONTENT_PREVIEW_LEN);
    }

    #[test]
    fn get_all_keeps_short_content() {
        let db = test_db();
        let id = db.add_item("hello", "text", None).unwrap();
        let item = db
            .get_all(100)
            .unwrap()
            .into_iter()
            .find(|i| i.id == id)
            .unwrap();
        assert_eq!(item.content.as_deref(), Some("hello"));
    }

    #[test]
    fn truncation_is_utf8_safe() {
        let db = test_db();
        let id = db.add_item(&"🦀".repeat(10_000), "text", None).unwrap();
        let item = db
            .get_all(100)
            .unwrap()
            .into_iter()
            .find(|i| i.id == id)
            .unwrap();
        let content = item.content.unwrap();
        assert_eq!(content.chars().count(), CONTENT_PREVIEW_LEN);
    }

    #[test]
    fn paste_content_is_not_truncated() {
        let db = test_db();
        let text = "y".repeat(100_000);
        let id = db.add_item(&text, "text", None).unwrap();
        assert_eq!(
            db.get_content_by_id(id).unwrap().as_deref(),
            Some(text.as_str())
        );
    }

    #[test]
    fn search_matches_full_content_but_returns_truncated() {
        let db = test_db();
        let mut text = "z".repeat(3000);
        text.push_str(" NEEDLE");
        let id = db.add_item(&text, "text", None).unwrap();
        let results = db.search("NEEDLE", 100).unwrap();
        let item = results
            .into_iter()
            .find(|i| i.id == id)
            .expect("needle beyond preview length must still be found");
        assert_eq!(item.content.as_ref().unwrap().chars().count(), CONTENT_PREVIEW_LEN);
    }

    #[test]
    fn get_item_by_id_truncates() {
        let db = test_db();
        let id = db.add_item(&"w".repeat(50_000), "text", None).unwrap();
        let item = db.get_item_by_id(id).unwrap().unwrap();
        assert_eq!(item.content.as_ref().unwrap().chars().count(), CONTENT_PREVIEW_LEN);
    }

    #[test]
    fn image_items_keep_hash_content_and_thumbnail() {
        let db = test_db();
        let id = db
            .add_image_item(&tiny_png(), "hash123", 4, 4, None)
            .unwrap();
        let item = db.get_item_by_id(id).unwrap().unwrap();
        assert_eq!(item.content.as_deref(), Some("hash123"));
        assert!(item.thumbnail.is_some());
        assert_eq!(item.title, "Image 4×4");
    }

    #[test]
    fn legacy_column_order_is_migrated() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE history_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL DEFAULT 'text',
                content TEXT,
                content_blob BLOB,
                thumbnail TEXT,
                title TEXT NOT NULL,
                source_app TEXT,
                first_copied_at DATETIME NOT NULL DEFAULT (datetime('now')),
                last_copied_at DATETIME NOT NULL DEFAULT (datetime('now')),
                copy_count INTEGER NOT NULL DEFAULT 1,
                is_pinned BOOLEAN NOT NULL DEFAULT 0,
                pin_key TEXT
            );",
        )
        .unwrap();
        let png = tiny_png();
        conn.execute(
            "INSERT INTO history_items (content_type, content, content_blob, thumbnail, title)
             VALUES ('image', 'hash-legacy', ?1, 'thumb-legacy', 'Image 4×4')",
            params![png],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO history_items (content_type, content, title) VALUES ('text', 'note', 'note')",
            [],
        )
        .unwrap();

        let db = Database::with_connection(conn).unwrap();

        let conn = db.conn.lock().unwrap();
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(history_items)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let blob = cols.iter().position(|n| n == "content_blob").unwrap();
        let pin = cols.iter().position(|n| n == "pin_key").unwrap();
        let thumb = cols.iter().position(|n| n == "thumbnail").unwrap();
        assert!(blob > pin && blob > thumb, "blob columns must move last, got {cols:?}");

        let migrated: Vec<(String, String, Option<Vec<u8>>, Option<String>)> = conn
            .prepare("SELECT content_type, content, content_blob, thumbnail FROM history_items ORDER BY id")
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(migrated.len(), 2);
        assert_eq!(migrated[0].0, "image");
        assert_eq!(migrated[0].1, "hash-legacy");
        assert_eq!(migrated[0].2.as_deref(), Some(png.as_slice()));
        assert_eq!(migrated[0].3.as_deref(), Some("thumb-legacy"));
        assert_eq!(migrated[1].0, "text");
        assert_eq!(migrated[1].1, "note");

        let has_pin_time: bool = conn
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_pin_time'")
            .unwrap()
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|v| v == 1)
            .unwrap_or(false);
        assert!(has_pin_time);
    }

    #[test]
    fn migrated_layout_is_not_remigrated() {
        let conn = Connection::open_in_memory().unwrap();
        let db = Database::with_connection(conn).unwrap();
        db.add_item("hello", "text", None).unwrap();

        let cols: Vec<String> = {
            let conn = db.conn.lock().unwrap();
            let mut stmt = conn
                .prepare("PRAGMA table_info(history_items)")
                .unwrap();
            stmt.query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        let blob = cols.iter().position(|n| n == "content_blob").unwrap();
        let pin = cols.iter().position(|n| n == "pin_key").unwrap();
        assert!(blob > pin);

        db.add_item("world", "text", None).unwrap();
        assert_eq!(db.get_all(100).unwrap().len(), 2);
    }
}
