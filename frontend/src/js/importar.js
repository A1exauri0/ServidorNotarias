/**
 * JS Modular de Transferencia Masiva de PDFs (importar.js).
 * Lista notarías locales de C:\NOTARIAS, escanea sus PDFs y gestiona la importación o corrección
 * de páginas en base a si el archivo ya existe con páginas incompletas (<= 1).
 */

const LIMITE_MB_COPIA_DIRECTA = 500;

// Lista de resultados del último escaneo
let listaResultadosEscaneo = [];

async function inicializarVistaImportar() {
    // 1. Cargar las notarías locales en el select
    await cargarNotariasLocales();

    // 2. Vincular botón de escanear
    const btnEscanear = document.getElementById('btnEscanearDirectorio');
    if (btnEscanear && !btnEscanear.dataset.listener) {
        btnEscanear.dataset.listener = 'true';
        btnEscanear.addEventListener('click', ejecutarEscaneo);
    }

    // 3. Vincular botón de transferir
    const btnTransferir = document.getElementById('btnTransferirTodo');
    if (btnTransferir && !btnTransferir.dataset.listener) {
        btnTransferir.dataset.listener = 'true';
        btnTransferir.addEventListener('click', ejecutarTransferenciaMasiva);
    }

    // 4. Vincular checkbox master
    const chkTodos = document.getElementById('chkSeleccionarTodos');
    if (chkTodos && !chkTodos.dataset.listener) {
        chkTodos.dataset.listener = 'true';
        chkTodos.addEventListener('change', (e) => {
            document.querySelectorAll('.chk-archivo-importar:not(:disabled)').forEach(chk => {
                chk.checked = e.target.checked;
            });
        });
    }
}

// Carga las carpetas de notarías desde C:\NOTARIAS en el dropdown
async function cargarNotariasLocales() {
    const select = document.getElementById('cboNotariaImportar');
    if (!select) return;

    try {
        const respuesta = await fetch('http://localhost:3000/api/notarias-locales');
        const datos = await respuesta.json();

        select.innerHTML = '';
        if (datos.ok && datos.notarias && datos.notarias.length > 0) {
            datos.notarias.forEach(notaria => {
                const opt = document.createElement('option');
                opt.value = notaria;
                opt.innerText = notaria;
                select.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.value = '';
            opt.innerText = 'No se encontraron carpetas en C:\\NOTARIAS';
            select.appendChild(opt);
        }
    } catch (error) {
        console.error('Error al cargar notarías locales:', error);
        select.innerHTML = '<option value="">Error al cargar directorio central</option>';
    }
}

// Ejecuta el escaneo del directorio en el backend
async function ejecutarEscaneo() {
    const select = document.getElementById('cboNotariaImportar');
    const lblEstado = document.getElementById('lblEstadoEscaneo');
    const btnEscanear = document.getElementById('btnEscanearDirectorio');
    const panel = document.getElementById('panelResultadosImportar');

    if (!select || !select.value) {
        if (lblEstado) lblEstado.textContent = '⚠️ Selecciona una notaría válida.';
        return;
    }

    const notariaSeleccionada = select.value;

    btnEscanear.disabled = true;
    btnEscanear.textContent = 'Escaneando...';
    if (lblEstado) {
        lblEstado.style.color = 'var(--color-texto-secundario)';
        lblEstado.textContent = `Escaneando C:\\NOTARIAS\\${notariaSeleccionada}, esto puede tardar unos segundos...`;
    }

    try {
        const respuesta = await fetch('http://localhost:3000/api/escanear-directorio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notariaSeleccionada })
        });

        const datos = await respuesta.json();

        if (!datos.ok) {
            if (lblEstado) {
                lblEstado.style.color = '#eb5584';
                lblEstado.textContent = `❌ ${datos.mensaje}`;
            }
            return;
        }

        listaResultadosEscaneo = datos.resultados || [];

        const nuevos = listaResultadosEscaneo.filter(r => !r.yaRegistrado).length;
        const incompletos = listaResultadosEscaneo.filter(r => r.yaRegistrado && r.paginasRegistradas <= 1).length;
        const correctos = listaResultadosEscaneo.filter(r => r.yaRegistrado && r.paginasRegistradas > 1).length;

        if (lblEstado) {
            lblEstado.style.color = '#2ebd75';
            lblEstado.textContent = `✅ Escaneo: ${datos.totalEncontrados} PDFs. ${nuevos} nuevos, ${incompletos} con páginas incompletas (seleccionados para corregir), ${correctos} correctos.`;
        }

        renderizarTablaImportar();
        if (panel) panel.style.display = 'block';

    } catch (error) {
        console.error('Error al escanear directorio:', error);
        if (lblEstado) {
            lblEstado.style.color = '#eb5584';
            lblEstado.textContent = '❌ No se pudo conectar con el servidor local.';
        }
    } finally {
        btnEscanear.disabled = false;
        btnEscanear.innerHTML = '<iconify-icon icon="mdi:folder-search-outline" style="vertical-align: middle; margin-right: 6px;"></iconify-icon>Escanear';
    }
}

// Renderiza la tabla de resultados del escaneo
function renderizarTablaImportar() {
    const tbody = document.getElementById('tablaImportarBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (listaResultadosEscaneo.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 30px; color: var(--color-texto-secundario);">No se encontraron archivos PDF.</td></tr>`;
        return;
    }

    listaResultadosEscaneo.forEach((item, index) => {
        const esPesado = item.tamanioMb >= LIMITE_MB_COPIA_DIRECTA;
        const requiereCorreccion = item.yaRegistrado && item.paginasRegistradas <= 1;
        const omitidoCompleto = item.yaRegistrado && item.paginasRegistradas > 1;

        // Colores de fondo para la fila
        let colorFondo = '#E2EFDA'; // Nuevo - verde pastel
        if (omitidoCompleto) {
            colorFondo = '#F2F2F2'; // Ya registrado correcto - gris
        } else if (requiereCorreccion) {
            colorFondo = '#FFF2CC'; // Páginas incompletas - amarillo/naranja suave
        }

        let etiquetaEstado = `<span style="color: #1a7f4c; font-size: 11px; font-weight: 600;">🆕 Nuevo</span>`;
        if (omitidoCompleto) {
            etiquetaEstado = `<span style="color: #666; font-size: 11px; font-weight: 600;">✔ Registrado (${item.paginasRegistradas} pág.)</span>`;
        } else if (requiereCorreccion) {
            etiquetaEstado = `<span style="color: #c07a00; font-size: 11px; font-weight: 600;">⚠️ Páginas incompletas (${item.paginasRegistradas})</span>`;
        }

        if (esPesado && !item.yaRegistrado) {
            etiquetaEstado += ` <span style="background-color: #eb5584; color: white; padding: 2px 4px; border-radius: 3px; font-size: 9px; margin-left: 4px;">📦 +500MB Copia Directa</span>`;
        }

        const deshabilitado = omitidoCompleto;

        const fila = document.createElement('tr');
        fila.style.backgroundColor = colorFondo;
        fila.style.color = '#17233d';
        fila.dataset.index = index;

        fila.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="chk-archivo-importar" data-index="${index}"
                    ${deshabilitado ? 'disabled' : 'checked'}
                    style="cursor: ${deshabilitado ? 'not-allowed' : 'pointer'};">
            </td>
            <td style="font-size: 12px; word-break: break-all; color: #17233d; font-weight: 600;">${item.archivo}</td>
            <td style="font-size: 12px; color: #17233d;">${item.notaria}</td>
            <td style="font-size: 12px; color: #17233d;">${item.volumen || 'SIN LOTE'}</td>
            <td style="text-align: center; font-size: 12px; color: #17233d; font-family: monospace;">
                ${item.tamanioMb > 0 ? `${item.tamanioMb.toFixed(1)} MB` : '—'}
            </td>
            <td style="text-align: center;" id="estadoFila_${index}">${etiquetaEstado}</td>
        `;
        tbody.appendChild(fila);
    });
}

// Ejecuta la transferencia masiva
async function ejecutarTransferenciaMasiva() {
    const checkboxes = document.querySelectorAll('.chk-archivo-importar:checked:not(:disabled)');
    if (checkboxes.length === 0) {
        alert('No hay archivos nuevos o incompletos seleccionados para transferir.');
        return;
    }

    const indicesSeleccionados = Array.from(checkboxes).map(chk => parseInt(chk.dataset.index));
    const archivosAImportar = indicesSeleccionados.map(i => listaResultadosEscaneo[i]);

    const btnTransferir = document.getElementById('btnTransferirTodo');
    if (btnTransferir) btnTransferir.disabled = true;

    const barraContenedor = document.getElementById('barraProgresoImportar');
    const barra = document.getElementById('barraProgreso');
    const lblTexto = document.getElementById('lblProgresoTexto');
    const lblPct = document.getElementById('lblPorcentaje');
    if (barraContenedor) barraContenedor.style.display = 'block';

    let procesadosOk = 0;
    let errores = 0;
    const total = archivosAImportar.length;

    for (let i = 0; i < total; i++) {
        const item = archivosAImportar[i];
        const indexOriginal = listaResultadosEscaneo.indexOf(item);
        const celdaEstado = document.getElementById(`estadoFila_${indexOriginal}`);

        if (lblTexto) lblTexto.textContent = `Procesando ${i + 1} de ${total}: ${item.archivo}`;
        const pct = Math.round((i / total) * 100);
        if (barra) barra.style.width = `${pct}%`;
        if (lblPct) lblPct.textContent = `${pct}%`;
        if (celdaEstado) celdaEstado.innerHTML = `<span style="color: #3a6ac9; font-size: 11px;">⏳ Procesando...</span>`;

        try {
            const respuesta = await fetch('http://localhost:3000/api/importar-archivo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rutaCompleta: item.rutaCompleta,
                    archivo: item.archivo,
                    notaria: item.notaria,
                    volumen: item.volumen,
                    usuario: 'Administrador',
                    turno: 'Matutino',
                    pc: 'SERVIDOR-CENTRAL'
                })
            });

            const datos = await respuesta.json();

            if (datos.ok) {
                procesadosOk++;
                const descAccion = datos.accion === 'actualizado' ? 'Corregido' : 'Importado';
                if (celdaEstado) {
                    celdaEstado.innerHTML = `<span style="color: #1a7f4c; font-size: 11px; font-weight: 600;">✅ ${descAccion} (${datos.paginas} pág.)</span>`;
                }
                
                // Actualizar metadatos en la lista local para evitar reprocesamientos
                listaResultadosEscaneo[indexOriginal].yaRegistrado = true;
                listaResultadosEscaneo[indexOriginal].paginasRegistradas = datos.paginas;
                const filaEl = document.querySelector(`tr[data-index="${indexOriginal}"]`);
                if (filaEl) {
                    filaEl.style.backgroundColor = '#F2F2F2';
                    const chk = filaEl.querySelector('.chk-archivo-importar');
                    if (chk) {
                        chk.disabled = true;
                        chk.checked = false;
                    }
                }
            } else {
                errores++;
                if (celdaEstado) {
                    celdaEstado.innerHTML = `<span style="color: #eb5584; font-size: 11px; font-weight: 600;">❌ Error</span>`;
                }
            }
        } catch (error) {
            errores++;
            if (celdaEstado) {
                celdaEstado.innerHTML = `<span style="color: #eb5584; font-size: 11px; font-weight: 600;">❌ Falló conexión</span>`;
            }
            console.error('Error al importar:', error);
        }
    }

    // Finalizado
    if (barra) barra.style.width = '100%';
    if (lblPct) lblPct.textContent = '100%';
    if (lblTexto) {
        lblTexto.textContent = `Proceso completado: ${procesadosOk} exitosos, ${errores} con error.`;
        lblTexto.style.color = errores > 0 ? '#eb5584' : '#2ebd75';
    }
    if (btnTransferir) btnTransferir.disabled = false;
}

window.inicializarVistaImportar = inicializarVistaImportar;
