const { app, BrowserWindow } = require('electron');
const path = require('path');

// Levantar el servidor de fondo Express de forma interna en el mismo proceso
require('./server.js');

function crearVentana() {
    const ventana = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 1024,
        minHeight: 720,
        icon: path.join(__dirname, 'frontend', 'assets', 'icono.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        title: "Servidor local y Panel de Administración de Capturas"
    });

    // Quitar la barra de menús estándar en producción
    ventana.setMenuBarVisibility(false);

    // Cargar el archivo principal de la interfaz de administración
    ventana.loadFile(path.join(__dirname, 'frontend', 'index.html'));
}

app.whenReady().then(() => {
    crearVentana();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
