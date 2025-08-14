# Blockchain Interna para el Proyecto de Seguridad

Este directorio contiene los archivos necesarios para ejecutar una blockchain privada localmente, diseñada para el registro de hashes de archivos.

## Requisitos previos

1. **Node.js** (versión 14 o superior)
2. **Geth** (cliente de Ethereum)
   - En Windows: `choco install geth`
   - En macOS: `brew install ethereum`
   - En Ubuntu/Debian: `sudo apt-get install ethereum`

## Estructura de archivos

- `genesis.json`: Configuración inicial de la blockchain
- `start.js`: Script para iniciar el nodo de blockchain
- `deploy.js`: Script para desplegar el contrato inteligente
- `contracts/`: Directorio con los contratos inteligentes
  - `FileRegistry.sol`: Contrato para el registro de archivos
- `data/`: Directorio donde se almacenan los datos de la blockchain (se crea automáticamente)

## Cómo usar

### 1. Iniciar la blockchain local

```bash
# Navegar al directorio del proyecto
cd c:\Users\eaar2\Documents\TAREAS\seguridad\ProyectoSeguridadU2\blockchain

# Iniciar el nodo de blockchain
node start.js
```

### 2. Desplegar el contrato inteligente

En una nueva terminal, ejecuta:

```bash
# Navegar al directorio del proyecto
cd c:\Users\eaar2\Documents\TAREAS\seguridad\ProyectoSeguridadU2\blockchain

# Instalar dependencias (solo la primera vez)
npm install solc

# Desplegar el contrato
node deploy.js
```

Esto generará un archivo `deployed-contract.json` con la información del contrato desplegado.

### 3. Configurar la aplicación para usar la blockchain local

Asegúrate de que en tu archivo `.env` tengas la siguiente configuración:

```env
USE_INTERNAL_BLOCKCHAIN=true
INTERNAL_BLOCKCHAIN_URL=http://localhost:8545
```

## Características de la blockchain local

- **Red privada**: Totalmente aislada de las redes públicas de Ethereum
- **Tiempo de bloque rápido**: Los bloques se generan cada 15 segundos
- **Sin costo de gas**: Las transacciones no tienen costo real
- **Cuentas pre-fondeadas**: La primera cuenta tiene fondos ilimitados para pruebas

## Solución de problemas

### Error de conexión

Si ves un error de conexión, asegúrate de que:
1. El nodo de blockchain esté en ejecución (`node start.js`)
2. El puerto 8545 no esté siendo utilizado por otro proceso

### Error de contrato no encontrado

Si el contrato no se encuentra, verifica que:
1. El contrato se haya desplegado correctamente (`node deploy.js`)
2. El archivo `deployed-contract.json` exista y tenga la dirección correcta

### Error de cuenta bloqueada

Si ves un error de cuenta bloqueada, asegúrate de que la cuenta esté desbloqueada en el nodo.
