const jwt = require("jsonwebtoken");

function handleSocketAuth(socket, next) {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Token requerido"));

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
        next();
    } catch {
        return next(new Error("Token inválido"));
    }
}

module.exports = { handleSocketAuth };
