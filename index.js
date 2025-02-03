const express = require("express");
const multer = require("multer");
const multerS3 = require("multer-s3");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const { S3 } = require("@aws-sdk/client-s3");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configure AWS S3
const s3 = new S3({
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  region: process.env.AWS_REGION,
});

// S3 Bucket name
const BUCKET_NAME = process.env.BUCKET_NAME;

// Create a new SQLite database (or connect to the existing one)
const db = new sqlite3.Database("gallery.db");

// Middleware for file uploads
const upload = multer({
  storage: multerS3({
    s3: s3,
    acl: "public-read",
    bucket: BUCKET_NAME,
    key: function (req, file, cb) {
      const roomId = req.body.roomId;
      cb(null, `${roomId}/${Date.now()}_${file.originalname}`);
    },
  }),
});

// API: Check Room and List Images
app.post("/room/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const { username } = req.body; // e.g., "all" | "tinu" | "krishna" | etc.

  try {
    // Base query (we'll build on top of this)
    let query = `
      SELECT rooms.name, images.image_url, images.upload_date, images.user
      FROM rooms
      JOIN images ON rooms.id = images.room_id
      WHERE rooms.name = ?
    `;
    const params = [roomId];

    // If username !== "all", we want images matching this username OR "all"

    query += ` AND (images.user = ? OR images.user = "all")`;
    params.push(username);

    // If username === "all", we do NOT add any further filter on images.user
    // so it returns all images in the given room.

    db.all(query, params, (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });
      }
      if (!rows || rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "No images found for this room." });
      }

      return res.json({ success: true, images: rows });
    });
  } catch (error) {
    console.error("Error fetching room:", error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching room.", error });
  }
});

// API: Upload Multiple Images
app.post("/upload", upload.array("images[]"), (req, res) => {
  const { roomId, user } = req.body;

  if (!roomId) {
    return res
      .status(400)
      .json({ success: false, message: "Room ID is required." });
  }

  // Insert room if it doesn't exist
  db.get("SELECT id FROM rooms WHERE name = ?", [roomId], (err, row) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Database error", error: err });
    }

    let roomIdFromDb;
    if (!row) {
      // Create the room
      db.run("INSERT INTO rooms (name) VALUES (?)", [roomId], function () {
        roomIdFromDb = this.lastID;
        uploadImages(req.files, roomIdFromDb);
      });
    } else {
      roomIdFromDb = row.id;
      uploadImages(req.files, roomIdFromDb);
    }

    function uploadImages(files, roomId) {
      files.forEach((file) => {
        const uploadDate = new Date().toISOString();
        db.run(
          "INSERT INTO images (room_id, image_url, upload_date,user) VALUES (?, ?, ?,?)",
          [
            roomId,
            `https://${BUCKET_NAME}.s3.amazonaws.com/${file.key}`,
            uploadDate,
            user || "all",
          ]
        );
      });

      return res.json({
        success: true,
        message: `${files.length} image(s) uploaded successfully.`,
        fileInfo: files.map((file) => ({
          key: file.key,
          location: file.location,
        })),
      });
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
