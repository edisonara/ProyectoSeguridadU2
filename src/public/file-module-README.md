# Gestión Segura de Archivos

Este módulo proporciona una solución integral para la gestión segura de archivos, incluyendo limpieza de metadatos, almacenamiento distribuido y trazabilidad mediante blockchain.

## Características Principales

### 🔒 Limpieza de Metadatos
- **MAT2** como herramienta principal para limpieza
- Métodos alternativos manuales si MAT2 falla
- Análisis detallado con ExifTool
- Eliminación segura de metadatos sensibles

### 🌐 Almacenamiento Distribuido
- Integración con **IPFS** para almacenamiento descentralizado
- Registro inmutable en **blockchain**
- Almacenamiento local como respaldo
- Verificación de integridad con hashes SHA-256

### 🛡️ Seguridad Avanzada
- Validación de tipos de archivo
- Límites de tamaño configurables
- Escaneo de contenido malicioso
- Autenticación y autorización

### 📊 Trazabilidad Completa
- Registro detallado de metadatos eliminados
- Comparación visual antes/después
- Historial de transacciones en blockchain
- Verificación de integridad en tiempo real

## Requisitos del Sistema

- Node.js 14+
- MongoDB
- IPFS (opcional, para almacenamiento distribuido)
- Cuenta en Infura (para blockchain)
- MAT2 instalado para limpieza de metadatos
- ExifTool instalado para análisis de metadatos

## Instalación

1. Instalar dependencias:
   ```bash
   npm install exiftool-vendored ipfs-http-client web3 mat2
   ```

2. Instalar dependencias del sistema (Ubuntu/Debian):
   ```bash
   sudo apt-get update
   sudo apt-get install -y mat2 libimage-exiftool-perl
   ```

3. Configurar variables de entorno (crear archivo `.env`):
   ```
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/securefiles
   JWT_SECRET=tu_clave_secreta
   INFURA_URL=https://mainnet.infura.io/v3/TU-PROYECTO-ID
   ETH_ACCOUNT=0x...
   PRIVATE_KEY=tu_clave_privada
   SMART_CONTRACT_ADDRESS=0x...
   ```

## Uso

### Subir un archivo
```http
POST /api/files/upload
Content-Type: multipart/form-data
Authorization: Bearer TU_TOKEN

file: [archivo]
```

### Descargar un archivo
```http
GET /api/files/download/:fileId
Authorization: Bearer TU_TOKEN
```

### Obtener información de un archivo
```http
GET /api/files/info/:fileId
Authorization: Bearer TU_TOKEN
```

## Estructura del Proyecto

```
src/
├── controllers/
│   └── file.controller.js    # Lógica de negocio
├── middleware/
│   └── file.middleware.js    # Middleware para archivos
├── models/
│   └── File.js              # Modelo de base de datos
├── routes/
│   └── file.routes.js       # Definición de rutas
├── public/
│   └── uploads/             # Archivos subidos
└── server.js               # Configuración del servidor
```

## Variables de Entorno

| Variable | Requerido | Descripción |
|----------|-----------|-------------|
| PORT | No | Puerto del servidor (por defecto: 3000) |
| MONGODB_URI | Sí | URI de conexión a MongoDB |
| JWT_SECRET | Sí | Secreto para firmar tokens JWT |
| INFURA_URL | No | URL de Infura para blockchain |
| ETH_ACCOUNT | No | Cuenta Ethereum para transacciones |
| PRIVATE_KEY | No | Clave privada para firmar transacciones |
| SMART_CONTRACT_ADDRESS | No | Dirección del contrato inteligente |

## Seguridad

- Todos los archivos se escanean en busca de contenido malicioso
- Se eliminan metadatos sensibles automáticamente
- Se verifican hashes de integridad
- Acceso restringido mediante autenticación JWT
- Límites de tamaño y tipo de archivo

## Contribución

1. Haz un fork del repositorio
2. Crea una rama para tu característica (`git checkout -b feature/nueva-caracteristica`)
3. Haz commit de tus cambios (`git commit -am 'Añadir nueva característica'`)
4. Haz push a la rama (`git push origin feature/nueva-caracteristica`)
5. Abre un Pull Request

## Licencia

Este proyecto está bajo la Licencia MIT.
