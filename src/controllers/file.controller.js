const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const util = require('util');
const exiftool = require('exiftool-vendored').exiftool;
const { create } = require('ipfs-http-client');
const crypto = require('crypto');
const execPromise = util.promisify(exec);

// Array para rastrear archivos temporales que deben limpiarse
const tempFilesToCleanup = [];

// Función para limpiar archivos temporales
const cleanupTempFiles = async () => {
  for (const file of tempFilesToCleanup) {
    try {
      await fs.promises.unlink(file).catch(console.error);
    } catch (error) {
      console.error('Error al limpiar archivo temporal:', file, error.message);
    }
  }
  // Limpiar el array después de la limpieza
  tempFilesToCleanup.length = 0;
};

// Limpiar archivos temporales al salir
process.on('exit', cleanupTempFiles);
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

// Inicialización condicional de IPFS
let ipfs;
try {
  const { create } = require('ipfs-http-client');
  ipfs = create({ 
    host: process.env.IPFS_HOST || 'ipfs.infura.io',
    port: process.env.IPFS_PORT || 5001,
    protocol: process.env.IPFS_PROTOCOL || 'https'
  });
  console.log('IPFS inicializado correctamente');
} catch (error) {
  console.warn('No se pudo inicializar IPFS, la funcionalidad estará limitada:', error.message);
  ipfs = null;
}

// Inicialización condicional de Web3
let web3;
try {
  const Web3 = require('web3');
  if (process.env.INFURA_URL) {
    web3 = new Web3(process.env.INFURA_URL);
    console.log('Web3 inicializado con Infura');
  } else {
    console.warn('INFURA_URL no configurado, la funcionalidad de blockchain estará deshabilitada');
    web3 = null;
  }
} catch (error) {
  console.warn('No se pudo inicializar Web3, la funcionalidad de blockchain estará deshabilitada:', error.message);
  web3 = null;
}

const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'text/plain'
];

// Utility functions
const calculateHash = (buffer) => {
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

// Limpiar metadatos con MAT2
const cleanWithMat2 = async (filePath) => {
  let tempFile;
  try {
    const tempDir = path.dirname(filePath);
    tempFile = path.join(tempDir, `cleaned_${Date.now()}_${path.basename(filePath)}`);
    
    // Registrar archivo para limpieza
    tempFilesToCleanup.push(tempFile);
    
    // Ejecutar mat2 sin --inplace para mantener el original
    const { stdout, stderr } = await execPromise(`mat2 ${filePath} ${tempFile}`);
    
    if (stderr) {
      console.warn('MAT2 stderr:', stderr);
      throw new Error(stderr);
    }
    
    // Leer metadatos del archivo limpiado
    const metadata = await exiftool.read(tempFile).catch(() => ({}));
    
    return {
      cleanedFilePath: tempFile,
      metadata
    };
  } catch (error) {
    console.warn('Error al limpiar con MAT2:', error.message);
    throw error; // Propagar el error para manejarlo en el llamador
  }
};

// Limpieza manual de metadatos con exiftool
const cleanWithExifTool = async (filePath) => {
  let tempFile;
  try {
    const tempDir = path.dirname(filePath);
    tempFile = path.join(tempDir, `cleaned_${Date.now()}_${path.basename(filePath)}`);
    
    // Registrar archivo para limpieza
    tempFilesToCleanup.push(tempFile);
    
    // Crear una copia del archivo
    await fs.promises.copyFile(filePath, tempFile);
    
    // Eliminar todos los metadatos
    const { stdout, stderr } = await execPromise(`exiftool -all= -overwrite_original ${tempFile}`);
    
    if (stderr && !stderr.includes('image files updated')) {
      console.warn('exiftool stderr:', stderr);
      throw new Error(stderr);
    }
    
    // Leer metadatos del archivo limpiado
    const metadata = await exiftool.read(tempFile).catch(() => ({}));
    
    return {
      cleanedFilePath: tempFile,
      metadata
    };
  } catch (error) {
    console.warn('Error al limpiar con exiftool:', error.message);
    throw error; // Propagar el error para manejarlo en el llamador
  }
};

const cleanManually = async (filePath) => {
  try {
    // Verificar si exiftool está disponible
    try {
      await execPromise('exiftool -ver');
    } catch {
      console.warn('exiftool no está disponible, no se limpiarán los metadatos');
      return false;
    }

    // Si llegamos aquí, exiftool está disponible
    const { stdout, stderr } = await execPromise(`exiftool -all= -overwrite_original "${filePath}"`);
    
    // Algunas versiones de exiftool pueden mostrar advertencias en stderr
    // pero aún así completar la operación exitosamente
    const isSuccess = !stderr || 
                     stderr.includes('image files updated') || 
                     stderr.includes('files updated');
    
    if (!isSuccess) {
      console.error('Error en exiftool stderr:', stderr);
      return false;
    }
    
    return true;
  } catch (error) {
    console.warn('Error en limpieza manual, continuando sin limpieza de metadatos:', error.message);
    return false;
  }
};

const storeInIPFS = async (fileBuffer) => {
  if (!ipfs) {
    console.warn('IPFS no está configurado, omitiendo almacenamiento');
    return null;
  }
  try {
    const { cid } = await ipfs.add(fileBuffer);
    console.log('Archivo almacenado en IPFS con CID:', cid.toString());
    return cid.toString();
  } catch (error) {
    console.error('Error al almacenar en IPFS:', error.message);
    return null;
  }
};

const storeInBlockchain = async (fileHash, ipfsHash, metadata) => {
  if (!web3) {
    console.warn('Web3 no está configurado, omitiendo blockchain');
    return null;
  }
  
  try {
    if (!process.env.ETH_ACCOUNT || !process.env.PRIVATE_KEY) {
      console.warn('Faltan credenciales de Ethereum, omitiendo blockchain');
      return null;
    }

    console.log('Intentando registrar en la blockchain...');
    // Esto es un ejemplo simplificado
    const tx = {
      from: process.env.ETH_ACCOUNT,
      to: process.env.SMART_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
      data: web3.eth.abi.encodeFunctionCall({
        name: 'storeFile',
        type: 'function',
        inputs: [
          { type: 'string', name: 'fileHash' },
          { type: 'string', name: 'ipfsHash' },
          { type: 'string', name: 'metadata' }
        ]
      }, [fileHash, ipfsHash || '', JSON.stringify(metadata)])
    };

    const signedTx = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    console.log('Transacción exitosa:', receipt.transactionHash);
    return receipt.transactionHash;
  } catch (error) {
    console.error('Error en la transacción blockchain:', error.message);
    return null;
  }
};

// Main controller functions
exports.uploadFile = async (req, res) => {
  let tempPath;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    // Extraer propiedades del archivo
    const { originalname, mimetype, size, buffer } = req.file;
    // Usar req.file.path directamente para evitar conflictos de nombres
    tempPath = req.file.path;
    
    console.log(`Procesando archivo: ${originalname} (${mimetype}, ${size} bytes)`);

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(mimetype)) {
      await fs.unlink(tempPath);
      return res.status(400).json({ error: 'File type not allowed' });
    }

    // Validate file size
    if (size > MAX_FILE_SIZE) {
      await fs.unlink(tempPath);
      return res.status(400).json({ error: 'File size exceeds limit' });
    }

    // Obtener metadatos originales
    const originalMetadata = await exiftool.read(tempPath).catch(() => ({}));
    console.log('Metadatos originales obtenidos');
    
    // Intentar limpiar el archivo
    let wasCleaned = false;
    let cleanedMetadata = {};
    let cleanedBuffer = null;
    
    try {
      console.log('Intentando limpiar con MAT2...');
      const mat2Result = await cleanWithMat2(tempPath);
      if (mat2Result.cleanedFilePath) {
        cleanedBuffer = await fs.promises.readFile(mat2Result.cleanedFilePath);
        cleanedMetadata = mat2Result.metadata || {};
        wasCleaned = true;
        console.log('Metadatos limpiados con MAT2');
      }
    } catch (mat2Error) {
      console.warn('MAT2 no está disponible:', mat2Error.message);
      try {
        console.log('Intentando limpieza manual con exiftool...');
        const exifResult = await cleanWithExifTool(tempPath);
        if (exifResult.cleanedFilePath) {
          cleanedBuffer = await fs.promises.readFile(exifResult.cleanedFilePath);
          cleanedMetadata = exifResult.metadata || {};
          wasCleaned = true;
          console.log('Metadatos limpiados con exiftool');
        }
      } catch (exifError) {
        console.warn('exiftool no está disponible:', exifError.message);
        // Usar el buffer original si no se pudo limpiar
        cleanedBuffer = buffer;
      }
    }
    
    // Usar el buffer limpio o el original si no se pudo limpiar
    const finalBuffer = cleanedBuffer || buffer;
    const fileHash = calculateHash(finalBuffer);
    
    // Almacenar en IPFS (si está configurado)
    let ipfsHash = null;
    try {
      ipfsHash = await storeInIPFS(finalBuffer);
    } catch (ipfsError) {
      console.warn('No se pudo almacenar en IPFS:', ipfsError.message);
    }
    
    // Almacenar en blockchain (si está configurado)
    let txHash = null;
    try {
      txHash = await storeInBlockchain(fileHash, ipfsHash, {
        originalName: originalname,
        mimeType: mimetype,
        size,
        originalMetadata,
        cleanedMetadata: wasCleaned ? cleanedMetadata : {}
      });
    } catch (blockchainError) {
      console.warn('No se pudo registrar en la blockchain:', blockchainError.message);
    }

    // Generar ID de archivo y ruta de guardado
    const fileId = uuidv4();
    const fileName = `${fileId}${path.extname(originalname)}`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    
    // Crear directorio de subidas si no existe
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    
    // Guardar archivo en el sistema de archivos
    await fs.promises.writeFile(filePath, finalBuffer);
    
    // Crear registro en la base de datos
    const fileRecord = new File({
      fileId,
      originalName: originalname,
      mimeType: mimetype,
      size,
      path: filePath,
      hash: fileHash,
      ipfsHash: ipfsHash || undefined,
      txHash: txHash || undefined,
      metadata: wasCleaned ? cleanedMetadata : originalMetadata,
      uploadedBy: req.userId || 'anonymous',
      status: 'processed',
      cleaned: wasCleaned
    });
    
    await fileRecord.save();

    // Generar URL de descarga
    const downloadUrl = `/api/files/download/${fileId}`;
    
    // Limpiar archivos temporales
    await cleanupTempFiles();
    
    // Responder con éxito
    res.json({
      success: true,
      fileId,
      originalName: originalname,
      mimeType: mimetype,
      size,
      hash: fileHash,
      ipfsHash: ipfsHash || null,
      txHash: txHash || null,
      downloadUrl,
      metadata: wasCleaned ? cleanedMetadata : originalMetadata,
      cleaned: wasCleaned,
      message: wasCleaned ? 'Archivo limpiado exitosamente' : 'No se pudo limpiar el archivo'
    });
  } catch (error) {
    console.error('Error al procesar el archivo:', error);
    
    // Limpiar archivos temporales en caso de error
    try {
      await cleanupTempFiles();
    } catch (cleanupError) {
      console.error('Error al limpiar archivos temporales:', cleanupError);
    }
    
    // Responder con error
    res.status(500).json({ 
      success: false, 
      error: 'Error al procesar el archivo',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const files = await fs.readdir(UPLOAD_DIR);
    const file = files.find(f => f.startsWith(fileId));
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const fullPath = path.join(UPLOAD_DIR, file);
    const fileName = file.split('-').slice(1).join('-');
    
    res.download(fullPath, fileName, (err) => {
      if (err) {
        console.error('Download error:', err);
        res.status(500).json({ error: 'Failed to download file' });
      }
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getFileInfo = async (req, res) => {
  try {
    const { fileId } = req.params;
    const files = await fs.readdir(UPLOAD_DIR);
    const file = files.find(f => f.startsWith(fileId));
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const filePath = path.join(UPLOAD_DIR, file);
    const stats = await fs.stat(filePath);
    const fileBuffer = await fs.readFile(filePath);
    const fileHash = calculateHash(fileBuffer);
    
    res.json({
      fileId,
      fileName: file.split('-').slice(1).join('-'),
      size: stats.size,
      uploadDate: stats.birthtime,
      lastModified: stats.mtime,
      hash: fileHash,
      downloadUrl: `/api/files/download/${fileId}`
    });
  } catch (error) {
    console.error('File info error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
