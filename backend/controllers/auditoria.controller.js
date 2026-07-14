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
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
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
          ahora,
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
    res
      .status(500)
      .json({
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

    // Si es una simulación fake de Electron (no tiene req.file.destination)
    if (!req.file.destination) {
      // Asegurar que el directorio destino exista
      if (!fs.existsSync(carpetaDestinoFinal)) {
        fs.mkdirSync(carpetaDestinoFinal, { recursive: true });
      }

      // Copiar el archivo original local al almacenamiento de ssdirec (NUNCA mover ni eliminar el original)
      if (rutaCompletaTemporal !== rutaDestinoArchivo) {
        fs.copyFileSync(rutaCompletaTemporal, rutaDestinoArchivo);
      }
      rutaFinalArchivo = rutaDestinoArchivo;
    } else {
      // Si es una subida multipart real de Multer, Multer ya guardó el archivo en req.file.path
      rutaFinalArchivo = rutaCompletaTemporal;
    }

    // Contar páginas de forma asíncrona sobre el archivo en su ruta final
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
      // Si el registro no existe en MySQL, lo insertamos
      const sqlInsert = `
                INSERT INTO \`auditoria\` 
                (fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, detalles, paginas, exportado, exportado_en, lugar_trabajo, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
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
        ahora,
        "IREC",
        ahora,
        ahora,
      ];
      await dbPool.query(sqlInsert, paramsInsert);
    }

    // Si la importación fue exitosa y proviene de la simulación de Electron, eliminamos el archivo local de origen (cortar)
    if (!req.file.destination && fs.existsSync(rutaCompletaTemporal)) {
      try {
        fs.unlinkSync(rutaCompletaTemporal);
      } catch (errUnlink) {
        console.warn(
          "No se pudo eliminar el archivo origen local en la simulación:",
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
    res
      .status(500)
      .json({
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
    res
      .status(500)
      .json({
        ok: false,
        mensaje: "Error al consultar registros: " + error.message,
      });
  }
}

// Obtiene el listado de carpetas que representan notarias en C:\NOTARIAS
async function obtenerNotariasLocales(req, res) {
  try {
    const rutaBase = "C:\\NOTARIAS";
    if (!fs.existsSync(rutaBase)) {
      return res.json({ ok: true, notarias: [] });
    }

    const items = fs.readdirSync(rutaBase);
    const arbolNotarias = [];

    items.forEach((item) => {
      const rutaNotaria = path.join(rutaBase, item);
      try {
        const stat = fs.statSync(rutaNotaria);
        if (stat.isDirectory() && item.toUpperCase().startsWith("NOTARIA")) {
          // Leer las subcarpetas (volúmenes o lotes) de esta notaría
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
            volumenes: volumenes
          });
        }
      } catch (e) {
        // Ignorar carpetas individuales con problemas de lectura
      }
    });

    res.json({ ok: true, notarias: arbolNotarias });
  } catch (error) {
    res
      .status(500)
      .json({
        ok: false,
        mensaje: "Error al listar notarias: " + error.message,
      });
  }
}

// Escanea recursivamente los PDFs de una notaria seleccionada en C:\NOTARIAS\<notaria>
async function escanearDirectorio(req, res) {
  try {
    const { notariaSeleccionada } = req.body;
    if (!notariaSeleccionada) {
      return res
        .status(400)
        .json({
          ok: false,
          mensaje: "Debe especificar la notaría a escanear.",
        });
    }

    const rutaDirectorio = path.join("C:\\NOTARIAS", notariaSeleccionada);

    if (!fs.existsSync(rutaDirectorio)) {
      return res
        .status(400)
        .json({
          ok: false,
          mensaje: `La ruta de la notaría no existe en el disco local: ${rutaDirectorio}`,
        });
    }

    const archivosPdf = [];
    obtenerPdfsRecursivo(rutaDirectorio, archivosPdf);

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
      const [rows] = await dbPool.query(
        'SELECT id, paginas FROM `auditoria` WHERE archivo = ? AND notaria = ? AND (volumen = ? OR (volumen IS NULL AND ? = "SIN VOLUMEN")) LIMIT 1',
        [archivo, notaria, volumen, volumen],
      );

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
    res
      .status(500)
      .json({
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
      return res
        .status(400)
        .json({
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

    // Si el archivo es menor a 500 MB, simular y procesar a través de la tubería del endpoint de subida (subirPdf)
    if (tamanioMb < 500) {
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

    // Para archivos de más de 500 MB: Omitir endpoint de subida (evita out-of-memory) y hacer copia directa y registro
    const [rows] = await dbPool.query(
      'SELECT id, paginas FROM `auditoria` WHERE archivo = ? AND notaria = ? AND (volumen = ? OR (volumen IS NULL AND ? = "SIN VOLUMEN")) LIMIT 1',
      [archivo, notaria, volumen, volumen],
    );

    const existeRegistro = rows.length > 0;
    const tipoCaptura = (req.body.tipo_captura || "NOTARIAS").toUpperCase();
    const baseDestino = process.env.RUTA_SSDIREC || "\\\\172.40.5.84\\ssdirec";
    const subcarpeta =
      volumen && volumen !== "SIN VOLUMEN"
        ? path.join(tipoCaptura, notaria, volumen)
        : path.join(tipoCaptura, notaria);
    const carpetaDestinoFinal = path.join(baseDestino, subcarpeta);
    const rutaDestinoArchivo = path.join(carpetaDestinoFinal, archivo);

    if (existeRegistro) {
      const registroId = rows[0].id;
      const paginasRegistradas = rows[0].paginas || 0;

      if (paginasRegistradas <= 1) {
        const paginasReales = await contarPaginasPdf(rutaCompleta);
        await dbPool.query(
          "UPDATE `auditoria` SET paginas = ?, updated_at = NOW() WHERE id = ?",
          [paginasReales, registroId],
        );

        if (!fs.existsSync(carpetaDestinoFinal)) {
          fs.mkdirSync(carpetaDestinoFinal, { recursive: true });
        }
        if (rutaCompleta !== rutaDestinoArchivo) {
          fs.copyFileSync(rutaCompleta, rutaDestinoArchivo);
        }

        // Eliminar el archivo local de origen (cortar) tras copiarlo y registrarlo con éxito
        if (fs.existsSync(rutaCompleta)) {
          try {
            fs.unlinkSync(rutaCompleta);
          } catch (errUnlink) {
            console.warn(
              "No se pudo eliminar el archivo original pesado tras actualizar:",
              errUnlink.message,
            );
          }
        }

        return res.json({
          ok: true,
          mensaje: `Archivo pesado copiado directamente. Registro existente actualizado de ${paginasRegistradas} a ${paginasReales} páginas.`,
          paginas: paginasReales,
          accion: "actualizado",
        });
      } else {
        if (rutaCompleta !== rutaDestinoArchivo) {
          if (!fs.existsSync(carpetaDestinoFinal)) {
            fs.mkdirSync(carpetaDestinoFinal, { recursive: true });
          }
          if (!fs.existsSync(rutaDestinoArchivo)) {
            fs.copyFileSync(rutaCompleta, rutaDestinoArchivo);
          }
        }

        // Si ya existe correcto, lo removemos de origen para no dejar duplicados
        if (fs.existsSync(rutaCompleta)) {
          try {
            fs.unlinkSync(rutaCompleta);
          } catch (errUnlink) {
            console.warn(
              "No se pudo eliminar el archivo original pesado ya existente:",
              errUnlink.message,
            );
          }
        }

        return res.json({
          ok: true,
          mensaje: "El registro pesado ya existe con páginas válidas.",
          paginas: paginasRegistradas,
          accion: "omitido",
        });
      }
    }

    // 2. Si no existe, se procede al registro normal
    if (!fs.existsSync(carpetaDestinoFinal)) {
      fs.mkdirSync(carpetaDestinoFinal, { recursive: true });
    }

    if (rutaCompleta !== rutaDestinoArchivo) {
      fs.copyFileSync(rutaCompleta, rutaDestinoArchivo);
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

    // Eliminar el archivo local de origen (cortar) tras copiarlo y registrarlo con éxito en MySQL
    if (fs.existsSync(rutaCompleta)) {
      try {
        fs.unlinkSync(rutaCompleta);
      } catch (errUnlink) {
        console.warn(
          "No se pudo eliminar el archivo original pesado tras registrar:",
          errUnlink.message,
        );
      }
    }

    res.json({
      ok: true,
      mensaje: `Archivo ${archivo} importado y registrado correctamente.`,
      paginas,
      accion: "registrado",
    });
  } catch (error) {
    res
      .status(500)
      .json({
        ok: false,
        mensaje: `Error al importar archivo: ${error.message}`,
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

// Extrae notaría y volumen imitando el comportamiento del cliente C#
function extraerNotariaYVolumenDeRuta(rutaArchivo) {
  const segmentos = rutaArchivo.split(path.sep);
  let indiceNotaria = -1;
  for (let i = 0; i < segmentos.length; i++) {
    if (
      segmentos[i].toUpperCase().startsWith("NOTARIA") &&
      !segmentos[i].toUpperCase().startsWith("NOTARIAS")
    ) {
      indiceNotaria = i;
      break;
    }
  }

  let notaria = "General";
  let volumen = "SIN VOLUMEN";

  if (indiceNotaria !== -1) {
    notaria = segmentos[indiceNotaria].trim();
    if (indiceNotaria + 1 < segmentos.length - 1) {
      const sgte = segmentos[indiceNotaria + 1];
      if (
        sgte.toUpperCase().startsWith("VOLUMEN") ||
        sgte.toUpperCase().startsWith("LOTE")
      ) {
        volumen = sgte.trim();
      }
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
    res
      .status(500)
      .json({
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

module.exports = {
  inicializarPool,
  registrarAuditoria,
  subirPdf,
  obtenerRegistros,
  escanearDirectorio,
  importarArchivoPdf,
  obtenerNotariasLocales,
  sincronizarAstronmx,
  sincronizarAstronmxSilencioso,
};
