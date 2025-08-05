const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('../middleware/auth.middleware');
const fileController = require('../controllers/file.controller');

const router = express.Router();

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // El directorio de subidas será manejado por el controlador
    cb(null, '/tmp');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeFilename = file.originalname.replace(/[^\w\d.-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeFilename);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'text/plain'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error('Tipo de archivo no permitido');
    error.status = 400;
    cb(error, false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB límite
  }
});

// Middleware para manejar errores de multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Un error de Multer al subir el archivo
    return res.status(400).json({ 
      success: false, 
      message: 'Error al subir el archivo',
      error: err.message 
    });
  } else if (err) {
    // Un error desconocido ocurrió
    console.error('Error al subir el archivo:', err);
    return res.status(err.status || 500).json({ 
      success: false,
      message: err.message || 'Error al procesar el archivo',
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
  // Si no hay error, continuar
  next();
};

// Ruta para subir archivos
router.post(
  '/upload',
  verifyToken,
  upload.single('file'),
  handleMulterError,
  fileController.uploadFile
);

// Ruta para descargar archivos
router.get('/download/:fileId', verifyToken, fileController.downloadFile);

// Ruta para obtener información de archivos
router.get('/info/:fileId', verifyToken, fileController.getFileInfo);

// Manejador de errores global para las rutas de archivos
router.use((err, req, res, next) => {
  console.error('Error en la ruta de archivos:', err);
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

module.exports = router;
