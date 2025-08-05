require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const socketIO = require("socket.io");
const path = require("path");

const authRoutes = require("./routes/auth.routes");
const chatRoutes = require("./routes/chat.routes");
const fileRoutes = require("./routes/file.routes");
const { verifyToken } = require("./middleware/auth.middleware");
const { processMetadata, cleanupTempFiles } = require("./middleware/file.middleware");
const Message = require("./models/Message");
const { handleSocketAuth } = require("./middleware/socketAuth.middleware");

const app = express();
// ---------- File uploads -------------
const multer = require('multer');
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, unique + '_' + safeName);
    }
});
const upload = multer({ storage });
app.use('/uploads', express.static(uploadsDir));
const server = http.createServer(app);
const io = socketIO(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Rutas
app.use("/auth", authRoutes);
app.use("/chat", verifyToken, chatRoutes);
app.use("/api/files", fileRoutes);

// File upload error handling
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  } else if (err) {
    console.error('File upload error:', err);
    return res.status(500).json({ 
      error: 'File upload failed',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
  next();
});

// Conexión principal
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Conexión segura a sockets
io.use(handleSocketAuth);

// Endpoint para subir archivos
app.post('/files/upload', verifyToken, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url, name: req.file.originalname });
});

io.on("connection", (socket) => {
    console.log(`Usuario conectado: ${socket.user.username}`);

    socket.on("chat-message", async (data) => {
        // Persistir en DB
        try {
            await Message.create({
                room: data.room || 'general',
                username: socket.user.username,
                message: data.message,
                role: socket.user.role,
                type: data.type || 'text',
            });
        } catch (err) {
            console.error('Error guardando mensaje:', err.message);
        }
        const room = data.room || 'general';
        io.to(room).emit("chat-message", { 
            room,
            timestamp: new Date(),
            username: socket.user.username,
            message: data.message,
            role: socket.user.role,
            type: data.type || 'text'
        });
    });

    socket.on("join", (room) => {
        socket.join(room);
    });

    socket.on("leave", (room) => {
        socket.leave(room);
    });

    socket.on("disconnect", () => {
        console.log(`Usuario desconectado: ${socket.user.username}`);
    });
});

// Configuración de MongoDB con URI por defecto
const mongoUri = process.env.MONGO_URI || "mongodb://admin:password123@localhost:27017/espe-chat?authSource=admin";
const port = process.env.PORT || 8081;

console.log("Intentando conectar a MongoDB con URI:", mongoUri);
console.log("Puerto configurado:", port);

mongoose.connect(mongoUri)
    .then(() => {
        console.log("✅ Conexión a MongoDB establecida exitosamente");
        server.listen(port, () => {
            console.log(`🚀 Servidor ejecutándose en el puerto ${port}`);
            console.log(`📱 Frontend URL: http://localhost:3000`);
            console.log(`🔧 API URL: http://localhost:${port}/auth`);
        });
    })
    .catch((err) => {
        console.error("❌ Error de conexión a MongoDB:", err.message);
        if (err.message.includes('authentication')) {
            console.log("💡 Sugerencia: Verifica las credenciales de MongoDB");
        } else if (err.message.includes('ECONNREFUSED')) {
            console.log("💡 Sugerencia: MongoDB no está ejecutándose");
        }
        process.exit(1);
    });
