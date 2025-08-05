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
  fileName: {
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
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['uploaded', 'processing', 'completed', 'failed'],
    default: 'uploaded'
  },
  error: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for faster queries
fileSchema.index({ fileId: 1 });
fileSchema.index({ userId: 1 });
fileSchema.index({ hash: 1 });
fileSchema.index({ ipfsHash: 1 });
fileSchema.index({ 'metadata.original.GPSLatitude': 1, 'metadata.original.GPSLongitude': 1 });

// Static methods
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
