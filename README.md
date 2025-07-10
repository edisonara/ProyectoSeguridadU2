<p align="center">
  <a href="https://github.com/your-org/chatseguro" target="_blank">
    <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="license" />
  </a>
  <img src="https://img.shields.io/badge/Node.js-%3E=18-green?style=for-the-badge" alt="node-version" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="prs-welcome" />
</p>

<h1 align="center">🛡️ ChatSeguro</h1>
<p align="center">
  ChatSeguro es una aplicación de chat en tiempo real enfocada en la <b>seguridad</b> y la facilidad de despliegue.
</p>

---

## 📑 Tabla de Contenido
- [Características](#características)
- [Tech-Stack](#tech-stack)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Variables de entorno clave](#variables-de-entorno-clave)
- [Scripts npm](#scripts-npm)
- [Endpoints principales](#endpoints-principales)
- [Flujo de autenticación](#flujo-de-autenticación)
- [Seguridad implementada](#seguridad-implementada)
- [Despliegue](#despliegue)
- [Roadmap](#roadmap)
- [Licencia](#licencia)

---

## Características

- Registro y login con contraseña hasheada (bcrypt)
- Segundo factor opcional mediante OTP enviado por correo
- Autenticación y autorización basadas en JWT (roles: `admin`, `moderador`, `usuario`)
- Chat en tiempo real usando WebSocket (Socket.IO)
- Historial de mensajes almacenado en MongoDB
- Subida/descarga de archivos con validaciones usando Multer
- Variables sensibles gestionadas con **dotenv**
- CORS configurable y preparado para TLS/HTTPS

## Tech-Stack

| Capa | Tecnología |
|------|------------|
| Backend | Node.js, Express, Socket.IO, Mongoose |
| Base de datos | MongoDB |
| Autenticación | JSON Web Tokens (JWT), bcrypt |
| Seguridad extra | OTP por email (nodemailer) |
| Frontend | HTML + Vanilla JS + Socket.IO client |

## Estructura del proyecto

```
ProyectoSeguridadU2/
├── src/
│   ├── models/       # Esquemas de Mongoose (User, Message)
│   ├── routes/       # Rutas REST (auth, chat)
│   ├── middleware/   # Middlewares de auth para HTTP y WebSocket
│   ├── public/       # Frontend estático (HTML, CSS, JS)
│   └── server.js     # Punto de entrada del servidor
├── .env.example      # Plantilla de variables de entorno
├── package.json      # Dependencias y scripts
└── README.md
```

## Requisitos

- Node.js ≥ 18
- MongoDB ≥ 4.4
- (Opcional) Cuenta SMTP para envío de correos (Gmail, Mailtrap, etc.)

## Instalación

```bash
# Clonar repositorio
$ git clone <repo-url>
$ cd ProyectoSeguridadU2

# Instalar dependencias
$ npm install

# Copiar y editar variables de entorno
$ cp .env.example .env
$ npm run dev   # o: npm start
```

La API se levantará en `http://localhost:8081` y el frontend estático en la misma URL raíz (`/`).

## Variables de entorno clave

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto de Express (default 8081) |
| `MONGO_URI` | Cadena de conexión MongoDB |
| `JWT_SECRET` | Clave para firmar tokens JWT |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Credenciales SMTP para OTP |
| `SKIP_OTP` | `true` para desactivar temporalmente la verificación OTP |

## Scripts npm

| Comando | Acción |
|---------|--------|
| `npm start` | Ejecuta servidor en modo producción |
| `npm run dev` | Ejecuta con **nodemon** para desarrollo |
| `npm run lint` | Corre linters (si se configura) |

## Endpoints principales

```
POST   /auth/register          # Registro de usuario
POST   /auth/login             # Login (fase 1)
POST   /auth/verify-otp        # Login (fase 2, OTP)
GET    /chat/history?room=...  # Historial de mensajes (JWT)
POST   /chat/send              # Enviar mensaje (JWT)
DELETE /chat/:id               # Eliminar mensaje (admin)
POST   /files/upload           # Subir archivos (JWT)
```

## Flujo de autenticación

1. **/register**: crea usuario, envía OTP inicial de bienvenida.
2. **/login**: valida password y envía un nuevo OTP + *tempToken* (5 min).
3. **/verify-otp**: recibe OTP y *tempToken*, devuelve *JWT final* (1 h).
4. El cliente guarda JWT y lo manda en `Authorization: Bearer <token>`.

> Para desarrollo se puede fijar `SKIP_OTP=true` y omitir los pasos 2-3.

## Seguridad implementada

- Hash de contraseñas con *bcrypt*
- Tokens JWT con expiración y clave en `.env`
- OTP por correo (TOTP-like)
- Middlewares `verifyToken` y `handleSocketAuth` para HTTP & WS
- Validación de rol para rutas sensibles (ej. borrar mensajes)
- Sanitización de nombres de archivo al subirlos
- CORS configurable; se recomienda restringir dominios en prod.

## Despliegue

El proyecto puede desplegarse en cualquier servicio que soporte Node.js y MongoDB (Railway, Render, VPS). Asegúrate de:

1. Definir variables de entorno en el panel del proveedor.
2. Apuntar la variable `MONGO_URI` a tu clúster Atlas o instancia remota.
3. Habilitar TLS/HTTPS (p. ej. detrás de Nginx o usando el certificado del proveedor).

## Roadmap

- [ ] Agregar Helmet + rate-limit
- [ ] Subida de imágenes con miniaturas
- [ ] Tests automatizados (Jest/Supertest)

## Licencia

MIT © 2025
