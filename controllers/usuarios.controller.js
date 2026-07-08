/**
 * Controlador de Usuarios (usuarios.controller.js).
 * Contiene todas las operaciones CRUD y la lógica de base de datos de usuarios en MySQL.
 */

let dbPool = null;

// Inicializa el pool de conexiones y crea las tablas si no existen
async function inicializarTablasUsuarios(pool) {
    dbPool = pool;
    const conexion = await dbPool.getConnection();
    try {
        // 1. Crear tabla usuarios
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS \`usuarios\` (
                \`id\` INT AUTO_INCREMENT PRIMARY KEY,
                \`nombre_completo\` VARCHAR(255) NOT NULL,
                \`nombre_usuario\` VARCHAR(255) UNIQUE NOT NULL,
                \`pin\` VARCHAR(4) NOT NULL,
                \`turno\` VARCHAR(50) DEFAULT 'Matutino',
                \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
                \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 2. Crear tabla de configuracion para el PIN Maestro
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS \`configuracion\` (
                \`clave\` VARCHAR(100) PRIMARY KEY,
                \`valor\` TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // 3. Insertar usuario administrador inicial si está vacío
        const [filasUsuarios] = await conexion.query("SELECT COUNT(*) as total FROM \`usuarios\`");
        if (filasUsuarios[0].total === 0) {
            await conexion.query(`
                INSERT INTO \`usuarios\` (nombre_completo, nombre_usuario, pin, turno) 
                VALUES ('ADMINISTRADOR', 'admin', '2003', 'Matutino')
            `);
            console.log("Usuario administrador inicial 'admin' inyectado con éxito.");
        }

        // 4. Insertar PIN Maestro inicial si está vacío
        const [filasConfig] = await conexion.query("SELECT COUNT(*) as total FROM \`configuracion\` WHERE clave = 'pin_maestro'");
        if (filasConfig[0].total === 0) {
            await conexion.query(`
                INSERT INTO \`configuracion\` (clave, valor) 
                VALUES ('pin_maestro', '2003')
            `);
            console.log("PIN Maestro por defecto '2003' registrado con éxito.");
        }

    } finally {
        conexion.release();
    }
}

// Verifica credenciales para login (retorna usuario o null)
async function loginUsuario(nombreUsuario, pin) {
    const [filas] = await dbPool.query(
        "SELECT id, nombre_completo, nombre_usuario, turno FROM \`usuarios\` WHERE nombre_usuario = ? AND pin = ?",
        [nombreUsuario, pin]
    );
    return filas.length > 0 ? filas[0] : null;
}

// Obtiene la lista de todos los usuarios
async function obtenerTodosUsuarios() {
    const [filas] = await dbPool.query(
        "SELECT id, nombre_completo, nombre_usuario, pin, turno, created_at FROM \`usuarios\` ORDER BY nombre_completo ASC"
    );
    return filas;
}

// Crea un nuevo usuario
async function crearUsuario(nombreCompleto, nombreUsuario, pin, turno) {
    const [resultado] = await dbPool.query(
        "INSERT INTO \`usuarios\` (nombre_completo, nombre_usuario, pin, turno) VALUES (?, ?, ?, ?)",
        [nombreCompleto.toUpperCase(), nombreUsuario.toLowerCase().trim(), pin, turno]
    );
    return resultado.insertId;
}

// Actualiza un usuario existente
async function actualizarUsuario(id, nombreCompleto, nombreUsuario, pin, turno) {
    await dbPool.query(
        "UPDATE \`usuarios\` SET nombre_completo = ?, nombre_usuario = ?, pin = ?, turno = ? WHERE id = ?",
        [nombreCompleto.toUpperCase(), nombreUsuario.toLowerCase().trim(), pin, turno, id]
    );
    return true;
}

// Elimina un usuario
async function eliminarUsuario(id) {
    await dbPool.query("DELETE FROM \`usuarios\` WHERE id = ?", [id]);
    return true;
}

// Intercambia turnos de Matutino a Vespertino y viceversa para todos los usuarios
async function intercambiarTurnos() {
    const conexion = await dbPool.getConnection();
    try {
        await conexion.beginTransaction();

        const [usuarios] = await conexion.query("SELECT id, turno FROM \`usuarios\`");
        let actualizados = 0;

        for (const u of usuarios) {
            let nuevoTurno = null;
            if (u.turno === 'Matutino') {
                nuevoTurno = 'Vespertino';
            } else if (u.turno === 'Vespertino') {
                nuevoTurno = 'Matutino';
            }

            if (nuevoTurno) {
                await conexion.query("UPDATE \`usuarios\` SET turno = ? WHERE id = ?", [nuevoTurno, u.id]);
                actualizados++;
            }
        }

        await conexion.commit();
        return actualizados;
    } catch (error) {
        await conexion.rollback();
        throw error;
    } finally {
        conexion.release();
    }
}

// Obtiene el PIN Maestro desde la tabla de configuracion
async function obtenerPinMaestro() {
    const [filas] = await dbPool.query("SELECT valor FROM \`configuracion\` WHERE clave = 'pin_maestro'");
    return filas.length > 0 ? filas[0].valor : "2003";
}

// Guarda un nuevo PIN Maestro
async function guardarPinMaestro(nuevoPin) {
    await dbPool.query(
        "INSERT INTO \`configuracion\` (clave, valor) VALUES ('pin_maestro', ?) ON DUPLICATE KEY UPDATE valor = ?",
        [nuevoPin, nuevoPin]
    );
    return true;
}

module.exports = {
    inicializarTablasUsuarios,
    loginUsuario,
    obtenerTodosUsuarios,
    crearUsuario,
    actualizarUsuario,
    eliminarUsuario,
    intercambiarTurnos,
    obtenerPinMaestro,
    guardarPinMaestro
};
