use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

use crate::models::HistoryItem;

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
                content_blob BLOB,
                thumbnail TEXT,
                title TEXT NOT NULL,
                source_app TEXT,
                first_copied_at DATETIME NOT NULL DEFAULT (datetime('now')),
                last_copied_at DATETIME NOT NULL DEFAULT (datetime('now')),
                copy_count INTEGER NOT NULL DEFAULT 1,
                is_pinned BOOLEAN NOT NULL DEFAULT 0,
                pin_key TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_last_copied ON history_items(last_copied_at DESC);
            CREATE INDEX IF NOT EXISTS idx_pinned ON history_items(is_pinned);",
        )?;

        // Schema migration: add thumbnail column if missing
        let has_thumbnail: bool = conn
            .prepare("PRAGMA table_info(history_items)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .any(|name| name.map(|n| n == "thumbnail").unwrap_or(false));
        if !has_thumbnail {
            conn.execute("ALTER TABLE history_items ADD COLUMN thumbnail TEXT", [])?;
        }

        Ok(())
    }

    pub fn add_item(
        &self,
        content: &str,
        content_type: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
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
                "UPDATE history_items SET last_copied_at = datetime('now'), copy_count = copy_count + 1 WHERE id = ?1",
                params![id],
            )?;
        } else {
            conn.execute(
                "INSERT INTO history_items (content_type, content, title) VALUES (?1, ?2, ?3)",
                params![content_type, content, title],
            )?;
        }
        Ok(())
    }

    /// Store an image item. `hash` is used for dedup, `png_bytes` stored as BLOB.
    pub fn add_image_item(
        &self,
        png_bytes: &[u8],
        hash: &str,
        width: u32,
        height: u32,
    ) -> Result<(), Box<dyn std::error::Error>> {
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
                "UPDATE history_items SET last_copied_at = datetime('now'), copy_count = copy_count + 1 WHERE id = ?1",
                params![id],
            )?;
        } else {
            let thumb = generate_thumbnail_base64(png_bytes);
            conn.execute(
                "INSERT INTO history_items (content_type, content, content_blob, thumbnail, title) VALUES ('image', ?1, ?2, ?3, ?4)",
                params![hash, png_bytes, thumb, title],
            )?;
        }
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<HistoryItem>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content_type, content, thumbnail, title, source_app,
                    first_copied_at, last_copied_at, copy_count, is_pinned
             FROM history_items
             ORDER BY is_pinned DESC, last_copied_at DESC
             LIMIT 1000",
        )?;

        let items = stmt
            .query_map([], |row| {
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
    let single_line: String = s.lines().next().unwrap_or("").to_string();
    if single_line.len() <= max_len {
        single_line
    } else {
        format!("{}…", &single_line[..max_len])
    }
}

/// Generate a small thumbnail (max 48px height) as base64 PNG
fn generate_thumbnail_base64(png_bytes: &[u8]) -> Option<String> {
    use image::ImageReader;
    use std::io::Cursor;

    let img = ImageReader::new(Cursor::new(png_bytes))
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;

    let thumb = img.thumbnail(64, 48);
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    thumb
        .write_to(&mut cursor, image::ImageFormat::Png)
        .ok()?;

    Some(BASE64.encode(&buf))
}
