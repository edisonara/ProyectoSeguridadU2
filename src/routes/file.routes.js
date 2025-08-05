const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { verifyToken } = require('../middleware/auth.middleware');
const fileController = require('../controllers/file.controller');

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../public/uploads');
(async () => {
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create uploads directory:', error);
  }
})();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'application/pdf',
    'text/plain'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Routes
router.post('/upload', verifyToken, upload.single('file'), fileController.uploadFile);
router.get('/download/:fileId', verifyToken, fileController.downloadFile);
router.get('/info/:fileId', verifyToken, fileController.getFileInfo);

// Error handling middleware for file uploads
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // A Multer error occurred when uploading
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the limit (10MB)' });
    }
    return res.status(400).json({ error: err.message });
  } else if (err) {
    // An unknown error occurred
    console.error('File upload error:', err);
    return res.status(500).json({ 
      error: 'Failed to upload file',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
  next();
});

module.exports = router;
