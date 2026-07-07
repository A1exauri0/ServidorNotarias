require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const app = express();
const puerto = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

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

        // Crear la carpeta física de destino si no existe
        if (!fs.existsSync(rutaDestino)) {
            fs.mkdirSync(rutaDestino, { recursive: true });
        }

        callback(null, rutaDestino);
    },
    filename: (req, archivo, callback) => {
        // Conservar el nombre original del archivo PDF
        callback(null, archivo.originalname);
    }
});

const upload = multer({ storage: almacenamiento });

let pool;

// Inicialización de conexión a MySQL y creación de base de datos / tablas
async function inicializarBaseDatos() {
    try {
        // Conexión inicial sin especificar base de datos para poder crearla si no existe
        const conexionInicial = await mysql.createConnection({
            host: process.env.DB_HOST || '127.0.0.1',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || ''
        });

        const dbNombre = process.env.DB_DATABASE || 'captura_notarias_db';
        await conexionInicial.query(`CREATE DATABASE IF NOT EXISTS \`${dbNombre}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        await conexionInicial.end();

        // Conectar pool a la base de datos ya creada
        pool = mysql.createPool({
            host: process.env.DB_HOST || '127.0.0.1',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: dbNombre,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Crear tablas necesarias
        await crearTablas();

        console.log(`Base de datos y tablas inicializadas correctamente en MySQL [${dbNombre}].`);
    } catch (error) {
        console.error('Error al inicializar la base de datos MySQL:', error);
    }
}

async function crearTablas() {
    const conexion = await pool.getConnection();
    try {
        // 1. Tabla auditoria_notarias
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS \`auditoria_notarias\` (
                \`id\` bigint(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                \`fecha_hora\` datetime NOT NULL,
                \`turno\` varchar(255) DEFAULT NULL,
                \`user_id\` bigint(20) DEFAULT NULL,
                \`categoria\` varchar(255) DEFAULT NULL,
                \`pc\` varchar(255) DEFAULT NULL,
                \`directorio\` varchar(255) DEFAULT NULL,
                \`volumen\` varchar(255) DEFAULT NULL,
                \`accion\` varchar(255) DEFAULT NULL,
                \`archivo_original\` varchar(255) DEFAULT NULL,
                \`archivo_nuevo\` varchar(255) DEFAULT NULL,
                \`ruta\` varchar(500) DEFAULT NULL,
                \`detalles\` text DEFAULT NULL,
                \`paginas\` int(11) DEFAULT 0,
                \`exportado\` tinyint(4) DEFAULT 0,
                \`exportado_en\` datetime DEFAULT NULL,
                \`created_at\` datetime DEFAULT NULL,
                \`updated_at\` datetime DEFAULT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 2. Tabla auditoria_digitalizacion
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS \`auditoria_digitalizacion\` (
                \`id\` bigint(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                \`fecha_hora\` datetime NOT NULL,
                \`turno\` varchar(255) DEFAULT NULL,
                \`user_id\` bigint(20) DEFAULT NULL,
                \`pc\` varchar(255) DEFAULT NULL,
                \`ip\` varchar(255) DEFAULT NULL,
                \`notaria\` varchar(255) DEFAULT NULL,
                \`archivo\` varchar(255) DEFAULT NULL,
                \`detalles\` text DEFAULT NULL,
                \`paginas\` int(11) DEFAULT 0,
                \`lugar_trabajo\` varchar(255) DEFAULT NULL,
                \`exportado\` tinyint(4) DEFAULT 0,
                \`exportado_en\` datetime DEFAULT NULL,
                \`created_at\` datetime DEFAULT NULL,
                \`updated_at\` datetime DEFAULT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 3. Tabla auditoria_libros
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS \`auditoria_libros\` (
                \`id\` bigint(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                \`user_id\` bigint(20) DEFAULT NULL,
                \`turno\` varchar(255) DEFAULT NULL,
                \`categoria\` varchar(255) DEFAULT NULL,
                \`pc\` varchar(255) DEFAULT NULL,
                \`directorio\` varchar(500) DEFAULT NULL,
                \`accion\` varchar(255) DEFAULT NULL,
                \`archivo_original\` varchar(255) DEFAULT NULL,
                \`archivo_nuevo\` varchar(255) DEFAULT NULL,
                \`detalles\` text DEFAULT NULL,
                \`paginas\` int(11) DEFAULT 0,
                \`exportado\` tinyint(4) DEFAULT 0,
                \`exportado_en\` datetime DEFAULT NULL,
                \`created_at\` datetime DEFAULT NULL,
                \`updated_at\` datetime DEFAULT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

    } finally {
        conexion.release();
    }
}

// Función auxiliar para obtener el total de páginas de un PDF
async function contarPaginasPdf(rutaCompleta) {
    try {
        if (!fs.existsSync(rutaCompleta)) return 0;
        const pdfBytes = fs.readFileSync(rutaCompleta);
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        return pdfDoc.getPageCount();
    } catch (e) {
        // Fallback rápido por regex en caso de error de lectura binaria
        try {
            const stream = fs.readFileSync(rutaCompleta);
            const content = stream.toString('ascii', 0, 102400); // Primeros 100KB
            const matches = content.match(/\/Count\s+(\d+)/);
            if (matches && matches[1]) {
                return parseInt(matches[1], 10);
            }
        } catch (ex) {}
        return 0;
    }
}

// Manejador común para registrar auditorías
async function registrarAuditoriaHandler(req, res) {
    const datos = req.body;
    let registros = [];

    if (datos.Registros && Array.isArray(datos.Registros)) {
        registros = datos.Registros;
    } else if (Array.isArray(datos)) {
        registros = datos;
    } else {
        registros = [datos];
    }

    let procesados = 0;
    let duplicados = 0;
    const errores = [];

    const conexion = await pool.getConnection();

    try {
        for (const [index, reg] of registros.entries()) {
            try {
                // Determinar tipo de captura e inferir la tabla correspondiente
                let tipo = (reg.TipoCaptura || reg.tipo_captura || 'DIGITALIZACION').toUpperCase();
                
                // Mapeo dinámico de tablas
                let tabla = 'auditoria_digitalizacion';
                if (tipo === 'NOTARIAS' || req.originalUrl.includes('/notarias/')) {
                    tabla = 'auditoria_notarias';
                    tipo = 'NOTARIAS';
                } else if (tipo === 'LIBROS' || req.originalUrl.includes('/libros/')) {
                    tabla = 'auditoria_libros';
                    tipo = 'LIBROS';
                }

                const fechaHora = reg.FechaHora || reg.fecha_hora || new Date().toISOString().slice(0, 19).replace('T', ' ');
                const archivoOriginal = reg.ArchivoOriginal || reg.archivo_original || reg.archivo || null;
                const pc = reg.PC || reg.pc || null;
                const accion = reg.Accion || reg.accion || 'Capturado';

                // Prevenir duplicados en MySQL
                let queryDuplicado = '';
                let paramsDuplicado = [];
                if (tabla === 'auditoria_digitalizacion') {
                    queryDuplicado = `SELECT id FROM \`${tabla}\` WHERE fecha_hora = ? AND pc = ? AND archivo = ? LIMIT 1`;
                    paramsDuplicado = [fechaHora, pc, archivoOriginal];
                } else {
                    queryDuplicado = `SELECT id FROM \`${tabla}\` WHERE fecha_hora = ? AND pc = ? AND archivo_original = ? AND accion = ? LIMIT 1`;
                    paramsDuplicado = [fechaHora, pc, archivoOriginal, accion];
                }

                const [rows] = await conexion.query(queryDuplicado, paramsDuplicado);
                if (rows.length > 0) {
                    duplicados++;
                    continue;
                }

                // Armar la consulta de inserción dinámica según la tabla
                const ahora = new Date();
                let sqlInsert = '';
                let paramsInsert = [];

                if (tabla === 'auditoria_digitalizacion') {
                    sqlInsert = `
                        INSERT INTO \`auditoria_digitalizacion\` 
                        (fecha_hora, turno, user_id, pc, ip, notaria, archivo, detalles, paginas, lugar_trabajo, exportado, exportado_en, created_at, updated_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                    `;
                    paramsInsert = [
                        fechaHora,
                        reg.Turno || reg.turno || null,
                        reg.UserId || reg.user_id || null,
                        pc,
                        reg.IP || reg.ip || null,
                        reg.Notaria || reg.notaria || 'General',
                        archivoOriginal,
                        reg.Detalles || reg.detalles || null,
                        reg.Paginas || reg.paginas || 0,
                        reg.LugarTrabajo || reg.lugar_trabajo || null,
                        ahora,
                        ahora,
                        ahora
                    ];
                } else if (tabla === 'auditoria_notarias') {
                    sqlInsert = `
                        INSERT INTO \`auditoria_notarias\` 
                        (fecha_hora, turno, user_id, categoria, pc, directorio, volumen, accion, archivo_original, archivo_nuevo, ruta, detalles, paginas, exportado, exportado_en, created_at, updated_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                    `;
                    paramsInsert = [
                        fechaHora,
                        reg.Turno || reg.turno || null,
                        reg.UserId || reg.user_id || null,
                        reg.Categoria || reg.categoria || null,
                        pc,
                        reg.Notaria || reg.notaria || reg.directorio || 'General',
                        reg.Lote || reg.lote || reg.volumen || null,
                        accion,
                        archivoOriginal,
                        reg.ArchivoNuevo || reg.archivo_nuevo || null,
                        reg.RutaLocal || reg.ruta_local || reg.ruta || null,
                        reg.Detalles || reg.detalles || null,
                        reg.Paginas || reg.paginas || 0,
                        ahora,
                        ahora,
                        ahora
                    ];
                } else if (tabla === 'auditoria_libros') {
                    sqlInsert = `
                        INSERT INTO \`auditoria_libros\` 
                        (user_id, turno, categoria, pc, directorio, accion, archivo_original, archivo_nuevo, detalles, paginas, exportado, exportado_en, created_at, updated_at) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                    `;
                    paramsInsert = [
                        reg.UserId || reg.user_id || null,
                        reg.Turno || reg.turno || null,
                        reg.Categoria || reg.categoria || null,
                        pc,
                        reg.Notaria || reg.notaria || reg.directorio || 'General',
                        accion,
                        archivoOriginal,
                        reg.ArchivoNuevo || reg.archivo_nuevo || null,
                        reg.Detalles || reg.detalles || null,
                        reg.Paginas || reg.paginas || 0,
                        ahora,
                        ahora,
                        ahora
                    ];
                }

                await conexion.query(sqlInsert, paramsInsert);
                procesados++;
            } catch (errInner) {
                errores.push(`Fila ${index}: ${errInner.message}`);
            }
        }

        res.json({
            ok: errores.length === 0 || procesados > 0,
            procesados,
            duplicados,
            mensaje: errores.length > 0 ? "Errores durante el registro de algunas filas." : "Registros procesados correctamente.",
            errores: errores.length > 0 ? errores : null
        });

    } catch (err) {
        res.status(500).json({ ok: false, mensaje: 'Error interno en el servidor: ' + err.message });
    } finally {
        conexion.release();
    }
}

// Definición de endpoints de API para soportar cualquier URL configurada en C#
app.post('/api/registrar', registrarAuditoriaHandler);
app.post('/api/digitalizacion/registrar', registrarAuditoriaHandler);
app.post('/api/notarias/registrar', registrarAuditoriaHandler);
app.post('/api/libros/registrar', registrarAuditoriaHandler);
app.post('/api/nominas/registrar', registrarAuditoriaHandler);

// Endpoint de recepción y almacenamiento de PDFs
app.post([
    '/api/subir-pdf',
    '/api/digitalizacion/subir-pdf',
    '/api/notarias/subir-pdf',
    '/api/libros/subir-pdf',
    '/api/nominas/subir-pdf'
], upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ ok: false, mensaje: 'No se recibió ningún archivo PDF.' });
        }

        const tipoCaptura = (req.body.tipo_captura || 'DIGITALIZACION').toUpperCase();
        let notaria = (req.body.notaria || 'General').trim();
        const archivoOriginal = req.file.originalname;
        const rutaCompleta = req.file.path;

        if (!notaria || notaria.toUpperCase() === 'NOTARIAS' || notaria.toUpperCase() === 'GENERAL') {
            notaria = 'General';
        }

        // 1. Contar páginas del PDF físicamente en el servidor
        const paginasFisicas = await contarPaginasPdf(rutaCompleta);

        // 2. Determinar la tabla adecuada
        let tabla = 'auditoria_digitalizacion';
        if (tipoCaptura === 'NOTARIAS' || req.originalUrl.includes('/notarias/')) {
            tabla = 'auditoria_notarias';
        } else if (tipoCaptura === 'LIBROS' || req.originalUrl.includes('/libros/')) {
            tabla = 'auditoria_libros';
        }

        // 3. Actualizar base de datos
        let queryUpdate = '';
        let paramsUpdate = [];
        const ahora = new Date();

        if (tabla === 'auditoria_digitalizacion') {
            queryUpdate = `
                UPDATE \`auditoria_digitalizacion\` 
                SET exportado = 1, exportado_en = ?, paginas = CASE WHEN ? > 0 THEN ? ELSE paginas END 
                WHERE archivo = ? AND notaria LIKE ?
            `;
            paramsUpdate = [ahora, paginasFisicas, paginasFisicas, archivoOriginal, `%${notaria}%`];
        } else {
            queryUpdate = `
                UPDATE \`${tabla}\` 
                SET exportado = 1, exportado_en = ?, paginas = CASE WHEN ? > 0 THEN ? ELSE paginas END 
                WHERE archivo_original = ? AND directorio LIKE ?
            `;
            paramsUpdate = [ahora, paginasFisicas, paginasFisicas, archivoOriginal, `%${notaria}%`];
        }

        await pool.query(queryUpdate, paramsUpdate);

        res.json({
            ok: true,
            mensaje: `El archivo ${archivoOriginal} fue subido y procesado con éxito.`,
            paginas_detectadas: paginasFisicas
        });

    } catch (error) {
        res.status(500).json({ ok: false, mensaje: 'Error al procesar el archivo PDF: ' + error.message });
    }
});

// Endpoint para el Dashboard (consultas de productividad y estadísticas de Electron)
app.get('/api/estadisticas/productividad', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ ok: false, mensaje: 'Debe especificar fecha_inicio y fecha_fin (formato yyyy-mm-dd).' });
        }

        const [notariasData] = await pool.query(`
            SELECT 
                DATE(fecha_hora) as fecha,
                COALESCE(directorio, 'General') as notaria,
                COUNT(*) as total_pdfs,
                SUM(paginas) as total_imagenes
            FROM \`auditoria_notarias\`
            WHERE DATE(fecha_hora) BETWEEN ? AND ?
            GROUP BY DATE(fecha_hora), directorio
            ORDER BY fecha ASC, total_pdfs DESC
        `, [fecha_inicio, fecha_fin]);

        const [digitalizacionData] = await pool.query(`
            SELECT 
                DATE(fecha_hora) as fecha,
                COALESCE(notaria, 'General') as notaria,
                COUNT(*) as total_pdfs,
                SUM(paginas) as total_imagenes
            FROM \`auditoria_digitalizacion\`
            WHERE DATE(fecha_hora) BETWEEN ? AND ?
            GROUP BY DATE(fecha_hora), notaria
            ORDER BY fecha ASC, total_pdfs DESC
        `, [fecha_inicio, fecha_fin]);

        res.json({
            ok: true,
            notarias: notariasData,
            digitalizacion: digitalizacionData
        });

    } catch (error) {
        res.status(500).json({ ok: false, mensaje: 'Error al consultar estadísticas: ' + error.message });
    }
});

// Levantar el servidor Express
app.listen(puerto, () => {
    console.log(`Servidor Express corriendo localmente en http://localhost:${puerto}`);
    inicializarBaseDatos();
});

module.exports = app;
