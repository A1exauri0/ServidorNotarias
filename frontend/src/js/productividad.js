/**
 * JS Modular para el Reporte de Productividad Diaria por Capturista (productividad.js).
 * Controla el listado estilo hoja de cálculo, la consulta interactiva y la exportación.
 */

let listaReporteLocal = [];

async function inicializarVistaProductividad() {
    // 1. Vincular botón de exportación a Excel
    const btnExcel = document.getElementById('btnExportarExcelProd');
    if (btnExcel && !btnExcel.dataset.listener) {
        btnExcel.dataset.listener = 'true';
        btnExcel.addEventListener('click', exportarProductividadExcel);
    }

    // 2. Vincular filtro local por Día
    const filtroDia = document.getElementById('filtroDiaProductividad');
    if (filtroDia && !filtroDia.dataset.listener) {
        filtroDia.dataset.listener = 'true';
        filtroDia.addEventListener('change', () => {
            renderizarTablaProductividad();
        });
    }

    // 3. Vincular botón para abrir el modal de Consulta de Usuario
    const btnConsulta = document.getElementById('btnConsultarPorUsuario');
    if (btnConsulta && !btnConsulta.dataset.listener) {
        btnConsulta.dataset.listener = 'true';
        btnConsulta.addEventListener('click', abrirModalConsultaUsuario);
    }

    // 4. Vincular eventos de cierre del modal de consulta
    const btnCerrar = document.getElementById('btnCerrarModalConsulta');
    if (btnCerrar && !btnCerrar.dataset.listener) {
        btnCerrar.dataset.listener = 'true';
        btnCerrar.addEventListener('click', cerrarModalConsultaUsuario);
    }

    // 5. Vincular formulario de consulta por usuario
    const formConsulta = document.getElementById('formConsultaUsuario');
    if (formConsulta && !formConsulta.dataset.listener) {
        formConsulta.dataset.listener = 'true';
        formConsulta.addEventListener('submit', procesarConsultaUsuario);
    }

    // 6. Realizar la primera carga de datos con las fechas del header global
    await cargarReporteProductividad();
}

// Consulta a la API de Express la productividad consolidada
async function cargarReporteProductividad() {
    const inputInicio = document.getElementById('fechaInicio');
    const inputFin = document.getElementById('fechaFin');
    if (!inputInicio || !inputFin) return;

    const fechaInicio = inputInicio.value;
    const fechaFin = inputFin.value;

    const tbody = document.getElementById('tablaProductividadBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-texto-secundario); padding: 25px;">Cargando reporte de productividad diaria...</td></tr>`;
    }

    try {
        const url = `http://localhost:3000/api/estadisticas/productividad/diaria?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`;
        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        if (datos.ok) {
            listaReporteLocal = datos.productividad || [];
            renderizarTablaProductividad();
        } else {
            console.error('Error de API:', datos.mensaje);
        }
    } catch (error) {
        console.error('Error al cargar reporte de productividad:', error);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #eb5584; padding: 25px;">Error al conectar con la base de datos local.</td></tr>`;
        }
    }
}

// Renderiza las filas en la tabla estilo hoja de cálculo contemplando el filtro por día local
function renderizarTablaProductividad() {
    const tbody = document.getElementById('tablaProductividadBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const filtroDiaInput = document.getElementById('filtroDiaProductividad');
    const valorDiaFiltrado = filtroDiaInput ? filtroDiaInput.value : '';

    // Filtrar los datos localmente si se seleccionó un día específico
    const datosAMostrar = listaReporteLocal.filter(item => {
        if (!valorDiaFiltrado) return true;
        return item.fecha === valorDiaFiltrado;
    });

    if (datosAMostrar.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-texto-secundario); padding: 30px;">No se encontraron registros de captura para el filtro seleccionado.</td></tr>`;
        return;
    }

    datosAMostrar.forEach((item) => {
        const fila = document.createElement('tr');
        
        // Formatear la fecha a visual estándar (dd/mm/yyyy)
        let fechaVisual = item.fecha;
        try {
            const partes = item.fecha.split('-');
            fechaVisual = `${partes[2]}/${partes[1]}/${partes[0]}`;
        } catch (e) {}

        // Determinar color de fondo según el turno
        let colorFondo = '#F2F2F2'; // Gris
        const turnoLower = (item.turno || 'Matutino').toLowerCase();
        if (turnoLower === 'matutino') {
            colorFondo = '#FFF2CC'; // Amarillo pastel
        } else if (turnoLower === 'vespertino') {
            colorFondo = '#E2EFDA'; // Verde pastel
        } else if (turnoLower === 'nocturno') {
            colorFondo = '#DDEBF7'; // Azul pastel
        }

        // Aplicar el color de fondo y forzar texto oscuro para que resalte en cualquier tema (claro/oscuro)
        fila.style.backgroundColor = colorFondo;
        fila.style.color = '#17233d';

        fila.innerHTML = `
            <td style="font-weight: 600; color: #17233d;">${item.usuario}</td>
            <td style="text-align: center; color: #17233d;">${item.turno || 'Matutino'}</td>
            <td style="text-align: center; font-family: monospace; color: #17233d;">${fechaVisual}</td>
            <td style="text-align: center; font-weight: 600; color: #3a6ac9;">${item.total_pdfs}</td>
            <td style="text-align: center; font-weight: 600; color: #17233d;">${item.total_paginas}</td>
        `;
        tbody.appendChild(fila);
    });
}

// Abre el modal de consulta por usuario
function abrirModalConsultaUsuario() {
    const modal = document.getElementById('modalConsultaProductividad');
    if (!modal) return;

    // Resetear panel de resultados
    const panel = document.getElementById('panelResultadosConsulta');
    if (panel) panel.style.display = 'none';

    // Poblar dropdown con usuarios únicos existentes
    const cbo = document.getElementById('cboConsultaUsuario');
    if (cbo) {
        cbo.innerHTML = '';
        const usuariosUnicos = [...new Set(listaReporteLocal.map(item => item.usuario))].sort();
        usuariosUnicos.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.innerText = u;
            cbo.appendChild(opt);
        });
    }

    // Poner fecha de hoy por defecto
    const inputFecha = document.getElementById('txtConsultaFecha');
    if (inputFecha) {
        const hoy = new Date();
        const anio = hoy.getFullYear();
        const mes = String(hoy.getMonth() + 1).padStart(2, '0');
        const dia = String(hoy.getDate()).padStart(2, '0');
        inputFecha.value = `${anio}-${mes}-${dia}`;
    }

    modal.style.display = 'flex';
}

// Cierra el modal de consulta
function cerrarModalConsultaUsuario() {
    const modal = document.getElementById('modalConsultaProductividad');
    if (modal) modal.style.display = 'none';
}

// Procesa la consulta del usuario en una fecha específica (Estilo app C#)
function procesarConsultaUsuario(e) {
    e.preventDefault();

    const cbo = document.getElementById('cboConsultaUsuario');
    const inputFecha = document.getElementById('txtConsultaFecha');
    if (!cbo || !inputFecha) return;

    const usuarioSeleccionado = cbo.value;
    const fechaSeleccionada = inputFecha.value;

    // Buscar coincidencia en la lista consolidada
    const coincidencia = listaReporteLocal.find(item => 
        item.usuario === usuarioSeleccionado && item.fecha === fechaSeleccionada
    );

    const lblPdfs = document.getElementById('lblResultadoPdfs');
    const lblImagenes = document.getElementById('lblResultadoImagenes');
    const panel = document.getElementById('panelResultadosConsulta');

    if (lblPdfs && lblImagenes) {
        if (coincidencia) {
            lblPdfs.innerText = coincidencia.total_pdfs.toLocaleString();
            lblImagenes.innerText = coincidencia.total_paginas.toLocaleString();
        } else {
            lblPdfs.innerText = "0";
            lblImagenes.innerText = "0";
        }
    }

    if (panel) {
        panel.style.display = 'block';
    }
}

// Genera un archivo CSV compatible con Excel agregando el BOM UTF-8
function exportarProductividadExcel() {
    if (listaReporteLocal.length === 0) {
        alert('No hay información en el reporte para exportar.');
        return;
    }

    const separador = ';';
    const cabeceras = ['Capturista', 'Turno', 'Fecha de Registro', 'Total de PDFs', 'Total de Imagenes (Paginas)'];
    
    let contenidoCsv = cabeceras.join(separador) + '\n';

    listaReporteLocal.forEach(item => {
        let fechaVisual = item.fecha;
        try {
            const partes = item.fecha.split('-');
            fechaVisual = `${partes[2]}/${partes[1]}/${partes[0]}`;
        } catch (e) {}

        const fila = [
            item.usuario,
            item.turno || 'Matutino',
            fechaVisual,
            item.total_pdfs,
            item.total_paginas
        ];
        contenidoCsv += fila.join(separador) + '\n';
    });

    const blob = new Blob(['\uFEFF' + contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const enlaceDescarga = document.createElement('a');
    enlaceDescarga.href = url;
    
    const fechaInicio = document.getElementById('fechaInicio')?.value || 'inicio';
    const fechaFin = document.getElementById('fechaFin')?.value || 'fin';
    enlaceDescarga.setAttribute('download', `Productividad_Captura_${fechaInicio}_al_${fechaFin}.csv`);
    
    document.body.appendChild(enlaceDescarga);
    enlaceDescarga.click();
    document.body.removeChild(enlaceDescarga);
}

// Exponer la función de inicialización a window para que funcione con el cargador de vistas de app.js
window.inicializarVistaProductividad = inicializarVistaProductividad;
