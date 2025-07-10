const express = require("express");
const Message = require("../models/Message");
const { verifyToken } = require("../middleware/auth.middleware");

const router = express.Router();

// Historial de mensajes
router.get("/history", verifyToken, async (req, res) => {
    const room = req.query.room || 'general';
    const filter = room === 'all' ? {} : { room };
    const messages = await Message.find(filter).sort({ timestamp: 1 });
    res.json(messages);
});

// Guardar nuevo mensaje
router.post("/send", verifyToken, async (req, res) => {
    const newMsg = new Message({
        username: req.user.username,
        message: req.body.message,
        role: req.user.role
    });

    await newMsg.save();
    res.status(201).json({ message: "Mensaje guardado" });
});

// Eliminar mensaje (admin solo)
router.delete("/:id", verifyToken, async (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ message: "No autorizado" });
    }

    await Message.findByIdAndDelete(req.params.id);
    res.json({ message: "Mensaje eliminado" });
});

module.exports = router;
