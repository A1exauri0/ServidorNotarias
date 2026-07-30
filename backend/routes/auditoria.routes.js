/**
 * Enrutador de Express para la API de Auditoría (auditoria.routes.js).
 * Registra las subidas físicas y los endpoints de registro de auditorías.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const controladorAuditoria = require("../controllers/auditoria.controller");

// Helper seguro para crear carpetas sin fallar en rutas de red UNC de Windows (\\servidor\recurso)
function asegurarDirectorioSync(targetPath) {
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
            fs.mkdirSync(acumulado);
          } catch (err) {
            if (err.code !== "EEXIST" && !fs.existsSync(acumulado)) throw err;
          }
        }
      }
      return;
    }
  }

  fs.mkdirSync(targetPath, { recursive: true });
}

// Configuración de almacenamiento físico de PDFs con multer
const almacenamiento = multer.diskStorage({
  destination: (req, archivo, callback) => {
    const tipoCaptura = (
      req.body.tipo_captura || "DIGITALIZACION"
    ).toUpperCase();
    let notaria = (req.body.notaria || "General").trim();

    if (
      !notaria ||
      notaria.toUpperCase() === "NOTARIAS" ||
      notaria.toUpperCase() === "GENERAL"
    ) {
      notaria = "General";
    }

    const rutaBase = process.env.RUTA_SSDIREC || "\\\\172.40.5.84\\ssdirec";
    const rutaDestino = path.join(rutaBase, tipoCaptura, notaria);

    // Crear la carpeta física si no existe de forma segura para rutas UNC de red
    asegurarDirectorioSync(rutaDestino);

    callback(null, rutaDestino);
  },
  filename: (req, archivo, callback) => {
    callback(null, archivo.originalname);
  },
});

const upload = multer({ storage: almacenamiento });

// 1. Endpoints para registrar logs de auditoría (compatibilidad multiproyecto)
router.post("/registrar", controladorAuditoria.registrarAuditoria);

// 2. Endpoint de recepción y almacenamiento de PDFs físicos
router.post(
  "/subir-pdf",
  upload.single("archivo"),
  controladorAuditoria.subirPdf,
);

// 3. Endpoint para obtener y eliminar registros
router.get("/registros", controladorAuditoria.obtenerRegistros);
router.get("/filtros-registros", controladorAuditoria.obtenerOpcionesFiltrosRegistros);
router.delete("/registros/:id", controladorAuditoria.eliminarRegistroAuditoria);

// 4. Endpoints para la importación masiva desde directorios locales o de red
router.get("/notarias-locales", controladorAuditoria.obtenerNotariasLocales);
router.post("/escanear-directorio", controladorAuditoria.escanearDirectorio);
router.post("/importar-archivo", controladorAuditoria.importarArchivoPdf);
router.post("/sincronizar-astronmx", controladorAuditoria.sincronizarAstronmx);
router.get("/pcs-unicas", controladorAuditoria.obtenerPcsUnicas);
router.post("/reparar-paginas", controladorAuditoria.repararPaginasIncompletas);
router.post("/migrar-historico", controladorAuditoria.migrarHistorico);
router.post("/asignar", controladorAuditoria.asignarPdfs);
router.get(
  "/pendientes-asignacion",
  controladorAuditoria.obtenerPdfsParaAsignar,
);
router.get(
  "/volumenes-pendientes",
  controladorAuditoria.obtenerVolumenesPendientesAsignacion,
);
router.post("/obtener-pdfs-lote", controladorAuditoria.obtenerPdfsLoteDirecto);
router.post(
  "/iniciar-transferencia-lote",
  controladorAuditoria.iniciarTransferenciaSegundoPlano,
);
router.get(
  "/estado-transferencia-lote",
  controladorAuditoria.obtenerEstadoTransferenciaSegundoPlano,
);

// 5. Endpoint dummy para monitoreo de digitalizacion
router.get("/digitalizacion", (req, res) => {
  res.json({ ok: true, mensaje: "Servicio de digitalización activo." });
});

module.exports = router;
