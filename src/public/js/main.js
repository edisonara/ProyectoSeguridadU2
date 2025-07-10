let token = "";
let socket;
let currentChannel = "general";
let username = "";
let userRole = "";

// ---- Cifrado AES cliente a cliente ----
let encryptionKey = localStorage.getItem('encKey') || null;

function askEncryptionKey() {
    if (!encryptionKey) {
        encryptionKey = prompt("Ingresa la clave de cifrado (debe coincidir con los demás participantes):");
        if (encryptionKey) {
            localStorage.setItem('encKey', encryptionKey);
        } else {
            alert("Se requiere una clave de cifrado para continuar.");
        }
    }
}

askEncryptionKey();

function encrypt(text) {
    if (!encryptionKey) return text;
    return CryptoJS.AES.encrypt(text, encryptionKey).toString();
}

function decrypt(cipher) {
    if (!encryptionKey) return cipher;
    try {
        const bytes = CryptoJS.AES.decrypt(cipher, encryptionKey);
        const original = bytes.toString(CryptoJS.enc.Utf8);
        return original || cipher;
    } catch (e) {
        return cipher;
    }
}

// Construye la URL del backend según dónde se abra la página
const BACKEND_URL = `${location.protocol}//${location.hostname}:8083`;

function register() {
    const username = document.getElementById("reg-user").value;
    const email = document.getElementById("reg-email")?.value; const password = document.getElementById("reg-pass").value;
    const role = document.getElementById("reg-role").value;

    fetch("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, role })
    })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.message || 'Error en el registro');
            }
            return data;
        })
        .then(data => alert(`Registrado: Guarda esta clave OTP: ${data.otpSecret}`))
        .catch(error => alert(error.message));
}

function login() {
    const usernameInput = document.getElementById("login-user").value;
    const password = document.getElementById("login-pass").value;

    return fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput, password })
    })
    .then(res => {
        if (!res.ok) {
            throw new Error('Usuario o contraseña incorrectos');
        }
        return res.json();
    })
    .then(data => {
        if (data.error) {
            throw new Error(data.message || 'Error en el inicio de sesión');
        }
        localStorage.setItem("username", usernameInput);
        localStorage.setItem("tempToken", data.tempToken); // Guardar token temporal
        // Si el backend devuelve token directo (SKIP_OTP)
        if (data.token) {
            token = data.token;
            username = usernameInput;
            localStorage.setItem('token', data.token);
            localStorage.setItem('role', data.role);
            userRole = data.role || "usuario";
            updateUserProfile();
            connectSocket();
            return data;
        }
        return data;
    });
}

function verifyOTP() {
    const storedUsername = localStorage.getItem("username");
    const tempToken = localStorage.getItem("tempToken");
    const otp = document.getElementById("otp").value;

    if (!storedUsername || !tempToken) {
        throw new Error("No hay sesión activa. Por favor, inicia sesión nuevamente.");
    }

    return fetch("/auth/verify-otp", {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tempToken}` // Enviar token temporal
        },
        body: JSON.stringify({ username: storedUsername, otp })
    })
    .then(res => {
        if (!res.ok) {
            throw new Error('Código OTP incorrecto');
        }
        return res.json();
    })
    .then(data => {
        if (data.error) {
            throw new Error(data.message || 'Error en la verificación OTP');
        }
        
        // Limpiar token temporal
        localStorage.removeItem("tempToken");
        
        // Guardar datos de la sesión
        connectSocket();
        token = data.token;
        username = storedUsername;
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', storedUsername);
        userRole = data.role;
        localStorage.setItem('role', data.role);
        
        // Actualizar UI
        updateUserProfile();
        
        return data;
    });
}

function updateUserProfile() {
    const userNameElement = document.querySelector('.user-name');
    const userStatusElement = document.querySelector('.user-status');
    
    const avatarEl = document.querySelector('.user-avatar');
    if (userNameElement && userStatusElement) {
        userNameElement.textContent = username;
        userStatusElement.textContent = userRole;
        if (avatarEl && username) {
            avatarEl.textContent = username.charAt(0).toUpperCase();
        }
    }
}

function formatTimestamp(date) {
    const today = new Date();
    const messageDate = new Date(date);
    
    if (today.toDateString() === messageDate.toDateString()) {
        return messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return messageDate.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// IndexedDB util para archivos locales
let db;
function initDB() {
    const req = indexedDB.open('chatFiles', 1);
    req.onupgradeneeded = e => {
        db = e.target.result;
        db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => db = e.target.result;
}

function saveFileLocally(file) {
    if (!db) return;
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').add({ name: file.name, data: file });
}

document.addEventListener('DOMContentLoaded', () => initDB());

// Subir archivos al backend y compartir URL accesible
function handleLocalFiles(fileList) {
    [...fileList].forEach(file => {
        saveFileLocally(file);
        const form = new FormData();
        form.append('file', file);
        fetch('/files/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        })
        .then(res => res.json())
        .then(({ url, name }) => {
            const payload = { name, url };
            socket.emit('chat-message', { message: JSON.stringify(payload), room: currentChannel, type: 'file' });
        })
        .catch(err => console.error('Error subiendo archivo:', err));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('local-file-input');
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) handleLocalFiles(fileInput.files);
            fileInput.value = '';
        });
    }
});

// Imagenes
function handleImageUpload(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const base64 = e.target.result;
        socket.emit('chat-message', { message: base64, room: currentChannel, type: 'image' });
    };
    reader.readAsDataURL(file);
}

document.addEventListener('DOMContentLoaded', () => {
    const imgBtn = document.getElementById('image-btn');
    const imgInput = document.getElementById('image-input');
    if (imgBtn && imgInput) {
        imgBtn.addEventListener('click', () => imgInput.click());
        imgInput.addEventListener('change', () => {
            const file = imgInput.files[0];
            if (file) handleImageUpload(file);
            imgInput.value = '';
        });
    }
});

// Emoji picker simple
const emojiList = ['😀','😁','😂','🤣','😅','😊','😍','😎','😭','👍','🙏'];
let emojiPicker;

function createEmojiPicker() {
    emojiPicker = document.createElement('div');
    emojiPicker.id = 'emoji-picker';
    emojiList.forEach(e => {
        const span = document.createElement('span');
        span.textContent = e;
        span.addEventListener('click', () => {
            const input = document.getElementById('message');
            input.value += e;
            input.focus();
            emojiPicker.style.display = 'none';
        });
        emojiPicker.appendChild(span);
    });
    document.body.appendChild(emojiPicker);
}

document.addEventListener('DOMContentLoaded', () => {
    if (!emojiPicker) createEmojiPicker();
    const emojiBtn = document.getElementById('emoji-btn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const rect = emojiBtn.getBoundingClientRect();
            emojiPicker.style.left = `${rect.left}px`;
            emojiPicker.style.top = `${rect.top - 160}px`;
            emojiPicker.style.display = emojiPicker.style.display === 'flex' ? 'none' : 'flex';
        });
    }
    document.addEventListener('click', () => {
        if (emojiPicker) emojiPicker.style.display = 'none';
    });

    // listener logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (socket) socket.disconnect();
            localStorage.clear();
            window.location.href = 'index.html';
        });
    }
});

function loadHistory(room) {
    fetch(`/chat/history?room=${room}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(messages => {
        const chatDiv = document.getElementById('chat');
        chatDiv.innerHTML = '';
        messages.forEach(m => {
            const el = createMessageElement(m);
            chatDiv.appendChild(el);
        });
        chatDiv.scrollTop = chatDiv.scrollHeight;
    })
    .catch(err => console.error('Error cargando historial:', err));
}

function createMessageElement(data) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    // You could set a background image here if you have user avatars
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    const headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    
    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = data.username || 'Desconocido';
    
    const timestamp = document.createElement('span');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = formatTimestamp(data.timestamp || new Date());
    
    const roleTag = document.createElement('span');
    roleTag.className = 'message-role';
    roleTag.style.backgroundColor = 'var(--accent-color)';
    roleTag.style.padding = '2px 6px';
    roleTag.style.borderRadius = '4px';
    roleTag.style.fontSize = '0.7em';
    roleTag.textContent = data.role;
    
    headerDiv.appendChild(author);
    headerDiv.appendChild(timestamp);
    headerDiv.appendChild(roleTag);
    
    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    if (data.type === 'file') {
        const info = JSON.parse(data.message);
        const link = document.createElement('a');
        link.href = info.url.startsWith('http') ? info.url : `${BACKEND_URL}${info.url}`;
        link.download = info.name;
        link.textContent = `📎 ${info.name}`;
        link.style.color = 'var(--accent-color)';
        messageText.appendChild(link);
    } else if (data.type === 'image') {
        const img = document.createElement('img');
        img.src = data.message;
        img.style.maxWidth = '200px';
        img.style.borderRadius = '6px';
        messageText.appendChild(img);
    } else {
        const decrypted = decrypt(data.message);
        messageText.textContent = decrypted;
    }
    
    contentDiv.appendChild(headerDiv);
    contentDiv.appendChild(messageText);
    
    messageDiv.appendChild(avatar);
    if (data.username === username) {
        messageDiv.classList.add('own');
    }
    messageDiv.appendChild(contentDiv);
    
    return messageDiv;
}

function connectSocket() {
    if (socket) {
        socket.disconnect();
    }
    socket = io(BACKEND_URL, {
        auth: { token }
    });

    socket.on("connect", () => {
        console.log("Conectado al socket");
        socket.emit("join", currentChannel); // unir a canal por defecto
        loadHistory(currentChannel);
        const statusEl = document.querySelector('.user-status');
        if (statusEl) statusEl.textContent = 'En línea';
        // Mensaje de sistema cuando se conecta
        const chatDiv = document.getElementById("chat");
        const systemMessage = createMessageElement({
            username: "Sistema",
            role: "system",
            message: `Conectado al canal #${currentChannel}`
        });
        systemMessage.style.opacity = "0.7";
        chatDiv.appendChild(systemMessage);
        chatDiv.scrollTop = chatDiv.scrollHeight;
    });

    socket.on("connect", () => {
        console.log("Conectado al socket");
        // Add a system message when connected
        const chatDiv = document.getElementById("chat");
        const systemMessage = createMessageElement({
            username: "Sistema",
            role: "system",
            message: "Conectado al chat"
        });
        systemMessage.style.opacity = "0.7";
        chatDiv.appendChild(systemMessage);
        chatDiv.scrollTop = chatDiv.scrollHeight;
    });

    socket.on("chat-message", (data) => {
        if (data.room && data.room !== currentChannel) return; // ignorar mensajes de otros canales
        const chatDiv = document.getElementById("chat");
        const messageElement = createMessageElement(data);
        chatDiv.appendChild(messageElement);
        chatDiv.scrollTop = chatDiv.scrollHeight;
    });

    socket.on("connect_error", (error) => {
        console.error("Error de conexión:", error);
        if (error.message.includes("Token")) {
            alert("Sesión expirada. Por favor, inicia sesión nuevamente.");
            window.location.href = 'index.html';
        }
    });

    socket.on("disconnect", () => {
        const statusEl = document.querySelector('.user-status');
        if (statusEl) statusEl.textContent = 'Desconectado';
    });
}

function sendMessage() {
    if (!socket || socket.disconnected) {
        alert("No conectado al chat");
        return;
    }
    const messageInput = document.getElementById("message");
    const msg = messageInput.value.trim();

    if (msg) {
        const encrypted = encrypt(msg);
        socket.emit("chat-message", { message: encrypted, room: currentChannel });
        messageInput.value = "";
    }
}

// Add event listener for Enter key in message input
document.addEventListener('DOMContentLoaded', () => {
    // Si ya tenemos sesión guardada, recuperar y mostrar
    const storedToken = localStorage.getItem('token');
    const storedUsername = localStorage.getItem('username');
    const storedRole = localStorage.getItem('role');
    if (storedToken && storedUsername) {
        token = storedToken;
        username = storedUsername;
        userRole = storedRole || 'usuario';
        updateUserProfile();
        connectSocket();
    }

    // Listener para cambio de canal
    document.querySelectorAll('.channel-item').forEach(item => {
        item.addEventListener('click', () => {
            const channelName = item.textContent.trim();
            if (channelName === currentChannel) return;
            // Dejar canal anterior y unirse al nuevo
            if (socket && socket.connected) {
                socket.emit('leave', currentChannel);
                socket.emit('join', channelName);
            loadHistory(channelName);
            }
            currentChannel = channelName;
            // actualizar UI activo
            document.querySelectorAll('.channel-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            // actualizar header y placeholder
            const headSpan = document.querySelector('.chat-header span');
            if (headSpan) headSpan.textContent = channelName;
            const msgInput = document.getElementById('message');
            msgInput.placeholder = `Enviar mensaje a #${channelName}`;
            // limpiar mensajes
            document.getElementById('chat').innerHTML = '';
            // restricción de rol (solo admins publican en anuncios)
            const sendBtn = document.querySelector('.fa-paper-plane').parentElement;
            if (channelName === 'anuncios' && userRole !== 'admin') {
                msgInput.disabled = true;
                sendBtn.disabled = true;
                sendBtn.style.opacity = 0.3;
            } else {
                msgInput.disabled = false;
                sendBtn.disabled = false;
                sendBtn.style.opacity = 1;
            }
        });
    });
    const messageInput = document.getElementById("message");
    messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});
