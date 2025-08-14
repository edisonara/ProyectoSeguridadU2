import Web3 from 'web3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import solc from 'solc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración
const CONTRACT_PATH = path.join(__dirname, 'contracts', 'FileRegistry.sol');
const PROVIDER_URL = 'http://localhost:8545';
const PASSWORD = 'password123'; // Debe coincidir con el del script start.js

// Inicializar Web3
const web3 = new Web3(PROVIDER_URL);

// Función para compilar el contrato
const compileContract = () => {
  console.log('🔨 Compilando contrato...');
  
  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const input = {
    language: 'Solidity',
    sources: {
      'FileRegistry.sol': {
        content: source
      }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['*']
        }
      }
    }
  };
  
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  
  if (output.errors) {
    console.error('❌ Errores de compilación:');
    output.errors.forEach(error => console.error(error.formattedMessage));
    process.exit(1);
  }
  
  const contract = output.contracts['FileRegistry.sol']['FileRegistry'];
  return {
    abi: contract.abi,
    bytecode: '0x' + contract.evm.bytecode.object
  };
};

// Función principal
const deploy = async () => {
  try {
    // Verificar conexión
    const nodeInfo = await web3.eth.getNodeInfo();
    console.log('✅ Conectado al nodo:', nodeInfo);
    
    // Obtener cuentas
    const accounts = await web3.eth.getAccounts();
    if (accounts.length === 0) {
      throw new Error('No se encontraron cuentas en el nodo');
    }
    
    const deployer = accounts[0];
    console.log('👤 Usando cuenta:', deployer);
    
    // Mostrar balance de la cuenta
    const balance = await web3.eth.getBalance(deployer);
    console.log(`💰 Balance: ${web3.utils.fromWei(balance, 'ether')} ETH`);
    
    // Compilar el contrato
    const { abi, bytecode } = compileContract();
    
    // Desplegar el contrato
    console.log('🚀 Desplegando contrato...');
    
    const contract = new web3.eth.Contract(abi);
    const deployTx = contract.deploy({
      data: bytecode,
      arguments: []
    });
    
    const gas = await deployTx.estimateGas({ from: deployer });
    console.log('⛽ Gas estimado:', gas);
    
    try {
      const deployedContract = await deployTx.send({
        from: deployer,
        gas: gas,
        gasPrice: '20000000000' // 20 Gwei
      });
      
      console.log('✅ Contrato desplegado en:', deployedContract.options.address);
      console.log('📄 ABI:', JSON.stringify(abi, null, 2));
      
      // Guardar la información del contrato
      const contractInfo = {
        address: deployedContract.options.address,
        abi: abi,
        transactionHash: deployedContract.transactionHash,
        blockNumber: deployedContract.options.fromBlock || 'latest'
      };
      
      fs.writeFileSync(
        path.join(__dirname, 'deployed-contract.json'),
        JSON.stringify(contractInfo, null, 2)
      );
      
      console.log('📝 Información del contrato guardada en deployed-contract.json');
    } catch (error) {
      console.error('❌ Error al desplegar el contrato:', error);
      if (error.receipt) {
        console.error('📄 Recibo de error:', JSON.stringify(error.receipt, null, 2));
      }
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Error al desplegar el contrato:', error);
    process.exit(1);
  }
};

deploy();
