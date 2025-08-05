const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const exiftool = require('exiftool-vendored').exiftool;

const execPromise = util.promisify(exec);

// Validate file type
const validateFileType = (req, res, next) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'application/pdf',
    'text/plain'
  ];

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' });
  }

  next();
};

// Validate file size
const validateFileSize = (req, res, next) => {
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (req.file.size > maxSize) {
    return res.status(400).json({ error: 'File size exceeds limit (10MB)' });
  }
  
  next();
};

// Scan file for malicious content
const scanFile = async (req, res, next) => {
  try {
    // Simple virus scan using ClamAV if available
    if (process.env.CLAMSCAN_PATH) {
      const { stdout, stderr } = await execPromise(
        `${process.env.CLAMSCAN_PATH} --no-summary ${req.file.path}`
      );
      
      if (stderr || stdout.includes('FOUND')) {
        await fs.unlink(req.file.path);
        return res.status(400).json({ error: 'File contains malicious content' });
      }
    }
    next();
  } catch (error) {
    console.error('Virus scan error:', error);
    next(); // Continue even if scan fails
  }
};

// Extract and validate metadata
const processMetadata = async (req, res, next) => {
  try {
    const metadata = await exiftool.read(req.file.path).catch(() => ({}));
    
    // Check for potentially sensitive metadata
    const sensitiveFields = [
      'GPSLatitude', 'GPSLongitude', 'GPSPosition',
      'Creator', 'Author', 'LastModifiedBy',
      'CreateDate', 'ModifyDate', 'Software',
      'History', 'XMPToolkit'
    ];
    
    const sensitiveData = {};
    sensitiveFields.forEach(field => {
      if (metadata[field]) {
        sensitiveData[field] = metadata[field];
      }
    });
    
    // Attach metadata to request for later use
    req.file.metadata = {
      original: metadata,
      sensitive: Object.keys(sensitiveData).length > 0 ? sensitiveData : null
    };
    
    next();
  } catch (error) {
    console.error('Metadata processing error:', error);
    next();
  }
};

// Clean up temporary files in case of errors
const cleanupTempFiles = async (req, res, next) => {
  try {
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(console.error);
    }
    next();
  } catch (error) {
    console.error('Cleanup error:', error);
    next(error);
  }
};

module.exports = {
  validateFileType,
  validateFileSize,
  scanFile,
  processMetadata,
  cleanupTempFiles
};
