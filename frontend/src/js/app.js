// Variables globales para las gráficas de Chart.js
let instanciaGraficaBarras = null;
let instanciaGraficaPastel = null;

// Almacén local de registros para filtrado dinámico
let listaRegistrosLocal = [];

let vistaActual = "dashboard";

// Ejecutar cuando se cargue el DOM de la aplicación
document.addEventListener("DOMContentLoaded", () => {
  establecerFechasPorDefecto();

  // Cargar la vista por defecto (Dashboard)
  cargarVista("dashboard");

  // Evento de clic en el botón de aplicar filtros (Global)
  document.getElementById("btnFiltrar").addEventListener("click", () => {
    if (vistaActual === "dashboard") {
      consultarEstadisticas();
    } else if (vistaActual === "registros") {
      cargarTablaRegistros();
    } else if (vistaActual === "productividad") {
      inicializarVistaProductividad();
    }
  });

  // Control para colapsar/expandir el menú lateral
  const btnColapsar = document.getElementById("btnColapsar");
  const barraLateral = document.querySelector(".barra-lateral");
  if (btnColapsar && barraLateral) {
    btnColapsar.addEventListener("click", () => {
      barraLateral.classList.toggle("colapsada");
    });
  }

  // Botón para actualizar estadísticas manualmente
  const btnActualizar = document.getElementById("btnActualizar");
  if (btnActualizar) {
    btnActualizar.addEventListener("click", () => {
      if (vistaActual === "dashboard") {
        consultarEstadisticas();
      } else {
        cargarTablaRegistros();
      }
    });
  }

  // Control de intercambio de pestañas (Carga dinámica de vistas)
  const botonesNavegacion = document.querySelectorAll(".nav-item");
  botonesNavegacion.forEach((btn) => {
    btn.addEventListener("click", () => {
      botonesNavegacion.forEach((b) => b.classList.remove("activo"));
      btn.classList.add("activo");

      const tabDestino = btn.getAttribute("data-tab");
      cargarVista(tabDestino);
    });
  });
});

// Carga dinámica de sub-vistas HTML
async function cargarVista(nombreVista) {
  vistaActual = nombreVista;
  try {
    const respuesta = await fetch(`../src/views/${nombreVista}.html`);
    if (!respuesta.ok) throw new Error("No se pudo cargar la vista");
    const html = await respuesta.text();
    document.getElementById("contenido-vista").innerHTML = html;

    const elTitulo = document.querySelector(".titulo-pagina h1");
    const elSubtitulo = document.querySelector(".titulo-pagina p");
    const elFiltrosFecha = document.querySelector(".filtros-fecha");

    // Inicializadores y configuración de encabezado según la vista activa
    if (nombreVista === "dashboard") {
      if (elTitulo) elTitulo.innerText = "Resumen de Productividad";
      if (elSubtitulo) elSubtitulo.innerText = "Monitoreo y KPIs locales en tiempo real";
      if (elFiltrosFecha) elFiltrosFecha.style.display = "flex";
      consultarEstadisticas();
    } else if (nombreVista === "registros") {
      if (elTitulo) elTitulo.innerText = "Registros de Auditoría";
      if (elSubtitulo) elSubtitulo.innerText = "Listado detallado de capturas físicas procesadas";
      if (elFiltrosFecha) elFiltrosFecha.style.display = "flex";
      cargarTablaRegistros();

      // Vincular evento de búsqueda del buscador inyectado
      const buscadorRegistros = document.getElementById("buscadorRegistros");
      if (buscadorRegistros) {
        buscadorRegistros.addEventListener("input", (e) => {
          const termino = e.target.value.toLowerCase().trim();
          filtrarYRenderizarTabla(termino);
        });
      }

      // Vincular evento de exportación de registros detallados a Excel
      const btnExportarExcel = document.getElementById("btnExportarExcelRegistros");
      if (btnExportarExcel) {
        btnExportarExcel.addEventListener("click", exportarRegistrosExcel);
      }

      // Vincular evento de Sincronización con Astronmx (Estilo app C#)
      const btnSinc = document.getElementById("btnSincronizarAstronmx");
      if (btnSinc) {
        btnSinc.addEventListener("click", () => {
          const modal = document.getElementById("modalSincronizarAstronmx");
          if (modal) {
            document.getElementById("panelProgresoSinc").style.display = "none";
            document.getElementById("btnConfirmarSinc").disabled = false;
            document.getElementById("btnCancelarSinc").disabled = false;
            modal.style.display = "flex";
          }
        });
      }

      const btnCerrarSinc = document.getElementById("btnCerrarModalSinc");
      const btnCancelarSinc = document.getElementById("btnCancelarSinc");
      const modalSinc = document.getElementById("modalSincronizarAstronmx");

      const cerrarModalSinc = () => {
        if (modalSinc) modalSinc.style.display = "none";
      };

      if (btnCerrarSinc) btnCerrarSinc.addEventListener("click", cerrarModalSinc);
      if (btnCancelarSinc) btnCancelarSinc.addEventListener("click", cerrarModalSinc);

      const btnConfirmarSinc = document.getElementById("btnConfirmarSinc");
      if (btnConfirmarSinc) {
        btnConfirmarSinc.addEventListener("click", async () => {
          btnConfirmarSinc.disabled = true;
          document.getElementById("btnCancelarSinc").disabled = true;
          document.getElementById("panelProgresoSinc").style.display = "block";

          try {
            const respuesta = await fetch("http://localhost:3000/api/sincronizar-astronmx", {
              method: "POST"
            });
            const datos = await respuesta.json();

            if (datos.ok) {
              alert(datos.mensaje);
              cargarTablaRegistros(); // Refrescar la tabla para ver cambios
            } else {
              alert("⚠️ " + datos.mensaje);
            }
          } catch (error) {
            console.error("Error al sincronizar con Astronmx:", error);
            alert("❌ No se pudo conectar con el servidor local para la sincronización.");
          } finally {
            cerrarModalSinc();
          }
        });
      }
    } else if (nombreVista === "usuarios") {
      if (elTitulo) elTitulo.innerText = "Administrar Usuarios";
      if (elSubtitulo) elSubtitulo.innerText = "Configuración y gestión de credenciales y accesos";
      if (elFiltrosFecha) elFiltrosFecha.style.display = "none";
      inicializarVistaUsuarios();
    } else if (nombreVista === "productividad") {
      if (elTitulo) elTitulo.innerText = "Productividad por Capturista";
      if (elSubtitulo) elSubtitulo.innerText = "Reporte consolidado diario del rendimiento de los usuarios";
      if (elFiltrosFecha) elFiltrosFecha.style.display = "flex";
      inicializarVistaProductividad();
    } else if (nombreVista === "importar") {
      if (elTitulo) elTitulo.innerText = "Transferir Archivos PDF";
      if (elSubtitulo) elSubtitulo.innerText = "Importar y registrar PDFs desde carpetas locales o de red";
      if (elFiltrosFecha) elFiltrosFecha.style.display = "none";
      inicializarVistaImportar();
    }
  } catch (error) {
    console.error(`Error al cargar la vista modular ${nombreVista}:`, error);
  }
}

// Función auxiliar para actualizar los colores de las gráficas según el tema (Expuesta globalmente)
window.actualizarColoresGraficasPorTema = function (esClaro) {
  const colorTexto = esClaro ? "#17233d" : "#8d8d99";
  const colorCuadricula = esClaro ? "#d2dbe8" : "#24242b";

  if (instanciaGraficaBarras) {
    instanciaGraficaBarras.options.plugins.legend.labels.color = colorTexto;
    instanciaGraficaBarras.options.scales.x.ticks.color = colorTexto;
    instanciaGraficaBarras.options.scales.x.grid.color = colorCuadricula;
    instanciaGraficaBarras.options.scales.y.ticks.color = colorTexto;
    instanciaGraficaBarras.options.scales.y.grid.color = colorCuadricula;
    instanciaGraficaBarras.update();
  }

  if (instanciaGraficaPastel) {
    instanciaGraficaPastel.options.plugins.legend.labels.color = colorTexto;
    instanciaGraficaPastel.options.scales.x.ticks.color = colorTexto;
    instanciaGraficaPastel.options.scales.x.grid.color = colorCuadricula;
    instanciaGraficaPastel.options.scales.y.ticks.color = colorTexto;
    instanciaGraficaPastel.options.scales.y.grid.color = colorCuadricula;
    instanciaGraficaPastel.update();
  }
};

// Establece las fechas del filtro (del 1 del mes actual al día de hoy)
function establecerFechasPorDefecto() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");

  const primerDia = `${anio}-${mes}-01`;
  const ultimoDia = `${anio}-${mes}-${dia}`;

  document.getElementById("fechaInicio").value = primerDia;
  document.getElementById("fechaFin").value = ultimoDia;
}

// Consulta a la API local de Express y actualiza la interfaz
async function consultarEstadisticas() {
  const fechaInicio = document.getElementById("fechaInicio").value;
  const fechaFin = document.getElementById("fechaFin").value;

  try {
    const respuesta = await fetch(
      `http://localhost:3000/api/estadisticas/productividad?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`,
    );
    const datos = await respuesta.json();

    if (datos.ok) {
      actualizarKpisYGraficas(datos);
    } else {
      console.error("Error del servidor:", datos.mensaje);
    }
  } catch (error) {
    console.error("Error al conectar con la API de Express:", error);
  }
}

// Procesa y formatea los datos para renderizar la UI
function actualizarKpisYGraficas(datos) {
  const notariasCombinadas = {};
  const volumenesCombinados = {};

  // Procesar datos combinados
  datos.notarias.forEach((item) => {
    const notariaNombre = (item.notaria || "").toUpperCase().trim();
    const volumenNombre =
      (item.volumen || "").toUpperCase().trim() || "SIN LOTE";
    const claveVolumen = `${notariaNombre} - ${volumenNombre}`;

    // Agrupación por Notaría
    if (!notariasCombinadas[notariaNombre]) {
      notariasCombinadas[notariaNombre] = { pdfs: 0, imagenes: 0 };
    }
    notariasCombinadas[notariaNombre].pdfs += parseInt(
      item.total_pdfs || 0,
      10,
    );
    notariasCombinadas[notariaNombre].imagenes += parseInt(
      item.total_imagenes || 0,
      10,
    );

    // Agrupación por Volumen por Notaría
    if (!volumenesCombinados[claveVolumen]) {
      volumenesCombinados[claveVolumen] = { pdfs: 0, imagenes: 0 };
    }
    volumenesCombinados[claveVolumen].pdfs += parseInt(
      item.total_pdfs || 0,
      10,
    );
    volumenesCombinados[claveVolumen].imagenes += parseInt(
      item.total_imagenes || 0,
      10,
    );
  });

  // Calcular totales de KPIs
  let totalPdfs = 0;
  let totalImagenes = 0;
  const listaNotarias = Object.keys(notariasCombinadas);

  listaNotarias.forEach((clave) => {
    totalPdfs += notariasCombinadas[clave].pdfs;
    totalImagenes += notariasCombinadas[clave].imagenes;
  });

  // Actualizar elementos HTML del KPI
  const elPdfs = document.getElementById("txtTotalPdfs");
  const elImg = document.getElementById("txtTotalImagenes");
  const elNot = document.getElementById("txtTotalNotarias");

  if (elPdfs) elPdfs.innerText = totalPdfs.toLocaleString();
  if (elImg) elImg.innerText = totalImagenes.toLocaleString();
  if (elNot) elNot.innerText = listaNotarias.length.toString();

  // Renderizar Gráficas
  renderizarGraficaNotarias(notariasCombinadas, listaNotarias);
  renderizarGraficaVolumenes(volumenesCombinados);
}

// Gráfica 1: PDFs e Imágenes agrupados por Notaría
function renderizarGraficaNotarias(datosCombinados, listaNotarias) {
  const canvas = document.getElementById("graficaBarrasPdfs");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const datasetsPdfs = [];
  const datasetsImagenes = [];

  listaNotarias.forEach((notaria) => {
    datasetsPdfs.push(datosCombinados[notaria].pdfs);
    datasetsImagenes.push(datosCombinados[notaria].imagenes);
  });

  if (instanciaGraficaBarras) {
    instanciaGraficaBarras.destroy();
  }

  const esClaro = document.body.classList.contains("tema-claro");
  const colorTexto = esClaro ? "#17233d" : "#8d8d99";
  const colorCuadricula = esClaro ? "#d2dbe8" : "#24242b";

  instanciaGraficaBarras = new Chart(ctx, {
    type: "bar",
    data: {
      labels: listaNotarias,
      datasets: [
        {
          label: "PDFs Procesados",
          data: datasetsPdfs,
          backgroundColor: "rgba(58, 106, 201, 0.85)", // Azul
          borderColor: "#3a6ac9",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Imágenes / Páginas",
          data: datasetsImagenes,
          backgroundColor: "rgba(46, 189, 117, 0.85)", // Verde
          borderColor: "#2ebd75",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: colorTexto, font: { family: "Outfit" } },
        },
      },
      scales: {
        x: {
          ticks: { color: colorTexto, font: { family: "Inter" } },
          grid: { color: colorCuadricula },
        },
        y: {
          ticks: { color: colorTexto, font: { family: "Inter" } },
          grid: { color: colorCuadricula },
        },
      },
    },
  });
}

// Gráfica 2: PDFs e Imágenes agrupados por Volumen por Notaría
function renderizarGraficaVolumenes(datosVolumenes) {
  const canvas = document.getElementById("graficaBarrasPaginas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const listaVolumenes = Object.keys(datosVolumenes);

  // Si hay demasiados volúmenes, tomamos los 15 con más PDFs para mantener la legibilidad
  if (listaVolumenes.length > 15) {
    listaVolumenes.sort(
      (a, b) => datosVolumenes[b].pdfs - datosVolumenes[a].pdfs,
    );
    listaVolumenes.splice(15);
  }

  const datasetsPdfs = [];
  const datasetsImagenes = [];

  listaVolumenes.forEach((vol) => {
    datasetsPdfs.push(datosVolumenes[vol].pdfs);
    datasetsImagenes.push(datosVolumenes[vol].imagenes);
  });

  if (instanciaGraficaPastel) {
    instanciaGraficaPastel.destroy();
  }

  const esClaro = document.body.classList.contains("tema-claro");
  const colorTexto = esClaro ? "#17233d" : "#8d8d99";
  const colorCuadricula = esClaro ? "#d2dbe8" : "#24242b";

  instanciaGraficaPastel = new Chart(ctx, {
    type: "bar",
    data: {
      labels: listaVolumenes,
      datasets: [
        {
          label: "PDFs por Volumen",
          data: datasetsPdfs,
          backgroundColor: "rgba(235, 85, 132, 0.85)", // Rosa
          borderColor: "#eb5584",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "Páginas por Volumen",
          data: datasetsImagenes,
          backgroundColor: "rgba(139, 92, 246, 0.85)", // Morado
          borderColor: "#8b5cf6",
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: colorTexto, font: { family: "Outfit" } },
        },
      },
      scales: {
        x: {
          ticks: {
            color: colorTexto,
            font: { family: "Inter", size: 10 },
            maxRotation: 45,
            minRotation: 45,
          },
          grid: { color: colorCuadricula },
        },
        y: {
          ticks: { color: colorTexto, font: { family: "Inter" } },
          grid: { color: colorCuadricula },
        },
      },
    },
  });
}

// Carga la lista de registros en tiempo real desde la API
async function cargarTablaRegistros() {
  try {
    const fechaInicio = document.getElementById("fechaInicio")?.value;
    const fechaFin = document.getElementById("fechaFin")?.value;
    let url = "http://localhost:3000/api/registros";
    if (fechaInicio && fechaFin) {
      url += `?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`;
    }

    const respuesta = await fetch(url);
    const datos = await respuesta.json();

    if (datos.ok) {
      listaRegistrosLocal = datos.registros || [];

      // Poblar dinámicamente los dropdowns con valores únicos
      poblarDropdownsFiltro();

      // Renderizar la tabla limpia
      const buscador = document.getElementById("buscadorRegistros");
      const termino = buscador ? buscador.value.toLowerCase().trim() : "";
      filtrarYRenderizarTabla(termino);
    } else {
      console.error("Error al obtener registros:", datos.mensaje);
    }
  } catch (error) {
    console.error("Error de red al cargar registros:", error);
  }
}

// Configura y pobla de manera interactiva un custom select
function configurarCustomDropdown(idDropdown, listaValores, textoPorDefecto) {
  const wrapper = document.getElementById(`wrapperFiltro${idDropdown}`);
  const btn = document.getElementById(`btnFiltro${idDropdown}`);
  const optionsDiv = document.getElementById(`optionsFiltro${idDropdown}`);
  if (!wrapper || !btn || !optionsDiv) return;

  const valorActual = btn.getAttribute("data-valor") || "";

  // Renderizar las opciones
  optionsDiv.innerHTML = `<div class="custom-select-option ${valorActual === "" ? "seleccionado" : ""}" data-valor="">${textoPorDefecto}</div>`;
  listaValores.forEach((val) => {
    optionsDiv.innerHTML += `<div class="custom-select-option ${valorActual === val ? "seleccionado" : ""}" data-valor="${val}">${val}</div>`;
  });

  // Manejar el clic en el botón para abrir/cerrar
  if (!btn.dataset.listener) {
    btn.dataset.listener = "true";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".custom-select-wrapper").forEach((w) => {
        if (w !== wrapper) w.classList.remove("activo");
      });
      wrapper.classList.toggle("activo");
    });
  }
}

// Cerrar selectores al hacer clic en cualquier parte fuera de ellos
if (!window.customDropdownGlobalListener) {
  window.customDropdownGlobalListener = true;
  document.addEventListener("click", () => {
    document
      .querySelectorAll(".custom-select-wrapper")
      .forEach((w) => w.classList.remove("activo"));
  });
}

// Poblar los dropdowns dinámicamente según los registros existentes
function poblarDropdownsFiltro() {
  const usuarios = [
    ...new Set(
      listaRegistrosLocal.map((r) => (r.usuario || "").trim()).filter(Boolean),
    ),
  ].sort();
  const notarias = [
    ...new Set(
      listaRegistrosLocal
        .map((r) => (r.notaria || "").toUpperCase().trim())
        .filter(Boolean),
    ),
  ].sort();
  const volumenes = [
    ...new Set(
      listaRegistrosLocal
        .map((r) => (r.volumen || "").toUpperCase().trim())
        .filter(Boolean),
    ),
  ].sort();

  configurarCustomDropdown("Usuario", usuarios, "Todos los Usuarios");
  configurarCustomDropdown("Notaria", notarias, "Todas las Notarías");
  configurarCustomDropdown("Volumen", volumenes, "Todos los Volúmenes");

  // Registrar listeners de clic en las opciones para filtrar de inmediato
  ["Usuario", "Notaria", "Volumen"].forEach((idDropdown) => {
    const wrapper = document.getElementById(`wrapperFiltro${idDropdown}`);
    const btn = document.getElementById(`btnFiltro${idDropdown}`);
    const optionsDiv = document.getElementById(`optionsFiltro${idDropdown}`);
    if (!optionsDiv || !btn || !wrapper) return;

    optionsDiv.onclick = (e) => {
      const opt = e.target.closest(".custom-select-option");
      if (!opt) return;

      const nuevoValor = opt.getAttribute("data-valor");
      btn.setAttribute("data-valor", nuevoValor);
      btn.innerText = opt.innerText;

      optionsDiv
        .querySelectorAll(".custom-select-option")
        .forEach((o) => o.classList.remove("seleccionado"));
      opt.classList.add("seleccionado");
      wrapper.classList.remove("activo");

      // Disparar renderizado con filtros actualizados
      const buscador = document.getElementById("buscadorRegistros");
      filtrarYRenderizarTabla(
        buscador ? buscador.value.toLowerCase().trim() : "",
      );
    };
  });
}

// Filtra la lista de registros contemplando los dropdowns y el buscador
function filtrarYRenderizarTabla(termino) {
  const tbody = document.getElementById("tablaRegistrosBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const btnUsuario = document.getElementById("btnFiltroUsuario");
  const btnNotaria = document.getElementById("btnFiltroNotaria");
  const btnVolumen = document.getElementById("btnFiltroVolumen");

  const filtroUsuarioVal = btnUsuario
    ? btnUsuario.getAttribute("data-valor")
    : "";
  const filtroNotariaVal = btnNotaria
    ? btnNotaria.getAttribute("data-valor")
    : "";
  const filtroVolumenVal = btnVolumen
    ? btnVolumen.getAttribute("data-valor")
    : "";

  const registrosFiltrados = listaRegistrosLocal.filter((reg) => {
    const pc = (reg.pc || "").toLowerCase();
    const archivo = (reg.archivo || "").toLowerCase();
    const notaria = (reg.notaria || "").toUpperCase().trim();
    const usuario = (reg.usuario || "").trim();
    const volumen = (reg.volumen || "").toUpperCase().trim();

    // Filtro buscador (coincidencia parcial en PC o archivo)
    const coincideTexto = pc.includes(termino) || archivo.includes(termino);

    // Filtros dropdown (coincidencia exacta)
    const coincideUsuario =
      !filtroUsuarioVal || usuario === filtroUsuarioVal.trim();
    const coincideNotaria =
      !filtroNotariaVal || notaria === filtroNotariaVal.toUpperCase().trim();
    const coincideVolumen =
      !filtroVolumenVal || volumen === filtroVolumenVal.toUpperCase().trim();

    return (
      coincideTexto && coincideUsuario && coincideNotaria && coincideVolumen
    );
  });

  if (registrosFiltrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--color-texto-secundario); padding: 30px;">No se encontraron registros que coincidan con los filtros seleccionados.</td></tr>`;
    return;
  }

  registrosFiltrados.forEach((reg) => {
    const fila = document.createElement("tr");

    // Formatear fecha y hora
    let fechaFormateada = reg.fecha_hora;
    try {
      const date = new Date(reg.fecha_hora);
      fechaFormateada = date.toLocaleString("es-MX", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (e) {}

    const iconoExportado =
      reg.exportado === 1
        ? `<iconify-icon icon="mdi:check-circle-outline" style="color: #2ebd75; font-size: 18px; vertical-align: middle;"></iconify-icon>`
        : `<iconify-icon icon="mdi:close-circle-outline" style="color: #eb5584; font-size: 18px; vertical-align: middle;"></iconify-icon>`;

    fila.innerHTML = `
            <td style="text-align: center;">${iconoExportado}</td>
            <td>${reg.usuario || "-"}</td>
            <td>${reg.turno || "-"}</td>
            <td>${reg.pc || "-"}</td>
            <td>${reg.notaria || "General"}</td>
            <td>${reg.volumen || "-"}</td>
            <td title="${reg.archivo || ""}">${reg.archivo || "-"}</td>
            <td style="text-align: center;">${reg.paginas || 0}</td>
            <td style="text-align: right; font-family: var(--tipografia-cuerpo); font-size: 12px; color: var(--color-texto-secundario);">${fechaFormateada}</td>
        `;
    tbody.appendChild(fila);
  });
}

// Abre el modal para seleccionar el rango de fechas antes de generar el Excel premium
function exportarRegistrosExcel() {
  const modal = document.getElementById("modalRangoExcel");
  if (!modal) {
    alert("Error: No se encontró el modalRangoExcel en el HTML.");
    return;
  }

  // Rango de fechas por defecto: ultimos 7 dias (Igual que la app de C#)
  const hoy = new Date();
  const hace7Dias = new Date();
  hace7Dias.setDate(hoy.getDate() - 7);

  const formatoFecha = (d) => {
    const anio = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${anio}-${mes}-${dia}`;
  };

  const inputInicio = document.getElementById("excelFechaInicio");
  const inputFin = document.getElementById("excelFechaFin");

  if (inputInicio) inputInicio.value = formatoFecha(hace7Dias);
  if (inputFin) inputFin.value = formatoFecha(hoy);

  modal.style.display = "flex";

  // Vincular eventos de cierre
  const btnCerrar = document.getElementById("btnCerrarModalExcel");
  const btnCancelar = document.getElementById("btnCancelarExcel");
  const form = document.getElementById("formRangoExcel");

  const cerrarModal = () => {
    modal.style.display = "none";
  };

  if (btnCerrar && !btnCerrar.dataset.listener) {
    btnCerrar.dataset.listener = "true";
    btnCerrar.addEventListener("click", cerrarModal);
  }

  if (btnCancelar && !btnCancelar.dataset.listener) {
    btnCancelar.dataset.listener = "true";
    btnCancelar.addEventListener("click", cerrarModal);
  }

  if (form && !form.dataset.listener) {
    form.dataset.listener = "true";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const fechaInicio = inputInicio.value;
      const fechaFin = inputFin.value;

      cerrarModal();

      try {
        const url = `http://localhost:3000/api/estadisticas/exportar-excel?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (datos.ok) {
          alert("Reporte Excel generado y abierto de forma automática.");
        } else {
          alert("Error al generar Excel: " + datos.mensaje);
        }
      } catch (err) {
        console.error("Error al exportar Excel:", err);
        alert("Error de conexión con el servidor al generar el reporte Excel.");
      }
    });
  }
}
