const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const File = require('../models/File');
const { exec } = require('child_process');
const util = require('util');
const exiftool = require('exiftool-vendored').exiftool;
const crypto = require('crypto');
const execPromise = util.promisify(exec);
const { Blob } = require('buffer');
const fetch = require('node-fetch');
const FormData = require('form-data');

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

// Configuración de IPFS
console.log('Configurando IPFS...');
console.log('IPFS_HOST:', process.env.IPFS_HOST || 'No configurado');
console.log('IPFS_PORT:', process.env.IPFS_PORT || 'No configurado');

// Verificar configuración mínima de IPFS
const isIPFSConfigured = process.env.IPFS_HOST && process.env.IPFS_PORT;

if (isIPFSConfigured) {
  console.log('✅ IPFS configurado correctamente');
  if (process.env.IPFS_PROJECT_ID && process.env.IPFS_PROJECT_SECRET) {
    console.log('🔐 Autenticación con Infura habilitada');
  } else {
    console.log('ℹ️  Modo sin autenticación (IPFS local)');
  }
} else {
  console.warn('⚠️  IPFS no está configurado. Configura las variables de entorno IPFS_HOST y IPFS_PORT');
  console.warn('   Para desarrollo local, puedes usar IPFS Desktop: https://docs.ipfs.io/install/ipfs-desktop/');
  console.warn('   O configura Infura IPFS: https://infura.io/ipfs');
}

// Inicialización condicional de Web3
let web3 = null;
let web3Initialized = false;

// Función para inicializar Web3 usando Web3Auth Infura Service
const initWeb3 = async () => {
  if (web3Initialized) return true;

  try {
    console.log('🔍 Inicializando Web3 con Web3Auth Infura Service...');
    
    // Importaciones dinámicas para mejor manejo de errores
    const { Web3 } = require('web3');
    const fetch = require('node-fetch');
    
    // Configurar el proveedor HTTP con la URL de Web3Auth Infura Service
    const providerUrl = process.env.WEB3_PROVIDER_URL;
    console.log(`🔗 Conectando a Web3Auth Infura Service: ${providerUrl}`);
    
    // Verificar que la URL de Web3Auth esté configurada
    if (!providerUrl || !providerUrl.includes('web3auth.io')) {
      throw new Error('URL de Web3Auth Infura Service no configurada correctamente');
    }
    
    // Configurar el proveedor HTTP
    const provider = new Web3.providers.HttpProvider(providerUrl, {
      timeout: 15000, // 15 segundos de timeout
      headers: [
        {
          name: 'Content-Type',
          value: 'application/json'
        }
      ]
    });
    
    // Configurar Web3 con el proveedor
    web3 = new Web3(provider);
    
    // Verificar conexión
    try {
      // Intentar obtener información de la red
      const networkId = await web3.eth.net.getId();
      console.log(`✅ Web3 conectado a la red: ${networkId} (Ethereum)`);
      
      const blockNumber = await web3.eth.getBlockNumber();
      console.log(`📦 Último bloque: ${blockNumber}`);
      
      web3Initialized = true;
      return true;
    } catch (connectionError) {
      console.error('❌ Error al verificar la conexión con Web3Auth:', connectionError.message);
      throw new Error('No se pudo conectar al servicio Web3Auth Infura. Verifica la URL del proveedor y tu conexión a Internet.');
    }
    
  } catch (error) {
    console.warn('⚠️  No se pudo inicializar Web3 con Web3Auth:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    console.log('ℹ️  La aplicación funcionará sin funcionalidad de blockchain');
    web3 = null;
    web3Initialized = false;
    return false;
  }
};

// Inicializar Web3 al cargar el módulo
setTimeout(() => {
  initWeb3().catch(console.error);
}, 1000);

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

/**
 * Lee los metadatos de un archivo usando ExifTool a través de WSL
 * @param {string} filePath - Ruta al archivo en Windows
 * @returns {Promise<Object>} Objeto con los metadatos
 */
const readMetadata = async (filePath) => {
  try {
    // Convertir la ruta de Windows a WSL
    const convertToWslPath = (winPath) => {
      if (winPath.startsWith('/mnt/')) return winPath;
      if (winPath.startsWith('\\')) {
        const driveLetter = process.cwd().split(path.sep)[0].toLowerCase().replace(':', '');
        return `/mnt/${driveLetter}${winPath.replace(/\\/g, '/')}`;
      }
      return winPath
        .replace(/^([A-Za-z]):/, (m, d) => `/mnt/${d.toLowerCase()}`)
        .replace(/\\/g, '/');
    };

    const wslPath = convertToWslPath(filePath);
    
    // Ejecutar exiftool en WSL
    const { stdout } = await execPromise(`wsl -d Ubuntu exiftool -j -g1 -a -u -x Orientation -x ThumbnailImage -x PreviewImage -x PreviewImageLength -x PreviewImageStart -x PreviewImageMD5 -x ThumbnailMD5 -x PreviewMD5 "${wslPath}"`);
    
    try {
      const metadata = JSON.parse(stdout)[0] || {};
      return metadata;
    } catch (e) {
      console.warn('⚠️  No se pudieron analizar los metadatos JSON:', e.message);
      return {};
    }
  } catch (error) {
    console.warn('⚠️  Error al leer metadatos con ExifTool:', error.message);
    throw error;
  }
};

// Verificar la disponibilidad de herramientas externas
let hasMat2 = false;
let hasExifTool = false;

// Verificar si las herramientas están disponibles a través de WSL
(async () => {
  try {
    // Verificar MAT2
    try {
      const { stdout } = await execPromise('wsl -d Ubuntu which mat2');
      if (stdout.trim()) {
        hasMat2 = true;
        const version = await execPromise('wsl -d Ubuntu mat2 --version');
        console.log(`MAT2 está disponible en WSL (${version.stdout.trim()})`);
      }
    } catch (e) {
      console.warn('MAT2 no está disponible en WSL. La limpieza de metadatos estará limitada.');
    }

    // Verificar ExifTool
    try {
      const { stdout } = await execPromise('wsl -d Ubuntu which exiftool');
      if (stdout.trim()) {
        hasExifTool = true;
        const version = await execPromise('wsl -d Ubuntu exiftool -ver');
        console.log(`ExifTool está disponible en WSL (${version.stdout.trim()})`);
      }
    } catch (e) {
      console.warn('ExifTool no está disponible en WSL. La limpieza de metadatos estará limitada.');
    }
  } catch (error) {
    console.error('Error al verificar herramientas en WSL:', error.message);
  }
})();

// Limpiar metadatos con MAT2 a través de WSL
const cleanWithMat2 = async (filePath) => {
  console.log('\n🔧 Iniciando limpieza con MAT2 a través de WSL...');
  
  // Crear un nombre de archivo temporal en el directorio /tmp de WSL
  const wslTempDir = '/tmp/mat2_clean';
  const fileName = path.basename(filePath);
  const fileExt = path.extname(fileName);
  const baseName = path.basename(fileName, fileExt);
  const timestamp = Date.now();
  
  const wslTempFile = `${wslTempDir}/${timestamp}_${baseName}${fileExt}`;
  const wslCleanedFile = `${wslTempDir}/${timestamp}_${baseName}.cleaned${fileExt}`;
  
  // Función para convertir ruta de Windows a WSL
  const convertToWslPath = (winPath) => {
    // Si ya es una ruta WSL, devolverla tal cual
    if (winPath.startsWith('/mnt/')) return winPath;
    
    // Si la ruta comienza con \, asumir que es relativa a la unidad del sistema
    if (winPath.startsWith('\\')) {
      // Convertir ruta como \path -> /mnt/<drive_letter>/path
      const driveLetter = process.cwd().split(path.sep)[0].toLowerCase().replace(':', '');
      return `/mnt/${driveLetter}${winPath.replace(/\\/g, '/')}`;
    }
    
    // Convertir ruta Windows a WSL (ej: C:\path -> /mnt/c/path)
    return winPath
      .replace(/^([A-Za-z]):/, (m, d) => `/mnt/${d.toLowerCase()}`)
      .replace(/\\/g, '/');
  };

  // Asegurar que la ruta sea absoluta
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const wslPath = convertToWslPath(absolutePath);
  
  console.log('Ruta de origen (Windows):', absolutePath);
  console.log('Ruta de origen (WSL):', wslPath);
  console.log('Ruta de destino (WSL):', wslTempFile);

  try {
    // Crear directorio temporal en WSL
    console.log('Creando directorio temporal en WSL...');
    await execPromise(`wsl -d Ubuntu mkdir -p ${wslTempDir}`);
    
    // Copiar el archivo a WSL
    console.log(`🔄 Copiando archivo a WSL: ${absolutePath} -> ${wslTempFile}`);
    await execPromise(`wsl -d Ubuntu cp "${wslPath}" "${wslTempFile}"`);
    
    // Verificar que el archivo se copió correctamente
    const { stdout: lsOut } = await execPromise(`wsl -d Ubuntu ls -la "${wslTempFile}"`);
    console.log(`✅ Archivo copiado a WSL: ${lsOut.trim()}`);
    
    // Ejecutar MAT2 en WSL
    console.log('🚀 Ejecutando MAT2 en WSL...');
    try {
      // Usar --inplace para modificar el archivo directamente
      await execPromise(`wsl -d Ubuntu mat2 --inplace "${wslTempFile}"`);
      console.log('✅ MAT2 ejecutado correctamente');
    } catch (mat2Error) {
      console.warn('⚠️  MAT2 mostró advertencias o errores no críticos:', mat2Error.message);
    }
    
    // Crear un archivo temporal en Windows para el resultado
    const winTempFile = path.join(os.tmpdir(), `mat2_cleaned_${timestamp}_${baseName}${fileExt}`);
    const winWslPath = winTempFile
      .replace(/^([A-Za-z]):/, (m, d) => `/mnt/${d.toLowerCase()}`)
      .replace(/\\/g, '/');
    
    // Copiar el archivo de vuelta a Windows
    console.log(`🔄 Copiando archivo de vuelta a Windows...`);
    await execPromise(`wsl -d Ubuntu cp "${wslTempFile}" "${winWslPath}"`);
    
    // Verificar que el archivo existe en Windows
    try {
      await fs.promises.access(winTempFile);
      console.log(`✅ Archivo limpio copiado a: ${winTempFile}`);
      
      // Leer metadatos del archivo limpio
      let metadata = {};
      try {
        metadata = await readMetadata(winTempFile);
        console.log('📊 Metadatos después de la limpieza:', Object.keys(metadata).length > 0 ? 'Metadatos encontrados' : 'Sin metadatos');
      } catch (e) {
        console.warn('⚠️  No se pudieron leer los metadatos después de MAT2:', e.message);
      }
      
      return {
        cleanedFilePath: winTempFile,
        metadata,
        cleanedWith: 'mat2'
      };
      
    } catch (e) {
      console.error('❌ No se pudo acceder al archivo limpiado:', e.message);
      throw new Error('No se pudo acceder al archivo limpiado');
    }
    
  } catch (error) {
    console.error('❌ Error al limpiar con MAT2:', error.message);
    throw new Error(`Error al limpiar con MAT2: ${error.message}`);
  } finally {
    // Limpiar archivos temporales en WSL
    try {
      console.log('🧹 Limpiando archivos temporales en WSL...');
      await execPromise(`wsl -d Ubuntu rm -f "${wslTempFile}" "${wslCleanedFile}"`);
    } catch (cleanError) {
      console.warn('⚠️  No se pudieron limpiar los archivos temporales en WSL:', cleanError.message);
    }
    console.log('🏁 Finalizada limpieza con MAT2\n');
  }
};

// Limpiar metadatos con ExifTool a través de WSL
const cleanWithExifTool = async (filePath) => {
  console.log('\n🔧 Iniciando limpieza con ExifTool a través de WSL...');
  
  // Asegurar que la ruta sea absoluta
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  
  // Crear nombres de archivos temporales
  const fileName = path.basename(absolutePath);
  const fileExt = path.extname(fileName);
  const baseName = path.basename(fileName, fileExt);
  const timestamp = Date.now();
  
  // Directorio temporal en WSL
  const wslTempDir = '/tmp/exiftool_clean';
  const wslTempFile = `${wslTempDir}/${timestamp}_${baseName}${fileExt}`;
  const wslOutputFile = `${wslTempDir}/${timestamp}_${baseName}_cleaned${fileExt}`;
  
  // Archivo temporal en Windows
  const winTempFile = path.join(os.tmpdir(), `exif_cleaned_${timestamp}_${baseName}${fileExt}`);
  
  // Convertir la ruta de Windows a formato WSL
  const convertToWslPath = (winPath) => {
    // Si ya es una ruta WSL, devolverla tal cual
    if (winPath.startsWith('/mnt/')) return winPath;
    
    // Si la ruta comienza con \, asumir que es relativa a la unidad del sistema
    if (winPath.startsWith('\\')) {
      // Convertir ruta como \path -> /mnt/<drive_letter>/path
      const driveLetter = process.cwd().split(path.sep)[0].toLowerCase().replace(':', '');
      return `/mnt/${driveLetter}${winPath.replace(/\\/g, '/')}`;
    }
    
    // Convertir ruta Windows a WSL (ej: C:\path -> /mnt/c/path)
    return winPath
      .replace(/^([A-Za-z]):/, (m, d) => `/mnt/${d.toLowerCase()}`)
      .replace(/\\/g, '/');
  };
  
  const wslSourcePath = convertToWslPath(absolutePath);
  const wslDestPath = convertToWslPath(winTempFile);
  
  console.log('Ruta de origen (Windows):', absolutePath);
  console.log('Ruta de origen (WSL):', wslSourcePath);
  console.log('Ruta de destino (WSL):', wslTempFile);
  
  try {
    // Crear directorio temporal en WSL
    console.log('Creando directorio temporal en WSL...');
    await execPromise(`wsl -d Ubuntu mkdir -p ${wslTempDir}`);
    
    // 1. Copiar el archivo a WSL usando la ruta de Windows accesible desde WSL
    console.log(`🔄 Copiando archivo a WSL: ${wslSourcePath} -> ${wslTempFile}`);
    
    // Usar la ruta de Windows accesible desde WSL directamente
    await execPromise(`wsl -d Ubuntu cp "${wslSourcePath}" "${wslTempFile}"`);
    
    // 2. Verificar que el archivo se copió correctamente
    console.log('Verificando que el archivo se copió a WSL...');
    const { stdout: lsOut } = await execPromise(`wsl -d Ubuntu ls -la "${wslTempFile}"`);
    console.log(`✅ Archivo copiado a WSL: ${lsOut.trim()}`);
    
    // 3. Ejecutar ExifTool en WSL
    console.log('🔄 Ejecutando ExifTool en WSL...');
    
    // Usar -o para especificar el archivo de salida
    await execPromise(
      `wsl -d Ubuntu exiftool -all= -o "${wslOutputFile}" "${wslTempFile}"`,
      { timeout: 30000 } // 30 segundos de timeout
    );
    
    console.log('✅ ExifTool ejecutado correctamente');
    
    // 4. Verificar que el archivo de salida se creó
    console.log('Verificando archivo de salida en WSL...');
    const { stdout: outputExists } = await execPromise(
      `wsl -d Ubuntu test -f "${wslOutputFile}" && echo "exists" || echo "not exists"`
    );
    
    if (outputExists.trim() !== 'exists') {
      throw new Error('No se generó el archivo de salida en WSL');
    }
    
    // 5. Copiar el archivo de vuelta a Windows
    console.log('🔄 Copiando archivo de vuelta a Windows...');
    
    // Asegurarse de que el directorio de destino existe en Windows
    await fs.promises.mkdir(path.dirname(winTempFile), { recursive: true });
    
    // Copiar el archivo usando la ruta de Windows accesible desde WSL
    await execPromise(`wsl -d Ubuntu cp "${wslOutputFile}" "${wslDestPath}"`);
    
    // Verificar que el archivo existe en Windows
    console.log('Verificando que el archivo se copió a Windows...');
    await fs.promises.access(winTempFile);
    console.log(`✅ Archivo limpiado copiado a: ${winTempFile}`);
    
    // Leer metadatos del archivo limpiado
    let metadata = {};
    try {
      metadata = await readMetadata(winTempFile);
      console.log('📊 Metadatos después de la limpieza:', 
        Object.keys(metadata).length > 0 ? 'Metadatos encontrados' : 'Sin metadatos');
    } catch (e) {
      console.warn('⚠️  No se pudieron leer los metadatos después de la limpieza:', e.message);
    }
    
    return {
      cleanedFilePath: winTempFile,
      metadata,
      cleanedWith: 'exiftool',
      originalFileSize: (await fs.promises.stat(absolutePath)).size,
      cleanedFileSize: (await fs.promises.stat(winTempFile)).size
    };
    
  } catch (error) {
    console.error('❌ Error al limpiar con ExifTool:', error.message);
    
    // Si hay un error, intentar copiar el archivo original como respaldo
    try {
      console.log('⚠️  Intentando copiar el archivo original como respaldo...');
      await fs.promises.copyFile(absolutePath, winTempFile);
      console.log('✅ Archivo original copiado como respaldo');
      
      return {
        cleanedFilePath: winTempFile,
        metadata: {},
        cleanedWith: 'none',
        error: error.message
      };
    } catch (backupError) {
      console.error('❌ No se pudo copiar el archivo original:', backupError.message);
      throw new Error(`Error al limpiar con ExifTool: ${error.message}`);
    }
  } finally {
    // Limpiar archivos temporales en WSL
    try {
      console.log('🧹 Limpiando archivos temporales en WSL...');
      await execPromise(`wsl -d Ubuntu rm -f "${wslTempFile}" "${wslOutputFile}"`);
    } catch (cleanError) {
      console.warn('⚠️  No se pudieron limpiar los archivos temporales en WSL:', cleanError.message);
    }
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
  // Verificar si IPFS está configurado
  if (!process.env.IPFS_HOST || !process.env.IPFS_PORT) {
    console.warn('IPFS no está configurado. Configura las variables de entorno IPFS_*');
    return null;
  }
  
  try {
    const form = new FormData();
    // Usar Buffer directamente en lugar de Blob para Node.js
    form.append('file', fileBuffer, 'uploaded_file');
    
    const protocol = process.env.IPFS_PROTOCOL || 'http';
    const url = `${protocol}://${process.env.IPFS_HOST}:${process.env.IPFS_PORT}/api/v0/add`;
    console.log('🌐 Conectando a IPFS en:', url);
    
    const options = {
      method: 'POST',
      body: form,
      // FormData manejará los headers necesarios incluyendo 'Content-Type'
    };
    
    // Agregar autenticación si está configurada
    if (process.env.IPFS_PROJECT_ID && process.env.IPFS_PROJECT_SECRET) {
      const auth = 'Basic ' + Buffer.from(
        `${process.env.IPFS_PROJECT_ID}:${process.env.IPFS_PROJECT_SECRET}`
      ).toString('base64');
      options.headers = {
        ...options.headers,
        'Authorization': auth
      };
    }
    
    console.log('📤 Enviando archivo a IPFS...');
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error en la respuesta de IPFS: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    if (data && data.Hash) {
      console.log('✅ Archivo almacenado en IPFS con hash:', data.Hash);
      return data.Hash;
    } else {
      console.error('Error: Respuesta inesperada de IPFS:', data);
      return null;
    }
  } catch (error) {
    console.error('❌ Error al almacenar en IPFS:', error.message);
    if (error.response) {
      console.error('Detalles del error:', error.response.data);
    }
    return null;
  }
};

const storeInBlockchain = async (fileHash, ipfsHash, metadata) => {
  try {
    console.log('\n🔷🔷🔷 INICIO DE REGISTRO EN BLOCKCHAIN INTERNA 🔷🔷🔷');
    console.log('⏰ Hora de inicio:', new Date().toISOString());
    
    // Configuración de la blockchain interna
    const INTERNAL_BLOCKCHAIN_URL = process.env.INTERNAL_BLOCKCHAIN_URL || 'http://localhost:8545';
    const web3 = new Web3(INTERNAL_BLOCKCHAIN_URL);
    
    // Modo de simulación para desarrollo
    if (process.env.NODE_ENV !== 'production' && process.env.USE_INTERNAL_BLOCKCHAIN !== 'true') {
      console.log('\n⚠️  MODO SIMULACIÓN: No se enviarán transacciones reales a la blockchain');
      const mockTxHash = '0x' + crypto.randomBytes(32).toString('hex');
      return {
        success: true,
        message: 'Simulación de registro en blockchain completada',
        txHash: mockTxHash,
        explorerUrl: `#${mockTxHash}`,
        data: { fileHash, ipfsHash, metadata },
        simulated: true
      };
    }
    // Cargar información del contrato desplegado
    let contractInfo;
    try {
      contractInfo = require('../../blockchain/deployed-contract.json');
      console.log(' Información del contrato cargada:', contractInfo.address);
      const contractAddress = contractInfo.address;
    } catch (error) {
      console.error(' No se pudo cargar la información del contrato desplegado');
      return {
        success: false,
        error: 'No se encontró el contrato desplegado',
        code: 'CONTRACT_NOT_FOUND',
        details: error.message
      };
    }
    // Verificar si tenemos una dirección de contrato configurada
    const contractAddress = process.env.SMART_CONTRACT_ADDRESS;
    console.log(' Dirección del contrato:', contractAddress || 'No configurada');
    // ...
    // Crear la transacción para registrar el archivo en el contrato
    console.log('\n Preparando transacción para el contrato:', contractAddress);
    try {
      // Usar el ABI del contrato desplegado
      const minABI = contractInfo.abi;
      // Crear instancia del contrato
      const contract = new web3.eth.Contract(minABI, contractAddress);
      // Obtener la primera cuenta disponible
      const accounts = await web3.eth.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No se encontraron cuentas disponibles en el nodo');
      }
      
      const fromAddress = accounts[0];
      console.log('👤 Usando cuenta:', fromAddress);
      
      // Preparar los datos de la transacción
      const data = contract.methods.registerFile(
        fileHash,
        ipfsHash || '',
        fileData.timestamp
      ).encodeABI();
      
      // Verificar si el contrato existe
      console.log('🔍 Verificando contrato en la dirección:', contractAddress);
      const code = await web3.eth.getCode(contractAddress);
      
      if (code === '0x') {
        throw new Error(`No se encontró ningún contrato en la dirección ${contractAddress}`);
      }
      
      // Verificar saldo de la billetera
      const balance = await web3.eth.getBalance(process.env.WALLET_ADDRESS);
      console.log('💰 Saldo de la billetera:', web3.utils.fromWei(balance, 'ether'), 'ETH');
      
      if (parseInt(balance) === 0) {
        throw new Error('La billetera no tiene fondos para pagar el gas');
      }

      // Crear la transacción
      const tx = {
        from: fromAddress,
        to: contractAddress,
        data: data,
        gas: 200000,  // Límite de gas estimado
        gasPrice: await web3.eth.getGasPrice()
      };
      
      console.log('\n📤 Enviando transacción a través de Web3Auth Infura Service...');
      
      // Enviar la transacción directamente (el nodo ya maneja la firma)
      console.log('📨 Enviando transacción...');
      const receipt = await web3.eth.sendTransaction(tx);
      console.log('✅ Transacción enviada con éxito');
      
      // Obtener el hash de la transacción y crear la URL del explorador
      const txHash = receipt.transactionHash;
      const networkId = await web3.eth.net.getId();
      let explorerUrl;
      
      // URL local para ver la transacción
      explorerUrl = `#${txHash}`;
      
      console.log('\n✅ Transacción exitosa');
      console.log('🔗 Hash de transacción:', txHash);
      console.log('🌐 Ver en explorador:', explorerUrl);
      
      // Mostrar información adicional para depuración
      console.log('\n🔍 Estado de la red:');
      const blockNumber = await web3.eth.getBlockNumber();
      console.log('- ID de red:', networkId);
      console.log('- Último bloque:', blockNumber);
      console.log('- Proveedor:', process.env.WEB3_PROVIDER_URL);
      
      console.log('\n🔷🔷🔷 FIN DE REGISTRO EN BLOCKCHAIN 🔷🔷🔷\n');
      
      return {
        success: true,
        message: 'Registro en blockchain completado correctamente',
        txHash: txHash,
        explorerUrl: explorerUrl,
        data: fileData
      };
    } catch (txError) {
      console.error('❌ Error al enviar la transacción:', txError.message);
      
      // Si hay un error, intentar proporcionar más contexto
      if (txError.receipt) {
        console.error('📄 Recibo de error:', JSON.stringify(txError.receipt, null, 2));
      }
      
      // Si el error es específico de revert, intentar decodificarlo
      if (txError.reason) {
        console.error('🔍 Razón del revert:', txError.reason);
      }
      
      // Si hay un error de conexión con la blockchain interna
      if (txError.message.includes('connect') || txError.message.includes('ECONNREFUSED')) {
        console.error('❌ No se pudo conectar al nodo de blockchain local. Asegúrate de que el nodo esté ejecutándose.');
        return {
          success: false,
          error: 'No se pudo conectar al nodo de blockchain local',
          code: 'BLOCKCHAIN_CONNECTION_ERROR',
          details: 'Asegúrate de que el nodo de blockchain esté ejecutándose en http://localhost:8545'
        };
      }
      
      // Si hay un error de firma, verificar si la cuenta está desbloqueada
      if (txError.message.includes('account is locked') || txError.message.includes('authentication needed')) {
        console.error('❌ La cuenta no está desbloqueada. Asegúrate de desbloquear la cuenta en el nodo.');
        return {
          success: false,
          error: 'La cuenta no está desbloqueada',
          code: 'ACCOUNT_LOCKED',
          details: 'Asegúrate de desbloquear la cuenta en el nodo de blockchain'
        };
      }
      
      // Mejorar el mensaje de error para errores comunes
      if (txError.message.includes('insufficient funds')) {
        throw new Error('Fondos insuficientes en la billetera para pagar el gas');
      } else if (txError.message.includes('revert')) {
        throw new Error('La transacción fue revertida por el contrato. ¿El contrato tiene la función registerFile?');
      } else if (txError.message.includes('nonce too low')) {
        throw new Error('Error de nonce. Intenta reiniciar tu nodo o espera un momento.');
      }
      
      throw txError; // Re-lanzar el error para que sea capturado por el catch exterior
    }
    
  } catch (error) {
    console.error('\n❌❌❌ ERROR EN BLOCKCHAIN ❌❌❌');
    console.error('Mensaje:', error.message);
    console.error('Código:', error.code || 'NO_CODE');
    console.error('Stack:', error.stack || 'No hay stack disponible');
    console.error('❌❌❌ FIN DEL ERROR ❌❌❌\n');
    
    return {
      success: false,
      error: error.message,
      code: error.code || 'BLOCKCHAIN_ERROR',
      details: {
        message: error.message,
        code: error.code,
        stack: error.stack
      }
    };
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
    
    // Variables para el procesamiento
    let wasCleaned = false;
    let cleanedMetadata = {};
    let finalBuffer = buffer;
    let cleanedFilePath = tempPath;

    // Intentar con MAT2 primero si está disponible
    try {
      console.log('Intentando limpiar con MAT2 a través de WSL...');
      const mat2Result = await cleanWithMat2(tempPath);
      cleanedFilePath = mat2Result.cleanedFilePath;
      cleanedMetadata = mat2Result.metadata;
      wasCleaned = true;
      console.log('Limpieza con MAT2 exitosa');
    } catch (mat2Error) {
      console.warn('Error al limpiar con MAT2 a través de WSL:', mat2Error.message);
      
      // Si falla, intentar con exiftool
      try {
        console.log('Intentando limpieza con ExifTool a través de WSL...');
        const exifResult = await cleanWithExifTool(tempPath);
        cleanedFilePath = exifResult.cleanedFilePath;
        cleanedMetadata = exifResult.metadata;
        wasCleaned = true;
        console.log('Limpieza con ExifTool exitosa');
      } catch (exifError) {
        console.warn('Error al limpiar con ExifTool a través de WSL:', exifError.message);
        
        // Si todo falla, usar el archivo original
        console.log('Usando archivo original sin limpieza de metadatos');
        cleanedFilePath = tempPath;
        wasCleaned = false;
      }
    }

    // Leer el archivo limpiado
    finalBuffer = await fsp.readFile(cleanedFilePath);

    // Calcular hash del archivo
    const fileHash = calculateHash(finalBuffer);
    
    // Almacenar en IPFS (si está configurado)
    let ipfsHash = null;
    try {
      ipfsHash = await storeInIPFS(finalBuffer);
      console.log('Archivo almacenado en IPFS con hash:', ipfsHash);
    } catch (ipfsError) {
      console.warn('No se pudo almacenar en IPFS:', ipfsError.message);
    }
    
    // Almacenar en blockchain usando Web3Auth Infura Service
    let txHash = null;
    let explorerUrl = null;
    let blockchainSimulated = false;
    
    // Intentar registrar en blockchain si tenemos la URL de Web3Auth configurada
    if (process.env.WEB3_PROVIDER_URL && process.env.WEB3_PROVIDER_URL.includes('web3auth.io')) {
      console.log('🔗 Usando Web3Auth Infura Service para registro en blockchain');
      const blockchainResult = await storeInBlockchain(fileHash, ipfsHash, {
        filename: originalname,
        size,
        mimeType: mimetype
      });
      
      if (blockchainResult && blockchainResult.success) {
        txHash = blockchainResult.txHash;
        explorerUrl = blockchainResult.explorerUrl;
        blockchainSimulated = blockchainResult.simulated || false;
        
        if (blockchainSimulated) {
          console.log('⚠️ Registro en blockchain simulado (no hay clave privada)');
        } else {
          console.log('✅ Registro en blockchain exitoso');
        }
        console.log(`🔗 Transacción: ${blockchainResult.explorerUrl}`);
      } else {
        console.warn('⚠️  No se pudo completar el registro en blockchain');
        if (blockchainResult) {
          console.warn(`   Código de error: ${blockchainResult.code}`);
          console.warn(`   Mensaje: ${blockchainResult.error}`);
        }
      }
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
      metadata: {
        original: originalMetadata,
        cleaned: wasCleaned ? cleanedMetadata : {}
      },
      userId: req.userId || 'anonymous',
      status: wasCleaned ? 'completed' : 'failed',
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
        message: 'Archivo no encontrado en la base de datos' 
      });
    }
    
    // Construir la ruta completa al archivo
    const fullPath = path.isAbsolute(fileRecord.path) 
      ? fileRecord.path 
      : path.join(process.cwd(), fileRecord.path);
    
    // Verificar si el archivo existe
    try {
      await fsp.access(fullPath, fs.constants.F_OK);
    } catch (error) {
      return res.status(404).json({ 
        success: false,
        message: 'Archivo no encontrado en el sistema de archivos' 
      });
    }
    
    // Configurar las cabeceras para la descarga
    res.download(fullPath, fileRecord.originalName, (err) => {
      if (err) {
        console.error('Error al descargar el archivo:', err);
        if (!res.headersSent) {
          res.status(500).json({ 
            success: false,
            message: 'Error al descargar el archivo'
          });
        }
      }
    });
    
  } catch (error) {
    console.error('Error al procesar la descarga:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error al procesar la descarga',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
