/**
 * Controlador de Estadísticas (estadisticas.controller.js).
 * Procesa la información de productividad por notarias, lotes y rendimiento diario por usuario.
 */

const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

let dbPool = null;

// Helper para obtener la fecha natural del registro sin desplazamientos de horario y asignar turno único General
function resolverFechaYTurnoDeJornada(fechaHoraStr) {
  let fechaStr = "";

  if (fechaHoraStr instanceof Date) {
    const a = fechaHoraStr.getFullYear();
    const m = String(fechaHoraStr.getMonth() + 1).padStart(2, "0");
    const d = String(fechaHoraStr.getDate()).padStart(2, "0");
    fechaStr = `${a}-${m}-${d}`;
  } else if (typeof fechaHoraStr === "string") {
    // Parsear fecha natural YYYY-MM-DD
    fechaStr = fechaHoraStr.slice(0, 10);
  } else {
    const d = new Date(fechaHoraStr);
    const a = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    fechaStr = `${a}-${m}-${dia}`;
  }

  return { fechaStr, turno: "General" };
}

// Inicializa el pool de base de datos desde server.js
function inicializarPool(pool) {
  dbPool = pool;
}

// Obtiene la productividad agrupada por notaría y lote/volumen para las gráficas del Dashboard
async function obtenerProductividadGeneral(req, res) {
  try {
    const { fecha_inicio, fecha_fin } = req.query;
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debe especificar fecha_inicio y fecha_fin (formato yyyy-mm-dd).",
      });
    }

    const fechaInicioCompleta = `${fecha_inicio} 00:00:00`;
    const fechaFinCompleta = `${fecha_fin} 23:59:59`;

    // Consultamos los registros brutos en el rango de fecha/hora de jornada
    const [registros] = await dbPool.query(
      `
            SELECT 
                DATE_FORMAT(a.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora, 
                a.notaria, 
                a.volumen, 
                a.paginas, 
                a.turno,
                u.turno AS turno_usuario
            FROM \`auditoria\` a
            LEFT JOIN \`usuarios\` u ON LOWER(a.usuario) = LOWER(u.nombre_usuario)
            WHERE a.fecha_hora >= ? AND a.fecha_hora <= ?
        `,
      [fechaInicioCompleta, fechaFinCompleta],
    );

    const agrupadoNotarias = {};
    const agrupadoTurnos = {};

    registros.forEach((r) => {
      const turnoOficial = r.turno_usuario || r.turno || "Matutino";
      const { fechaStr, turno } = resolverFechaYTurnoDeJornada(r.fecha_hora, turnoOficial);
      const turnoFinal = turno || turnoOficial;
      const notaria = r.notaria || "General";
      const volumen = r.volumen || "Sin volumen";
      const paginas = parseInt(r.paginas || 0, 10);

      // 1. Agrupación por Notaria y Volumen (para la gráfica de barras)
      const claveNotaria = `${fechaStr}_${notaria.toUpperCase()}_${volumen.toUpperCase()}`;
      if (!agrupadoNotarias[claveNotaria]) {
        agrupadoNotarias[claveNotaria] = {
          fecha: fechaStr,
          notaria: notaria,
          volumen: volumen,
          total_pdfs: 0,
          total_imagenes: 0
        };
      }
      agrupadoNotarias[claveNotaria].total_pdfs += 1;
      agrupadoNotarias[claveNotaria].total_imagenes += paginas;

      // 2. Agrupación por Fecha y Turno (para las gráficas de puntos)
      const claveTurno = `${fechaStr}_${turnoFinal}`;
      if (!agrupadoTurnos[claveTurno]) {
        agrupadoTurnos[claveTurno] = {
          fecha: fechaStr,
          turno: turnoFinal,
          total_pdfs: 0,
          total_imagenes: 0
        };
      }
      agrupadoTurnos[claveTurno].total_pdfs += 1;
      agrupadoTurnos[claveTurno].total_imagenes += paginas;
    });

    const notarias = Object.values(agrupadoNotarias).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const turnos = Object.values(agrupadoTurnos).sort((a, b) => a.fecha.localeCompare(b.fecha));

    res.json({
      ok: true,
      notarias,
      turnos,
      digitalizacion: [], // Compatibilidad
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al consultar estadísticas: " + error.message,
    });
  }
}

// Obtiene la productividad diaria agrupada por capturista y fecha para la vista estilo Excel
async function obtenerProductividadDiaria(req, res) {
  try {
    const { fecha_inicio, fecha_fin } = req.query;
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        ok: false,
        mensaje: "Debe especificar fecha_inicio y fecha_fin (formato yyyy-mm-dd).",
      });
    }

    const limiteFinDate = new Date(fecha_fin + "T12:00:00");
    limiteFinDate.setDate(limiteFinDate.getDate() + 1);
    const anioF = limiteFinDate.getFullYear();
    const mesF = String(limiteFinDate.getMonth() + 1).padStart(2, "0");
    const diaF = String(limiteFinDate.getDate()).padStart(2, "0");
    const fechaFinMas1 = `${anioF}-${mesF}-${diaF}`;

    const fechaInicioCompleta = `${fecha_inicio} 00:00:00`;
    const fechaFinCompleta = `${fechaFinMas1} 05:59:59`;

    const [registros] = await dbPool.query(
      `
            SELECT 
                DATE_FORMAT(COALESCE(a.created_at, a.fecha_hora), '%Y-%m-%d %H:%i:%s') AS fecha_hora, 
                a.usuario, 
                a.notaria,
                a.volumen,
                a.archivo,
                a.paginas, 
                a.turno,
                u.turno AS turno_usuario
            FROM \`auditoria\` a
            LEFT JOIN \`usuarios\` u ON LOWER(a.usuario) = LOWER(u.nombre_usuario)
            WHERE COALESCE(a.created_at, a.fecha_hora) >= ? AND COALESCE(a.created_at, a.fecha_hora) <= ?
              AND a.usuario IS NOT NULL AND a.usuario != '' AND a.usuario != 'Desconocido'
        `,
      [fechaInicioCompleta, fechaFinCompleta],
    );

    // Deduplicar registros por usuario, notaria, volumen, archivo y fecha para no eliminar archivos distintos del mismo usuario
    const deduplicadosMap = {};
    registros.forEach((r) => {
      if (!r.usuario || r.usuario === "Desconocido") return;
      const userNorm = r.usuario.trim().toLowerCase();
      const notariaNorm = (r.notaria || "").trim().toLowerCase();
      const volNorm = (r.volumen || "").trim().toLowerCase();
      const archNorm = (r.archivo || "").trim().toLowerCase();
      const fechaNorm = r.fecha_hora.slice(0, 10);

      const claveUnicaArch = `${userNorm}_${notariaNorm}_${volNorm}_${archNorm}_${fechaNorm}`;
      if (!deduplicadosMap[claveUnicaArch]) {
        deduplicadosMap[claveUnicaArch] = r;
      }
    });

    const registrosDeduplicados = Object.values(deduplicadosMap);
    const agrupadoDiario = {};

    registrosDeduplicados.forEach((r) => {
      const turnoOficial = r.turno_usuario || r.turno;
      const { fechaStr, turno: turnoCalculado } = resolverFechaYTurnoDeJornada(r.fecha_hora, turnoOficial);
      const turnoFinal = turnoCalculado || "Matutino";
      const usuarioNorm = r.usuario.trim();
      const paginas = parseInt(r.paginas || 0, 10);

      const clave = `${fechaStr}_${usuarioNorm.toUpperCase()}_${turnoFinal}`;
      if (!agrupadoDiario[clave]) {
        agrupadoDiario[clave] = {
          fecha: fechaStr,
          usuario: usuarioNorm,
          turno: turnoFinal,
          total_pdfs: 0,
          total_paginas: 0
        };
      }
      agrupadoDiario[clave].total_pdfs += 1;
      agrupadoDiario[clave].total_paginas += paginas;
    });

    const productividad = Object.values(agrupadoDiario).sort((a, b) => {
      if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha); // Más reciente primero
      if (a.usuario !== b.usuario) return a.usuario.localeCompare(b.usuario);
      return a.turno.localeCompare(b.turno);
    });

    res.json({
      ok: true,
      productividad,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      mensaje: "Error al consultar productividad diaria: " + error.message,
    });
  }
}

// Genera un archivo Excel premium coloreado por turno y agrupado por fecha y lo abre automáticamente
async function exportarExcelAuditoria(req, res) {
  try {
    const { fecha_inicio, fecha_fin, tipo } = req.query;
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        ok: false,
        mensaje:
          "Debe especificar fecha_inicio y fecha_fin (formato yyyy-mm-dd).",
      });
    }

    const fechaInicioCompleta = `${fecha_inicio} 00:00:00`;
    const fechaFinCompleta = `${fecha_fin} 23:59:59`;

    // Consultar todos los registros en el rango estricto basándonos en fecha de registro
    const [registros] = await dbPool.query(
      `
            SELECT 
                a.id, 
                DATE_FORMAT(COALESCE(a.created_at, a.fecha_hora), '%Y-%m-%d %H:%i:%s') AS fecha_hora, 
                a.created_at,
                a.turno, 
                u.turno AS turno_usuario,
                COALESCE(u.nombre_usuario, LOWER(a.usuario)) AS usuario, 
                COALESCE(u.nombre_completo, UPPER(a.usuario)) AS nombre_completo,
                a.pc, 
                a.ip, 
                a.notaria, 
                a.volumen, 
                a.archivo, 
                a.paginas, 
                a.exportado, 
                a.lugar_trabajo 
            FROM \`auditoria\` a
            LEFT JOIN \`usuarios\` u ON LOWER(a.usuario) = LOWER(u.nombre_usuario)
            WHERE COALESCE(a.created_at, a.fecha_hora) >= ? AND COALESCE(a.created_at, a.fecha_hora) <= ?
              AND a.usuario IS NOT NULL AND a.usuario != '' AND a.usuario != 'Desconocido'
        `,
      [fechaInicioCompleta, fechaFinCompleta],
    );

    if (registros.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: "No hay datos para exportar en este rango.",
      });
    }

    // 1. Agrupar por Fecha sin descartar ningún registro
    const registrosPorFecha = {};
    registros.forEach((reg) => {
      const turnoOficial = reg.turno_usuario || reg.turno;
      let { fechaStr, turno } = resolverFechaYTurnoDeJornada(reg.fecha_hora, turnoOficial);

      // Si la fecha pertenece a las fechas consultadas por el usuario
      if (fechaStr < fecha_inicio || fechaStr > fecha_fin) {
        return;
      }

      const turnoFinal = turno || "Matutino";
      reg.fecha_calculada = fechaStr;
      reg.turno_calculado = turnoFinal;

      if (!registrosPorFecha[fechaStr]) {
        registrosPorFecha[fechaStr] = [];
      }
      registrosPorFecha[fechaStr].push(reg);
    });

    // 2. Deduplicar registros por usuario, notaria, volumen y archivo original por cada fecha
    const registrosDeduplicados = [];
    Object.keys(registrosPorFecha).forEach((fechaStr) => {
      const grupoFecha = registrosPorFecha[fechaStr];
      const grupoArchivos = {};

      grupoFecha.forEach((reg) => {
        const userNorm = (reg.usuario || "desconocido").toLowerCase().trim();
        const notariaNorm = (reg.notaria || "desconocido").toLowerCase().trim();
        const volNorm = (reg.volumen || "desconocido").toLowerCase().trim();
        const archNorm = (reg.archivo || "desconocido").toLowerCase().trim();

        const claveUnica = `${userNorm}_${notariaNorm}_${volNorm}_${archNorm}`;
        if (!grupoArchivos[claveUnica]) {
          grupoArchivos[claveUnica] = [];
        }
        grupoArchivos[claveUnica].push(reg);
      });

      Object.keys(grupoArchivos).forEach((claveUnica) => {
        const grupo = grupoArchivos[claveUnica];
        if (grupo.length === 1) {
          registrosDeduplicados.push(grupo[0]);
        } else {
          let seleccionado = null;
          const regMuestra = grupo[0];
          const nombreArchivo = (regMuestra.archivo || "").toLowerCase();
          const coincidenciaPc = nombreArchivo.match(/^pc(\d+)/i);

          if (coincidenciaPc) {
            const prefijoPC = coincidenciaPc[0].toUpperCase();
            seleccionado = grupo.find((r) => {
              if (!r.pc) return false;
              const pcNormalizada = r.pc.replace(/[- ]/g, "").toUpperCase();
              return (
                pcNormalizada === prefijoPC ||
                pcNormalizada.includes(prefijoPC) ||
                prefijoPC.includes(pcNormalizada)
              );
            });
          }

          if (!seleccionado) {
            seleccionado = grupo.sort(
              (a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora),
            )[0];
          }

          const maximoPaginas = Math.max(...grupo.map((r) => r.paginas || 0));
          if (maximoPaginas > (seleccionado.paginas || 0)) {
            seleccionado.paginas = maximoPaginas;
          }

          registrosDeduplicados.push(seleccionado);
        }
      });
    });

    // 3. Si se solicita formato concentrado, generar el reporte matricial en una sola hoja
    if (tipo === "concentrado") {
      const fechasOrdenadas = [...new Set(registrosDeduplicados.map((r) => r.fecha_calculada))]
        .filter((f) => f >= fecha_inicio && f <= fecha_fin)
        .sort((a, b) => new Date(a) - new Date(b));

      const mapaGeneral = {};
      registrosDeduplicados.forEach((reg) => {
        const fecha = reg.fecha_calculada;
        if (fecha < fecha_inicio || fecha > fecha_fin) return;

        const nombreKey = (reg.nombre_completo || reg.usuario || "DESCONOCIDO").toUpperCase();
        // Usar la hora real del reloj de la captura para el turno del reporte
        const turnoOficial = (reg.turno_calculado || "Matutino").toUpperCase();

        if (!mapaGeneral[nombreKey]) {
          mapaGeneral[nombreKey] = {
            nombre: nombreKey,
            turno: turnoOficial,
            capturasPorFecha: {}, // fechaStr -> { pdfs, imagenes }
          };
        }
        if (!mapaGeneral[nombreKey].capturasPorFecha[fecha]) {
          mapaGeneral[nombreKey].capturasPorFecha[fecha] = { pdfs: 0, imagenes: 0 };
        }
        mapaGeneral[nombreKey].capturasPorFecha[fecha].pdfs += 1;
        mapaGeneral[nombreKey].capturasPorFecha[fecha].imagenes += reg.paginas > 0 ? reg.paginas : 1;
      });

      const capturistasYTurnos = Object.values(mapaGeneral).sort((a, b) => {
        const turnosOrden = { MATUTINO: 1, VESPERTINO: 2, NOCTURNO: 3 };
        const ordenA = turnosOrden[a.turno] || 4;
        const ordenB = turnosOrden[b.turno] || 4;

        if (ordenA !== ordenB) {
          return ordenA - ordenB; // Agrupar por bloques de turno: Matutino, luego Vespertino, al final Nocturno
        }
        return a.nombre.localeCompare(b.nombre); // Alfabéticamente dentro del mismo turno
      });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Concentrado General");

      // Pintar y dar formato a todas las celdas de la cabecera (Filas 1 y 2) antes de combinarlas
      const totalColumnas = 3 + fechasOrdenadas.length * 2 + 1;
      for (let r = 1; r <= 2; r++) {
        const row = worksheet.getRow(r);
        row.height = r === 1 ? 25 : 20;
        for (let c = 1; c <= totalColumnas; c++) {
          const cell = row.getCell(c);
          cell.font = { name: "Outfit", bold: true, size: 10, color: { argb: "FFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "4F81BD" },
          };
          cell.border = {
            top: { style: "thin", color: { argb: "D9D9D9" } },
            left: { style: "thin", color: { argb: "D9D9D9" } },
            bottom: { style: "thin", color: { argb: "D9D9D9" } },
            right: { style: "thin", color: { argb: "D9D9D9" } },
          };
          cell.alignment = { vertical: "middle", horizontal: "center" };
        }
      }

      // Combinar columnas estáticas de la cabecera
      worksheet.mergeCells("A1:A2");
      worksheet.getRow(1).getCell(1).value = "NOMBRE";
      worksheet.mergeCells("B1:B2");
      worksheet.getRow(1).getCell(2).value = "TURNO";

      // Combinar e inyectar cabeceras de fechas
      fechasOrdenadas.forEach((fecha, i) => {
        const colInicio = 3 + i * 2;
        const colFin = 3 + i * 2 + 1;
        worksheet.mergeCells(1, colInicio, 1, colFin);

        const partesFecha = fecha.split("-");
        const fechaFormateada = `${partesFecha[2]}/${partesFecha[1]}/${partesFecha[0]}`;
        worksheet.getRow(1).getCell(colInicio).value = fechaFormateada;
        worksheet.getRow(2).getCell(colInicio).value = "PDFS";
        worksheet.getRow(2).getCell(colFin).value = "IMÁGENES";
      });

      // Combinar e inyectar cabeceras de Total General al final
      const colInicioTotal = 3 + fechasOrdenadas.length * 2;
      const colFinTotal = 3 + fechasOrdenadas.length * 2 + 1;
      worksheet.mergeCells(1, colInicioTotal, 1, colFinTotal);
      worksheet.getRow(1).getCell(colInicioTotal).value = "TOTAL GENERAL";
      worksheet.getRow(2).getCell(colInicioTotal).value = "PDFS";
      worksheet.getRow(2).getCell(colFinTotal).value = "IMÁGENES";

      // Configurar anchos de columna
      worksheet.getColumn(1).width = 32;
      worksheet.getColumn(2).width = 15;
      for (let col = 3; col <= totalColumnas; col++) {
        worksheet.getColumn(col).width = 12;
      }

      // Escribir registros de capturistas
      capturistasYTurnos.forEach((fila, idx) => {
        const rowData = [];
        rowData[1] = fila.nombre;
        rowData[2] = fila.turno;

        let sumPdfs = 0;
        let sumImagenes = 0;

        fechasOrdenadas.forEach((fecha, i) => {
          const colInicio = 3 + i * 2;
          const colFin = 3 + i * 2 + 1;
          const datosDia = fila.capturasPorFecha[fecha];

          if (datosDia) {
            rowData[colInicio] = datosDia.pdfs;
            rowData[colFin] = datosDia.imagenes;
            sumPdfs += datosDia.pdfs;
            sumImagenes += datosDia.imagenes;
          } else {
            rowData[colInicio] = "";
            rowData[colFin] = "";
          }
        });

        // Escribir los totales al final de la fila
        rowData[colInicioTotal] = sumPdfs;
        rowData[colFinTotal] = sumImagenes;

        const row = worksheet.addRow(rowData);
        row.height = 20;

        // Definir color de fondo según el turno
        let colorHex = "F2F2F2";
        const turnoLower = fila.turno.toLowerCase();
        if (turnoLower === "matutino") {
          colorHex = "FFF2CC"; // Amarillo pastel
        } else if (turnoLower === "vespertino") {
          colorHex = "E2EFDA"; // Verde pastel
        } else if (turnoLower === "nocturno") {
          colorHex = "DDEBF7"; // Azul pastel
        }

        // Estilos para todas las celdas de la fila de datos
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          cell.font = { name: "Inter", size: 10 };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: colorHex },
          };
          cell.border = {
            top: { style: "thin", color: { argb: "D9D9D9" } },
            left: { style: "thin", color: { argb: "D9D9D9" } },
            bottom: { style: "thin", color: { argb: "D9D9D9" } },
            right: { style: "thin", color: { argb: "D9D9D9" } },
          };

          if (colNum === 1) {
            cell.alignment = { vertical: "middle", horizontal: "left" };
          } else if (colNum === 2) {
            cell.alignment = { vertical: "middle", horizontal: "center" };
          } else {
            cell.alignment = { vertical: "middle", horizontal: "center" };
          }
        });
      });

      // Generar nombre de archivo con timestamp e idUnico anti-bloqueo EBUSY
      const ahora = new Date();
      const anio = ahora.getFullYear();
      const mes = String(ahora.getMonth() + 1).padStart(2, "0");
      const dia = String(ahora.getDate()).padStart(2, "0");
      const hora = String(ahora.getHours()).padStart(2, "0");
      const min = String(ahora.getMinutes()).padStart(2, "0");
      const seg = String(ahora.getSeconds()).padStart(2, "0");
      const idUnico = Date.now().toString().slice(-5);
      let nombreArchivo = `Reporte_Concentrado_Auditoria_${anio}${mes}${dia}_${hora}${min}${seg}_${idUnico}.xlsx`;

      const carpetaDescargas = path.join(
        process.env.USERPROFILE || process.env.HOME || "C:\\",
        "Downloads",
      );
      let rutaCompleta = path.join(carpetaDescargas, nombreArchivo);

      try {
        await workbook.xlsx.writeFile(rutaCompleta);
      } catch (errWrite) {
        // Manejo anti-bloqueo EBUSY en Windows
        const timestampAlt = Date.now().toString().slice(-4);
        nombreArchivo = `Reporte_Concentrado_Auditoria_${anio}${mes}${dia}_${hora}${min}${seg}_${timestampAlt}.xlsx`;
        rutaCompleta = path.join(carpetaDescargas, nombreArchivo);
        await workbook.xlsx.writeFile(rutaCompleta);
      }

      // Abrir archivo automáticamente en Windows mediante cmd.exe o PowerShell
      exec(`cmd.exe /c start "" "${rutaCompleta}"`, (err) => {
        if (err) {
          exec(`powershell.exe -Command "Start-Process '${rutaCompleta}'"`);
        }
      });

      return res.json({
        ok: true,
        mensaje: "Reporte Excel generado y abierto correctamente.",
        ruta: rutaCompleta,
      });
    }

    // 4. Agrupar por Fecha -> Usuario (Para el formato Detallado por pestañas)
    const registrosAgrupados = {};
    registrosDeduplicados.forEach((reg) => {
      const fecha = reg.fecha_calculada;

      if (!registrosAgrupados[fecha]) {
        registrosAgrupados[fecha] = {};
      }

      const usuario = (reg.usuario || "Desconocido").trim();
      const turno = "General";

      const claveFila = usuario.toLowerCase();
      if (!registrosAgrupados[fecha][claveFila]) {
        registrosAgrupados[fecha][claveFila] = {
          usuario: usuario,
          turno: turno,
          registros: [],
        };
      }

      registrosAgrupados[fecha][claveFila].registros.push(reg);
    });

    // Crear Libro de Excel
    const workbook = new ExcelJS.Workbook();
    const fechasOrdenadas = Object.keys(registrosAgrupados).sort(
      (a, b) => new Date(b) - new Date(a),
    );

    fechasOrdenadas.forEach((fecha) => {
      const sheetName = fecha.replace(/-/g, "_").slice(0, 31);
      const worksheet = workbook.addWorksheet(sheetName);

      // Columnas y Cabeceras
      worksheet.columns = [
        { header: "Capturista / Usuario", key: "usuario", width: 28 },
        { header: "Turno", key: "turno", width: 15 },
        { header: "Capturas (PDFs)", key: "pdfs", width: 18 },
        { header: "Total de Imágenes (Páginas)", key: "paginas", width: 25 },
      ];

      // Estilos para cabeceras
      worksheet.getRow(1).eachCell((cell) => {
        cell.font = { name: "Outfit", bold: true, color: { argb: "FFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "4F81BD" },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
          top: { style: "thin", color: { argb: "D9D9D9" } },
          left: { style: "thin", color: { argb: "D9D9D9" } },
          bottom: { style: "thin", color: { argb: "D9D9D9" } },
          right: { style: "thin", color: { argb: "D9D9D9" } },
        };
      });
      worksheet.getRow(1).height = 25;

      // Filas consolidadas ordenadas alfabéticamente por Usuario
      const filasDeLaFecha = Object.values(registrosAgrupados[fecha]);
      filasDeLaFecha.sort((a, b) => a.usuario.localeCompare(b.usuario));

      filasDeLaFecha.forEach((item) => {
        const totalPdfs = item.registros.length;
        const totalPaginas = item.registros.reduce(
          (sum, r) => sum + (parseInt(r.paginas || 0, 10) > 0 ? parseInt(r.paginas, 10) : 1),
          0,
        );

        const row = worksheet.addRow({
          usuario: item.usuario,
          turno: "General",
          pdfs: totalPdfs,
          paginas: totalPaginas,
        });

        row.height = 20;
        row.eachCell((cell, colNum) => {
          cell.font = { name: "Inter", size: 10 };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFFF" },
          };
          cell.border = {
            top: { style: "thin", color: { argb: "D9D9D9" } },
            left: { style: "thin", color: { argb: "D9D9D9" } },
            bottom: { style: "thin", color: { argb: "D9D9D9" } },
            right: { style: "thin", color: { argb: "D9D9D9" } },
          };

          if (colNum === 1) {
            cell.alignment = { vertical: "middle", horizontal: "left" };
          } else {
            cell.alignment = { vertical: "middle", horizontal: "center" };
          }
        });
      });
    });

    // Nombre de archivo con marca de tiempo: Reporte_Diario_Auditoria_YYYYMMDD_HHMM.xlsx
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, "0");
    const dia = String(ahora.getDate()).padStart(2, "0");
    const hora = String(ahora.getHours()).padStart(2, "0");
    const min = String(ahora.getMinutes()).padStart(2, "0");
    const seg = String(ahora.getSeconds()).padStart(2, "0");
    const idUnico = Date.now().toString().slice(-5);
    let nombreArchivo = `Reporte_Diario_Auditoria_${anio}${mes}${dia}_${hora}${min}${seg}_${idUnico}.xlsx`;

    const carpetaDescargas = path.join(
      process.env.USERPROFILE || process.env.HOME || "C:\\",
      "Downloads",
    );
    let rutaCompleta = path.join(carpetaDescargas, nombreArchivo);

    try {
      await workbook.xlsx.writeFile(rutaCompleta);
    } catch (errWrite) {
      const timestampAlt = Date.now().toString().slice(-4);
      nombreArchivo = `Reporte_Diario_Auditoria_${anio}${mes}${dia}_${hora}${min}${seg}_${timestampAlt}.xlsx`;
      rutaCompleta = path.join(carpetaDescargas, nombreArchivo);
      await workbook.xlsx.writeFile(rutaCompleta);
    }

    // Abrir automáticamente el archivo en Windows mediante cmd.exe o PowerShell
    exec(`cmd.exe /c start "" "${rutaCompleta}"`, (err) => {
      if (err) {
        exec(`powershell.exe -Command "Start-Process '${rutaCompleta}'"`);
      }
    });

    return res.json({
      ok: true,
      mensaje: "Reporte Excel generado y abierto correctamente.",
      ruta: rutaCompleta,
    });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, mensaje: "Error al generar Excel: " + error.message });
  }
}

module.exports = {
  inicializarPool,
  obtenerProductividadGeneral,
  obtenerProductividadDiaria,
  exportarExcelAuditoria,
};
