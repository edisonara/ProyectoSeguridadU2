const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    room: { type: String, default: 'general' },
    username: String,
    message: String,
    timestamp: { type: Date, default: Date.now },
    role: String,
    type: { type: String, default: 'text' }
});

module.exports = mongoose.model("Message", messageSchema);
