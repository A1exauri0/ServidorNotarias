/**
 * Controlador de Auditoría (auditoria.controller.js).
 * Gestiona el registro de auditorías, conteo de páginas de PDFs y listado de registros.
 */

const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

let dbPool = null;

// Inicializa el pool de base de datos desde server.js
function inicializarPool(pool) {
    dbPool = pool;
}

// Función auxiliar para obtener el total de páginas de un PDF de forma asíncrona
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

// Registra auditorías entrantes (formato masivo o individual)
async function registrarAuditoria(req, res) {
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

    const conexion = await dbPool.getConnection();

    try {
        for (const [index, reg] of registros.entries()) {
            try {
                const fechaHora = reg.FechaHora || reg.fecha_hora || new Date().toISOString().slice(0, 19).replace('T', ' ');
                const archivo = reg.ArchivoOriginal || reg.archivo_original || reg.archivo || null;
                const pc = reg.PC || reg.pc || null;

                // Validar duplicados en MySQL
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

// Procesa el PDF físico subido y actualiza la cantidad de páginas en MySQL
async function subirPdf(req, res) {
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

        await dbPool.query(
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
}

// Obtiene los registros de auditoría (opcionalmente filtrados por rango de fechas)
async function obtenerRegistros(req, res) {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        let querySql = `
            SELECT id, fecha_hora, turno, usuario, pc, notaria, volumen, archivo, paginas, exportado 
            FROM \`auditoria\`
        `;
        const queryParams = [];

        if (fecha_inicio && fecha_fin) {
            querySql += ` WHERE DATE(fecha_hora) BETWEEN ? AND ? `;
            queryParams.push(fecha_inicio, fecha_fin);
        }

        querySql += ` ORDER BY fecha_hora DESC LIMIT 100 `;

        const [rows] = await dbPool.query(querySql, queryParams);
        res.json({ ok: true, registros: rows });
    } catch (error) {
        res.status(500).json({ ok: false, mensaje: 'Error al consultar registros: ' + error.message });
    }
}

module.exports = {
    inicializarPool,
    registrarAuditoria,
    subirPdf,
    obtenerRegistros
};
