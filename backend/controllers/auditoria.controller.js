/**
 * Controlador de Auditoría (auditoria.controller.js).
 * Gestiona el registro de auditorías, conteo de páginas de PDFs y listado de registros.
 */

const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

let dbPool = null;

// Inicializa el pool de base de datos desde server.js
function inicializarPool(pool) {
  dbPool = pool;
}

// Función auxiliar para obtener el total de páginas de un PDF de forma asíncrona
async function contarPaginasPdf(rutaCompleta) {
  try {
    if (!fs.existsSync(rutaCompleta)) return 0;

    const stat = fs.statSync(rutaCompleta);
    const tamanio = stat.size;

    // Leer primeros 100 KB
    const fd = fs.openSync(rutaCompleta, "r");
    const bufferInicio = Buffer.alloc(Math.min(102400, tamanio));
    fs.readSync(fd, bufferInicio, 0, bufferInicio.length, 0);

    // Leer últimos 100 KB
    const bufferFin = Buffer.alloc(Math.min(102400, tamanio));
    const posicionInicioFin = Math.max(0, tamanio - bufferFin.length);
    fs.readSync(fd, bufferFin, 0, bufferFin.length, posicionInicioFin);
    fs.closeSync(fd);

    // Buscar /Count en el contenido de inicio
    const contenidoInicio = bufferInicio.toString("ascii");
    let matches = contenidoInicio.match(/\/Count\s+(\d+)/);
    if (matches && matches[1]) {
      return parseInt(matches[1], 10);
    }

    // Buscar /Count en el contenido de fin
    const contenidoFin = bufferFin.toString("ascii");
    matches = contenidoFin.match(/\/Count\s+(\d+)/);
    if (matches && matches[1]) {
      return parseInt(matches[1], 10);
    }

    // Fallback: solo si es un archivo liviano (< 15 MB) usar pdf-lib
    if (tamanio < 15 * 1024 * 1024) {
      const pdfBytes = fs.readFileSync(rutaCompleta);
      const pdfDoc = await PDFDocument.load(pdfBytes, {
        ignoreEncryption: true,
      });
      return pdfDoc.getPageCount();
    }

    return 0;
  } catch (e) {
    console.warn("Aviso al contar páginas de forma optimizada:", e.message);
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

    // Asegurar que el directorio de destino exista de forma asíncrona
    if (!fs.existsSync(carpetaDestinoFinal)) {
      await fs.promises.mkdir(carpetaDestinoFinal, { recursive: true });
    }

    // Copiar de forma asíncrona para liberar por completo el Event Loop de Node.js
    if (rutaCompletaTemporal !== rutaDestinoArchivo) {
      await fs.promises.copyFile(rutaCompletaTemporal, rutaDestinoArchivo);
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
        req.body.usuario || "Administrador",
        req.body.pc || "SERVIDOR-CENTRAL",
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
    res.status(500).json({
      ok: false,
      mensaje: "Error al consultar registros: " + error.message,
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

// Copia, calcula páginas y registra o actualiza registros existentes
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

    // Obtener tamaño para delegar o hacer copia directa
    const statObj = fs.statSync(rutaCompleta);
    const tamanioMb = statObj.size / (1024 * 1024);

    // Si el archivo es menor a 200 MB, simular y procesar a través de la tubería del endpoint de subida (subirPdf)
    if (tamanioMb < 200) {
      // Creamos un req fake que emule el objeto req.file de multer
      const reqFake = {
        file: {
          originalname: archivo,
          path: rutaCompleta, // Le pasamos la ruta origen directamente para que subirPdf la mueva a ssdirec
          size: statObj.size,
        },
        body: {
          notaria,
          volumen,
          usuario,
          turno,
          pc,
        },
      };
      return await subirPdf(reqFake, res);
    }

    // Para archivos de más de 200 MB: Copiar de forma asíncrona a red y registrar
    const tipoCaptura = (req.body.tipo_captura || "NOTARIAS").toUpperCase();
    const baseDestino = process.env.RUTA_SSDIREC || "\\\\172.40.5.84\\ssdirec";
    const subcarpeta =
      volumen && volumen !== "SIN VOLUMEN"
        ? path.join(tipoCaptura, notaria, volumen)
        : path.join(tipoCaptura, notaria);
    const carpetaDestinoFinal = path.join(baseDestino, subcarpeta);
    const rutaDestinoArchivo = path.join(carpetaDestinoFinal, archivo);

    const [rows] = await dbPool.query(
      'SELECT id, paginas FROM `auditoria` WHERE archivo = ? AND notaria = ? AND (volumen = ? OR (volumen IS NULL AND ? = "SIN VOLUMEN")) LIMIT 1',
      [archivo, notaria, volumen, volumen],
    );

    const existeRegistro = rows.length > 0;

    if (existeRegistro) {
      const registroId = rows[0].id;
      const paginasRegistradas = rows[0].paginas || 0;

      if (paginasRegistradas <= 1) {
        const paginasReales = await contarPaginasPdf(rutaCompleta);
        await dbPool.query(
          "UPDATE `auditoria` SET paginas = ?, updated_at = NOW() WHERE id = ?",
          [paginasReales, registroId],
        );

        // Copiar asíncronamente a red
        if (!fs.existsSync(carpetaDestinoFinal)) {
          await fs.promises.mkdir(carpetaDestinoFinal, { recursive: true });
        }
        if (rutaCompleta !== rutaDestinoArchivo) {
          await fs.promises.copyFile(rutaCompleta, rutaDestinoArchivo);
        }

        // Borrar asíncronamente el origen local
        if (fs.existsSync(rutaCompleta)) {
          try {
            await fs.promises.unlink(rutaCompleta);
          } catch (errUnlink) {
            console.warn("No se pudo eliminar el original pesado tras actualizar:", errUnlink.message);
          }
        }

        return res.json({
          ok: true,
          mensaje: `Archivo pesado copiado y registrado. Registro existente actualizado de ${paginasRegistradas} a ${paginasReales} páginas.`,
          paginas: paginasReales,
          accion: "actualizado",
        });
      } else {
        // Si ya está registrado con páginas válidas, igual asegurar copia en red
        if (!fs.existsSync(carpetaDestinoFinal)) {
          await fs.promises.mkdir(carpetaDestinoFinal, { recursive: true });
        }
        if (rutaCompleta !== rutaDestinoArchivo && !fs.existsSync(rutaDestinoArchivo)) {
          await fs.promises.copyFile(rutaCompleta, rutaDestinoArchivo);
        }

        // Eliminar original local
        if (fs.existsSync(rutaCompleta)) {
          try {
            await fs.promises.unlink(rutaCompleta);
          } catch (errUnlink) {
            console.warn("No se pudo eliminar el original pesado ya existente:", errUnlink.message);
          }
        }

        return res.json({
          ok: true,
          mensaje: "El registro pesado ya existe y fue transferido a red.",
          paginas: paginasRegistradas,
          accion: "omitido",
        });
      }
    }

    // 2. Si no existe en BD
    if (!fs.existsSync(carpetaDestinoFinal)) {
      await fs.promises.mkdir(carpetaDestinoFinal, { recursive: true });
    }
    if (rutaCompleta !== rutaDestinoArchivo) {
      await fs.promises.copyFile(rutaCompleta, rutaDestinoArchivo);
    }

    const paginas = await contarPaginasPdf(rutaDestinoArchivo);
    const ahora = new Date();
    const fechaHora = ahora.toISOString().slice(0, 19).replace("T", " ");

    const sqlInsert = `
            INSERT INTO \`auditoria\` 
            (fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, exportado, exportado_en, lugar_trabajo, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `;

    const paramsInsert = [
      fechaHora,
      turno || "Matutino",
      usuario || "Administrador",
      pc || "SERVIDOR-CENTRAL",
      "127.0.0.1",
      notaria,
      volumen === "SIN VOLUMEN" ? null : volumen,
      archivo,
      "Importado manualmente desde el panel del Administrador",
      paginas,
      ahora,
      "IREC",
      ahora,
      ahora,
    ];

    await dbPool.query(sqlInsert, paramsInsert);

    // Eliminar original local tras copiar y registrar exitosamente
    if (fs.existsSync(rutaCompleta)) {
      try {
        await fs.promises.unlink(rutaCompleta);
      } catch (errUnlink) {
        console.warn("No se pudo eliminar el original pesado tras registrar:", errUnlink.message);
      }
    }

    res.json({
      ok: true,
      mensaje: `Archivo pesado ${archivo} importado y copiado a red correctamente.`,
      paginas,
      accion: "registrado",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: `Error al importar archivo pesado: ${error.message}`,
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

module.exports = {
  inicializarPool,
  registrarAuditoria,
  subirPdf,
  obtenerRegistros,
  escanearDirectorio,
  importarArchivoPdf,
  obtenerNotables: obtenerNotariasLocales, // mantiene el alias si existía
  obtenerNotariasLocales,
  sincronizarAstronmx,
  sincronizarAstronmxSilencioso,
  obtenerPcsUnicas,
  repararPaginasIncompletas,
  migrarHistorico,
};
