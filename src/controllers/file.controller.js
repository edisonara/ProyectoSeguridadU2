const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const util = require('util');
const exiftool = require('exiftool-vendored').exiftool;
const { create } = require('ipfs-http-client');
const crypto = require('crypto');
const execPromise = util.promisify(exec);

// Asegurarse de que fs.promises esté disponible
const fsp = fs.promises || require('fs').promises;

// Inicializar constantes de directorio
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'text/plain'
];

// Array para rastrear archivos temporales que deben limpiarse
const tempFilesToCleanup = [];

// Función para limpiar archivos temporales
const cleanupTempFiles = async () => {
  const files = [...tempFilesToCleanup]; // Hacer una copia para evitar problemas de concurrencia
  tempFilesToCleanup.length = 0; // Limpiar el array inmediatamente
  
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        await fsp.unlink(file);
        console.log('Archivo temporal eliminado:', file);
      }
    } catch (error) {
      console.error('Error al limpiar archivo temporal:', file, error.message);
    }
  }
};

// Limpiar archivos temporales al salir
process.on('exit', () => cleanupTempFiles().catch(console.error));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

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
let web3 = null;
if (process.env.INFURA_URL) {
  try {
    const Web3 = require('web3');
    web3 = new Web3(process.env.INFURA_URL);
    console.log('Web3 inicializado con Infura');
  } catch (error) {
    console.warn('No se pudo inicializar Web3, la funcionalidad de blockchain estará deshabilitada:', error.message);
  }
} else {
  console.warn('INFURA_URL no configurado, la funcionalidad de blockchain estará deshabilitada');
}

// Asegurarse de que el directorio de subidas exista
const ensureUploadsDir = () => {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      console.log('Directorio de subidas creado:', UPLOAD_DIR);
    }
  } catch (error) {
    console.error('Error al crear el directorio de subidas:', error.message);
    throw new Error('No se pudo crear el directorio de subidas');
  }
};

// Crear el directorio de subidas al iniciar
ensureUploadsDir();

// Utility functions
const calculateHash = (buffer) => {
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

// Limpiar metadatos con MAT2
const cleanWithMat2 = async (filePath) => {
  // Verificar si mat2 está disponible
  try {
    await execPromise('mat2 --version');
  } catch (error) {
    console.warn('MAT2 no está disponible:', error.message);
    throw new Error('MAT2 no está instalado');
  }

  let tempFile;
  try {
    const tempDir = path.dirname(filePath);
    tempFile = path.join(tempDir, `cleaned_${Date.now()}_${path.basename(filePath)}`);
    
    console.log('Creando copia temporal para MAT2:', tempFile);
    
    // Registrar archivo para limpieza
    tempFilesToCleanup.push(tempFile);
    
    // Ejecutar mat2 sin --inplace para mantener el original
    console.log('Ejecutando MAT2...');
    const { stdout, stderr } = await execPromise(`mat2 "${filePath}" "${tempFile}"`);
    
    if (stderr) {
      console.warn('MAT2 stderr:', stderr);
      if (!fs.existsSync(tempFile)) {
        throw new Error('MAT2 no pudo crear el archivo de salida');
      }
    }
    
    // Verificar que el archivo de salida existe
    if (!fs.existsSync(tempFile)) {
      throw new Error('El archivo limpiado no se creó correctamente');
    }
    
    // Leer metadatos del archivo limpiado
    console.log('Leyendo metadatos después de MAT2...');
    const metadata = await exiftool.read(tempFile).catch((e) => {
      console.warn('No se pudieron leer los metadatos después de MAT2:', e.message);
      return {};
    });
    
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
  // Verificar si exiftool está disponible
  try {
    await execPromise('exiftool -ver');
  } catch (error) {
    console.warn('exiftool no está disponible:', error.message);
    throw new Error('exiftool no está instalado');
  }

  let tempFile;
  try {
    const tempDir = path.dirname(filePath);
    tempFile = path.join(tempDir, `cleaned_${Date.now()}_${path.basename(filePath)}`);
    
    console.log('Creando copia temporal para exiftool:', tempFile);
    
    // Registrar archivo para limpieza
    tempFilesToCleanup.push(tempFile);
    
    // Crear una copia del archivo
    await fsp.copyFile(filePath, tempFile);
    
    console.log('Ejecutando exiftool...');
    const { stdout, stderr } = await execPromise(`exiftool -all= -overwrite_original "${tempFile}"`);
    
    if (stderr && !stderr.includes('image files updated')) {
      console.warn('exiftool stderr:', stderr);
      throw new Error(stderr);
    }
    
    console.log('Leyendo metadatos del archivo limpiado...');
    const metadata = await exiftool.read(tempFile).catch((e) => {
      console.warn('No se pudieron leer los metadatos después de la limpieza:', e.message);
      return {};
    });
    
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
  // Si web3 no está disponible, devolver null inmediatamente
  if (!web3) {
    console.warn('Web3 no está configurado, omitiendo blockchain');
    return null;
  }
  
  try {
    // Verificar credenciales necesarias
    if (!process.env.ETH_ACCOUNT || !process.env.PRIVATE_KEY) {
      console.warn('Faltan credenciales de Ethereum, omitiendo blockchain');
      return null;
    }

    // Verificar que la cuenta esté disponible
    try {
      const balance = await web3.eth.getBalance(process.env.ETH_ACCOUNT);
      console.log(`Balance de la cuenta ${process.env.ETH_ACCOUNT}: ${web3.utils.fromWei(balance, 'ether')} ETH`);
    } catch (balanceError) {
      console.warn('No se pudo verificar el balance de la cuenta:', balanceError.message);
      return null;
    }

    console.log('Intentando registrar en la blockchain...');
    
    // Crear objeto de transacción
    const tx = {
      from: process.env.ETH_ACCOUNT,
      to: process.env.SMART_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
      gas: 200000, // Límite de gas razonable por defecto
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

    // Estimar el gas necesario
    try {
      const gasEstimate = await web3.eth.estimateGas({
        ...tx,
        from: process.env.ETH_ACCOUNT
      });
      tx.gas = Math.floor(gasEstimate * 1.1); // Añadir 10% de margen
      console.log(`Gas estimado: ${gasEstimate}, usando: ${tx.gas}`);
    } catch (estimateError) {
      console.warn('Error al estimar el gas, usando valor por defecto:', estimateError.message);
    }

    console.log('Firmando transacción...');
    const signedTx = await web3.eth.accounts.signTransaction(tx, process.env.PRIVATE_KEY);
    
    console.log('Enviando transacción...');
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
    
    console.log('Transacción exitosa. Hash:', receipt.transactionHash);
    return receipt.transactionHash;
    
  } catch (error) {
    console.error('Error en la transacción blockchain:', error.message);
    if (error.receipt) {
      console.error('Detalles del recibo de error:', error.receipt);
    }
    return null;
  }
};

// Main controller functions
exports.uploadFile = async (req, res) => {
  let tempPath;
  
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No se ha subido ningún archivo' 
      });
    }

    // Extraer propiedades del archivo
    const { originalname, mimetype, size, path: filePath } = req.file;
    tempPath = filePath; // Guardar la ruta temporal
    
    console.log(`Procesando archivo: ${originalname} (${mimetype}, ${size} bytes)`);

    // Validar tipo de archivo
    if (!ALLOWED_FILE_TYPES.includes(mimetype)) {
      await fsp.unlink(tempPath).catch(console.error);
      return res.status(400).json({ 
        success: false,
        message: 'Tipo de archivo no permitido',
        allowedTypes: ALLOWED_FILE_TYPES
      });
    }

    // Validar tamaño de archivo
    if (size > MAX_FILE_SIZE) {
      await fsp.unlink(tempPath).catch(console.error);
      return res.status(400).json({ 
        success: false,
        message: 'El archivo excede el tamaño máximo permitido',
        maxSize: '10MB'
      });
    }
    
    // Leer el archivo en un buffer
    const buffer = await fsp.readFile(tempPath);

    // Obtener metadatos originales
    const originalMetadata = await exiftool.read(tempPath).catch(() => ({}));
    console.log('Metadatos originales obtenidos');
    
    // Intentar limpiar el archivo
    let wasCleaned = false;
    let cleanedMetadata = {};
    let cleanedBuffer = null;

    // Usar el buffer original por defecto
    let finalBuffer = buffer;

    // Intentar con MAT2 primero si está disponible
    try {
      console.log('Intentando limpiar con MAT2...');
      const mat2Result = await cleanWithMat2(tempPath);
      if (mat2Result.cleanedFilePath) {
        console.log('Leyendo archivo limpiado por MAT2...');
        cleanedBuffer = await fsp.readFile(mat2Result.cleanedFilePath);
        cleanedMetadata = mat2Result.metadata || {};
        wasCleaned = true;
        finalBuffer = cleanedBuffer;
        console.log('Metadatos limpiados con MAT2');
      }
    } catch (mat2Error) {
      console.warn('MAT2 no está disponible o falló:', mat2Error.message);
      
      // Intentar con exiftool si MAT2 falla
      try {
        console.log('Intentando limpieza manual con exiftool...');
        const exifResult = await cleanWithExifTool(tempPath);
        if (exifResult.cleanedFilePath) {
          console.log('Leyendo archivo limpiado por exiftool...');
          cleanedBuffer = await fsp.readFile(exifResult.cleanedFilePath);
          cleanedMetadata = exifResult.metadata || {};
          wasCleaned = true;
          finalBuffer = cleanedBuffer;
          console.log('Metadatos limpiados con exiftool');
        }
      } catch (exifError) {
        console.warn('exiftool no está disponible o falló:', exifError.message);
        // Continuar sin limpieza
      }
    }

    // Si no se pudo limpiar, usar el original
    if (!wasCleaned) {
      console.warn('No se pudo limpiar el archivo, se usará sin cambios');
      cleanedMetadata = {};
      finalBuffer = buffer;
    }

    // Usar el buffer limpio o el original si no se pudo limpiar
    const fileHash = calculateHash(finalBuffer);
    
    // Almacenar en IPFS (si está configurado)
    let ipfsHash = null;
    try {
      ipfsHash = await storeInIPFS(finalBuffer);
      console.log('Archivo almacenado en IPFS con hash:', ipfsHash);
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
      console.log('Transacción registrada en blockchain con hash:', txHash);
    } catch (blockchainError) {
      console.warn('No se pudo registrar en la blockchain:', blockchainError.message);
    }

    // Generar ID de archivo y ruta de guardado
    const fileId = uuidv4();
    const fileName = `${fileId}${path.extname(originalname)}`;
    const finalFilePath = path.join(UPLOAD_DIR, fileName);
    const relativePath = path.relative(process.cwd(), finalFilePath);
    
    // Crear directorio de subidas si no existe
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    
    // Guardar archivo en el sistema de archivos
    await fsp.writeFile(finalFilePath, finalBuffer);
    console.log('Archivo guardado en:', finalFilePath);
    
    // Crear registro en la base de datos
    const fileRecord = new File({
      fileId,
      originalName: originalname,
      mimeType: mimetype,
      size,
      path: relativePath,
      hash: fileHash,
      ipfsHash: ipfsHash || undefined,
      txHash: txHash || undefined,
      metadata: wasCleaned ? cleanedMetadata : originalMetadata,
      uploadedBy: req.userId || 'anonymous',
      status: 'processed',
      cleaned: wasCleaned
    });
    
    await fileRecord.save();
    console.log('Registro de archivo guardado en la base de datos');

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
  }
} catch (mat2Error) {
  console.warn('MAT2 no está disponible o falló:', mat2Error.message);
  
  // Intentar con exiftool si MAT2 falla
  try {
    console.log('Intentando limpieza manual con exiftool...');
    const exifResult = await cleanWithExifTool(tempPath);
    if (exifResult.cleanedFilePath) {
      console.log('Leyendo archivo limpiado por exiftool...');
      cleanedBuffer = await fsp.readFile(exifResult.cleanedFilePath);
      cleanedMetadata = exifResult.metadata || {};
      wasCleaned = true;
      finalBuffer = cleanedBuffer;
      console.log('Metadatos limpiados con exiftool');
    }
  } catch (exifError) {
    console.warn('exiftool no está disponible o falló:', exifError.message);
    // Continuar sin limpieza
  }
}

// Si no se pudo limpiar, usar el original
if (!wasCleaned) {
  console.warn('No se pudo limpiar el archivo, se usará sin cambios');
  cleanedMetadata = {};
  finalBuffer = buffer;
}

// Usar el buffer limpio o el original si no se pudo limpiar
const fileHash = calculateHash(finalBuffer);
    
// Almacenar en IPFS (si está configurado)
let ipfsHash = null;
try {
  ipfsHash = await storeInIPFS(finalBuffer);
  console.log('Archivo almacenado en IPFS con hash:', ipfsHash);
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
  console.log('Transacción registrada en blockchain con hash:', txHash);
} catch (blockchainError) {
  console.warn('No se pudo registrar en la blockchain:', blockchainError.message);
}

// Generar ID de archivo y ruta de guardado
const fileId = uuidv4();
const fileName = `${fileId}${path.extname(originalname)}`;
const finalFilePath = path.join(UPLOAD_DIR, fileName);
const relativePath = path.relative(process.cwd(), finalFilePath);
    
// Crear directorio de subidas si no existe
await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    
// Guardar archivo en el sistema de archivos
await fsp.writeFile(finalFilePath, finalBuffer);
console.log('Archivo guardado en:', finalFilePath);
    
// Crear registro en la base de datos
const fileRecord = new File({
  fileId,
  originalName: originalname,
  mimeType: mimetype,
  size,
  path: relativePath,
  hash: fileHash,
  ipfsHash: ipfsHash || undefined,
  txHash: txHash || undefined,
  metadata: wasCleaned ? cleanedMetadata : originalMetadata,
  uploadedBy: req.userId || 'anonymous',
  status: 'processed',
  cleaned: wasCleaned
});
    
await fileRecord.save();
console.log('Registro de archivo guardado en la base de datos');

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

// Controlador para descargar un archivo
exports.downloadFile = async (req, res) => {
try {
const { fileId } = req.params;
    
// Buscar el archivo en la base de datos
const fileRecord = await File.findOne({ fileId });
    
if (!fileRecord) {
  return res.status(404).json({ 
    success: false,
    message: 'Archivo no encontrado' 
  });
}
    
// Construir la ruta completa al archivo
const fullPath = path.isAbsolute(fileRecord.path) 
  ? fileRecord.path 
  : path.join(process.cwd(), fileRecord.path);
    
    // Buscar el archivo en el directorio de subidas
    const files = await fsp.readdir(UPLOAD_DIR);
    const file = files.find(f => f.startsWith(fileId));
    
    if (!file) {
      return res.status(404).json({ 
        success: false,
        message: 'Archivo no encontrado' 
      });
    }
    
    const filePath = path.join(UPLOAD_DIR, file);
    const stats = await fsp.stat(filePath);
    const fileBuffer = await fsp.readFile(filePath);
    const fileHash = calculateHash(fileBuffer);
    
    res.json({
      success: true,
      fileId,
      fileName: file.split('-').slice(1).join('-'),
      size: stats.size,
      uploadDate: stats.birthtime,
      lastModified: stats.mtime,
      hash: fileHash,
      mimeType: require('mime-types').lookup(file)
    });
  } catch (error) {
    console.error('Error al obtener información del archivo:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error al obtener información del archivo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
