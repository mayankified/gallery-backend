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

// SQLite Database
const db = new sqlite3.Database("gallery.db", (err) => {
  if (err) {
    console.error("Database Connection Error:", err.message);
  } else {
    console.log("Connected to SQLite Database.");
  }
});

// Middleware for file uploads
const upload = multer({
  storage: multerS3({
    s3: s3,
    acl: "public-read",
    bucket: BUCKET_NAME,
    key: function (req, file, cb) {
      const roomId = req.body.roomId;
      const fileName = `${roomId}/${Date.now()}_${file.originalname}`;
      console.log(`Uploading to S3: ${fileName}`);
      cb(null, fileName);
    },
  }),
});

// ✅ Check Room and List Images API
app.post("/room/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const { username } = req.body;

  console.log(`Fetching images for room: ${roomId}, username: ${username}`);

  let query = `
    SELECT rooms.name, images.image_url, images.upload_date, images.user
    FROM rooms
    JOIN images ON rooms.id = images.room_id
    WHERE rooms.name = ?
  `;
  const params = [roomId];

  query += ` AND (images.user = ? OR images.user = "all")`;
  params.push(username);

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error("Database Query Error:", err);
      return res.status(500).json({ success: false, message: "Database error", error: err });
    }
    if (!rows || rows.length === 0) {
      console.log("No images found.");
      return res.status(404).json({ success: false, message: "No images found for this room." });
    }
    console.log(`Found ${rows.length} images.`);
    return res.json({ success: true, images: rows });
  });
});

// ✅ Upload Multiple Images API
app.post("/upload", upload.array("images[]"), (req, res) => {
  const { roomId, user } = req.body;

  console.log(`Received upload request for roomId: ${roomId}, user: ${user}`);
  console.log("Files received:", req.files);

  if (!roomId) {
    return res.status(400).json({ success: false, message: "Room ID is required." });
  }

  // Check if the room exists
  db.get("SELECT id FROM rooms WHERE name = ?", [roomId], (err, row) => {
    if (err) {
      console.error("Database Error:", err);
      return res.status(500).json({ success: false, message: "Database error", error: err });
    }

    let roomIdFromDb;
    if (!row) {
      // Create a new room
      db.run("INSERT INTO rooms (name) VALUES (?)", [roomId], function () {
        roomIdFromDb = this.lastID;
        console.log(`Created new room: ${roomId}, ID: ${roomIdFromDb}`);
        uploadImages(req.files, roomIdFromDb);
      });
    } else {
      roomIdFromDb = row.id;
      console.log(`Room exists: ${roomId}, ID: ${roomIdFromDb}`);
      uploadImages(req.files, roomIdFromDb);
    }

    function uploadImages(files, roomId) {
      if (!files || files.length === 0) {
        console.error("No files received for upload.");
        return res.status(400).json({ success: false, message: "No images uploaded." });
      }

      console.log(`Uploading ${files.length} images to database...`);
      files.forEach((file) => {
        const uploadDate = new Date().toISOString();
        const fileUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${file.key}`;

        console.log(`Saving image to DB: ${fileUrl}`);

        db.run(
          "INSERT INTO images (room_id, image_url, upload_date, user) VALUES (?, ?, ?, ?)",
          [roomId, fileUrl, uploadDate, user || "all"],
          (err) => {
            if (err) {
              console.error("Database Insert Error:", err);
            } else {
              console.log(`Image saved: ${fileUrl}`);
            }
          }
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

// ✅ Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
