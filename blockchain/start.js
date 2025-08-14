import Web3 from 'web3';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración
const PORT = 8545;
const PASSWORD = 'password123'; // Cambia esto en producción

console.log('🚀 Iniciando Ganache...');

// Iniciar Ganache
const ganache = spawn('ganache', [
  '--port', PORT,
  '--deterministic',
  '--accounts', '10',
  '--defaultBalanceEther', '1000',
  '--gasLimit', '8000000',
  '--gasPrice', '20000000000'
]);

ganache.stdout.on('data', (data) => {
  console.log(`[GANACHE] ${data}`);
});

ganache.stderr.on('data', (data) => {
  console.error(`[GANACHE-ERROR] ${data}`);
});

ganache.on('close', (code) => {
  console.log(`❌ El proceso de Ganache terminó con código ${code}`);
});

console.log(`✅ Ganache iniciado en http://localhost:${PORT}`);
console.log('🔗 Conectando Web3...');

// Configurar Web3
const web3 = new Web3(new Web3.providers.HttpProvider(`http://localhost:${PORT}`));

// Función para verificar la conexión
const checkConnection = async () => {
  try {
    const nodeInfo = await web3.eth.getNodeInfo();
    console.log('✅ Conectado a la blockchain:', nodeInfo);
    
    // Crear una cuenta si no existe
    const accounts = await web3.eth.getAccounts();
    if (accounts.length === 0) {
      console.log('🔑 Creando cuenta por defecto...');
      const account = web3.eth.accounts.create();
      console.log('✅ Cuenta creada:', account.address);
      
      // Desbloquear la cuenta permanentemente (solo para desarrollo)
      await web3.eth.personal.importRawKey(
        account.privateKey.replace('0x', ''),
        PASSWORD
      );
      
      console.log('🔓 Cuenta desbloqueada');
      
      // Minar algunos bloques para obtener ETH
      console.log('⛏️  Minando bloques...');
      await web3.eth.sendTransaction({
        from: '0x0000000000000000000000000000000000000000',
        to: account.address,
        value: web3.utils.toWei('1000', 'ether')
      });
      
      console.log('💰 Fondos asignados a la cuenta:', account.address);
    }
    
  } catch (error) {
    console.error('❌ Error al conectar con la blockchain:', error.message);
    process.exit(1);
  }
};

// Esperar a que el nodo esté listo
setTimeout(checkConnection, 5000);

// Manejar la salida del proceso
process.on('SIGINT', () => {
  console.log('\n🛑 Deteniendo nodo de blockchain...');
  geth.kill('SIGINT');
  process.exit(0);
});
