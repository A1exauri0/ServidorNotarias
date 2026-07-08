/**
 * Controlador de Estadísticas (estadisticas.controller.js).
 * Procesa la información de productividad por notarias, lotes y rendimiento diario por usuario.
 */

let dbPool = null;

// Inicializa el pool de base de datos desde server.js
function inicializarPool(pool) {
    dbPool = pool;
}

// Obtiene la productividad agrupada por notaría y lote/volumen para las gráficas del Dashboard
async function obtenerProductividadGeneral(req, res) {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ ok: false, mensaje: 'Debe especificar fecha_inicio y fecha_fin (formato yyyy-mm-dd).' });
        }

        const [productividadData] = await dbPool.query(`
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
            digitalizacion: [] // Compatibilidad
        });

    } catch (error) {
        res.status(500).json({ ok: false, mensaje: 'Error al consultar estadísticas: ' + error.message });
    }
}

// Obtiene la productividad diaria agrupada por capturista y fecha para la nueva vista estilo Excel
async function obtenerProductividadDiaria(req, res) {
    try {
        const { fecha_inicio, fecha_fin } = req.query;
        if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ ok: false, mensaje: 'Debe especificar fecha_inicio y fecha_fin (formato yyyy-mm-dd).' });
        }

        const [productividadDiaria] = await dbPool.query(`
            SELECT 
                DATE_FORMAT(fecha_hora, '%Y-%m-%d') as fecha,
                COALESCE(usuario, 'Desconocido') as usuario,
                COUNT(*) as total_pdfs,
                SUM(paginas) as total_paginas
            FROM \`auditoria\`
            WHERE DATE(fecha_hora) BETWEEN ? AND ?
            GROUP BY fecha, usuario
            ORDER BY fecha DESC, usuario ASC
        `, [fecha_inicio, fecha_fin]);

        res.json({
            ok: true,
            productividad: productividadDiaria
        });

    } catch (error) {
        res.status(500).json({ ok: false, mensaje: 'Error al consultar productividad diaria: ' + error.message });
    }
}

module.exports = {
    inicializarPool,
    obtenerProductividadGeneral,
    obtenerProductividadDiaria
};
