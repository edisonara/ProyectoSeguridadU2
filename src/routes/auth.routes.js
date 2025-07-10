const express = require("express");
const bcrypt = require("bcrypt");
const JWT_SECRET = process.env.JWT_SECRET || "default_secret";
const jwt = require("jsonwebtoken");
const { sendEmail } = require("../utils/email");
const SKIP_OTP = process.env.SKIP_OTP === 'true';
const User = require("../models/User");

const router = express.Router();

// Registro
router.post("/register", async (req, res) => {
    try {
        const { username, email, password, role } = req.body;

        // Validaciones
        if (!username || !password) {
            return res.status(400).json({ 
                error: true,
                message: "Usuario y contraseña son requeridos" 
            });
        }

        if (password.length < 8) {
            return res.status(400).json({ 
                error: true,
                message: "La contraseña debe tener al menos 8 caracteres" 
            });
        }

        const exists = await User.findOne({ $or: [{ username }, { email }] });
        if (exists) {
            return res.status(400).json({ 
                error: true,
                message: "El usuario ya existe" 
            });
        }

        // Generar código OTP de verificación inicial (opcional)
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = Date.now() + 5*60*1000;

        // Hash de la contraseña
        const hashed = await bcrypt.hash(password, 10);

        // Crear y guardar usuario
        const user = new User({ 
            username, 
            password: hashed,
            email,
            role: role || "usuario",
            otpCode,
            otpExpires 
        });
        await user.save();

        // Enviar email de bienvenida y código
        try {
            await sendEmail(email, 'Bienvenido a ChatSeguro', `<p>Registro exitoso. Tu código de verificación inicial es <b>${otpCode}</b></p>`);
        } catch(err) { console.error('Error enviando email:', err); }

        res.status(201).json({ message: 'Registro exitoso' });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ 
            error: true,
            message: "Error en el servidor" 
        });
    }
});

// Login
router.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validaciones
        if (!username || !password) {
            return res.status(400).json({ 
                error: true,
                message: "Usuario y contraseña son requeridos" 
            });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ 
                error: true,
                message: "Credenciales inválidas" 
            });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ 
                error: true,
                message: "Credenciales inválidas" 
            });
        }

        // Si se configura SKIP_OTP, devolvemos el token final directamente
        if (SKIP_OTP) {
            const token = jwt.sign(
                {
                    id: user._id,
                    username: user.username,
                    role: user.role,
                },
                JWT_SECRET,
                { expiresIn: '1h' }
            );
            return res.status(200).json({
                message: 'Autenticación exitosa (OTP omitido)',
                token,
                role: user.role,
            });
        }

        // Generar y enviar código OTP por correo
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        user.otpCode = code;
        user.otpExpires = Date.now() + 5*60*1000;
        await user.save();
        try {
            await sendEmail(user.email, 'Tu código OTP para ChatSeguro', `<h1>${code}</h1><p>Válido por 5 minutos.</p>`);
        } catch(err) { console.error('Error enviando email OTP:', err); }

        // Generar token temporal para verificación
        const tempToken = jwt.sign(
            { id: user._id, type: 'temp' },
            JWT_SECRET,
            { expiresIn: "5m" }
        );

        res.status(200).json({ 
            message: "Primera fase de autenticación exitosa",
            tempToken
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ 
            error: true,
            message: "Error en el servidor" 
        });
    }
});

// Verificación OTP
router.post("/verify-otp", async (req, res) => {
    if (SKIP_OTP) {
        // Saltar OTP y devolver éxito usando username del body
        try {
            const { username } = req.body;
            const user = await User.findOne({ username });
            if (!user) {
                return res.status(404).json({ error: true, message: 'Usuario no encontrado' });
            }
            const token = jwt.sign(
                { id: user._id, username: user.username, role: user.role },
                JWT_SECRET,
                { expiresIn: '1h' }
            );
            return res.status(200).json({ message: 'Autenticación exitosa (OTP omitido)', token, role: user.role });
        } catch (err) {
            console.error('Error en verificación OTP omitida:', err);
            return res.status(500).json({ error: true, message: 'Error en el servidor' });
        }
    }

    try {
        // Verificar token temporal
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: true,
                message: "Token temporal no proporcionado"
            });
        }

        const tempToken = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(tempToken, JWT_SECRET);
            if (decoded.type !== 'temp') {
                throw new Error('Token inválido');
            }
        } catch (err) {
            return res.status(401).json({
                error: true,
                message: "Token temporal inválido o expirado"
            });
        }

        const { username, otp } = req.body;

        // Validaciones
        if (!username || !otp) {
            return res.status(400).json({ 
                error: true,
                message: "Usuario y código OTP son requeridos" 
            });
        }

        const user = await User.findOne({ username });
        if (!user || user._id.toString() !== decoded.id) {
            return res.status(401).json({ 
                error: true,
                message: "Usuario no encontrado o no autorizado" 
            });
        }

        // Verificar código
        if (user.otpCode !== otp || user.otpExpires < Date.now()) {
            return res.status(401).json({ 
                error: true,
                message: "Código OTP inválido o expirado" 
            });
        }

        // Limpiar código utilizado
        user.otpCode = undefined;
        user.otpExpires = undefined;
        await user.save();

        // Generar token JWT final
        const token = jwt.sign(
            { 
                id: user._id, 
                username: user.username, 
                role: user.role 
            },
            JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.status(200).json({ 
            message: "Autenticación exitosa",
            token,
            role: user.role
        });
    } catch (error) {
        console.error('Error en verificación OTP:', error);
        res.status(500).json({ 
            error: true,
            message: "Error en el servidor" 
        });
    }
});

module.exports = router;
