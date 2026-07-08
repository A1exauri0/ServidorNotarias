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

let pool;

// Inicialización de conexión a MySQL
async function inicializarBaseDatos() {
    try {
        const conexionInicial = await mysql.createConnection({
            host: process.env.DB_HOST || '127.0.0.1',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || ''
        });

        const dbNombre = process.env.DB_DATABASE || 'captura_notarias_db';
        await conexionInicial.query(`CREATE DATABASE IF NOT EXISTS \`${dbNombre}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        await conexionInicial.end();

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

        await crearTablaUnica();

        console.log(`Base de datos y tabla única 'auditoria' inicializada en MySQL [${dbNombre}].`);
    } catch (error) {
        console.error('Error al inicializar la base de datos MySQL:', error);
    }
}

// Crear la tabla única de auditoría (idéntica a AuditoriaDigitalizacion.php)
async function crearTablaUnica() {
    const conexion = await pool.getConnection();
    try {
        await conexion.query(`
             CREATE TABLE IF NOT EXISTS \`auditoria\` (
                \`id\` bigint(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                \`fecha_hora\` datetime NOT NULL,
                \`turno\` varchar(255) DEFAULT NULL,
                \`usuario\` varchar(255) DEFAULT NULL,
                \`pc\` varchar(255) DEFAULT NULL,
                \`ip\` varchar(255) DEFAULT NULL,
                \`notaria\` varchar(255) DEFAULT NULL,
                \`volumen\` varchar(255) DEFAULT NULL,
                \`archivo\` varchar(255) DEFAULT NULL,
                \`detalles\` text DEFAULT NULL,
                \`paginas\` int(11) DEFAULT 0,
                \`exportado\` tinyint(4) DEFAULT 0,
                \`exportado_en\` datetime DEFAULT NULL,
                \`lugar_trabajo\` varchar(255) DEFAULT NULL,
                \`created_at\` datetime DEFAULT NULL,
                \`updated_at\` datetime DEFAULT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Crear índice compuesto para búsquedas ultra rápidas de duplicados en la migración
        await conexion.query(`
            CREATE INDEX IF NOT EXISTS \`idx_auditoria_busqueda\` ON \`auditoria\` (\`fecha_hora\`, \`pc\`, \`archivo\`);
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

// Manejador común para registrar auditorías en la tabla única
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
                const fechaHora = reg.FechaHora || reg.fecha_hora || new Date().toISOString().slice(0, 19).replace('T', ' ');
                const archivo = reg.ArchivoOriginal || reg.archivo_original || reg.archivo || null;
                const pc = reg.PC || reg.pc || null;

                // Validar duplicados contra la tabla única
                const [rows] = await conexion.query(
                    'SELECT id FROM `auditoria` WHERE fecha_hora = ? AND pc = ? AND archivo = ? LIMIT 1',
                    [fechaHora, pc, archivo]
                );

                if (rows.length > 0) {
                    duplicados++;
                    continue;
                }

                const ahora = new Date();
                const sqlInsert = `
                    INSERT INTO \`auditoria\` 
                    (fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, exportado, exportado_en, lugar_trabajo, created_at, updated_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                `;

                // Resolver nombres de variables adaptables desde el cliente C#
                let notariaResolv = reg.Notaria || reg.notaria || reg.directorio || 'General';
                let volumenResolv = reg.Lote || reg.lote || reg.volumen || null;

                // Separar de forma inteligente si viene en formato "NOTARIA XX\VOLUMEN YY"
                if (typeof notariaResolv === 'string' && notariaResolv.includes('\\')) {
                    const partes = notariaResolv.split('\\');
                    notariaResolv = partes[0].trim();
                    if (!volumenResolv) {
                        volumenResolv = partes[1].trim();
                    }
                }

                const paramsInsert = [
                    fechaHora,
                    reg.Turno || reg.turno || null,
                    reg.Usuario || reg.usuario || null,
                    pc,
                    reg.IP || reg.ip || null,
                    notariaResolv,
                    volumenResolv,
                    archivo,
                    reg.Detalles || reg.detalles || null,
                    reg.Paginas || reg.paginas || 0,
                    ahora,
                    reg.LugarTrabajo || reg.lugar_trabajo || null,
                    ahora,
                    ahora
                ];

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

// Rutas de API para soportar compatibilidad
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

        let notaria = (req.body.notaria || 'General').trim();
        const archivoOriginal = req.file.originalname;
        const rutaCompleta = req.file.path;

        if (!notaria || notaria.toUpperCase() === 'NOTARIAS' || notaria.toUpperCase() === 'GENERAL') {
            notaria = 'General';
        }

        const paginasFisicas = await contarPaginasPdf(rutaCompleta);
        const ahora = new Date();

        // Actualizar tabla única
        await pool.query(
            'UPDATE `auditoria` SET exportado = 1, exportado_en = ?, paginas = CASE WHEN ? > 0 THEN ? ELSE paginas END WHERE archivo = ? AND notaria LIKE ?',
            [ahora, paginasFisicas, paginasFisicas, archivoOriginal, `%${notaria}%`]
        );

        res.json({
            ok: true,
            mensaje: `El archivo ${archivoOriginal} fue subido y procesado con éxito.`,
            paginas_detectadas: paginasFisicas
        });

    } catch (error) {
        res.status(500).json({ ok: false, mensaje: 'Error al procesar el archivo PDF: ' + error.message });
    }
});

// Endpoint para el Dashboard
app.get('/api/estadisticas/productividad', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ ok: false, mensaje: 'Debe especificar fecha_inicio y fecha_fin (formato yyyy-mm-dd).' });
        }

        const [productividadData] = await pool.query(`
            SELECT 
                DATE(fecha_hora) as fecha,
                COALESCE(notaria, 'General') as notaria,
                COALESCE(volumen, 'Sin Lote') as volumen,
                COUNT(*) as total_pdfs,
                SUM(paginas) as total_imagenes
            FROM \`auditoria\`
            WHERE DATE(fecha_hora) BETWEEN ? AND ?
            GROUP BY DATE(fecha_hora), notaria, volumen
            ORDER BY fecha ASC, total_pdfs DESC
        `, [fecha_inicio, fecha_fin]);

        res.json({
            ok: true,
            notarias: productividadData,
            digitalizacion: [] // Retornar vacío para compatibilidad con la llamada actual del frontend
        });

    } catch (error) {
        res.status(500).json({ ok: false, mensaje: 'Error al consultar estadísticas: ' + error.message });
    }
});

// Endpoint para consultar los últimos 100 registros en la tabla única
app.get('/api/registros', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT id, fecha_hora, turno, pc, notaria, volumen, archivo, paginas, exportado 
            FROM \`auditoria\`
            ORDER BY fecha_hora DESC LIMIT 100
        `);
        res.json({ ok: true, registros: rows });
    } catch (error) {
        res.status(500).json({ ok: false, mensaje: 'Error al consultar registros: ' + error.message });
    }
});

// Levantar el servidor Express
app.listen(puerto, () => {
    console.log(`Servidor Express corriendo localmente en http://localhost:${puerto}`);
    inicializarBaseDatos();
});

module.exports = app;
