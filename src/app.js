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

  // Evento de clic en el botón de aplicar filtros
  document.getElementById("btnFiltrar").addEventListener("click", () => {
    if (vistaActual === "dashboard") {
      consultarEstadisticas();
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
    const respuesta = await fetch(`views/${nombreVista}.html`);
    if (!respuesta.ok) throw new Error("No se pudo cargar la vista");
    const html = await respuesta.text();
    document.getElementById("contenido-vista").innerHTML = html;

    // Inicializadores según la vista
    if (nombreVista === "dashboard") {
      consultarEstadisticas();
    } else if (nombreVista === "registros") {
      cargarTablaRegistros();

      // Vincular evento de búsqueda del buscador inyectado
      const buscadorRegistros = document.getElementById("buscadorRegistros");
      if (buscadorRegistros) {
        buscadorRegistros.addEventListener("input", (e) => {
          const termino = e.target.value.toLowerCase().trim();
          filtrarYRenderizarTabla(termino);
        });
      }
    } else if (nombreVista === "usuarios") {
      inicializarVistaUsuarios();
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
    const notariaNombre = item.notaria;
    const volumenNombre = item.volumen || "Sin Lote";
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
    const respuesta = await fetch("http://localhost:3000/api/registros");
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

// Poblar los selects dinámicamente según los registros existentes
function poblarDropdownsFiltro() {
  const selectUsuario = document.getElementById("filtroUsuario");
  const selectNotaria = document.getElementById("filtroNotaria");
  const selectVolumen = document.getElementById("filtroVolumen");

  if (!selectUsuario || !selectNotaria || !selectVolumen) return;

  const valUsuario = selectUsuario.value;
  const valNotaria = selectNotaria.value;
  const valVolumen = selectVolumen.value;

  const usuarios = [
    ...new Set(listaRegistrosLocal.map((r) => r.usuario).filter(Boolean)),
  ].sort();
  const notarias = [
    ...new Set(listaRegistrosLocal.map((r) => r.notaria).filter(Boolean)),
  ].sort();
  const volumenes = [
    ...new Set(listaRegistrosLocal.map((r) => r.volumen).filter(Boolean)),
  ].sort();

  selectUsuario.innerHTML = '<option value="">Todos los Usuarios</option>';
  usuarios.forEach((u) => {
    selectUsuario.innerHTML += `<option value="${u}">${u}</option>`;
  });
  selectUsuario.value = valUsuario;

  selectNotaria.innerHTML = '<option value="">Todas las Notarías</option>';
  notarias.forEach((n) => {
    selectNotaria.innerHTML += `<option value="${n}">${n}</option>`;
  });
  selectNotaria.value = valNotaria;

  selectVolumen.innerHTML = '<option value="">Todos los Volúmenes</option>';
  volumenes.forEach((v) => {
    selectVolumen.innerHTML += `<option value="${v}">${v}</option>`;
  });
  selectVolumen.value = valVolumen;

  // Asignar manejadores de eventos change una sola vez
  if (!selectUsuario.dataset.listener) {
    selectUsuario.dataset.listener = "true";
    selectUsuario.addEventListener("change", () => {
      const buscador = document.getElementById("buscadorRegistros");
      filtrarYRenderizarTabla(
        buscador ? buscador.value.toLowerCase().trim() : "",
      );
    });
  }
  if (!selectNotaria.dataset.listener) {
    selectNotaria.dataset.listener = "true";
    selectNotaria.addEventListener("change", () => {
      const buscador = document.getElementById("buscadorRegistros");
      filtrarYRenderizarTabla(
        buscador ? buscador.value.toLowerCase().trim() : "",
      );
    });
  }
  if (!selectVolumen.dataset.listener) {
    selectVolumen.dataset.listener = "true";
    selectVolumen.addEventListener("change", () => {
      const buscador = document.getElementById("buscadorRegistros");
      filtrarYRenderizarTabla(
        buscador ? buscador.value.toLowerCase().trim() : "",
      );
    });
  }
}

// Filtra la lista de registros contemplando los dropdowns y el buscador
function filtrarYRenderizarTabla(termino) {
  const tbody = document.getElementById("tablaRegistrosBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const selectUsuario = document.getElementById("filtroUsuario");
  const selectNotaria = document.getElementById("filtroNotaria");
  const selectVolumen = document.getElementById("filtroVolumen");

  const filtroUsuarioVal = selectUsuario ? selectUsuario.value : "";
  const filtroNotariaVal = selectNotaria ? selectNotaria.value : "";
  const filtroVolumenVal = selectVolumen ? selectVolumen.value : "";

  const registrosFiltrados = listaRegistrosLocal.filter((reg) => {
    const pc = (reg.pc || "").toLowerCase();
    const archivo = (reg.archivo || "").toLowerCase();
    const notaria = (reg.notaria || "").toLowerCase();
    const usuario = reg.usuario || "";
    const volumen = reg.volumen || "";

    // Filtro buscador (coincidencia parcial en PC o archivo)
    const coincideTexto = pc.includes(termino) || archivo.includes(termino);

    // Filtros dropdown (coincidencia exacta)
    const coincideUsuario = !filtroUsuarioVal || usuario === filtroUsuarioVal;
    const coincideNotaria = !filtroNotariaVal || notaria === filtroNotariaVal;
    const coincideVolumen = !filtroVolumenVal || volumen === filtroVolumenVal;

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
