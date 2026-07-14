/**
 * Enrutador de Express para la API de Auditoría (auditoria.routes.js).
 * Registra las subidas físicas y los endpoints de registro de auditorías.
 */

const express = require('express');
const enrutador = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const controladorAuditoria = require('../controllers/auditoria.controller');

// Configuración de almacenamiento físico de PDFs con multer
const almacenamiento = multer.diskStorage({
    destination: (req, archivo, callback) => {
        const tipoCaptura = (req.body.tipo_captura || 'DIGITALIZACION').toUpperCase();
        let notaria = (req.body.notaria || 'General').trim();

        if (!notaria || notaria.toUpperCase() === 'NOTARIAS' || notaria.toUpperCase() === 'GENERAL') {
            notaria = 'General';
        }

        const rutaBase = process.env.RUTA_SSDIREC || 'C:\\laragon\\www\\ssdirec';
        const rutaDestino = path.join(rutaBase, tipoCaptura, notaria);

        // Crear la carpeta física si no existe
        if (!fs.existsSync(rutaDestino)) {
            fs.mkdirSync(rutaDestino, { recursive: true });
        }

        callback(null, rutaDestino);
    },
    filename: (req, archivo, callback) => {
        callback(null, archivo.originalname);
    }
});

const upload = multer({ storage: almacenamiento });

// 1. Endpoints para registrar logs de auditoría (compatibilidad multiproyecto)
enrutador.post('/registrar', controladorAuditoria.registrarAuditoria);

// 2. Endpoint de recepción y almacenamiento de PDFs físicos
enrutador.post('/subir-pdf', upload.single('archivo'), controladorAuditoria.subirPdf);

// 3. Endpoint para obtener los últimos 100 registros
enrutador.get('/registros', controladorAuditoria.obtenerRegistros);

// 4. Endpoints para la importación masiva desde directorios locales o de red
enrutador.get('/notarias-locales', controladorAuditoria.obtenerNotariasLocales);
enrutador.post('/escanear-directorio', controladorAuditoria.escanearDirectorio);
enrutador.post('/importar-archivo', controladorAuditoria.importarArchivoPdf);
enrutador.post('/sincronizar-astronmx', controladorAuditoria.sincronizarAstronmx);

// 5. Endpoint dummy para monitoreo de digitalizacion
enrutador.get('/digitalizacion', (req, res) => {
    res.json({ ok: true, mensaje: 'Servicio de digitalización activo.' });
});

module.exports = enrutador;
