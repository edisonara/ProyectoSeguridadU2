const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  fileId: {
    type: String,
    required: true,
    unique: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  hash: {
    type: String,
    required: true
  },
  ipfsHash: {
    type: String
  },
  txHash: {
    type: String
  },
  metadata: {
    original: {
      type: mongoose.Schema.Types.Mixed
    },
    cleaned: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  userId: {
    type: String,
    required: true,
    default: 'anonymous'
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'processed'],
    default: 'pending'
  },
  cleaned: {
    type: Boolean,
    default: false
  },
  error: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for faster queries
fileSchema.index({ fileId: 1 });
fileSchema.index({ userId: 1 });
fileSchema.index({ hash: 1 });
fileSchema.index({ ipfsHash: 1 });
fileSchema.index({ 'metadata.original.GPSLatitude': 1, 'metadata.original.GPSLongitude': 1 });

module.exports = mongoose.model('File', fileSchema);
fileSchema.statics.findByFileId = function(fileId) {
  return this.findOne({ fileId });
};

fileSchema.statics.findByUserId = function(userId) {
  return this.find({ userId });
};

fileSchema.statics.findByHash = function(hash) {
  return this.findOne({ hash });
};

// Instance methods
fileSchema.methods.toJSON = function() {
  const file = this.toObject();
  delete file.__v;
  delete file._id;
  delete file.userId;
  return file;
};

const File = mongoose.model('File', fileSchema);

module.exports = File;
