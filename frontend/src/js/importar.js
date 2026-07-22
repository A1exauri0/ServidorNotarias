/**
 * JS Modular de Transferencia Masiva de PDFs (importar.js).
 * Estructura en árbol del explorador de directorios locales con checkboxes interactivos,
 * escaneo asíncrono dinámico por volumen y transferencia masiva de archivos.
 */

const LIMITE_MB_COPIA_DIRECTA = 500;

// Almacén en memoria de todos los archivos cargados en el árbol para su transferencia
let mapaArchivosEnArbol = {};

async function inicializarVistaImportar() {
  mapaArchivosEnArbol = {};

  // 1. Inicializar explorador de directorios en árbol
  await cargarArbolDirectorios();

  // 2. Vincular botón de transferencia masiva
  const btnTransferir = document.getElementById("btnTransferirTodo");
  if (btnTransferir && !btnTransferir.dataset.listener) {
    btnTransferir.dataset.listener = "true";
    btnTransferir.addEventListener("click", ejecutarTransferenciaMasiva);
  }
}

// Carga las notarías y construye el primer nivel del árbol de directorios
async function cargarArbolDirectorios() {
  const explorador = document.getElementById("exploradorDirectorios");
  if (!explorador) return;

  try {
    const respuesta = await fetch("http://localhost:3000/api/notarias-locales");
    const datos = await respuesta.json();

    explorador.innerHTML = "";

    if (datos.ok && datos.notarias && datos.notarias.length > 0) {
      // Identificar bases de datos locales únicas encontradas físicamente
      const basesUnicas = [...new Set(datos.notarias.map(n => n.rutaBase))];
      const lblTitulo = document.getElementById("lblTituloExplorador");
      if (lblTitulo && basesUnicas.length > 0) {
        lblTitulo.textContent = `Explorador de Directorios Local (${basesUnicas.join(", ")})`;
      }

      datos.notarias.forEach((notaria) => {
        const notariaIdSeguro = notaria.nombre.replace(/[^a-zA-Z0-9]/g, "_");
        const tieneVolumenes =
          notaria.volumenes && notaria.volumenes.length > 0;

        const nodoNotaria = document.createElement("div");
        nodoNotaria.className = "nodo-notaria";
        nodoNotaria.id = `nodo_notaria_${notariaIdSeguro}`;

        // 1. Cabecera de la Notaría
        const cabecera = document.createElement("div");
        cabecera.className = "cabecera-notaria";

        // Flecha chevron para colapsar/expandir
        const iconoFlecha = tieneVolumenes
          ? `<iconify-icon icon="mdi:chevron-right" class="flecha-toggle flecha-notaria-${notariaIdSeguro}" style="font-size: 16px; margin-right: 4px; vertical-align: middle;"></iconify-icon>`
          : `<span style="display: inline-block; width: 20px;"></span>`;

        cabecera.innerHTML = `
          ${iconoFlecha}
          <input type="checkbox" class="chk-notaria" data-notaria-id="${notariaIdSeguro}" style="cursor: pointer; margin-right: 6px;">
          <iconify-icon icon="mdi:folder" style="color: #4a90e2; font-size: 18px; vertical-align: middle; margin-right: 4px;"></iconify-icon>
          <span style="font-weight: 600; color: var(--color-texto);">${notaria.nombre}</span>
        `;

        nodoNotaria.appendChild(cabecera);

        // 2. Contenedor de Subcarpetas (Volúmenes)
        if (tieneVolumenes) {
          const listaVolumenes = document.createElement("div");
          listaVolumenes.className = "lista-volumenes";
          listaVolumenes.id = `lista_volumenes_${notariaIdSeguro}`;

          notaria.volumenes.forEach((vol) => {
            const volumenIdSeguro = `${notariaIdSeguro}_${vol.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const nodoVolumen = document.createElement("div");
            nodoVolumen.className = "nodo-volumen";
            nodoVolumen.id = `nodo_volumen_${volumenIdSeguro}`;

            // Cabecera del Volumen
            const cabeceraVol = document.createElement("div");
            cabeceraVol.className = "cabecera-volumen";
            cabeceraVol.innerHTML = `
              <iconify-icon icon="mdi:chevron-right" class="flecha-toggle flecha-volumen-${volumenIdSeguro}" style="font-size: 15px; margin-right: 4px; vertical-align: middle;"></iconify-icon>
              <input type="checkbox" class="chk-volumen" data-notaria-id="${notariaIdSeguro}" data-volumen-id="${volumenIdSeguro}" style="cursor: pointer; margin-right: 6px;">
              <iconify-icon icon="mdi:folder-outline" style="color: #f5a623; font-size: 16px; vertical-align: middle; margin-right: 4px;"></iconify-icon>
              <span style="color: var(--color-texto-secundario); font-weight: 500;">${vol}</span>
            `;

            nodoVolumen.appendChild(cabeceraVol);

            // Contenedor de subnodos de archivos PDF (Nivel 3)
            const listaArchivos = document.createElement("div");
            listaArchivos.className = "lista-archivos-pdf";
            listaArchivos.id = `lista_archivos_${volumenIdSeguro}`;
            listaArchivos.dataset.cargado = "false";
            listaArchivos.dataset.rutaEscaneo = `${notaria.nombre}\\${vol}`;
            listaArchivos.dataset.rutaBase = notaria.rutaBase || "C:\\NOTARIAS";
            listaArchivos.dataset.alias = notaria.alias || "";
            listaArchivos.dataset.usaSubcarpeta = notaria.usaSubcarpeta ? "true" : "false";

            nodoVolumen.appendChild(listaArchivos);

            // Evento para expandir/colapsar el volumen y escanear PDFs en cascada
            const chevronVol = cabeceraVol.querySelector(
              `.flecha-volumen-${volumenIdSeguro}`,
            );
            const expandirVolumen = async (e) => {
              // Evitar disparar si se hace clic en el checkbox
              if (e.target.type === "checkbox") return;

              const visible = listaArchivos.style.display === "block";
              listaArchivos.style.display = visible ? "none" : "block";

              if (chevronVol) {
                if (visible) chevronVol.classList.remove("rotar-90");
                else chevronVol.classList.add("rotar-90");
              }

              // Cargar archivos si no han sido cargados
              if (!visible && listaArchivos.dataset.cargado === "false") {
                await cargarArchivosDeVolumen(
                  listaArchivos.dataset.rutaEscaneo,
                  listaArchivos,
                  volumenIdSeguro,
                );
              }
            };

            cabeceraVol.addEventListener("click", expandirVolumen);

            // Evento checkbox de volumen (seleccionar todos sus archivos)
            const chkVol = cabeceraVol.querySelector(".chk-volumen");
            chkVol.addEventListener("change", (e) => {
              const checked = e.target.checked;
              const checksArchivos = listaArchivos.querySelectorAll(
                ".chk-archivo-pdf:not(:disabled)",
              );
              checksArchivos.forEach((chk) => {
                chk.checked = checked;
              });
            });

            nodoVolumen.appendChild(listaArchivos);
            listaVolumenes.appendChild(nodoVolumen);
          });

          nodoNotaria.appendChild(listaVolumenes);

          // Evento para expandir/colapsar la notaría
          const chevronNotaria = cabecera.querySelector(
            `.flecha-notaria-${notariaIdSeguro}`,
          );
          const expandirNotaria = (e) => {
            // Evitar disparar si se hace clic en el checkbox
            if (e.target.type === "checkbox") return;

            const visible = listaVolumenes.style.display === "block";
            listaVolumenes.style.display = visible ? "none" : "block";
            if (chevronNotaria) {
              if (visible) chevronNotaria.classList.remove("rotar-90");
              else chevronNotaria.classList.add("rotar-90");
            }
          };
          cabecera.addEventListener("click", expandirNotaria);

          // Evento checkbox de notaría (seleccionar todos sus volúmenes y archivos)
          const chkNot = cabecera.querySelector(".chk-notaria");
          chkNot.addEventListener("change", (e) => {
            const checked = e.target.checked;
            // 1. Marcar todos sus volúmenes
            const checksVol = listaVolumenes.querySelectorAll(".chk-volumen");
            checksVol.forEach((chk) => {
              chk.checked = checked;
            });
            // 2. Marcar todos sus archivos si ya se encuentran cargados en el DOM
            const checksArchivos = listaVolumenes.querySelectorAll(
              ".chk-archivo-pdf:not(:disabled)",
            );
            checksArchivos.forEach((chk) => {
              chk.checked = checked;
            });
          });
        }

        explorador.appendChild(nodoNotaria);
      });
    } else {
      explorador.innerHTML = `<div style="text-align: center; color: var(--color-texto-secundario); padding: 20px;">No se encontraron directorios locales de Notarías, Nóminas o Libros.</div>`;
    }
  } catch (error) {
    console.error("Error al construir árbol:", error);
    explorador.innerHTML = `<div style="text-align: center; color: #eb5584; padding: 20px;">Error al conectar con el servidor local para armar el explorador.</div>`;
  }
}

// Escanea y dibuja los archivos PDF de un volumen dinámicamente
async function cargarArchivosDeVolumen(
  rutaRelativa,
  contenedorDOM,
  volumenIdSeguro,
) {
  contenedorDOM.innerHTML = `
    <div style="padding: 6px 12px; color: var(--color-texto-secundario); font-size: 12px; display: flex; align-items: center; gap: 6px;">
      <iconify-icon icon="line-md:loading-twotone-loop" style="color: #3a6ac9; font-size: 14px;"></iconify-icon>
      <span>Escaneando archivos de volumen...</span>
    </div>
  `;

  const rBase = contenedorDOM.dataset.rutaBase;
  const alias = contenedorDOM.dataset.alias;
  const usaSub = contenedorDOM.dataset.usaSubcarpeta === "true";

  try {
    const respuesta = await fetch(
      "http://localhost:3000/api/escanear-directorio",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          notariaSeleccionada: rutaRelativa,
          rutaBase: rBase,
          alias: alias,
          usaSubcarpeta: usaSub
        }),
      },
    );

    const datos = await respuesta.json();
    contenedorDOM.innerHTML = "";
    contenedorDOM.dataset.cargado = "true";

    if (datos.ok && datos.resultados && datos.resultados.length > 0) {
      // Verificar si el checkbox del volumen padre está marcado
      const chkVolumenPadre = document.querySelector(
        `.chk-volumen[data-volumen-id="${volumenIdSeguro}"]`,
      );
      const volumenMarcado = chkVolumenPadre ? chkVolumenPadre.checked : false;

      datos.resultados.forEach((item, index) => {
        const esPesado = item.tamanioMb >= LIMITE_MB_COPIA_DIRECTA;
        const requiereCorreccion =
          item.yaRegistrado && item.paginasRegistradas <= 1;
        const omitidoCompleto =
          item.yaRegistrado && item.paginasRegistradas > 1;
        const noRegistrado = !item.yaRegistrado;

        let claseEstado = "incompleto";
        let textoEstado = "";
        let chkHabilitado = false;
        let chkChecked = false;

        if (noRegistrado) {
          claseEstado = "no-registrado";
          textoEstado = "❌ Sin registro en BD";
          chkHabilitado = false;
          chkChecked = false; // No se manda
        } else if (omitidoCompleto) {
          claseEstado = "completo";
          textoEstado = `✔ Registrado (${item.paginasRegistradas} pág.)`;
          chkHabilitado = true;
          chkChecked = true; // Sí se manda por defecto
        } else if (requiereCorreccion) {
          claseEstado = "incompleto";
          textoEstado = `⚠️ Incompleto (${item.paginasRegistradas} pág.)`;
          chkHabilitado = false;
          chkChecked = false; // No se manda
        }

        if (esPesado) {
          textoEstado += ` (Pesado)`;
        }

        // Si el volumen padre estaba previamente seleccionado, heredamos el check si está habilitado
        if (volumenMarcado && chkHabilitado) {
          chkChecked = true;
        }

        // Registrar metadatos del archivo en el mapa de memoria
        const archivoId = `${volumenIdSeguro}_f${index}`;
        mapaArchivosEnArbol[archivoId] = {
          rutaCompleta: item.rutaCompleta,
          archivo: item.archivo,
          notaria: item.notaria,
          volumen: item.volumen,
          tamanioMb: item.tamanioMb,
          domId: archivoId,
          volumenIdSeguro,
        };

        const nodoArchivo = document.createElement("div");
        nodoArchivo.className = `nodo-archivo-pdf ${claseEstado}`;
        nodoArchivo.id = `wrapper_${archivoId}`;

        const deshabilitado = !chkHabilitado;

        nodoArchivo.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" class="chk-archivo-pdf" data-archivo-id="${archivoId}"
              ${deshabilitado ? "disabled" : ""}
              ${chkChecked ? "checked" : ""}
              style="cursor: ${deshabilitado ? "not-allowed" : "pointer"}; margin-right: 4px;">
            <iconify-icon icon="mdi:file-pdf-box" style="color: #e84b3c; font-size: 16px; vertical-align: middle;"></iconify-icon>
            <span style="font-weight: 500; font-size: 12.5px; color: var(--color-texto); word-break: break-all;">${item.archivo}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; font-size: 11.5px; font-weight: 600; white-space: nowrap;">
            <span style="color: var(--color-texto-secundario); font-family: monospace;">${item.tamanioMb.toFixed(1)} MB</span>
            <span class="etiqueta-estado-archivo" style="padding: 2px 6px; border-radius: 4px;">${textoEstado}</span>
          </div>
        `;

        contenedorDOM.appendChild(nodoArchivo);
      });
    } else {
      contenedorDOM.innerHTML = `
        <div style="padding: 6px 12px; color: var(--color-texto-secundario); font-size: 12px;">
          No se encontraron archivos PDF en este volumen.
        </div>
      `;
    }
  } catch (error) {
    console.error("Error al escanear volumen:", error);
    contenedorDOM.innerHTML = `
      <div style="padding: 6px 12px; color: #eb5584; font-size: 12px;">
        Error al escanear archivos locales.
      </div>
    `;
  }
}

// Ejecuta la transferencia masiva de todos los archivos PDF seleccionados en el árbol
async function ejecutarTransferenciaMasiva() {
  const btnTransferir = document.getElementById("btnTransferirTodo");
  if (btnTransferir) btnTransferir.disabled = true;

  const barraContenedor = document.getElementById("barraProgresoImportar");
  const barra = document.getElementById("barraProgreso");
  const lblTexto = document.getElementById("lblProgresoTexto");
  const lblPct = document.getElementById("lblPorcentaje");
  const lblEstado = document.getElementById("lblEstadoEscaneo");

  if (barraContenedor) barraContenedor.style.display = "block";
  if (lblEstado) lblEstado.textContent = "";

  // --- Paso 1: Cargar automáticamente los volúmenes que aún no se han escaneado ---
  const notariasMarcadas = document.querySelectorAll(".chk-notaria:checked");
  const volumenesMarcados = document.querySelectorAll(".chk-volumen:checked");

  // Recopilar los contenedores de archivos que necesitan cargarse
  const contenedoresPendientes = [];

  // Desde notarías marcadas: buscar todos sus volúmenes
  notariasMarcadas.forEach((chkNot) => {
    const notariaId = chkNot.dataset.notariaId;
    const nodoNotaria = document.getElementById(`nodo_notaria_${notariaId}`);
    if (!nodoNotaria) return;
    const listasArchivos = nodoNotaria.querySelectorAll(".lista-archivos-pdf");
    listasArchivos.forEach((lista) => {
      if (lista.dataset.cargado === "false") {
        contenedoresPendientes.push(lista);
      }
    });
  });

  // Desde volúmenes marcados individualmente
  volumenesMarcados.forEach((chkVol) => {
    const volumenId = chkVol.dataset.volumenId;
    const lista = document.getElementById(`lista_archivos_${volumenId}`);
    if (lista && lista.dataset.cargado === "false") {
      // Evitar duplicados
      if (!contenedoresPendientes.includes(lista)) {
        contenedoresPendientes.push(lista);
      }
    }
  });

  // Si no hay ninguna notaría ni volumen seleccionado
  if (notariasMarcadas.length === 0 && volumenesMarcados.length === 0) {
    alert("Selecciona al menos una notaría o volumen para transferir.");
    if (btnTransferir) btnTransferir.disabled = false;
    if (barraContenedor) barraContenedor.style.display = "none";
    return;
  }

  // Escanear los volúmenes pendientes antes de transferir
  if (contenedoresPendientes.length > 0) {
    if (lblTexto) lblTexto.textContent = `Escaneando ${contenedoresPendientes.length} volumen(es) pendientes...`;
    if (barra) barra.style.width = "0%";

    for (let i = 0; i < contenedoresPendientes.length; i++) {
      const lista = contenedoresPendientes[i];
      const volumenId = lista.id.replace("lista_archivos_", "");
      const pctEscaneo = Math.round(((i + 1) / contenedoresPendientes.length) * 50);
      if (barra) barra.style.width = `${pctEscaneo}%`;
      if (lblPct) lblPct.textContent = `${pctEscaneo}%`;
      if (lblTexto) lblTexto.textContent = `Escaneando volumen ${i + 1} de ${contenedoresPendientes.length}...`;

      await cargarArchivosDeVolumen(
        lista.dataset.rutaEscaneo,
        lista,
        volumenId,
      );
      // Hacer visible el contenedor para que los checkboxes estén accesibles
      lista.style.display = "block";
    }
  }

  // --- Paso 2: Recolectar los archivos habilitados y marcados ---
  const checksSeleccionados = document.querySelectorAll(
    ".chk-archivo-pdf:checked:not(:disabled)",
  );

  if (checksSeleccionados.length === 0) {
    if (lblTexto) {
      lblTexto.textContent = "No se encontraron archivos válidos para transferir (todos están sin registro o incompletos).";
      lblTexto.style.color = "#eb5584";
    }
    if (barra) barra.style.width = "100%";
    if (lblPct) lblPct.textContent = "100%";
    if (btnTransferir) btnTransferir.disabled = false;
    return;
  }

  // --- Paso 3: Transferir ---
  let procesadosOk = 0;
  let errores = 0;
  const total = checksSeleccionados.length;

  for (let i = 0; i < total; i++) {
    const chk = checksSeleccionados[i];
    const archivoId = chk.dataset.archivoId;
    const datosArchivo = mapaArchivosEnArbol[archivoId];

    if (!datosArchivo) continue;

    // Actualizar progreso e interfaz visual en el nodo correspondiente
    if (lblTexto)
      lblTexto.textContent = `Transfiriendo ${i + 1} de ${total}: ${datosArchivo.archivo}`;
    const pct = 50 + Math.round(((i + 1) / total) * 50);
    if (barra) barra.style.width = `${pct}%`;
    if (lblPct) lblPct.textContent = `${pct}%`;

    const wrapperNodo = document.getElementById(`wrapper_${archivoId}`);
    const labelEstado = wrapperNodo
      ? wrapperNodo.querySelector(".etiqueta-estado-archivo")
      : null;

    if (labelEstado) {
      labelEstado.innerHTML = `<iconify-icon icon="line-md:loading-twotone-loop" style="vertical-align: middle; margin-right: 4px;"></iconify-icon>Enviando...`;
      labelEstado.style.color = "#3a6ac9";
    }

    try {
      const respuesta = await fetch(
        "http://localhost:3000/api/importar-archivo",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rutaCompleta: datosArchivo.rutaCompleta,
            archivo: datosArchivo.archivo,
            notaria: datosArchivo.notaria,
            volumen: datosArchivo.volumen,
            usuario: "Administrador",
            turno: "Matutino",
            pc: "SERVIDOR-CENTRAL",
          }),
        },
      );

      const datos = await respuesta.json();

      if (datos.ok) {
        procesadosOk++;

        // Actualizar visualmente a "Completo" en color verde
        if (wrapperNodo) {
          wrapperNodo.className = "nodo-archivo-pdf completo";
          // Desmarcar y deshabilitar check tras éxito
          const chkBox = wrapperNodo.querySelector(".chk-archivo-pdf");
          if (chkBox) {
            chkBox.checked = false;
            chkBox.disabled = true;
            chkBox.style.cursor = "not-allowed";
          }
        }
        if (labelEstado) {
          labelEstado.textContent = `✔ Registrado (${datos.paginas} pág.)`;
          labelEstado.style.color = "";
        }
      } else {
        errores++;
        if (labelEstado) {
          labelEstado.textContent = "❌ Falló transferencia";
          labelEstado.style.color = "#ea5455";
        }
      }
    } catch (err) {
      errores++;
      if (labelEstado) {
        labelEstado.textContent = "❌ Error de conexión";
        labelEstado.style.color = "#ea5455";
      }
      console.error("Error en fetch transferencia:", err);
    }
  }

  // Finalizar barra de progreso
  if (barra) barra.style.width = "100%";
  if (lblPct) lblPct.textContent = "100%";
  if (lblTexto) {
    lblTexto.textContent = `Transferencia finalizada: ${procesadosOk} exitosos, ${errores} fallidos.`;
    lblTexto.style.color = errores > 0 ? "#eb5584" : "#2ebd75";
  }

  if (btnTransferir) btnTransferir.disabled = false;
}

window.inicializarVistaImportar = inicializarVistaImportar;
