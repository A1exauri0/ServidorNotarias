/**
 * Controlador de Estadísticas (estadisticas.controller.js).
 * Procesa la información de productividad por notarias, lotes y rendimiento diario por usuario.
 */

const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

let dbPool = null;

// Helper para calcular la fecha fiscal de jornada y el turno en base a los horarios y fines de semana
function resolverFechaYTurnoDeJornada(fechaHoraStr) {
  const fecha = new Date(fechaHoraStr);
  const hora = fecha.getHours();
  
  let turno = "Matutino";
  let fechaJornada = new Date(fecha);
  
  // Horarios de turnos:
  // matutino: de 6 am a 2 pm (6:00 a 13:59)
  // vespertino: de 2 pm a 10 pm (14:00 a 21:59)
  // nocturno: de 10 pm a 6 am (22:00 a 05:59 del dia siguiente)
  if (hora >= 6 && hora < 14) {
    turno = "Matutino";
  } else if (hora >= 14 && hora < 22) {
    turno = "Vespertino";
  } else {
    turno = "Nocturno";
    // Si la hora es de 00:00 a 05:59 AM, pertenece a la jornada del dia anterior
    if (hora < 6) {
      fechaJornada.setDate(fechaJornada.getDate() - 1);
    }
  }
  
  // Fines de semana: si la jornada cae en Sabado (6) o Domingo (0), se acumulan al dia Viernes anterior
  const diaSemana = fechaJornada.getDay();
  if (diaSemana === 6) {
    fechaJornada.setDate(fechaJornada.getDate() - 1);
  } else if (diaSemana === 0) {
    fechaJornada.setDate(fechaJornada.getDate() - 2);
  }
  
  const y = fechaJornada.getFullYear();
  const m = String(fechaJornada.getMonth() + 1).padStart(2, '0');
  const d = String(fechaJornada.getDate()).padStart(2, '0');
  return { fechaStr: `${y}-${m}-${d}`, turno };
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

    // Consultamos los registros brutos en el rango de fechas
    const [registros] = await dbPool.query(
      `
            SELECT fecha_hora, notaria, volumen, paginas, turno
            FROM \`auditoria\`
            WHERE DATE(fecha_hora) BETWEEN ? AND ?
        `,
      [fecha_inicio, fecha_fin],
    );

    const agrupadoNotarias = {};
    const agrupadoTurnos = {};

    registros.forEach((r) => {
      const { fechaStr, turno } = resolverFechaYTurnoDeJornada(r.fecha_hora);
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
      const claveTurno = `${fechaStr}_${turno}`;
      if (!agrupadoTurnos[claveTurno]) {
        agrupadoTurnos[claveTurno] = {
          fecha: fechaStr,
          turno: turno,
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

    const [registros] = await dbPool.query(
      `
            SELECT fecha_hora, usuario, paginas
            FROM \`auditoria\`
            WHERE DATE(fecha_hora) BETWEEN ? AND ?
        `,
      [fecha_inicio, fecha_fin],
    );

    const agrupadoDiario = {};

    registros.forEach((r) => {
      const { fechaStr, turno } = resolverFechaYTurnoDeJornada(r.fecha_hora);
      const usuario = r.usuario || "Desconocido";
      const paginas = parseInt(r.paginas || 0, 10);

      const clave = `${fechaStr}_${usuario.toUpperCase()}_${turno}`;
      if (!agrupadoDiario[clave]) {
        agrupadoDiario[clave] = {
          fecha: fechaStr,
          usuario: usuario,
          turno: turno,
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
    const { fecha_inicio, fecha_fin } = req.query;
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        ok: false,
        mensaje:
          "Debe especificar fecha_inicio y fecha_fin (formato yyyy-mm-dd).",
      });
    }

    // Consultar todos los registros en el rango de fechas
    const [registros] = await dbPool.query(
      `
            SELECT id, fecha_hora, turno, usuario, pc, ip, notaria, volumen, archivo, paginas, exportado, lugar_trabajo 
            FROM \`auditoria\`
            WHERE DATE(fecha_hora) BETWEEN ? AND ?
        `,
      [fecha_inicio, fecha_fin],
    );

    if (registros.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: "No hay datos para exportar en este rango.",
      });
    }

    // 1. Agrupar por Fecha usando la lógica fiscal de turnos y fines de semana
    const registrosPorFecha = {};
    registros.forEach((reg) => {
      const { fechaStr, turno } = resolverFechaYTurnoDeJornada(reg.fecha_hora);
      reg.fecha_calculada = fechaStr;
      reg.turno_calculado = turno;

      if (!registrosPorFecha[fechaStr]) {
        registrosPorFecha[fechaStr] = [];
      }
      registrosPorFecha[fechaStr].push(reg);
    });

    // 2. Deduplicar registros por archivo original por cada fecha (Lógica idéntica a la app C#)
    const registrosDeduplicados = [];
    Object.keys(registrosPorFecha).forEach((fecha) => {
      const grupoArchivos = {};
      registrosPorFecha[fecha].forEach((reg) => {
        const nombreArchivo = (reg.archivo || "Desconocido").toLowerCase();
        if (!grupoArchivos[nombreArchivo]) {
          grupoArchivos[nombreArchivo] = [];
        }
        grupoArchivos[nombreArchivo].push(reg);
      });

      Object.keys(grupoArchivos).forEach((nombreArchivo) => {
        const grupo = grupoArchivos[nombreArchivo];
        if (grupo.length === 1) {
          registrosDeduplicados.push(grupo[0]);
        } else {
          let seleccionado = null;
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

    // 3. Agrupar por Fecha -> PC -> IP -> Usuario -> Turno
    const registrosAgrupados = {};
    registrosDeduplicados.forEach((reg) => {
      const fecha = reg.fecha_calculada;

      if (!registrosAgrupados[fecha]) {
        registrosAgrupados[fecha] = {};
      }

      const pc = reg.pc || "Desconocido";
      if (!registrosAgrupados[fecha][pc]) {
        registrosAgrupados[fecha][pc] = {};
      }

      const ip = reg.ip || "Desconocido";
      if (!registrosAgrupados[fecha][pc][ip]) {
        registrosAgrupados[fecha][pc][ip] = {};
      }

      const usuario = reg.usuario || "Desconocido";
      if (!registrosAgrupados[fecha][pc][ip][usuario]) {
        registrosAgrupados[fecha][pc][ip][usuario] = {};
      }

      const turno = reg.turno_calculado;
      if (!registrosAgrupados[fecha][pc][ip][usuario][turno]) {
        registrosAgrupados[fecha][pc][ip][usuario][turno] = [];
      }

      registrosAgrupados[fecha][pc][ip][usuario][turno].push(reg);
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
        { header: "PC", key: "pc", width: 15 },
        { header: "Lugar de Trabajo", key: "lugar", width: 22 },
        { header: "IP", key: "ip", width: 18 },
        { header: "Usuario", key: "usuario", width: 28 },
        { header: "Turno", key: "turno", width: 15 },
        { header: "Capturas (PDFs)", key: "pdfs", width: 18 },
        { header: "Total de Imágenes", key: "paginas", width: 20 },
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

      // Filas
      const listaFilas = [];
      const pcsDeLaFecha = registrosAgrupados[fecha];
      Object.keys(pcsDeLaFecha).forEach((pc) => {
        const ipsDeLaPc = pcsDeLaFecha[pc];
        Object.keys(ipsDeLaPc).forEach((ip) => {
          const usuariosDeLaIp = ipsDeLaPc[ip];
          Object.keys(usuariosDeLaIp).forEach((usuario) => {
            const turnosDelUsuario = usuariosDeLaIp[usuario];
            Object.keys(turnosDelUsuario).forEach((turno) => {
              const listaRegs = turnosDelUsuario[turno];
              const totalPdfs = listaRegs.length;
              const totalPaginas = listaRegs.reduce(
                (sum, r) => sum + (r.paginas > 0 ? r.paginas : 1),
                0,
              );
              const lugar =
                listaRegs.find((r) => r.lugar_trabajo)?.lugar_trabajo || "IREC";
              listaFilas.push({
                pc,
                lugar,
                ip,
                usuario,
                turno,
                pdfs: totalPdfs,
                paginas: totalPaginas,
              });
            });
          });
        });
      });

      // Ordenar por turno
      const filasOrdenadas = listaFilas.sort((a, b) => {
        const turnosOrden = { matutino: 1, vespertino: 2, nocturno: 3 };
        const ordenA = turnosOrden[a.turno.toLowerCase()] || 4;
        const ordenB = turnosOrden[b.turno.toLowerCase()] || 4;
        return ordenA - ordenB;
      });

      filasOrdenadas.forEach((fila) => {
        const row = worksheet.addRow({
          pc: fila.pc,
          lugar: fila.lugar,
          ip: fila.ip,
          usuario: fila.usuario,
          turno: fila.turno,
          pdfs: fila.pdfs,
          paginas: fila.paginas,
        });
        row.height = 20;

        // Color por turno
        let colorHex = "F2F2F2";
        const turnoLower = fila.turno.toLowerCase();
        if (turnoLower === "matutino") {
          colorHex = "FFF2CC"; // Amarillo pastel suave
        } else if (turnoLower === "vespertino") {
          colorHex = "E2EFDA"; // Verde pastel suave
        } else if (turnoLower === "nocturno") {
          colorHex = "DDEBF7"; // Azul pastel suave
        }

        row.eachCell((cell) => {
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
          cell.alignment = { vertical: "middle", horizontal: "left" };
        });

        row.getCell("pdfs").alignment = {
          vertical: "middle",
          horizontal: "center",
        };
        row.getCell("paginas").alignment = {
          vertical: "middle",
          horizontal: "center",
        };
      });
    });

    // Nombre de archivo con marca de tiempo: Reporte_Diario_Auditoria_YYYYMMDD_HHMM.xlsx
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, "0");
    const dia = String(ahora.getDate()).padStart(2, "0");
    const hora = String(ahora.getHours()).padStart(2, "0");
    const min = String(ahora.getMinutes()).padStart(2, "0");
    const nombreArchivo = `Reporte_Diario_Auditoria_${anio}${mes}${dia}_${hora}${min}.xlsx`;

    const carpetaDescargas = path.join(
      process.env.USERPROFILE || process.env.HOME || "C:\\",
      "Downloads",
    );
    const rutaCompleta = path.join(carpetaDescargas, nombreArchivo);

    await workbook.xlsx.writeFile(rutaCompleta);

    // Abrir automáticamente el archivo
    exec(`start "" "${rutaCompleta}"`, (err) => {
      if (err) {
        console.error("Error al abrir Excel automáticamente:", err);
      }
    });

    res.json({
      ok: true,
      mensaje: "Reporte Excel generado y abierto con éxito.",
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
