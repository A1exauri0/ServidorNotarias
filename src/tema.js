// Script para controlar el cambio de tema claro/oscuro de la aplicación
document.addEventListener('DOMContentLoaded', () => {
    const btnTema = document.getElementById('btnTema');
    
    if (btnTema) {
        // Cargar el tema preferido guardado por el usuario
        const temaGuardado = localStorage.getItem('tema');
        if (temaGuardado === 'claro') {
            document.body.classList.add('tema-claro');
            btnTema.querySelector('iconify-icon').setAttribute('icon', 'mdi:weather-night');
        }

        btnTema.addEventListener('click', () => {
            document.body.classList.toggle('tema-claro');
            const esClaro = document.body.classList.contains('tema-claro');
            localStorage.setItem('tema', esClaro ? 'claro' : 'oscuro');
            
            // Actualizar el icono del botón (Sol en modo oscuro, Luna en modo claro)
            btnTema.querySelector('iconify-icon').setAttribute('icon', esClaro ? 'mdi:weather-night' : 'mdi:weather-sunny');

            // Actualizar colores de las gráficas de Chart.js si la función está expuesta en window
            if (typeof window.actualizarColoresGraficasPorTema === 'function') {
                window.actualizarColoresGraficasPorTema(esClaro);
            }
        });
    }
});
