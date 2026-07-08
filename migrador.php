<?php
/**
 * Script de Migración Completo para ServidorNotarias.
 * Migra de forma masiva tanto los registros de SQLite local de la PC cliente
 * como los archivos históricos JSON de monitoreo de todas las PCs
 * directamente hacia la tabla única 'auditoria'.
 * 
 * Ejecución en consola de Laragon:
 * php migrador.php
 */

// 1. Cargar variables de entorno desde el archivo .env de Node.js
$rutaEnv = __DIR__ . '/.env';
if (!file_exists($rutaEnv)) {
    die("Error: No se encontró el archivo .env en el directorio actual.\n");
}

$variablesEnv = [];
$lineasEnv = file($rutaEnv, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
foreach ($lineasEnv as $linea) {
    if (strpos(trim($linea), '#') === 0) continue; // Omitir comentarios
    list($nombre, $valor) = explode('=', $linea, 2);
    $variablesEnv[trim($nombre)] = trim($valor);
}

// 2. Conectar a MySQL (Laragon)
$dbHost = $variablesEnv['DB_HOST'] ?? '127.0.0.1';
$dbPort = $variablesEnv['DB_PORT'] ?? '3306';
$dbName = $variablesEnv['DB_DATABASE'] ?? 'captura_notarias_db';
$dbUser = $variablesEnv['DB_USER'] ?? 'root';
$dbPass = $variablesEnv['DB_PASSWORD'] ?? '';

try {
    $mysqlPdo = new PDO("mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4", $dbUser, $dbPass);
    $mysqlPdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    echo "Conexión a MySQL establecida con éxito.\n";

    // Crear índice compuesto para garantizar que la verificación de duplicados sea instantánea
    try {
        $mysqlPdo->exec("CREATE INDEX IF NOT EXISTS idx_auditoria_busqueda ON auditoria (fecha_hora, pc, archivo)");
        echo "Índice de optimización verificado/creado con éxito.\n\n";
    } catch (Exception $eIndex) {
        try {
            $mysqlPdo->exec("ALTER TABLE auditoria ADD INDEX idx_auditoria_busqueda (fecha_hora, pc, archivo)");
            echo "Índice de optimización agregado con éxito.\n\n";
        } catch (Exception $eIndex2) {
            // Ya existe, ignorar
            echo "Búsqueda optimizada por índice activa.\n\n";
        }
    }

    // Asegurar que la columna 'usuario' exista en la tabla (por si se creó la tabla anteriormente sin ella)
    try {
        $mysqlPdo->exec("ALTER TABLE auditoria ADD COLUMN usuario VARCHAR(255) DEFAULT NULL AFTER user_id");
    } catch (Exception $eCol) {
        // Ignorar si ya existe
    }
} catch (Exception $e) {
    die("Error crítico de conexión a MySQL: " . $e->getMessage() . "\n");
}

// Preparar consultas preparadas contra la tabla única 'auditoria'
$chequeoDuplicado = $mysqlPdo->prepare("SELECT id FROM auditoria WHERE fecha_hora = ? AND pc = ? AND archivo = ? LIMIT 1");

$insertAuditoria = $mysqlPdo->prepare("
    INSERT INTO auditoria 
    (fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, exportado, exportado_en, lugar_trabajo, created_at, updated_at) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
");

// Contadores de control
$procesados = 0;
$duplicados = 0;
$errores = 0;

// ==========================================
// SECCIÓN PREVIA: MIGRACIÓN DE USUARIOS E INVENTARIO DESDE JSON
// ==========================================
$rutaUsuariosJson = 'c:\\NOTARIAS\\usuarios.json';
if (file_exists($rutaUsuariosJson)) {
    echo "--- INICIANDO MIGRACIÓN DE USUARIOS DESDE JSON ---\n";
    echo "Ruta JSON: {$rutaUsuariosJson}\n";

    try {
        $jsonContenido = file_get_contents($rutaUsuariosJson);
        $datosUsuarios = json_decode($jsonContenido, true);

        if ($datosUsuarios && isset($datosUsuarios['Usuarios'])) {
            // 1. Crear las tablas de usuarios y configuracion si no existen
            $mysqlPdo->exec("
                CREATE TABLE IF NOT EXISTS `usuarios` (
                    `id` INT AUTO_INCREMENT PRIMARY KEY,
                    `nombre_completo` VARCHAR(255) NOT NULL,
                    `nombre_usuario` VARCHAR(255) UNIQUE NOT NULL,
                    `pin` VARCHAR(4) NOT NULL,
                    `turno` VARCHAR(50) DEFAULT 'Matutino',
                    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
                    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            ");

            $mysqlPdo->exec("
                CREATE TABLE IF NOT EXISTS `configuracion` (
                    `clave` VARCHAR(100) PRIMARY KEY,
                    `valor` TEXT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            ");

            // 2. Guardar el PIN Maestro en la tabla configuracion
            if (isset($datosUsuarios['PinMaestro'])) {
                $pinMaestro = $datosUsuarios['PinMaestro'];
                $stmtConfig = $mysqlPdo->prepare("INSERT INTO configuracion (clave, valor) VALUES ('pin_maestro', ?) ON DUPLICATE KEY UPDATE valor = ?");
                $stmtConfig->execute([$pinMaestro, $pinMaestro]);
                echo "PIN Maestro migrado/actualizado a: {$pinMaestro}\n";
            }

            // 3. Insertar usuarios
            $stmtUsuario = $mysqlPdo->prepare("
                INSERT INTO usuarios (nombre_completo, nombre_usuario, pin, turno) 
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE nombre_completo = ?, pin = ?, turno = ?
            ");

            $usuariosMigrados = 0;
            foreach ($datosUsuarios['Usuarios'] as $u) {
                $nombreCompleto = trim($u['NombreCompleto'] ?? '');
                $nombreUsuario = strtolower(trim($u['NombreUsuario'] ?? ''));
                $pin = trim($u['Pin'] ?? '');
                $turno = trim($u['Turno'] ?? 'Matutino');

                if (empty($nombreUsuario) || empty($pin)) continue;

                $stmtUsuario->execute([
                    $nombreCompleto,
                    $nombreUsuario,
                    $pin,
                    $turno,
                    $nombreCompleto,
                    $pin,
                    $turno
                ]);
                $usuariosMigrados++;
            }
            echo "Se migraron/actualizaron {$usuariosMigrados} usuarios con éxito en MySQL.\n\n";
        } else {
            echo "Aviso: El formato del JSON de usuarios es inválido.\n\n";
        }
    } catch (Exception $eUsr) {
        echo "Error al migrar usuarios: " . $eUsr->getMessage() . "\n\n";
    }
} else {
    echo "Aviso: No se encontró el archivo de usuarios histórico en: {$rutaUsuariosJson} (Omitiendo esta fase)\n\n";
}

// ==========================================
// SECCIÓN A: MIGRACIÓN DESDE BASE DE DATOS SQLITE
// ==========================================
$appDataFolder = getenv('APPDATA');
$rutaSqliteDefault = $appDataFolder . DIRECTORY_SEPARATOR . 'CapturaNotarias' . DIRECTORY_SEPARATOR . 'captura_notarias.db';
$rutaSqlite = $argv[1] ?? $rutaSqliteDefault;

if (file_exists($rutaSqlite)) {
    echo "--- INICIANDO MIGRACIÓN DESDE SQLITE ---\n";
    echo "Ruta SQLite: {$rutaSqlite}\n";

    try {
        $sqlitePdo = new PDO("sqlite:" . $rutaSqlite);
        $sqlitePdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Leer registros de SQLite
        $querySqlite = $sqlitePdo->query("SELECT * FROM registros_auditoria");
        $registrosSqlite = $querySqlite->fetchAll(PDO::FETCH_ASSOC);
        echo "Se leyeron " . count($registrosSqlite) . " registros locales de SQLite.\n";

        $loteTamanio = 5000;
        $mysqlPdo->beginTransaction();
        $contadorLote = 0;

        foreach ($registrosSqlite as $reg) {
            // Normalizar campos de SQLite
            $regMapeado = [
                'fecha_hora' => $reg['fecha_hora'] ?? null,
                'turno' => $reg['turno'] ?? null,
                'user_id' => $reg['user_id'] ?? null,
                'usuario' => $reg['usuario'] ?? null,
                'pc' => $reg['pc'] ?? null,
                'ip' => $reg['ip'] ?? null,
                'notaria' => $reg['notaria'] ?? 'General',
                'volumen' => $reg['volumen'] ?? $reg['lote'] ?? null,
                'archivo' => $reg['archivo_original'] ?? null,
                'detalles' => $reg['detalles'] ?? null,
                'paginas' => (int)($reg['paginas'] ?? 0),
                'lugar_trabajo' => $reg['lugar_trabajo'] ?? null,
                'exportado_en' => $reg['exportado_en'] ?? null
            ];

            migrarRegistro($regMapeado, $mysqlPdo, $chequeoDuplicado, $insertAuditoria, $procesados, $duplicados, $errores);

            $contadorLote++;
            if ($contadorLote >= $loteTamanio) {
                $mysqlPdo->commit();
                $mysqlPdo->beginTransaction();
                $contadorLote = 0;
                echo "  -> Procesados " . ($procesados + $duplicados) . " registros...\n";
            }
        }
        if ($mysqlPdo->inTransaction()) {
            $mysqlPdo->commit();
        }
        echo "Migración de SQLite completada con éxito.\n\n";

    } catch (Exception $eSqlite) {
        if ($mysqlPdo->inTransaction()) $mysqlPdo->rollBack();
        echo "Error al procesar base de datos SQLite: " . $eSqlite->getMessage() . "\n\n";
    }
} else {
    echo "Aviso: No se localizó base de datos SQLite en: {$rutaSqlite} (Omitiendo esta fase)\n\n";
}

// ==========================================
// SECCIÓN B: MIGRACIÓN DE ARCHIVOS JSON DE MONITOREO DE TODAS LAS PCS
// ==========================================
$directorioMonitoreo = 'C:\\NOTARIAS\\MonitoreoCaptura';

if (is_dir($directorioMonitoreo)) {
    echo "--- INICIANDO MIGRACIÓN DESDE ARCHIVOS JSON ---\n";
    echo "Buscando archivos 'auditoria.json' en todas las subcarpetas de: {$directorioMonitoreo}...\n";

    $directoriosPc = glob($directorioMonitoreo . DIRECTORY_SEPARATOR . '*', GLOB_ONLYDIR);
    if (!empty($directoriosPc)) {
        $mysqlPdo->beginTransaction();
        
        foreach ($directoriosPc as $dirPc) {
            $rutaJson = $dirPc . DIRECTORY_SEPARATOR . 'auditoria.json';
            if (file_exists($rutaJson)) {
                $nombrePc = basename($dirPc);
                echo "Procesando JSON de la PC: {$nombrePc}...\n";

                try {
                    $jsonContent = file_get_contents($rutaJson);
                    $datosJson = json_decode($jsonContent, true);

                    $registrosJson = [];
                    if (isset($datosJson['Registros']) && is_array($datosJson['Registros'])) {
                        $registrosJson = $datosJson['Registros'];
                    } elseif (is_array($datosJson)) {
                        $registrosJson = $datosJson;
                    }

                    echo "  - Encontrados " . count($registrosJson) . " registros.\n";

                    foreach ($registrosJson as $reg) {
                        $regMapeado = [
                            'fecha_hora' => $reg['FechaHora'] ?? $reg['fecha_hora'] ?? null,
                            'turno' => $reg['Turno'] ?? $reg['turno'] ?? null,
                            'user_id' => $reg['UserId'] ?? $reg['user_id'] ?? null,
                            'usuario' => $reg['Usuario'] ?? $reg['usuario'] ?? null,
                            'pc' => $reg['PC'] ?? $reg['pc'] ?? $nombrePc,
                            'ip' => $reg['IP'] ?? $reg['ip'] ?? null,
                            'notaria' => $reg['Notaria'] ?? $reg['notaria'] ?? $reg['directorio'] ?? 'General',
                            'volumen' => $reg['Lote'] ?? $reg['lote'] ?? $reg['volumen'] ?? null,
                            'archivo' => $reg['ArchivoOriginal'] ?? $reg['archivo_original'] ?? $reg['archivo'] ?? null,
                            'detalles' => $reg['Detalles'] ?? $reg['detalles'] ?? null,
                            'paginas' => (int)($reg['Paginas'] ?? $reg['paginas'] ?? 0),
                            'lugar_trabajo' => $reg['LugarTrabajo'] ?? $reg['lugar_trabajo'] ?? null,
                            'exportado_en' => $reg['ExportadoEn'] ?? $reg['exportado_en'] ?? null
                        ];

                        migrarRegistro($regMapeado, $mysqlPdo, $chequeoDuplicado, $insertAuditoria, $procesados, $duplicados, $errores);
                    }

                } catch (Exception $eJson) {
                    echo "  - Error al leer el archivo JSON de la PC {$nombrePc}: " . $eJson->getMessage() . "\n";
                }
            }
        }
        
        $mysqlPdo->commit();
        echo "Migración de archivos JSON de red completada.\n\n";
    } else {
        echo "No se encontraron subcarpetas de PCs en el directorio de monitoreo.\n\n";
    }
} else {
    echo "Aviso: No se encontró la carpeta de monitoreo JSON en: {$directorioMonitoreo} (Omitiendo esta fase)\n\n";
}

// ==========================================
// RESUMEN FINAL
// ==========================================
echo "=== PROCESO DE MIGRACIÓN TERMINADO ===\n";
echo "Registros nuevos insertados en MySQL: {$procesados}\n";
echo "Registros duplicados omitidos: {$duplicados}\n";
echo "Errores detectados: {$errores}\n";
echo "======================================\n";


// Función auxiliar para insertar un registro en la tabla única 'auditoria' de MySQL
function migrarRegistro($reg, $mysqlPdo, $chequeoDuplicado, $insertAuditoria, &$procesados, &$duplicados, &$errores) {
    try {
        $fechaHora = $reg['fecha_hora'];
        if (empty($fechaHora)) return;

        $pc = $reg['pc'];
        $archivo = $reg['archivo'];
        if (empty($archivo)) return;

        $paginas = (int)$reg['paginas'];
        $exportadoEn = $reg['exportado_en'] ?? $fechaHora;

        // Separar de forma inteligente si viene en formato "NOTARIA XX\VOLUMEN YY"
        $notaria = $reg['notaria'] ?? 'General';
        $volumen = $reg['volumen'] ?? null;

        if (is_string($notaria) && strpos($notaria, '\\') !== false) {
            list($notariaPart, $volumenPart) = explode('\\', $notaria, 2);
            $notaria = trim($notariaPart);
            if (empty($volumen)) {
                $volumen = trim($volumenPart);
            }
        }

        // Validar duplicados contra la tabla única
        $chequeoDuplicado->execute([$fechaHora, $pc, $archivo]);
        if ($chequeoDuplicado->fetch()) {
            $duplicados++;
            return;
        }

        // Inserción en la tabla única incluyendo la columna usuario
        $insertAuditoria->execute([
            $fechaHora,
            $reg['turno'],
            $reg['usuario'],
            $pc,
            $reg['ip'],
            $notaria,
            $volumen,
            $archivo,
            $reg['detalles'],
            $paginas,
            $exportadoEn,
            $reg['lugar_trabajo'],
            $fechaHora,
            $fechaHora
        ]);

        $procesados++;

    } catch (Exception $e) {
        $errores++;
        // echo "Error al migrar archivo '{$archivo}': " . $e->getMessage() . "\n";
    }
}
