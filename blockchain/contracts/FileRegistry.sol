// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract FileRegistry {
    struct FileRecord {
        string fileHash;
        string ipfsHash;
        uint256 timestamp;
        address owner;
    }

    mapping(string => FileRecord) private files;
    string[] private fileHashes;

    event FileRegistered(
        string indexed fileHash,
        string ipfsHash,
        uint256 timestamp,
        address indexed owner
    );

    function registerFile(
        string memory _fileHash,
        string memory _ipfsHash,
        uint256 _timestamp
    ) public {
        require(bytes(_fileHash).length > 0, "El hash del archivo no puede estar vacío");
        require(bytes(files[_fileHash].fileHash).length == 0, "El archivo ya está registrado");
        
        files[_fileHash] = FileRecord({
            fileHash: _fileHash,
            ipfsHash: _ipfsHash,
            timestamp: _timestamp,
            owner: msg.sender
        });
        
        fileHashes.push(_fileHash);
        
        emit FileRegistered(_fileHash, _ipfsHash, _timestamp, msg.sender);
    }

    function getFile(string memory _fileHash) public view returns (
        string memory fileHash,
        string memory ipfsHash,
        uint256 timestamp,
        address owner
    ) {
        FileRecord memory record = files[_fileHash];
        require(bytes(record.fileHash).length > 0, "Archivo no encontrado");
        
        return (
            record.fileHash,
            record.ipfsHash,
            record.timestamp,
            record.owner
        );
    }

    function getTotalFiles() public view returns (uint256) {
        return fileHashes.length;
    }
}
