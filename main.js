const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

// Manejadores globales para prevenir que Electron se cierre por errores de red o excepciones no capturadas
process.on('uncaughtException', (err) => {
  console.error('Capturada uncaughtException global en Electron:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Capturada unhandledRejection global en Electron:', reason);
});

// Levantar el servidor de fondo Express de forma interna en el mismo proceso
require('./backend/server.js');

function crearVentana() {
    const ventana = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 1024,
        minHeight: 720,
        icon: path.join(__dirname, 'frontend', 'public', 'assets', 'icono.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        title: "Servidor local y Panel de Administración de Capturas"
    });

    // Quitar la barra de menús estándar en producción
    ventana.setMenuBarVisibility(false);

    // Advertencia de confirmación antes de cerrar la ventana
    let confirmandoCierre = false;
    ventana.on('close', (e) => {
        if (confirmandoCierre) return;

        e.preventDefault();

        const opcion = dialog.showMessageBoxSync(ventana, {
            type: 'warning',
            buttons: ['Cancelar', 'Salir de la Aplicación'],
            defaultId: 0,
            cancelId: 0,
            title: 'Confirmar Salida',
            message: '¿Estás seguro de que deseas salir de Servidor Notarías?',
            detail: 'Si hay transferencias masivas de archivos en curso en segundo plano, el proceso se interrumpirá.',
            noLink: true
        });

        if (opcion === 1) {
            confirmandoCierre = true;
            ventana.close();
        }
    });

    // Cargar el archivo principal de la interfaz de administración
    ventana.loadFile(path.join(__dirname, 'frontend', 'public', 'index.html'));
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
