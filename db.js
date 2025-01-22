const sqlite3 = require('sqlite3').verbose();

// Create a new SQLite database (or connect to the existing one)
const db = new sqlite3.Database('gallery.db');

// Create tables if they don't exist
db.serialize(() => {
  // Create rooms table
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);

  // Create images table
  db.run(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER,
      image_url TEXT NOT NULL,
      upload_date TEXT NOT NULL,
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    )
  `);
});
