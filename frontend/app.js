// Variables globales para las gráficas de Chart.js
let instanciaGraficaBarras = null;
let instanciaGraficaPastel = null;

// Ejecutar cuando se cargue el DOM de la aplicación
document.addEventListener('DOMContentLoaded', () => {
    establecerFechasPorDefecto();
    consultarEstadisticas();

    // Evento de clic en el botón de aplicar filtros
    document.getElementById('btnFiltrar').addEventListener('click', () => {
        consultarEstadisticas();
    });
});

// Establece las fechas del filtro (del 1 del mes actual al día de hoy)
function establecerFechasPorDefecto() {
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');

    const primerDia = `${anio}-${mes}-01`;
    const ultimoDia = `${anio}-${mes}-${dia}`;

    document.getElementById('fechaInicio').value = primerDia;
    document.getElementById('fechaFin').value = ultimoDia;
}

// Consulta a la API local de Express y actualiza la interfaz
async function consultarEstadisticas() {
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;

    try {
        const respuesta = await fetch(`http://localhost:3000/api/estadisticas/productividad?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`);
        const datos = await respuesta.json();

        if (datos.ok) {
            actualizarKpisYGraficas(datos);
        } else {
            console.error('Error del servidor:', datos.mensaje);
        }
    } catch (error) {
        console.error('Error al conectar con la API de Express:', error);
    }
}

// Procesa y formatea los datos para renderizar la UI
function actualizarKpisYGraficas(datos) {
    // Mezclar los registros de Notarías y Digitalización
    const registrosCombinados = {};

    // Procesar datos de Notarías
    datos.notarias.forEach(item => {
        const notariaNombre = item.notaria;
        if (!registrosCombinados[notariaNombre]) {
            registrosCombinados[notariaNombre] = { pdfs: 0, imagenes: 0 };
        }
        registrosCombinados[notariaNombre].pdfs += parseInt(item.total_pdfs || 0, 10);
        registrosCombinados[notariaNombre].imagenes += parseInt(item.total_imagenes || 0, 10);
    });

    // Procesar datos de Digitalización
    datos.digitalizacion.forEach(item => {
        const notariaNombre = item.notaria;
        if (!registrosCombinados[notariaNombre]) {
            registrosCombinados[notariaNombre] = { pdfs: 0, imagenes: 0 };
        }
        registrosCombinados[notariaNombre].pdfs += parseInt(item.total_pdfs || 0, 10);
        registrosCombinados[notariaNombre].imagenes += parseInt(item.total_imagenes || 0, 10);
    });

    // Calcular totales de KPIs
    let totalPdfs = 0;
    let totalImagenes = 0;
    const listaNotarias = Object.keys(registrosCombinados);

    listaNotarias.forEach(clave => {
        totalPdfs += registrosCombinados[clave].pdfs;
        totalImagenes += registrosCombinados[clave].imagenes;
    });

    // Actualizar elementos HTML del KPI
    document.getElementById('txtTotalPdfs').innerText = totalPdfs.toLocaleString();
    document.getElementById('txtTotalImagenes').innerText = totalImagenes.toLocaleString();
    document.getElementById('txtTotalNotarias').innerText = listaNotarias.length.toString();

    // Renderizar Gráficas
    renderizarGraficaBarras(registrosCombinados, listaNotarias);
    renderizarGraficaPastel(registrosCombinados, listaNotarias);
}

// Pinta la gráfica de barras de productividad
function renderizarGraficaBarras(datosCombinados, listaNotarias) {
    const ctx = document.getElementById('graficaBarras').getContext('2d');

    const datasetsPdfs = [];
    const datasetsImagenes = [];

    listaNotarias.forEach(notaria => {
        datasetsPdfs.push(datosCombinados[notaria].pdfs);
        datasetsImagenes.push(datosCombinados[notaria].imagenes);
    });

    // Destruir instancia anterior si existe
    if (instanciaGraficaBarras) {
        instanciaGraficaBarras.destroy();
    }

    instanciaGraficaBarras = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: listaNotarias,
            datasets: [
                {
                    label: 'PDFs Capturados',
                    data: datasetsPdfs,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 6
                },
                {
                    label: 'Imágenes / Páginas',
                    data: datasetsImagenes,
                    backgroundColor: 'rgba(16, 185, 129, 0.75)',
                    borderColor: '#10b981',
                    borderWidth: 1,
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#9ca3af', font: { family: 'Outfit' } }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#9ca3af', font: { family: 'Inter' } },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                y: {
                    ticks: { color: '#9ca3af', font: { family: 'Inter' } },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            }
        }
    });
}

// Pinta la gráfica de pastel/dona para la distribución
function renderizarGraficaPastel(datosCombinados, listaNotarias) {
    const ctx = document.getElementById('graficaPastel').getContext('2d');

    const datasetsPdfs = [];
    listaNotarias.forEach(notaria => {
        datasetsPdfs.push(datosCombinados[notaria].pdfs);
    });

    // Destruir instancia anterior si existe
    if (instanciaGraficaPastel) {
        instanciaGraficaPastel.destroy();
    }

    instanciaGraficaPastel = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: listaNotarias,
            datasets: [{
                data: datasetsPdfs,
                backgroundColor: [
                    'rgba(59, 130, 246, 0.7)',
                    'rgba(139, 92, 246, 0.7)',
                    'rgba(236, 72, 153, 0.7)',
                    'rgba(245, 158, 11, 0.7)',
                    'rgba(16, 185, 129, 0.7)',
                    'rgba(99, 102, 241, 0.7)'
                ],
                borderColor: '#141a2a',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#9ca3af', font: { family: 'Outfit' } }
                }
            }
        }
    });
}
