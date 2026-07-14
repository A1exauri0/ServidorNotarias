require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const controladorUsuarios = require('./controllers/usuarios.controller');
const controladorAuditoria = require('./controllers/auditoria.controller');
const controladorEstadisticas = require('./controllers/estadisticas.controller');

const rutasUsuarios = require('./routes/usuarios.routes');
const rutasAuditoria = require('./routes/auditoria.routes');
const rutasEstadisticas = require('./routes/estadisticas.routes');

const app = express();
const puerto = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Montar enrutadores
app.use('/api/usuarios', rutasUsuarios);
app.use('/api/estadisticas', rutasEstadisticas);

// Rutas de auditoría con soporte de compatibilidad multiproyecto
app.use('/api', rutasAuditoria);
app.use('/api/digitalizacion', rutasAuditoria);
app.use('/api/notarias', rutasAuditoria);
app.use('/api/libros', rutasAuditoria);
app.use('/api/nominas', rutasAuditoria);

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

        // Crear la tabla de auditoría
        await crearTablaUnica();

        // Inicializar controladores modulares con el pool de conexiones
        await controladorUsuarios.inicializarTablasUsuarios(pool);
        controladorAuditoria.inicializarPool(pool);
        controladorEstadisticas.inicializarPool(pool);

        console.log(`Base de datos y controladores inicializados con éxito en MySQL [${dbNombre}].`);
    } catch (error) {
        console.error('Error al inicializar la base de datos MySQL:', error);
    }
}

// Crear la tabla única de auditoría (esquema unificado)
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

        // Crear índice compuesto de búsqueda compatible y seguro
        try {
            await conexion.query(`
                CREATE INDEX \`idx_auditoria_busqueda\` ON \`auditoria\` (\`fecha_hora\`, \`pc\`, \`archivo\`);
            `);
        } catch (eIndex) {
            // Omitir si ya está creado
            if (eIndex.code !== 'ER_DUP_KEYNAME' && eIndex.errno !== 1061) {
                console.warn("Aviso al verificar índice:", eIndex.message);
            }
        }
    } finally {
        conexion.release();
    }
}

// Levantar el servidor Express
app.listen(puerto, () => {
    console.log(`Servidor Express corriendo localmente en http://localhost:${puerto}`);
    inicializarBaseDatos().then(() => {
        // Programar sincronización automática silenciosa con Astronmx cada hora
        const INTERVALO_UNA_HORA = 60 * 60 * 1000;
        setInterval(async () => {
            try {
                await controladorAuditoria.sincronizarAstronmxSilencioso();
            } catch (error) {
                console.error('[CRON-ERROR] Error en el intervalo de sincronización:', error.message);
            }
        }, INTERVALO_UNA_HORA);
        console.log('⏰ Programada sincronización automática con Astronmx cada hora.');
    });
});

module.exports = app;
