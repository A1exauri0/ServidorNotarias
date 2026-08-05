/**
 * Controlador de Auditoría (auditoria.controller.js).
 * Gestiona el registro de auditorías, conteo de páginas de PDFs y listado de registros.
 */

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { PDFDocument } = require("pdf-lib");

let dbPool = null;

// Helper robusto para copiar archivos a través de red UNC soportando reintentos y streams (para evitar ECONNRESET / UNKNOWN)
async function copiarArchivoRobusto(rutaOrigen, rutaDestino, maxIntentos = 3) {
  if (rutaOrigen === rutaDestino) return;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      // 1. Intentar con fs.promises.copyFile
      await fs.promises.copyFile(rutaOrigen, rutaDestino);
      return; // Éxito
    } catch (errorCopy) {
      console.warn(`⚠️ [Intento ${intento}/${maxIntentos}] Falló copyFile directo para ${path.basename(rutaOrigen)}: ${errorCopy.message}`);

      // 2. Si falló copyFile, intentar respaldo mediante streams
      try {
        const readStream = fs.createReadStream(rutaOrigen);
        const writeStream = fs.createWriteStream(rutaDestino);
        await pipeline(readStream, writeStream);
        return; // Éxito vía streams
      } catch (errorStream) {
        console.warn(`⚠️ [Intento ${intento}/${maxIntentos}] Falló copia vía stream para ${path.basename(rutaOrigen)}: ${errorStream.message}`);
      }

      // Si fue el último intento, lanzar la excepción
      if (intento === maxIntentos) {
        throw new Error(`Error al transferir archivo tras ${maxIntentos} intentos: ${errorCopy.message}`);
      }

      // Pausa exponencial entre reintentos para permitir que la red se recupere (300ms, 600ms, 1200ms)
      await new Promise((r) => setTimeout(r, intento * 300));
    }
  }
}

// Helper seguro para crear carpetas sin fallar en rutas de red UNC de Windows (\\servidor\recurso)
async function asegurarDirectorio(targetPath) {
  if (!targetPath) return;
  if (fs.existsSync(targetPath)) return;

  const esUnc = targetPath.startsWith("\\\\") || targetPath.startsWith("//");
  if (esUnc) {
    const partes = targetPath.replace(/\//g, "\\").split("\\").filter(Boolean);
    if (partes.length >= 2) {
      let acumulado = `\\\\${partes[0]}\\${partes[1]}`;
      for (let i = 2; i < partes.length; i++) {
        acumulado = path.join(acumulado, partes[i]);
        if (!fs.existsSync(acumulado)) {
          try {
            await fs.promises.mkdir(acumulado);
          } catch (err) {
            if (err.code !== "EEXIST" && !fs.existsSync(acumulado)) throw err;
          }
        }
      }
      return;
    }
  }

  await fs.promises.mkdir(targetPath, { recursive: true });
}

// Inicializa el pool de base de datos desde server.js
function inicializarPool(pool) {
  dbPool = pool;
}

// Función auxiliar para obtener el total de páginas de un PDF de forma asíncrona (soportando PDFs gigantes)
async function contarPaginasPdf(rutaCompleta) {
  try {
    if (!fs.existsSync(rutaCompleta)) return 0;

    const stat = fs.statSync(rutaCompleta);
    const tamanio = stat.size;

    // 1. Leer los primeros 300 KB y los últimos 300 KB del archivo
    const fd = fs.openSync(rutaCompleta, "r");
    const tamBloque = Math.min(307200, tamanio);

    const bufferInicio = Buffer.alloc(tamBloque);
    fs.readSync(fd, bufferInicio, 0, bufferInicio.length, 0);

    const bufferFin = Buffer.alloc(tamBloque);
    const posFin = Math.max(0, tamanio - tamBloque);
    fs.readSync(fd, bufferFin, 0, bufferFin.length, posFin);
    fs.closeSync(fd);

    const textoCompleto = bufferInicio.toString("latin1") + "\n" + bufferFin.toString("latin1");

    // Buscar expresamente el nodo raíz de páginas del PDF (/Type /Pages ... /Count N)
    const matchTypePages =
      textoCompleto.match(/\/Type\s*\/Pages[\s\S]{1,500}?\/Count\s+(\d+)/i) ||
      textoCompleto.match(/\/Count\s+(\d+)[\s\S]{1,500}?\/Type\s*\/Pages/i);

    if (matchTypePages && matchTypePages[1]) {
      const num = parseInt(matchTypePages[1], 10);
      if (num > 0) return num;
    }

    // Si no se detecta la firma directa, recopilar todos los /Count y tomar el mayor número coherente
    const todosCounts = [...textoCompleto.matchAll(/\/Count\s+(\d+)/gi)];
    if (todosCounts.length > 0) {
      let maxCount = 0;
      for (const m of todosCounts) {
        const val = parseInt(m[1], 10);
        if (val > maxCount) maxCount = val;
      }
      if (maxCount > 0) return maxCount;
    }

    // 2. Fallback de respaldo con pdf-lib (soportando tomos de hasta 300 MB)
    if (tamanio < 300 * 1024 * 1024) {
      const pdfBytes = fs.readFileSync(rutaCompleta);
      const pdfDoc = await PDFDocument.load(pdfBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      return pdfDoc.getPageCount();
    }

    return 1;
  } catch (e) {
    console.warn("Aviso al contar páginas de PDF:", e.message);
    return 1;
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
        const fechaHora =
          reg.FechaHora ||
          reg.fecha_hora ||
          new Date().toISOString().slice(0, 19).replace("T", " ");
        const archivo =
          reg.ArchivoOriginal || reg.archivo_original || reg.archivo || null;
        const pc = reg.PC || reg.pc || null;

        // Validar duplicados en MySQL
        const [rows] = await conexion.query(
          "SELECT id FROM `auditoria` WHERE fecha_hora = ? AND pc = ? AND archivo = ? LIMIT 1",
          [fechaHora, pc, archivo],
        );

        if (rows.length > 0) {
          duplicados++;
          continue;
        }

        const ahora = new Date();
        const sqlInsert = `
                    INSERT INTO \`auditoria\` 
                    (fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, exportado, exportado_en, lugar_trabajo, created_at, updated_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
                `;

        let notariaResolv =
          reg.Notaria || reg.notaria || reg.directorio || "General";
        let volumenResolv = reg.Lote || reg.lote || reg.volumen || null;

        // Separar de forma inteligente si viene en formato "NOTARIA XX\VOLUMEN YY"
        if (typeof notariaResolv === "string" && notariaResolv.includes("\\")) {
          const partes = notariaResolv.split("\\");
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
          reg.LugarTrabajo || reg.lugar_trabajo || null,
          ahora,
          ahora,
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
      mensaje:
        errores.length > 0
          ? "Errores durante el registro de algunas filas."
          : "Registros procesados correctamente.",
      errores: errores.length > 0 ? errores : null,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      mensaje: "Error interno en el servidor: " + err.message,
    });
  } finally {
    conexion.release();
  }
}

// Procesa el PDF físico subido y actualiza la cantidad de páginas en MySQL
async function subirPdf(req, res) {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ ok: false, mensaje: "No se recibió ningún archivo PDF." });
    }

    let notaria = (req.body.notaria || "General").trim();
    let volumen = (req.body.volumen || "SIN VOLUMEN").trim();
    const archivoOriginal = req.file.originalname;
    const rutaCompletaTemporal = req.file.path;

    if (
      !notaria ||
      notaria.toUpperCase() === "NOTARIAS" ||
      notaria.toUpperCase() === "GENERAL"
    ) {
      notaria = "General";
    }

    let paginasFisicas = 0;
    let rutaFinalArchivo = rutaCompletaTemporal;

    // Determinar ruta de destino alineada con la API de Laravel (ej. ssdirec/NOTARIAS/NOTARIA/VOLUMEN)
    const tipoCaptura = (req.body.tipo_captura || "NOTARIAS").toUpperCase();
    const baseDestino = process.env.RUTA_SSDIREC || "\\\\172.40.5.84\\ssdirec";
    const subcarpeta =
      volumen && volumen !== "SIN VOLUMEN"
        ? path.join(tipoCaptura, notaria, volumen)
        : path.join(tipoCaptura, notaria);
    const carpetaDestinoFinal = path.join(baseDestino, subcarpeta);
    const rutaDestinoArchivo = path.join(carpetaDestinoFinal, archivoOriginal);

    // Asegurar que el directorio de destino exista de forma asíncrona y segura en red UNC
    await asegurarDirectorio(carpetaDestinoFinal);

    // Copiar de forma asíncrona usando la función robusta con reintentos y streams (apta para red UNC)
    if (rutaCompletaTemporal !== rutaDestinoArchivo) {
      await copiarArchivoRobusto(rutaCompletaTemporal, rutaDestinoArchivo);
    }
    rutaFinalArchivo = rutaDestinoArchivo;

    // Contar páginas directamente sobre el archivo en su ruta final
    paginasFisicas = await contarPaginasPdf(rutaFinalArchivo);

    // Validar si ya existe el registro en la base de datos
    const [rows] = await dbPool.query(
      'SELECT id, paginas FROM `auditoria` WHERE archivo = ? AND notaria = ? AND (volumen = ? OR (volumen IS NULL AND ? = "SIN VOLUMEN")) LIMIT 1',
      [archivoOriginal, notaria, volumen, volumen],
    );

    const ahora = new Date();
    const fechaHora = ahora.toISOString().slice(0, 19).replace("T", " ");

    if (rows.length > 0) {
      const registroId = rows[0].id;
      const paginasRegistradas = rows[0].paginas || 0;

      // Actualizar páginas si son <= 1 o si no coinciden
      if (paginasRegistradas <= 1 || paginasRegistradas !== paginasFisicas) {
        await dbPool.query(
          "UPDATE `auditoria` SET exportado = 1, exportado_en = ?, paginas = ?, updated_at = NOW() WHERE id = ?",
          [ahora, paginasFisicas, registroId],
        );
      } else {
        await dbPool.query(
          "UPDATE `auditoria` SET exportado = 1, exportado_en = ?, updated_at = NOW() WHERE id = ?",
          [ahora, registroId],
        );
      }
    } else {
      const sqlInsert = `
                INSERT INTO \`auditoria\` 
                (fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, exportado, exportado_en, lugar_trabajo, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
            `;

      const paramsInsert = [
        fechaHora,
        req.body.turno || "Matutino",
        req.body.usuario || null,
        req.body.pc || null,
        "127.0.0.1",
        notaria,
        volumen === "SIN VOLUMEN" ? null : volumen,
        archivoOriginal,
        "Subido mediante API digitalizacion/subir-pdf",
        paginasFisicas,
        "IREC",
        ahora,
        ahora,
      ];
      await dbPool.query(sqlInsert, paramsInsert);
    }

    // Borrado asíncrono del archivo origen/temporal procesado para no dejar copias duplicadas
    if (fs.existsSync(rutaCompletaTemporal)) {
      try {
        await fs.promises.unlink(rutaCompletaTemporal);
      } catch (errUnlink) {
        console.warn(
          "No se pudo eliminar el archivo origen/temporal tras la copia:",
          errUnlink.message,
        );
      }
    }

    res.json({
      ok: true,
      mensaje: `El archivo ${archivoOriginal} fue subido y procesado con éxito.`,
      paginas: paginasFisicas,
      paginas_detectadas: paginasFisicas,
    });
  } catch (error) {
    // Eliminar archivo temporal si falla
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    res.status(500).json({
      ok: false,
      mensaje: "Error al procesar el archivo PDF: " + error.message,
    });
  }
}

// Obtiene los registros de auditoría con soporte de búsqueda global en toda la BD, filtros y paginación
async function obtenerRegistros(req, res) {
  try {
    const page = parseInt(req.query.page || 1, 10);
    const limit = parseInt(req.query.limit || 100, 10);
    const offset = (page - 1) * limit;

    const { buscar, usuario, notaria, volumen, fecha_inicio, fecha_fin } = req.query;

    const condiciones = [];
    const params = [];

    if (buscar && buscar.trim() !== "") {
      const termino = `%${buscar.trim()}%`;
      condiciones.push("(archivo LIKE ? OR notaria LIKE ? OR volumen LIKE ? OR usuario LIKE ? OR pc LIKE ?)");
      params.push(termino, termino, termino, termino, termino);
    }

    if (usuario && usuario.trim() !== "") {
      condiciones.push("LOWER(usuario) = LOWER(?)");
      params.push(usuario.trim());
    }

    if (notaria && notaria.trim() !== "") {
      condiciones.push("notaria = ?");
      params.push(notaria.trim());
    }

    if (volumen && volumen.trim() !== "") {
      condiciones.push("volumen = ?");
      params.push(volumen.trim());
    }

    if (fecha_inicio && fecha_fin) {
      condiciones.push("DATE(COALESCE(created_at, fecha_hora)) BETWEEN ? AND ?");
      params.push(fecha_inicio, fecha_fin);
    }

    const whereClause = condiciones.length > 0 ? " WHERE " + condiciones.join(" AND ") : "";

    // 1. Obtener total de registros que coinciden con la búsqueda/filtros
    const countSql = `SELECT COUNT(*) AS total FROM \`auditoria\` ${whereClause}`;
    const [countRows] = await dbPool.query(countSql, params);
    const total = countRows[0] ? countRows[0].total : 0;

    // 2. Obtener la página paginada ordenando por el timestamp created_at de MySQL
    const querySql = `
      SELECT 
        id, 
        DATE_FORMAT(COALESCE(created_at, fecha_hora), '%Y-%m-%d %H:%i:%s') AS fecha_hora, 
        created_at,
        turno, 
        usuario, 
        pc, 
        notaria, 
        volumen, 
        archivo, 
        paginas, 
        exportado 
      FROM \`auditoria\` 
      ${whereClause}
      ORDER BY COALESCE(created_at, fecha_hora) DESC 
      LIMIT ? OFFSET ?
    `;

    const queryParams = [...params, limit, offset];
    const [rows] = await dbPool.query(querySql, queryParams);

    const totalPages = Math.ceil(total / limit) || 1;

    res.json({
      ok: true,
      registros: rows,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al consultar registros: " + error.message,
    });
  }
}

// Obtiene el catálogo único de usuarios, notarías y volúmenes para poblar los dropdowns de filtrado
async function obtenerOpcionesFiltrosRegistros(req, res) {
  try {
    const [usuariosRows] = await dbPool.query(
      "SELECT DISTINCT usuario FROM `auditoria` WHERE usuario IS NOT NULL AND usuario != '' AND usuario != 'Desconocido' ORDER BY usuario ASC"
    );
    const [notariasRows] = await dbPool.query(
      "SELECT DISTINCT notaria FROM `auditoria` WHERE notaria IS NOT NULL AND notaria != '' ORDER BY notaria ASC"
    );
    const [volumenesRows] = await dbPool.query(
      "SELECT DISTINCT volumen FROM `auditoria` WHERE volumen IS NOT NULL AND volumen != '' AND volumen != 'SIN VOLUMEN' ORDER BY volumen ASC"
    );

    const usuarios = usuariosRows.map((r) => r.usuario);
    const notarias = notariasRows.map((r) => r.notaria);
    const volumenes = volumenesRows.map((r) => r.volumen);

    res.json({
      ok: true,
      usuarios,
      notarias,
      volumenes,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al obtener opciones de filtros: " + error.message,
    });
  }
}

// Obtiene el listado de carpetas que representan notarias en C:\NOTARIAS, C:\NOMINAS y C:\LIBROS
async function obtenerNotariasLocales(req, res) {
  try {
    const bases = [
      { path: "C:\\NOTARIAS", alias: "NOTARIAS" },
      { path: "C:\\NOMINAS", alias: "NOMINAS" },
      { path: "C:\\LIBROS", alias: "LIBROS" }
    ];

    const arbolNotarias = [];

    for (const baseObj of bases) {
      const rutaBase = baseObj.path;
      if (!fs.existsSync(rutaBase)) continue;

      let items = fs.readdirSync(rutaBase);

      // Comprobar también si dentro hay una subcarpeta intermedia con el mismo nombre (ej: C:\NOTARIAS\NOTARIAS)
      const subcarpetaDuplicada = path.join(rutaBase, baseObj.alias);
      let rutaLectura = rutaBase;
      let usaSubcarpeta = false;

      if (fs.existsSync(subcarpetaDuplicada)) {
        try {
          const statSub = fs.statSync(subcarpetaDuplicada);
          if (statSub.isDirectory()) {
            rutaLectura = subcarpetaDuplicada;
            items = fs.readdirSync(subcarpetaDuplicada);
            usaSubcarpeta = true;
          }
        } catch (errSub) {}
      }

      items.forEach((item) => {
        const rutaNotaria = path.join(rutaLectura, item);
        try {
          const stat = fs.statSync(rutaNotaria);
          // Permitir cualquier directorio que no sea la carpeta duplicada en sí
          if (stat.isDirectory() && item !== baseObj.alias) {
            // Leer las subcarpetas (volúmenes o lotes)
            const subItems = fs.readdirSync(rutaNotaria);
            const volumenes = subItems.filter((subItem) => {
              const rutaVol = path.join(rutaNotaria, subItem);
              try {
                const subStat = fs.statSync(rutaVol);
                return subStat.isDirectory();
              } catch (e) {
                return false;
              }
            });

            arbolNotarias.push({
              nombre: item,
              volumenes: volumenes,
              rutaBase: rutaBase,
              alias: baseObj.alias,
              usaSubcarpeta: usaSubcarpeta
            });
          }
        } catch (e) {
          // Ignorar carpetas individuales con problemas de lectura
        }
      });
    }

    res.json({ ok: true, notarias: arbolNotarias });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al listar directorios locales: " + error.message,
    });
  }
}

// Escanea recursivamente los PDFs de una notaria/nomina/libro seleccionada
async function escanearDirectorio(req, res) {
  try {
    const { notariaSeleccionada, rutaBase, alias, usaSubcarpeta } = req.body;
    if (!notariaSeleccionada) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debe especificar el directorio a escanear.",
      });
    }

    // Resolver la ruta física del directorio
    let rutaDirectorio = "";
    const baseFinal = rutaBase || "C:\\NOTARIAS";

    if (usaSubcarpeta && alias) {
      rutaDirectorio = path.join(baseFinal, alias, notariaSeleccionada);
    } else {
      rutaDirectorio = path.join(baseFinal, notariaSeleccionada);
    }

    // Fallback de ruta por si no existe
    if (!fs.existsSync(rutaDirectorio)) {
      if (alias) {
        if (usaSubcarpeta) {
          rutaDirectorio = path.join(baseFinal, notariaSeleccionada);
        } else {
          rutaDirectorio = path.join(baseFinal, alias, notariaSeleccionada);
        }
      }
    }

    console.log("[DEBUG ESCANEO] req.body:", req.body);

    if (!fs.existsSync(rutaDirectorio)) {
      console.log("[DEBUG ESCANEO] La ruta no existe:", rutaDirectorio);
      return res.status(400).json({
        ok: false,
        mensaje: `La ruta del directorio no existe en el disco local: ${rutaDirectorio}`,
      });
    }

    console.log("[DEBUG ESCANEO] Ruta resuelta existe:", rutaDirectorio);

    const archivosPdf = [];
    obtenerPdfsRecursivo(rutaDirectorio, archivosPdf);

    console.log("[DEBUG ESCANEO] PDFs encontrados:", archivosPdf.length, archivosPdf.slice(0, 5));

    const listadoResultados = [];
    for (const rutaCompleta of archivosPdf) {
      const archivo = path.basename(rutaCompleta);
      const { notaria, volumen } = extraerNotariaYVolumenDeRuta(rutaCompleta);

      // Consultar tamaño del archivo en MB
      let tamanioMb = 0;
      try {
        const statObj = fs.statSync(rutaCompleta);
        tamanioMb = statObj.size / (1024 * 1024);
      } catch (e) {}

      // Validar si el archivo ya existe en la base de datos y obtener sus páginas registradas
      let [rows] = await dbPool.query(
        'SELECT id, paginas FROM `auditoria` WHERE archivo = ? AND notaria = ? AND (volumen = ? OR (volumen IS NULL AND ? = "SIN VOLUMEN")) LIMIT 1',
        [archivo, notaria, volumen, volumen],
      );

      // Fallback: si no coincide por notaría/volumen exacto (ej: por unidad de red Z:\ vs C:\, carpetas repetidas o discrepancias de nombres)
      if (rows.length === 0) {
        let patronBusqueda = "";
        if (volumen && volumen !== "SIN VOLUMEN") {
          patronBusqueda = `%${notaria}%${volumen}%${archivo}%`;
        } else {
          patronBusqueda = `%${notaria}%${archivo}%`;
        }
        // Reemplazar barras por comodines de porcentaje para coincidir independientemente del formateo del path
        patronBusqueda = patronBusqueda.replace(/\\/g, "%").replace(/\//g, "%");

        [rows] = await dbPool.query(
          'SELECT id, paginas FROM `auditoria` WHERE archivo = ? AND detalles LIKE ? LIMIT 1',
          [archivo, patronBusqueda],
        );
      }

      const existe = rows.length > 0;
      const paginasReg = existe ? rows[0].paginas || 0 : 0;

      listadoResultados.push({
        rutaCompleta,
        archivo,
        notaria,
        volumen,
        yaRegistrado: existe,
        paginasRegistradas: paginasReg,
        tamanioMb,
      });
    }

    res.json({
      ok: true,
      totalEncontrados: archivosPdf.length,
      resultados: listadoResultados,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al escanear directorio: " + error.message,
    });
  }
}

// Envía el PDF físico directamente consumiendo la API oficial de Astronmx sin saturar la memoria RAM
async function enviarPdfAEndpointAstronmx(rutaCompleta, archivo, tipoCaptura, notariaConVolumen) {
  const urlEndpoint = "https://app.astronmx.cloud/api/digitalizacion/subir-pdf";

  let blob;
  if (typeof fs.openAsBlob === "function") {
    blob = await fs.openAsBlob(rutaCompleta, { type: "application/pdf" });
  } else {
    const buffer = await fs.promises.readFile(rutaCompleta);
    blob = new Blob([buffer], { type: "application/pdf" });
  }

  const formData = new FormData();
  formData.append("archivo", blob, archivo);
  formData.append("tipo_captura", tipoCaptura || "NOTARIAS");
  formData.append("notaria", notariaConVolumen || "General");
  formData.append("archivo_original", archivo);

  const respuesta = await fetch(urlEndpoint, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(30000), // Timeout de 30 segundos
  });

  if (!respuesta.ok) {
    const errorTexto = await respuesta.text();
    throw new Error(`El endpoint oficial de Astronmx respondió con código ${respuesta.status}: ${errorTexto}`);
  }

  return await respuesta.json();
}

// Copia, calcula páginas y registra a través del endpoint de subida de Astronmx
async function importarArchivoPdf(req, res) {
  try {
    const { rutaCompleta, archivo, notaria, volumen, usuario, turno, pc } =
      req.body;
    if (!rutaCompleta || !archivo) {
      return res.status(400).json({
        ok: false,
        mensaje: "Datos insuficientes para la importación.",
      });
    }

    if (!fs.existsSync(rutaCompleta)) {
      return res
        .status(400)
        .json({ ok: false, mensaje: "El archivo físico de origen no existe." });
    }

    const tipoCaptura = (req.body.tipo_captura || "NOTARIAS").toUpperCase();
    const notariaConVolumen =
      volumen && volumen !== "SIN VOLUMEN"
        ? `${notaria}\\${volumen}`
        : notaria;

    // 1. Intentar enviar el PDF consumiendo la API oficial de Astronmx / Stellum
    let respuestaAstronmx = null;
    let errorAstronmxDetalle = null;

    try {
      respuestaAstronmx = await enviarPdfAEndpointAstronmx(
        rutaCompleta,
        archivo,
        tipoCaptura,
        notariaConVolumen
      );
    } catch (errAstronmx) {
      errorAstronmxDetalle = errAstronmx.message;
      console.warn("Aviso al enviar a Astronmx:", errAstronmx.message);
    }

    let viaTransferencia = "endpoint_astronmx";

    // Fallback para archivos pesados o de red lenta: si el HTTP falló pero tenemos acceso a la red UNC
    if (!respuestaAstronmx || !respuestaAstronmx.ok) {
      const baseDestino = process.env.RUTA_SSDIREC || "\\\\172.40.5.84\\ssdirec";
      const subcarpeta =
        volumen && volumen !== "SIN VOLUMEN"
          ? path.join(tipoCaptura, notaria, volumen)
          : path.join(tipoCaptura, notaria);
      const carpetaDestinoFinal = path.join(baseDestino, subcarpeta);
      const rutaDestinoArchivo = path.join(carpetaDestinoFinal, archivo);

      await asegurarDirectorio(carpetaDestinoFinal);
      if (rutaCompleta !== rutaDestinoArchivo) {
        await copiarArchivoRobusto(rutaCompleta, rutaDestinoArchivo);
      }
      viaTransferencia = "copia_red_unc";
    }

    const paginasFisicas = respuestaAstronmx && respuestaAstronmx.paginas_detectadas
      ? respuestaAstronmx.paginas_detectadas
      : await contarPaginasPdf(rutaCompleta);

    // 2. Registrar o actualizar la base de datos local en MySQL para sincronización
    const [rows] = await dbPool.query(
      'SELECT id, paginas FROM `auditoria` WHERE archivo = ? AND notaria = ? AND (volumen = ? OR (volumen IS NULL AND ? = "SIN VOLUMEN")) LIMIT 1',
      [archivo, notaria, volumen, volumen],
    );

    const ahora = new Date();
    const fechaHora = ahora.toISOString().slice(0, 19).replace("T", " ");

    if (rows.length > 0) {
      const registroId = rows[0].id;
      const datosUpdate = [ahora, paginasFisicas];
      let sqlUpdate = "UPDATE `auditoria` SET exportado = 1, exportado_en = ?, paginas = ?";

      if (usuario && usuario !== "Administrador") {
        sqlUpdate += ", usuario = ?";
        datosUpdate.push(usuario);
      }
      if (pc && pc !== "SERVIDOR-CENTRAL") {
        sqlUpdate += ", pc = ?";
        datosUpdate.push(pc);
      }

      sqlUpdate += ", updated_at = NOW() WHERE id = ?";
      datosUpdate.push(registroId);

      await dbPool.query(sqlUpdate, datosUpdate);
    } else {
      const sqlInsert = `
        INSERT INTO \`auditoria\` 
        (fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, exportado, exportado_en, lugar_trabajo, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `;

      const paramsInsert = [
        fechaHora,
        turno || "Matutino",
        usuario && usuario !== "Administrador" ? usuario : null,
        pc && pc !== "SERVIDOR-CENTRAL" ? pc : null,
        "127.0.0.1",
        notaria,
        volumen === "SIN VOLUMEN" ? null : volumen,
        archivo,
        `Importado vía ${viaTransferencia}`,
        paginasFisicas,
        ahora,
        "IREC",
        ahora,
        ahora,
      ];
      await dbPool.query(sqlInsert, paramsInsert);
    }

    // 3. Cortar (eliminar) el archivo físico del disco local tras confirmarse la transferencia exitosa
    let cortado = false;
    if (fs.existsSync(rutaCompleta)) {
      try {
        await fs.promises.unlink(rutaCompleta);
        cortado = true;
      } catch (errUnlink) {
        console.warn("Aviso al eliminar el archivo físico local tras transferir:", errUnlink.message);
      }
    }

    res.json({
      ok: true,
      mensaje: `El archivo ${archivo} fue transferido con éxito (${viaTransferencia}).`,
      paginas: paginasFisicas,
      paginas_detectadas: paginasFisicas,
      cortado,
      via: viaTransferencia,
      errorAstronmxDetalle,
      respuestaAstronmx,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: `Error al transferir archivo: ${error.message}`,
    });
  }
}

// Función auxiliar recursiva para escanear archivos PDF
function obtenerPdfsRecursivo(dir, listaArchivos = []) {
  if (!fs.existsSync(dir)) return listaArchivos;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const rutaCompleta = path.join(dir, item);
    let stat;
    try {
      stat = fs.statSync(rutaCompleta);
    } catch (e) {
      continue; // Saltar archivos bloqueados o inaccesibles
    }

    if (stat.isDirectory()) {
      obtenerPdfsRecursivo(rutaCompleta, listaArchivos);
    } else if (stat.isFile() && item.toLowerCase().endsWith(".pdf")) {
      listaArchivos.push(rutaCompleta);
    }
  }
  return listaArchivos;
}

// Extrae notaría y volumen imitando exactamente al watcher de digitalización (dinámico para Notarias, Nominas y Libros)
function extraerNotariaYVolumenDeRuta(rutaCompleta) {
  const rutaNormalizada = rutaCompleta.replace(/\\/g, "/");
  const partes = rutaNormalizada.split("/");
  let notaria = "General";
  let volumen = "SIN VOLUMEN";

  const indexNotaria = partes.findIndex((p) => {
    const u = p.toUpperCase().trim();
    return (u.startsWith("NOTARIA") && u !== "NOTARIAS") ||
           (u.startsWith("NOMINA") && u !== "NOMINAS") ||
           (u.startsWith("LIBRO") && u !== "LIBROS");
  });

  if (indexNotaria !== -1) {
    notaria = partes[indexNotaria].trim();

    // Si hay subcarpetas intermedias entre la notaría y el archivo final (.pdf)
    const indexArchivo = partes.length - 1;
    if (indexArchivo - 1 > indexNotaria) {
      volumen = partes[indexArchivo - 1].trim();
    }
  }

  return { notaria, volumen };
}

// Realiza la consulta de registros no exportados y los envía a Astronmx
async function ejecutarSincronizacionAstronmxInterno() {
  // Consultar los registros que no han sido exportados (exportado = 0)
  const [rows] = await dbPool.query(
    "SELECT id, fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, lugar_trabajo FROM `auditoria` WHERE exportado = 0 ORDER BY id ASC",
  );

  if (rows.length === 0) {
    return { sincronizados: 0, mensaje: "No hay registros pendientes." };
  }

  // Mapear al formato JSON esperado por la API de Astronmx
  const registrosFormateados = rows.map((r) => ({
    FechaHora: r.fecha_hora
      ? new Date(r.fecha_hora).toISOString().slice(0, 19).replace("T", " ")
      : new Date().toISOString().slice(0, 19).replace("T", " "),
    Turno: r.turno || "Matutino",
    Usuario: r.usuario || "Desconocido",
    PC: r.pc || "SERVIDOR-CENTRAL",
    IP: r.ip || "127.0.0.1",
    Notaria: r.notaria || "General",
    Lote: r.volumen || null,
    ArchivoOriginal: r.archivo || null,
    Detalles: r.detalles || "Sincronizado automáticamente",
    Paginas: r.paginas || 0,
    LugarTrabajo: r.lugar_trabajo || "IREC",
  }));

  // Enviar por HTTP POST a Astronmx usando fetch nativo de Node.js
  const urlAstronmx = "https://app.astronmx.cloud/api/digitalizacion/registrar";
  const respuesta = await fetch(urlAstronmx, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ Registros: registrosFormateados }),
  });

  if (!respuesta.ok) {
    const errorTexto = await respuesta.text();
    throw new Error(
      `Servidor Astronmx respondió con código ${respuesta.status}: ${errorTexto}`,
    );
  }

  const datosRespuesta = await respuesta.json();

  // Si la sincronización fue exitosa, marcar los registros como exportados en MySQL
  const ahora = new Date();
  const idsSincronizados = rows.map((r) => r.id);

  if (idsSincronizados.length > 0) {
    await dbPool.query(
      "UPDATE `auditoria` SET exportado = 1, exportado_en = ?, updated_at = NOW() WHERE id IN (?)",
      [ahora, idsSincronizados],
    );
  }

  return {
    sincronizados: idsSincronizados.length,
    servidorRespuesta: datosRespuesta,
  };
}

// Endpoint HTTP para sincronización manual
async function sincronizarAstronmx(req, res) {
  try {
    const { forzar } = req.body || {};
    if (forzar) {
      console.log("[SYNC] Forzando resincronización completa. Reseteando exportado a 0...");
      await dbPool.query("UPDATE `auditoria` SET exportado = 0");
    }

    const resultado = await ejecutarSincronizacionAstronmxInterno();
    if (resultado.sincronizados === 0) {
      return res.json({
        ok: true,
        mensaje: "No hay registros pendientes de sincronizar.",
        sincronizados: 0,
      });
    }
    res.json({
      ok: true,
      mensaje: `Sincronización completada con éxito. Se enviaron ${resultado.sincronizados} registros a la nube.`,
      sincronizados: resultado.sincronizados,
      servidorRespuesta: resultado.servidorRespuesta,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al sincronizar con Astronmx: " + error.message,
    });
  }
}

// Función silenciosa para ejecución automática cada hora (Cron/Interval)
async function sincronizarAstronmxSilencioso() {
  try {
    const resultado = await ejecutarSincronizacionAstronmxInterno();
    if (resultado.sincronizados > 0) {
      console.log(
        `[AUTOSYNC] Sincronización automática completada: ${resultado.sincronizados} registros enviados a Astronmx.`,
      );
    }
  } catch (error) {
    console.error(
      "[AUTOSYNC] Error en la sincronización automática con Astronmx:",
      error.message,
    );
  }
}

// Obtiene el listado de PCs que han registrado auditorías en el sistema
async function obtenerPcsUnicas(req, res) {
  try {
    const [rows] = await dbPool.query(
      "SELECT DISTINCT pc FROM `auditoria` WHERE pc IS NOT NULL AND pc <> '' ORDER BY pc ASC",
    );
    const pcs = rows.map((r) => r.pc);
    res.json({ ok: true, pcs });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al consultar PCs únicas: " + error.message,
    });
  }
}

// Escanea C:\NOTARIAS para reparar en lote los registros con páginas incompletas (0 o 1)
async function repararPaginasIncompletas(req, res) {
  try {
    const { pc } = req.body;

    let sqlSelect =
      "SELECT id, notaria, volumen, archivo, pc FROM `auditoria` WHERE paginas <= 1";
    const sqlParams = [];

    if (pc && pc !== "TODAS") {
      sqlSelect += " AND pc = ?";
      sqlParams.push(pc);
    }

    const [rows] = await dbPool.query(sqlSelect, sqlParams);

    if (rows.length === 0) {
      return res.json({
        ok: true,
        omitido: true,
        totalIncompletos: 0,
        totalReparados: 0,
        totalNoEncontrados: 0,
      });
    }

    let totalIncompletos = rows.length;
    let totalReparados = 0;
    let totalNoEncontrados = 0;

    // Listado de directorios base de almacenamiento local y sus respectivas subcarpetas duplicadas
    const basesPosibles = [
      { base: "C:\\NOTARIAS", sub: "NOTARIAS" },
      { base: "C:\\NOMINAS", sub: "NOMINAS" },
      { base: "C:\\LIBROS", sub: "LIBROS" }
    ];

    for (const reg of rows) {
      const notaria = reg.notaria || "General";
      const volumen = reg.volumen;
      const archivo = reg.archivo;

      if (!archivo) {
        totalNoEncontrados++;
        continue;
      }

      let rutaFisica = "";
      let encontrado = false;

      // Buscar secuencialmente en los directorios de Notarías, Nóminas y Libros
      for (const itemBase of basesPosibles) {
        // 1. Probar ruta física directa
        if (volumen && volumen !== "SIN VOLUMEN") {
          rutaFisica = path.join(itemBase.base, notaria, volumen, archivo);
        } else {
          rutaFisica = path.join(itemBase.base, notaria, archivo);
        }

        if (fs.existsSync(rutaFisica)) {
          encontrado = true;
          break;
        }

        // 2. Probar ruta física con subcarpeta intermedia duplicada
        if (volumen && volumen !== "SIN VOLUMEN") {
          rutaFisica = path.join(itemBase.base, itemBase.sub, notaria, volumen, archivo);
        } else {
          rutaFisica = path.join(itemBase.base, itemBase.sub, notaria, archivo);
        }

        if (fs.existsSync(rutaFisica)) {
          encontrado = true;
          break;
        }
      }

      if (encontrado) {
        // Calcular páginas reales optimizado
        const paginas = await contarPaginasPdf(rutaFisica);

        // Actualizar en MySQL
        await dbPool.query(
          "UPDATE `auditoria` SET paginas = ?, updated_at = NOW() WHERE id = ?",
          [paginas, reg.id],
        );
        totalReparados++;
      } else {
        totalNoEncontrados++;
      }
    }

    res.json({
      ok: true,
      totalIncompletos,
      totalReparados,
      totalNoEncontrados,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al reparar páginas incompletas: " + error.message,
    });
  }
}

// Realiza la migración nativa de usuarios e históricos JSON de auditoría desde C:\NOTARIAS
async function migrarHistorico(req, res) {
  try {
    let usuariosMigrados = 0;
    let registrosMigrados = 0;
    let duplicadosOmitidos = 0;

    // 1. MIGRACIÓN DE USUARIOS (Notarías, Nóminas y Libros)
    const rutasUsuariosJsonPosibles = [
      "C:\\NOTARIAS\\usuarios.json",
      "C:\\NOMINAS\\usuarios.json",
      "C:\\LIBROS\\usuarios.json"
    ];

    // Asegurar estructura de tablas una sola vez
    await dbPool.query(`
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

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS \`configuracion\` (
        \`clave\` VARCHAR(100) PRIMARY KEY,
        \`valor\` TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    for (const rutaUsuariosJson of rutasUsuariosJsonPosibles) {
      if (fs.existsSync(rutaUsuariosJson)) {
        try {
          const jsonContenido = fs.readFileSync(rutaUsuariosJson, "utf8");
          const datosUsuarios = JSON.parse(jsonContenido);

          if (
            datosUsuarios &&
            datosUsuarios.Usuarios &&
            Array.isArray(datosUsuarios.Usuarios)
          ) {
            for (const u of datosUsuarios.Usuarios) {
              const nombreCompleto = (u.NombreCompleto || "").trim();
              const nombreUsuario = (u.NombreUsuario || "").toLowerCase().trim();
              const pin = (u.Pin || "").trim();
              const turno = (u.Turno || "Matutino").trim();

              if (!nombreUsuario || !pin) continue;

              await dbPool.query(
                `INSERT INTO usuarios (nombre_completo, nombre_usuario, pin, turno) 
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE nombre_completo = ?, pin = ?, turno = ?`,
                [
                  nombreCompleto,
                  nombreUsuario,
                  pin,
                  turno,
                  nombreCompleto,
                  pin,
                  turno,
                ],
              );
              usuariosMigrados++;
            }
          }
        } catch (errUsr) {
          console.error(`Error al migrar usuarios JSON desde ${rutaUsuariosJson}:`, errUsr);
        }
      }
    }

    // 2. MIGRACIÓN DE HISTÓRICOS JSON DE AUDITORÍA (Notarías, Nóminas y Libros)
    const directoriosMonitoreoPosibles = [
      "C:\\NOTARIAS\\MonitoreoCaptura",
      "C:\\NOMINAS\\MonitoreoCaptura",
      "C:\\LIBROS\\MonitoreoCaptura"
    ];

    for (const directorioMonitoreo of directoriosMonitoreoPosibles) {
      if (fs.existsSync(directorioMonitoreo)) {
        try {
          const elementos = fs.readdirSync(directorioMonitoreo);

          for (const elem of elementos) {
            const rutaCarpetaPc = path.join(directorioMonitoreo, elem);
            const stat = fs.statSync(rutaCarpetaPc);

            if (stat.isDirectory()) {
              const rutaJson = path.join(rutaCarpetaPc, "auditoria.json");
              if (fs.existsSync(rutaJson)) {
                const nombrePc = elem;
                const jsonContenido = fs.readFileSync(rutaJson, "utf8");
                const datosJson = JSON.parse(jsonContenido);

                let registrosJson = [];
                if (
                  datosJson &&
                  datosJson.Registros &&
                  Array.isArray(datosJson.Registros)
                ) {
                  registrosJson = datosJson.Registros;
                } else if (Array.isArray(datosJson)) {
                  registrosJson = datosJson;
                }

                for (const reg of registrosJson) {
                  const fechaHora = reg.FechaHora || reg.fecha_hora || null;
                  const archivo =
                    reg.ArchivoOriginal ||
                    reg.archivo_original ||
                    reg.archivo ||
                    null;

                  if (!fechaHora || !archivo) continue;

                  // Verificar duplicado en la base de datos
                  const [rows] = await dbPool.query(
                    "SELECT id FROM `auditoria` WHERE fecha_hora = ? AND pc = ? AND archivo = ? LIMIT 1",
                    [fechaHora, nombrePc, archivo],
                  );

                  if (rows.length > 0) {
                    duplicadosOmitidos++;
                    continue;
                  }

                  // Insertar registro en lote con separación de Notaría y Volumen, y captura de IP correcta
                  const turno = reg.Turno || reg.turno || "Matutino";
                  const usuario = reg.Usuario || reg.usuario || null;
                  const ip = reg.IP || reg.Ip || reg.ip || null;
                  const detalles = reg.Detalles || reg.detalles || null;
                  const paginas = parseInt(reg.Paginas || reg.paginas || 0, 10);
                  const lugarTrabajo =
                    reg.LugarTrabajo || reg.lugar_trabajo || null;
                  const exportadoEn =
                    reg.ExportadoEn || reg.exportado_en || reg.fecha_hora || null;
                  const createdAt =
                    reg.CreatedAt ||
                    reg.created_at ||
                    reg.fecha_hora ||
                    new Date();
                  const updatedAt =
                    reg.UpdatedAt ||
                    reg.updated_at ||
                    reg.fecha_hora ||
                    new Date();

                  let notaria =
                    reg.Notaria || reg.notaria || reg.directorio || "General";
                  let volumen =
                    reg.Volumen || reg.volumen || reg.Lote || reg.lote || null;

                  if (typeof notaria === "string" && notaria.includes("\\")) {
                    const partes = notaria.split("\\");
                    notaria = partes[0].trim();
                    if (!volumen) {
                      volumen = partes[1].trim();
                    }
                  }

                  await dbPool.query(
                    `INSERT INTO \`auditoria\` 
                     (fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, exportado, exportado_en, lugar_trabajo, created_at, updated_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
                    [
                      fechaHora,
                      turno,
                      usuario,
                      nombrePc,
                      ip,
                      notaria,
                      volumen,
                      archivo,
                      detalles,
                      paginas,
                      exportadoEn,
                      lugarTrabajo,
                      createdAt,
                      updatedAt,
                    ],
                  );
                  registrosMigrados++;
                }
              }
            }
          }
        } catch (errJson) {
          console.error(`Error al migrar históricos JSON desde ${directorioMonitoreo}:`, errJson);
        }
      }
    }

    res.json({
      ok: true,
      usuariosMigrados,
      registrosMigrados,
      duplicadosOmitidos,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje:
        "Error durante la migración de datos históricos: " + error.message,
    });
  }
}

// Asigna masivamente un usuario a una lista de registros de auditoria por sus IDs o por notaría/volúmenes
async function asignarPdfs(req, res) {
  try {
    const { ids, usuario, notaria, volumenes, itemsVolumenes } = req.body;
    if (!usuario) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debe proporcionar el usuario a asignar.",
      });
    }

    // 1. Asignar arreglo de pares { notaria, volumen } seleccionados en el árbol
    if (itemsVolumenes && Array.isArray(itemsVolumenes) && itemsVolumenes.length > 0) {
      let totalAfectados = 0;
      for (const item of itemsVolumenes) {
        const [resVol] = await dbPool.query(
          "UPDATE `auditoria` SET usuario = ?, updated_at = NOW() WHERE notaria = ? AND (volumen = ? OR (volumen IS NULL AND ? = 'SIN VOLUMEN'))",
          [usuario, item.notaria, item.volumen, item.volumen]
        );
        totalAfectados += resVol.affectedRows;
      }
      return res.json({
        ok: true,
        mensaje: `Se asignaron los ${itemsVolumenes.length} volumen(es) (${totalAfectados} archivos) al capturista "${usuario}" correctamente.`,
      });
    }

    if (ids && Array.isArray(ids) && ids.length > 0) {
      await dbPool.query(
        "UPDATE `auditoria` SET usuario = ?, updated_at = NOW() WHERE id IN (?)",
        [usuario, ids]
      );
      return res.json({
        ok: true,
        mensaje: `Se asignaron ${ids.length} registros al usuario "${usuario}" correctamente.`,
      });
    }

    if (notaria) {
      if (volumenes && Array.isArray(volumenes) && volumenes.length > 0) {
        const [resultado] = await dbPool.query(
          "UPDATE `auditoria` SET usuario = ?, updated_at = NOW() WHERE notaria = ? AND volumen IN (?)",
          [usuario, notaria, volumenes]
        );
        return res.json({
          ok: true,
          mensaje: `Se asignaron ${resultado.affectedRows} registros de ${volumenes.length} volumen(es) al usuario "${usuario}".`,
        });
      } else {
        const [resultado] = await dbPool.query(
          "UPDATE `auditoria` SET usuario = ?, updated_at = NOW() WHERE notaria = ?",
          [usuario, notaria]
        );
        return res.json({
          ok: true,
          mensaje: `Se asignaron ${resultado.affectedRows} registros de la ${notaria} al usuario "${usuario}".`,
        });
      }
    }

    return res.status(400).json({
      ok: false,
      mensaje: "Debe seleccionar registros por ID o seleccionar carpetas de notaría/volúmenes.",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al asignar PDFs a usuario: " + error.message,
    });
  }
}

// Obtiene únicamente las notarías y carpetas de volúmenes que tienen archivos SIN ASIGNAR
async function obtenerVolumenesPendientesAsignacion(req, res) {
  try {
    const sql = `
      SELECT 
        notaria, 
        COALESCE(volumen, 'SIN VOLUMEN') AS volumen, 
        COUNT(*) AS pendientes
      FROM \`auditoria\`
      WHERE (usuario IS NULL OR usuario = '' OR usuario = 'Administrador' OR usuario = 'Desconocido')
      GROUP BY notaria, volumen
      HAVING pendientes > 0
      ORDER BY notaria ASC, volumen ASC
    `;
    const [rows] = await dbPool.query(sql);

    const mapaNotarias = {};
    rows.forEach((r) => {
      const nombreNotaria = r.notaria || "General";
      if (!mapaNotarias[nombreNotaria]) {
        mapaNotarias[nombreNotaria] = {
          nombre: nombreNotaria,
          totalPendientes: 0,
          volumenes: [],
        };
      }
      mapaNotarias[nombreNotaria].totalPendientes += r.pendientes;
      mapaNotarias[nombreNotaria].volumenes.push({
        nombre: r.volumen,
        pendientes: r.pendientes,
      });
    });

    const notarias = Object.values(mapaNotarias);
    res.json({ ok: true, notarias });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al obtener volúmenes pendientes: " + error.message,
    });
  }
}

// Obtiene los registros de auditoría filtrados por notaría, volumen y usuario para asignación
async function obtenerPdfsParaAsignar(req, res) {
  try {
    const { notaria, volumen, usuario } = req.query;
    let sql = "SELECT id, fecha_hora, usuario, notaria, volumen, archivo, paginas FROM `auditoria` WHERE 1=1 ";
    const params = [];

    if (notaria) {
      sql += " AND notaria = ? ";
      params.push(notaria);
    }
    if (volumen) {
      sql += " AND (volumen = ? OR (volumen IS NULL AND ? = 'SIN VOLUMEN')) ";
      params.push(volumen, volumen);
    }
    if (usuario !== undefined && usuario !== null && usuario !== "") {
      if (usuario === "SIN_ASIGNAR") {
        sql += " AND (usuario IS NULL OR usuario = '' OR usuario = 'Administrador' OR usuario = 'Desconocido') ";
      } else {
        sql += " AND usuario = ? ";
        params.push(usuario);
      }
    }

    sql += " ORDER BY fecha_hora DESC LIMIT 500";

    const [rows] = await dbPool.query(sql, params);
    res.json({ ok: true, registros: rows });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al consultar PDFs para asignación: " + error.message,
    });
  }
}

// Obtiene de forma ultra rápida la lista plana de archivos PDF de las notarías y volúmenes seleccionados sin consultas SQL
async function obtenerPdfsLoteDirecto(req, res) {
  try {
    const { notariasMarcadas, volumenesMarcados } = req.body;
    const listaResultados = [];
    const baseFinal = "C:\\NOTARIAS";

    if (volumenesMarcados && Array.isArray(volumenesMarcados) && volumenesMarcados.length > 0) {
      for (const itemVol of volumenesMarcados) {
        const rBase = itemVol.rutaBase || baseFinal;
        let dirVolumen = path.join(rBase, itemVol.notaria, itemVol.volumen);
        
        if (!fs.existsSync(dirVolumen)) {
          dirVolumen = path.join(rBase, "NOTARIAS", itemVol.notaria, itemVol.volumen);
        }

        if (fs.existsSync(dirVolumen)) {
          const archivosPdf = [];
          obtenerPdfsRecursivo(dirVolumen, archivosPdf);
          archivosPdf.forEach((rutaCompleta) => {
            listaResultados.push({
              rutaCompleta,
              archivo: path.basename(rutaCompleta),
              notaria: itemVol.notaria,
              volumen: itemVol.volumen,
            });
          });
        }
      }
    } else if (notariasMarcadas && Array.isArray(notariasMarcadas) && notariasMarcadas.length > 0) {
      for (const itemNot of notariasMarcadas) {
        const rBase = itemNot.rutaBase || baseFinal;
        let dirNotaria = path.join(rBase, itemNot.notaria);

        if (!fs.existsSync(dirNotaria)) {
          dirNotaria = path.join(rBase, "NOTARIAS", itemNot.notaria);
        }

        if (fs.existsSync(dirNotaria)) {
          const archivosPdf = [];
          obtenerPdfsRecursivo(dirNotaria, archivosPdf);
          archivosPdf.forEach((rutaCompleta) => {
            const { notaria, volumen } = extraerNotariaYVolumenDeRuta(rutaCompleta);
            listaResultados.push({
              rutaCompleta,
              archivo: path.basename(rutaCompleta),
              notaria: notaria !== "General" ? notaria : itemNot.notaria,
              volumen,
            });
          });
        }
      }
    }

    res.json({ ok: true, total: listaResultados.length, archivos: listaResultados });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: "Error al obtener lista de PDFs: " + error.message });
  }
}

// Estado persistente en memoria del servidor Node.js
const estadoTransferenciaSegundoPlano = {
  activo: false,
  total: 0,
  procesados: 0,
  exitosos: 0,
  errores: 0,
  pct: 0,
  archivoActual: "",
  mensajeTexto: "Sin transferencias activas.",
  iniciadoEn: null,
  detallesErrores: [],
};

// Iniciar proceso masivo en segundo plano
async function iniciarTransferenciaSegundoPlano(req, res) {
  try {
    const { notariasMarcadas, volumenesMarcados, listaDirecta } = req.body;

    if (estadoTransferenciaSegundoPlano.activo) {
      return res.json({
        ok: true,
        mensaje: "Ya hay una transferencia ejecutándose en segundo plano.",
        estado: estadoTransferenciaSegundoPlano,
      });
    }

    let archivosAProcesar = [];

    if (listaDirecta && Array.isArray(listaDirecta) && listaDirecta.length > 0) {
      archivosAProcesar = listaDirecta;
    } else {
      const listaResultados = [];
      const baseFinal = "C:\\NOTARIAS";

      if (volumenesMarcados && Array.isArray(volumenesMarcados) && volumenesMarcados.length > 0) {
        for (const itemVol of volumenesMarcados) {
          const rBase = itemVol.rutaBase || baseFinal;
          let dirVolumen = path.join(rBase, itemVol.notaria, itemVol.volumen);
          if (!fs.existsSync(dirVolumen)) {
            dirVolumen = path.join(rBase, "NOTARIAS", itemVol.notaria, itemVol.volumen);
          }
          if (fs.existsSync(dirVolumen)) {
            const pdfs = [];
            obtenerPdfsRecursivo(dirVolumen, pdfs);
            pdfs.forEach((rutaCompleta) => {
              listaResultados.push({
                rutaCompleta,
                archivo: path.basename(rutaCompleta),
                notaria: itemVol.notaria,
                volumen: itemVol.volumen,
              });
            });
          }
        }
      } else if (notariasMarcadas && Array.isArray(notariasMarcadas) && notariasMarcadas.length > 0) {
        for (const itemNot of notariasMarcadas) {
          const rBase = itemNot.rutaBase || baseFinal;
          let dirNotaria = path.join(rBase, itemNot.notaria);
          if (!fs.existsSync(dirNotaria)) {
            dirNotaria = path.join(rBase, "NOTARIAS", itemNot.notaria);
          }
          if (fs.existsSync(dirNotaria)) {
            const pdfs = [];
            obtenerPdfsRecursivo(dirNotaria, pdfs);
            pdfs.forEach((rutaCompleta) => {
              const { notaria, volumen } = extraerNotariaYVolumenDeRuta(rutaCompleta);
              listaResultados.push({
                rutaCompleta,
                archivo: path.basename(rutaCompleta),
                notaria: notaria !== "General" ? notaria : itemNot.notaria,
                volumen,
              });
            });
          }
        }
      }
      archivosAProcesar = listaResultados;
    }

    if (archivosAProcesar.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: "No se encontraron archivos PDF para transferir en la selección.",
      });
    }

    // Inicializar estado
    estadoTransferenciaSegundoPlano.activo = true;
    estadoTransferenciaSegundoPlano.total = archivosAProcesar.length;
    estadoTransferenciaSegundoPlano.procesados = 0;
    estadoTransferenciaSegundoPlano.exitosos = 0;
    estadoTransferenciaSegundoPlano.errores = 0;
    estadoTransferenciaSegundoPlano.pct = 5;
    estadoTransferenciaSegundoPlano.mensajeTexto = `Iniciando transferencia de ${archivosAProcesar.length} archivo(s)...`;
    estadoTransferenciaSegundoPlano.iniciadoEn = new Date();
    estadoTransferenciaSegundoPlano.detallesErrores = [];

    // Arrancar la cola concurrente en segundo plano (3 transferencias simultáneas en paralelo sin colapso de RAM)
    setImmediate(async () => {
      const LIMITE_CONCURRENCIA = 3;
      let indiceSiguiente = 0;

      const ejecutarWorker = async () => {
        while (indiceSiguiente < archivosAProcesar.length) {
          const i = indiceSiguiente++;
          const item = archivosAProcesar[i];
          const rutaLegible = item.volumen && item.volumen !== "SIN VOLUMEN"
            ? `${item.notaria} \\ ${item.volumen} \\ ${item.archivo}`
            : `${item.notaria} \\ ${item.archivo}`;

          try {
            // Consultar datos originales del registro (usuario, pc, turno) si ya existían
            let userOrig = item.usuario && item.usuario !== "Administrador" ? item.usuario : null;
            let pcOrig = item.pc && item.pc !== "SERVIDOR-CENTRAL" ? item.pc : null;
            let turnoOrig = item.turno || "Matutino";

            if (!userOrig) {
              const [rowsReg] = await dbPool.query(
                "SELECT usuario, pc, turno FROM `auditoria` WHERE archivo = ? AND notaria = ? LIMIT 1",
                [item.archivo, item.notaria]
              );
              if (rowsReg.length > 0) {
                if (rowsReg[0].usuario && rowsReg[0].usuario !== "Administrador") userOrig = rowsReg[0].usuario;
                if (rowsReg[0].pc && rowsReg[0].pc !== "SERVIDOR-CENTRAL") pcOrig = rowsReg[0].pc;
                if (rowsReg[0].turno) turnoOrig = rowsReg[0].turno;
              }
            }

            const reqSim = {
              body: {
                rutaCompleta: item.rutaCompleta,
                archivo: item.archivo,
                notaria: item.notaria,
                volumen: item.volumen,
                usuario: userOrig,
                turno: turnoOrig,
                pc: pcOrig,
              },
            };

            let exitoLocal = false;
            let mensajeErrorLocal = "";
            const resSim = {
              status: () => resSim,
              json: (data) => {
                if (data && data.ok) {
                  exitoLocal = true;
                } else if (data && data.mensaje) {
                  mensajeErrorLocal = data.mensaje;
                }
                return data;
              },
            };

            await importarArchivoPdf(reqSim, resSim);

            if (exitoLocal) {
              estadoTransferenciaSegundoPlano.exitosos++;
            } else {
              estadoTransferenciaSegundoPlano.errores++;
              const motivo = mensajeErrorLocal || "Error durante la importación.";
              estadoTransferenciaSegundoPlano.detallesErrores.push({
                archivo: item.archivo,
                notaria: item.notaria,
                volumen: item.volumen || "SIN VOLUMEN",
                error: motivo,
                hora: new Date().toLocaleTimeString("es-MX"),
              });
              console.error(`❌ [ERROR TRANSFERENCIA] ${rutaLegible}: ${motivo}`);
            }
          } catch (errTask) {
            estadoTransferenciaSegundoPlano.errores++;
            const motivo = errTask.message || "Excepción al transferir archivo.";
            estadoTransferenciaSegundoPlano.detallesErrores.push({
              archivo: item.archivo,
              notaria: item.notaria,
              volumen: item.volumen || "SIN VOLUMEN",
              error: motivo,
              hora: new Date().toLocaleTimeString("es-MX"),
            });
            console.error(`❌ [EXCEPCIÓN TRANSFERENCIA] ${rutaLegible}: ${motivo}`);
          }

          estadoTransferenciaSegundoPlano.procesados++;
          const pctExacto = Math.round((estadoTransferenciaSegundoPlano.procesados / archivosAProcesar.length) * 100);
          estadoTransferenciaSegundoPlano.archivoActual = rutaLegible;
          estadoTransferenciaSegundoPlano.mensajeTexto = `[${estadoTransferenciaSegundoPlano.procesados}/${archivosAProcesar.length}] Transfiriendo en segundo plano: ${rutaLegible}`;
          estadoTransferenciaSegundoPlano.pct = Math.min(100, Math.max(1, pctExacto));

          // Pausa mínima para permitir recolección de basura de V8
          await new Promise((r) => setTimeout(r, 15));
        }
      };

      // Iniciar los trabajadores concurrentes simultáneos
      const numWorkers = Math.min(LIMITE_CONCURRENCIA, archivosAProcesar.length);
      const workers = [];
      for (let w = 0; w < numWorkers; w++) {
        workers.push(ejecutarWorker());
      }

      await Promise.all(workers);

      // Finalizar estado tras completar todos los trabajadores
      estadoTransferenciaSegundoPlano.activo = false;
      estadoTransferenciaSegundoPlano.pct = 100;
      estadoTransferenciaSegundoPlano.mensajeTexto = `Finalizado: ${estadoTransferenciaSegundoPlano.exitosos} exitosos, ${estadoTransferenciaSegundoPlano.errores} errores.`;
    });

    res.json({
      ok: true,
      mensaje: `Transferencia en segundo plano iniciada para ${archivosAProcesar.length} archivos.`,
      estado: estadoTransferenciaSegundoPlano,
    });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: "Error al iniciar segundo plano: " + error.message });
  }
}

// Consultar estado actual del proceso en segundo plano
function obtenerEstadoTransferenciaSegundoPlano(req, res) {
  res.json({ ok: true, estado: estadoTransferenciaSegundoPlano });
}

// Elimina un registro de auditoría por su ID
async function eliminarRegistroAuditoria(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ ok: false, mensaje: "Debe especificar el ID del registro a eliminar." });
    }

    const [resultado] = await dbPool.query("DELETE FROM `auditoria` WHERE id = ?", [id]);

    if (resultado.affectedRows === 0) {
      return res.status(404).json({ ok: false, mensaje: "El registro no fue encontrado o ya había sido eliminado." });
    }

    res.json({ ok: true, mensaje: "Registro eliminado correctamente." });
  } catch (error) {
    res.status(500).json({ ok: false, mensaje: "Error al eliminar el registro: " + error.message });
  }
}

module.exports = {
  inicializarPool,
  registrarAuditoria,
  subirPdf,
  obtenerRegistros,
  obtenerOpcionesFiltrosRegistros,
  eliminarRegistroAuditoria,
  escanearDirectorio,
  importarArchivoPdf,
  obtenerNotables: obtenerNotariasLocales, // mantiene el alias si existía
  obtenerNotariasLocales,
  sincronizarAstronmx,
  sincronizarAstronmxSilencioso,
  obtenerPcsUnicas,
  repararPaginasIncompletas,
  migrarHistorico,
  asignarPdfs,
  obtenerPdfsParaAsignar,
  obtenerVolumenesPendientesAsignacion,
  obtenerPdfsLoteDirecto,
  iniciarTransferenciaSegundoPlano,
  obtenerEstadoTransferenciaSegundoPlano,
};
