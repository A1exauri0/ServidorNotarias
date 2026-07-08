/**
 * JS Modular para el Reporte de Productividad Diaria por Capturista (productividad.js).
 * Controla el listado estilo hoja de cálculo y la exportación compatible con Microsoft Excel.
 */

let listaReporteLocal = [];

async function inicializarVistaProductividad() {
    // 1. Establecer rango de fechas por defecto (del 1 del mes actual a hoy)
    establecerRangoFechasDefecto();

    // 2. Vincular listeners de cambio de fecha para recargar los datos
    const inputInicio = document.getElementById('prodFechaInicio');
    const inputFin = document.getElementById('prodFechaFin');

    if (inputInicio) inputInicio.addEventListener('change', cargarReporteProductividad);
    if (inputFin) inputFin.addEventListener('change', cargarReporteProductividad);

    // 3. Vincular botón de exportación a Excel
    const btnExcel = document.getElementById('btnExportarExcelProd');
    if (btnExcel) {
        btnExcel.addEventListener('click', exportarProductividadExcel);
    }

    // 4. Realizar la primera carga de datos
    await cargarReporteProductividad();
}

// Establece el rango de fechas en los inputs de productividad
function establecerRangoFechasDefecto() {
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');

    const primerDia = `${anio}-${mes}-01`;
    const ultimoDia = `${anio}-${mes}-${dia}`;

    const inputInicio = document.getElementById('prodFechaInicio');
    const inputFin = document.getElementById('prodFechaFin');

    if (inputInicio) inputInicio.value = primerDia;
    if (inputFin) inputFin.value = ultimoDia;
}

// Consulta a la API de Express la productividad consolidada
async function cargarReporteProductividad() {
    const inputInicio = document.getElementById('prodFechaInicio');
    const inputFin = document.getElementById('prodFechaFin');
    if (!inputInicio || !inputFin) return;

    const fechaInicio = inputInicio.value;
    const fechaFin = inputFin.value;

    const tbody = document.getElementById('tablaProductividadBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--color-texto-secundario); padding: 25px;">Cargando reporte de productividad diaria...</td></tr>`;
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
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #eb5584; padding: 25px;">Error al conectar con la base de datos local.</td></tr>`;
        }
    }
}

// Renderiza las filas en la tabla estilo hoja de cálculo
function renderizarTablaProductividad() {
    const tbody = document.getElementById('tablaProductividadBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (listaReporteLocal.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--color-texto-secundario); padding: 30px;">No se encontraron registros de captura en este rango de fechas.</td></tr>`;
        return;
    }

    listaReporteLocal.forEach((item, index) => {
        const fila = document.createElement('tr');
        
        // Formatear la fecha a visual estándar (dd/mm/yyyy)
        let fechaVisual = item.fecha;
        try {
            const partes = item.fecha.split('-');
            fechaVisual = `${partes[2]}/${partes[1]}/${partes[0]}`;
        } catch (e) {}

        fila.innerHTML = `
            <td style="text-align: center; font-weight: bold; color: var(--color-texto-secundario);">${index + 1}</td>
            <td style="font-weight: 600;">${item.usuario}</td>
            <td style="text-align: center; font-family: monospace;">${fechaVisual}</td>
            <td style="text-align: center; font-weight: 600; color: var(--color-primario);">${item.total_pdfs}</td>
            <td style="text-align: center; font-weight: 600;">${item.total_paginas}</td>
        `;
        tbody.appendChild(fila);
    });
}

// Genera un archivo CSV compatible con Excel agregando el BOM UTF-8
function exportarProductividadExcel() {
    if (listaReporteLocal.length === 0) {
        alert('No hay información en el reporte para exportar.');
        return;
    }

    // Cabeceras y filas formateadas para CSV (Excel en español en Windows requiere punto y coma como separador)
    const separador = ';';
    const cabeceras = ['Capturista', 'Fecha de Registro', 'Total de PDFs', 'Total de Imagenes (Paginas)'];
    
    let contenidoCsv = cabeceras.join(separador) + '\n';

    listaReporteLocal.forEach(item => {
        let fechaVisual = item.fecha;
        try {
            const partes = item.fecha.split('-');
            fechaVisual = `${partes[2]}/${partes[1]}/${partes[0]}`;
        } catch (e) {}

        const fila = [
            item.usuario,
            fechaVisual,
            item.total_pdfs,
            item.total_paginas
        ];
        contenidoCsv += fila.join(separador) + '\n';
    });

    // Inyectar el BOM (Byte Order Mark) de UTF-8 (\uFEFF) para que Excel reconozca tildes y caracteres en español
    const blob = new Blob(['\uFEFF' + contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const enlaceDescarga = document.createElement('a');
    enlaceDescarga.href = url;
    
    const fechaInicio = document.getElementById('prodFechaInicio').value;
    const fechaFin = document.getElementById('prodFechaFin').value;
    enlaceDescarga.setAttribute('download', `Productividad_Captura_${fechaInicio}_al_${fechaFin}.csv`);
    
    document.body.appendChild(enlaceDescarga);
    enlaceDescarga.click();
    document.body.removeChild(enlaceDescarga);
}

// Exponer la función de inicialización a window para que funcione con el cargador de vistas de app.js
window.inicializarVistaProductividad = inicializarVistaProductividad;
