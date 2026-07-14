/**
 * JS Modular para el Reporte de Productividad Diaria por Capturista (productividad.js).
 * Controla el listado consolidado ordenado por turno, la consulta global por usuario y la exportación.
 */

let listaReporteLocal = [];

// Inicialización global al cargar el documento (para la opción del menú lateral persistente)
document.addEventListener("DOMContentLoaded", () => {
    // 1. Vincular botón del menú lateral
    const btnMenuConsulta = document.getElementById('btnMenuConsultarUsuario');
    if (btnMenuConsulta) {
        btnMenuConsulta.addEventListener('click', abrirModalConsultaUsuario);
    }

    // 2. Vincular eventos de cierre del modal de consulta
    const btnCerrar = document.getElementById('btnCerrarModalConsulta');
    if (btnCerrar) {
        btnCerrar.addEventListener('click', cerrarModalConsultaUsuario);
    }

    // 3. Vincular formulario de consulta por usuario
    const formConsulta = document.getElementById('formConsultaUsuario');
    if (formConsulta) {
        formConsulta.addEventListener('submit', procesarConsultaUsuario);
    }
});

// Inicialización específica al abrir la pestaña de Productividad
async function inicializarVistaProductividad() {
    listaReporteLocal = [];
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

// Renderiza las filas en la tabla ordenadas jerárquicamente por turno
function renderizarTablaProductividad() {
    const tbody = document.getElementById('tablaProductividadBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (listaReporteLocal.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--color-texto-secundario); padding: 30px;">No se encontraron registros de captura para el rango seleccionado.</td></tr>`;
        return;
    }

    // Orden jerárquico fijo de los turnos para evitar registros mezclados
    const ORDEN_TURNOS = {
        "matutino": 1,
        "vespertino": 2,
        "nocturno": 3
    };

    // Ordenar los registros por Turno, y secundariamente por Capturista
    const registrosOrdenados = [...listaReporteLocal].sort((a, b) => {
        const pesoA = ORDEN_TURNOS[(a.turno || 'Matutino').toLowerCase()] || 99;
        const pesoB = ORDEN_TURNOS[(b.turno || 'Matutino').toLowerCase()] || 99;
        
        if (pesoA !== pesoB) {
            return pesoA - pesoB;
        }
        return (a.usuario || '').localeCompare(b.usuario || '');
    });

    registrosOrdenados.forEach((item) => {
        const fila = document.createElement('tr');
        
        // Formatear la fecha a visual estándar (dd/mm/yyyy)
        let fechaVisual = item.fecha;
        try {
            const partes = item.fecha.split('-');
            fechaVisual = `${partes[2]}/${partes[1]}/${partes[0]}`;
        } catch (e) {}

        // Determinar color de fondo según el turno
        let colorFondo = '#F2F2F2';
        const turnoLower = (item.turno || 'Matutino').toLowerCase();
        if (turnoLower === 'matutino') {
            colorFondo = '#FFF2CC'; // Amarillo pastel
        } else if (turnoLower === 'vespertino') {
            colorFondo = '#E2EFDA'; // Verde pastel
        } else if (turnoLower === 'nocturno') {
            colorFondo = '#DDEBF7'; // Azul pastel
        }

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

// Abre el modal de consulta por usuario de forma global
function abrirModalConsultaUsuario() {
    const modal = document.getElementById('modalConsultaProductividad');
    if (!modal) return;

    // Resetear panel de resultados
    const panel = document.getElementById('panelResultadosConsulta');
    if (panel) panel.style.display = 'none';

    // Poblar dropdown con usuarios únicos de la sesión actual
    const cbo = document.getElementById('cboConsultaUsuario');
    if (cbo) {
        cbo.innerHTML = '';
        // Si la lista local está vacía, intentar obtener todos los usuarios del sistema
        const usuariosUnicos = [...new Set(listaReporteLocal.map(item => item.usuario))].sort();
        
        if (usuariosUnicos.length > 0) {
            usuariosUnicos.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u;
                opt.innerText = u;
                cbo.appendChild(opt);
            });
        } else {
            // Fallback si el admin abre el modal desde otra vista
            const opt = document.createElement('option');
            opt.innerText = "Carga la pestaña productividad primero";
            cbo.appendChild(opt);
        }
    }

    // Poner fecha de hoy por defecto en el input
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

// Exponer la función de inicialización a window para que funcione con el cargador de vistas de app.js
window.inicializarVistaProductividad = inicializarVistaProductividad;
