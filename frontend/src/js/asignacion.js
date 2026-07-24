/**
 * Módulo de Asignación de PDFs a Usuarios (asignacion.js).
 * Construye el explorador de árbol de notarías y volúmenes con checkboxes interactivos,
 * permitiendo la asignación directa de carpetas de volúmenes completas o archivos individuales.
 */

let listaNotariasGlobal = [];
let listaUsuariosGlobal = [];
let notariaFiltroActiva = "";
let volumenFiltroActivo = "";

async function inicializarVistaAsignacion() {
  await cargarNotariasYUsuarios();
  await consultarPdfsAsignacion();
  vincularEventosAsignacion();
}

// Carga las notarías y usuarios y renderiza el árbol explorador de carpetas
async function cargarNotariasYUsuarios() {
  // 1. Cargar Notarías
  try {
    const resNot = await fetch("http://localhost:3000/api/notarias-locales");
    const datNot = await resNot.json();
    if (datNot.ok && datNot.notarias) {
      listaNotariasGlobal = datNot.notarias;
      renderizarArbolExploradorAsignacion();
    }
  } catch (e) {
    console.error("Error al cargar notarías para asignación:", e);
  }

  // 2. Cargar Usuarios Capturistas
  try {
    const resUsr = await fetch("http://localhost:3000/api/usuarios");
    const datUsr = await resUsr.json();
    if (datUsr.ok && datUsr.usuarios) {
      listaUsuariosGlobal = datUsr.usuarios;
      poblarCustomSelectUsuarios();
    }
  } catch (e) {
    console.error("Error al cargar usuarios para asignación:", e);
  }

  // Registrar listeners para dropdowns de filtro y usuario destino
  registrarEventosCustomSelect("AsignacionUsuarioFiltro", () => {
    consultarPdfsAsignacion();
  });

  registrarEventosCustomSelect("UsuarioDestino", null);
}

// Helper genérico para los dropdowns de custom-select-wrapper
function registrarEventosCustomSelect(idPrefijo, alSeleccionarCallback) {
  const wrapper = document.getElementById(`wrapper${idPrefijo}`);
  const btn = document.getElementById(`btn${idPrefijo}`);
  const optionsDiv = document.getElementById(`options${idPrefijo}`);
  if (!wrapper || !btn || !optionsDiv) return;

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

  optionsDiv.onclick = (e) => {
    const opt = e.target.closest(".custom-select-option");
    if (!opt) return;

    optionsDiv.querySelectorAll(".custom-select-option").forEach((o) => o.classList.remove("seleccionado"));
    opt.classList.add("seleccionado");

    const valor = opt.getAttribute("data-valor") || "";
    const texto = opt.textContent.trim();

    btn.setAttribute("data-valor", valor);
    btn.textContent = texto;
    wrapper.classList.remove("activo");

    if (typeof alSeleccionarCallback === "function") {
      alSeleccionarCallback(valor, texto);
    }
  };
}

// Pobla el custom-select del usuario destino con nombre_completo y nombre_usuario
function poblarCustomSelectUsuarios() {
  const optionsFiltro = document.getElementById("optionsAsignacionUsuarioFiltro");
  const optionsDestino = document.getElementById("optionsUsuarioDestino");

  if (optionsFiltro) {
    const btnFiltro = document.getElementById("btnAsignacionUsuarioFiltro");
    const valFiltro = btnFiltro ? btnFiltro.getAttribute("data-valor") : "SIN_ASIGNAR";

    optionsFiltro.innerHTML = `
      <div class="custom-select-option ${valFiltro === "" ? "seleccionado" : ""}" data-valor="">Todos los Usuarios</div>
      <div class="custom-select-option ${valFiltro === "SIN_ASIGNAR" ? "seleccionado" : ""}" data-valor="SIN_ASIGNAR">Sin Asignar / General</div>
    `;

    listaUsuariosGlobal.forEach((u) => {
      const nombreMostrar = u.nombre_completo || u.nombre_usuario || "Usuario Desconocido";
      const usuarioValor = u.nombre_usuario || u.nombre_completo;
      const esSel = valFiltro === usuarioValor;
      optionsFiltro.innerHTML += `<div class="custom-select-option ${esSel ? "seleccionado" : ""}" data-valor="${usuarioValor}">${nombreMostrar} (${usuarioValor})</div>`;
    });
  }

  if (optionsDestino) {
    optionsDestino.innerHTML = `<div class="custom-select-option seleccionado" data-valor="">-- Seleccionar Capturista --</div>`;
    listaUsuariosGlobal.forEach((u) => {
      const nombreMostrar = u.nombre_completo || u.nombre_usuario || "Usuario Desconocido";
      const usuarioValor = u.nombre_usuario || u.nombre_completo;
      optionsDestino.innerHTML += `<div class="custom-select-option" data-valor="${usuarioValor}">${nombreMostrar} (${usuarioValor})</div>`;
    });
  }
}

// Dibuja el Árbol Explorador de Notarías y Volúmenes con Checkboxes
function renderizarArbolExploradorAsignacion() {
  const contenedor = document.getElementById("exploradorArbolAsignacion");
  if (!contenedor) return;

  contenedor.innerHTML = "";

  if (listaNotariasGlobal.length === 0) {
    contenedor.innerHTML = `<div style="text-align: center; color: var(--color-texto-secundario); padding: 20px;">No se encontraron notarías.</div>`;
    return;
  }

  listaNotariasGlobal.forEach((notaria) => {
    const notariaIdSeguro = notaria.nombre.replace(/[^a-zA-Z0-9]/g, "_");
    const tieneVolumenes = notaria.volumenes && notaria.volumenes.length > 0;

    const nodoNotaria = document.createElement("div");
    nodoNotaria.className = "nodo-notaria-asig";

    // Cabecera Notaría
    const cabecera = document.createElement("div");
    cabecera.className = "cabecera-notaria-asig";

    const iconoFlecha = tieneVolumenes
      ? `<iconify-icon icon="mdi:chevron-right" class="flecha-toggle flecha-asig-${notariaIdSeguro}" style="font-size: 16px; margin-right: 2px; vertical-align: middle;"></iconify-icon>`
      : `<span style="display: inline-block; width: 18px;"></span>`;

    cabecera.innerHTML = `
      ${iconoFlecha}
      <input type="checkbox" class="chk-notaria-asig" data-notaria="${notaria.nombre}" data-notaria-id="${notariaIdSeguro}" style="cursor: pointer; margin-right: 4px;">
      <iconify-icon icon="mdi:folder" style="color: #4a90e2; font-size: 17px; vertical-align: middle; margin-right: 4px;"></iconify-icon>
      <span style="font-weight: 600; color: var(--color-texto);">${notaria.nombre}</span>
    `;

    nodoNotaria.appendChild(cabecera);

    // Contenedor de Volúmenes (Nivel 2)
    if (tieneVolumenes) {
      const listaVolumenes = document.createElement("div");
      listaVolumenes.className = "lista-volumenes-asig";
      listaVolumenes.id = `lista_volumenes_asig_${notariaIdSeguro}`;

      notaria.volumenes.forEach((vol) => {
        const nodoVolumen = document.createElement("div");
        nodoVolumen.className = "nodo-volumen-asig";

        const cabeceraVol = document.createElement("div");
        cabeceraVol.className = "cabecera-volumen-asig";
        cabeceraVol.innerHTML = `
          <span style="display: inline-block; width: 14px;"></span>
          <input type="checkbox" class="chk-volumen-asig" data-notaria="${notaria.nombre}" data-volumen="${vol}" style="cursor: pointer; margin-right: 4px;">
          <iconify-icon icon="mdi:folder-outline" style="color: #f5a623; font-size: 16px; vertical-align: middle; margin-right: 4px;"></iconify-icon>
          <span style="color: var(--color-texto-secundario); font-weight: 500;">${vol}</span>
        `;

        // Evento al dar clic en la carpeta de volumen: consultar su contenido en la tabla derecha
        cabeceraVol.addEventListener("click", (e) => {
          if (e.target.type === "checkbox") return;
          document.querySelectorAll(".cabecera-volumen-asig").forEach((c) => c.classList.remove("seleccionado"));
          cabeceraVol.classList.add("seleccionado");

          notariaFiltroActiva = notaria.nombre;
          volumenFiltroActivo = vol;
          consultarPdfsAsignacion();
        });

        nodoVolumen.appendChild(cabeceraVol);
        listaVolumenes.appendChild(nodoVolumen);
      });

      nodoNotaria.appendChild(listaVolumenes);

      // Evento para expandir/colapsar Notaría
      const chevronNotaria = cabecera.querySelector(`.flecha-asig-${notariaIdSeguro}`);
      const toggleNotaria = (e) => {
        if (e.target.type === "checkbox") return;
        const visible = listaVolumenes.style.display === "block";
        listaVolumenes.style.display = visible ? "none" : "block";
        if (chevronNotaria) {
          if (visible) chevronNotaria.classList.remove("rotar-90");
          else chevronNotaria.classList.add("rotar-90");
        }

        notariaFiltroActiva = notaria.nombre;
        volumenFiltroActivo = "";
        consultarPdfsAsignacion();
      };
      cabecera.addEventListener("click", toggleNotaria);

      // Checkbox Notaría: marcar/desmarcar todos sus volúmenes
      const chkNot = cabecera.querySelector(".chk-notaria-asig");
      chkNot.addEventListener("change", (e) => {
        const checked = e.target.checked;
        const checksVol = listaVolumenes.querySelectorAll(".chk-volumen-asig");
        checksVol.forEach((chk) => (chk.checked = checked));
        actualizarContadorSeleccionados();
      });

      // Checkboxes de volúmenes: disparar contador de selección
      const checksVol = listaVolumenes.querySelectorAll(".chk-volumen-asig");
      checksVol.forEach((chk) => {
        chk.addEventListener("change", actualizarContadorSeleccionados);
      });
    }

    contenedor.appendChild(nodoNotaria);
  });
}

// Vincula los eventos de la vista
function vincularEventosAsignacion() {
  const btnAsignar = document.getElementById("btnEjecutarAsignacion");
  if (btnAsignar && !btnAsignar.dataset.listener) {
    btnAsignar.dataset.listener = "true";
    btnAsignar.addEventListener("click", ejecutarAsignacionMasiva);
  }

  const chkTodos = document.getElementById("chkSeleccionarTodosAsignacion");
  if (chkTodos && !chkTodos.dataset.listener) {
    chkTodos.dataset.listener = "true";
    chkTodos.addEventListener("change", (e) => {
      const checked = e.target.checked;
      const checksFila = document.querySelectorAll(".chk-fila-asignacion");
      checksFila.forEach((chk) => (chk.checked = checked));
      actualizarContadorSeleccionados();
    });
  }
}

// Actualiza la cuenta de elementos marcados (PDFs individuales o carpetas de Volúmenes)
function actualizarContadorSeleccionados() {
  const PDFsMarcados = document.querySelectorAll(".chk-fila-asignacion:checked").length;
  const volMarcados = document.querySelectorAll(".chk-volumen-asig:checked").length;
  const notMarcadas = document.querySelectorAll(".chk-notaria-asig:checked").length;

  const badge = document.getElementById("badgeSeleccionados");
  if (!badge) return;

  if (PDFsMarcados > 0) {
    badge.textContent = `${PDFsMarcados} PDFs seleccionados`;
  } else if (volMarcados > 0) {
    badge.textContent = `${volMarcados} volumen(es) seleccionados`;
  } else if (notMarcadas > 0) {
    badge.textContent = `${notMarcadas} notaría(s) seleccionada(s)`;
  } else {
    badge.textContent = `0 seleccionados`;
  }
}

// Consulta los registros de auditoría filtrados por notaría, volumen y usuario
async function consultarPdfsAsignacion() {
  const btnUsuario = document.getElementById("btnAsignacionUsuarioFiltro");
  const tbody = document.getElementById("tablaAsignacionBody");
  const lblTotal = document.getElementById("lblTotalRegistrosAsignar");

  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align: center; padding: 25px; color: var(--color-texto-secundario);">
        <iconify-icon icon="line-md:loading-twotone-loop" style="font-size: 24px; color: #3a6ac9; vertical-align: middle; margin-right: 8px;"></iconify-icon>
        Consultando registros para asignación...
      </td>
    </tr>
  `;

  const usuario = btnUsuario ? btnUsuario.getAttribute("data-valor") : "SIN_ASIGNAR";

  try {
    const url = new URL("http://localhost:3000/api/pendientes-asignacion");
    if (notariaFiltroActiva) url.searchParams.append("notaria", notariaFiltroActiva);
    if (volumenFiltroActivo) url.searchParams.append("volumen", volumenFiltroActivo);
    if (usuario !== null && usuario !== undefined) url.searchParams.append("usuario", usuario);

    const res = await fetch(url);
    const datos = await res.json();

    tbody.innerHTML = "";

    if (datos.ok && datos.registros && datos.registros.length > 0) {
      const tituloFiltro = volumenFiltroActivo
        ? `${notariaFiltroActiva} - ${volumenFiltroActivo}`
        : notariaFiltroActiva || "Todas las Notarías";
      if (lblTotal) lblTotal.textContent = `Documentos Digitalizados (${datos.registros.length}) - ${tituloFiltro}`;

      datos.registros.forEach((reg) => {
        const tr = document.createElement("tr");
        const fechaFormateada = reg.fecha_hora
          ? new Date(reg.fecha_hora).toLocaleString("es-MX")
          : "-";

        tr.innerHTML = `
          <td style="text-align: center;">
            <input type="checkbox" class="chk-fila-asignacion" data-id="${reg.id}" style="cursor: pointer;">
          </td>
          <td style="text-align: center; font-weight: 600; font-family: monospace;">#${reg.id}</td>
          <td style="font-weight: 500;">
            <iconify-icon icon="mdi:file-pdf-box" style="color: #e84b3c; vertical-align: middle; margin-right: 6px; font-size: 16px;"></iconify-icon>
            ${reg.archivo || 'Sin Nombre'}
          </td>
          <td>${reg.notaria || 'General'}</td>
          <td>${reg.volumen || 'SIN VOLUMEN'}</td>
          <td style="text-align: center; font-weight: 600;">${reg.paginas || 0}</td>
          <td>
            <span style="padding: 2px 8px; border-radius: 4px; font-size: 11.5px; font-weight: 600; background-color: var(--color-tarjeta-borde); color: var(--color-texto);">
              ${reg.usuario || 'Sin Asignar'}
            </span>
          </td>
          <td style="text-align: center; font-size: 12px; color: var(--color-texto-secundario);">${fechaFormateada}</td>
        `;

        const chkFila = tr.querySelector(".chk-fila-asignacion");
        if (chkFila) {
          chkFila.addEventListener("change", actualizarContadorSeleccionados);
        }

        tbody.appendChild(tr);
      });
    } else {
      if (lblTotal) lblTotal.textContent = "Documentos Digitalizados (0)";
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 25px; color: var(--color-texto-secundario);">
            No se encontraron registros con los filtros seleccionados.
          </td>
        </tr>
      `;
    }

    actualizarContadorSeleccionados();
    const chkTodos = document.getElementById("chkSeleccionarTodosAsignacion");
    if (chkTodos) chkTodos.checked = false;
  } catch (error) {
    console.error("Error al consultar asignaciones:", error);
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 25px; color: #eb5584;">
          Error al conectar con el servidor para consultar asignaciones.
        </td>
      </tr>
    `;
  }
}

// Ejecuta la asignación masiva de volúmenes o PDFs individuales al capturista seleccionado
async function ejecutarAsignacionMasiva() {
  const btnDestino = document.getElementById("btnUsuarioDestino");
  const usuarioDestino = btnDestino ? btnDestino.getAttribute("data-valor") || "" : "";

  if (!usuarioDestino) {
    alert("Por favor selecciona el capturista al que deseas asignar los PDFs.");
    return;
  }

  const checksPdfs = document.querySelectorAll(".chk-fila-asignacion:checked");
  const checksVolumenes = document.querySelectorAll(".chk-volumen-asig:checked");
  const checksNotarias = document.querySelectorAll(".chk-notaria-asig:checked");

  let payload = { usuario: usuarioDestino };

  // 1. Si hay PDFs específicos seleccionados por checkbox en la tabla
  if (checksPdfs.length > 0) {
    payload.ids = Array.from(checksPdfs).map((chk) => parseInt(chk.dataset.id, 10));
  } 
  // 2. Si se marcaron carpetas de Volúmenes en el árbol explorador
  else if (checksVolumenes.length > 0) {
    const notariasSet = new Set();
    const volumenesArr = [];

    checksVolumenes.forEach((chk) => {
      notariasSet.add(chk.dataset.notaria);
      volumenesArr.push(chk.dataset.volumen);
    });

    const notariaUnica = Array.from(notariasSet)[0];
    payload.notaria = notariaUnica;
    payload.volumenes = volumenesArr;
  }
  // 3. Si se marcó una Notaría completa en el árbol explorador
  else if (checksNotarias.length > 0) {
    const firstNotaria = checksNotarias[0].dataset.notaria;
    payload.notaria = firstNotaria;
  }
  // 4. Fallback: si hay registros mostrados en el filtro actual
  else {
    const todosChecks = document.querySelectorAll(".chk-fila-asignacion");
    if (todosChecks.length === 0) {
      alert("Selecciona carpetas de volúmenes en el árbol o PDFs en la tabla para asignar.");
      return;
    }
    const desSelec = confirm(`¿Deseas asignar los ${todosChecks.length} PDFs mostrados actualmente al capturista seleccionado?`);
    if (!desSelec) return;
    payload.ids = Array.from(todosChecks).map((chk) => parseInt(chk.dataset.id, 10));
  }

  const btnAsignar = document.getElementById("btnEjecutarAsignacion");
  if (btnAsignar) btnAsignar.disabled = true;

  try {
    const res = await fetch("http://localhost:3000/api/asignar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const datos = await res.json();

    if (datos.ok) {
      alert(`✔ ${datos.mensaje}`);
      await consultarPdfsAsignacion();
    } else {
      alert(`❌ ${datos.mensaje}`);
    }
  } catch (err) {
    console.error("Error al ejecutar asignación masiva:", err);
    alert("❌ Error de comunicación con el servidor al realizar la asignación.");
  } finally {
    if (btnAsignar) btnAsignar.disabled = false;
  }
}

window.inicializarVistaAsignacion = inicializarVistaAsignacion;
