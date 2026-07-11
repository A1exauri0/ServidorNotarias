/**
 * Enrutador de Express para la API de Estadísticas y Reportes (estadisticas.routes.js).
 * Expone las APIs para gráficas y para el reporte de productividad estilo Excel.
 */

const express = require('express');
const enrutador = express.Router();
const controladorEstadisticas = require('../controllers/estadisticas.controller');

// Obtener productividad general por notarias y volumenes (Dashboard)
enrutador.get('/productividad', controladorEstadisticas.obtenerProductividadGeneral);

// Obtener productividad diaria por capturista y dia (Nueva vista Excel)
enrutador.get('/productividad/diaria', controladorEstadisticas.obtenerProductividadDiaria);

// Exportar reporte de auditoría premium en Excel y abrirlo automáticamente
enrutador.get('/exportar-excel', controladorEstadisticas.exportarExcelAuditoria);

module.exports = enrutador;
