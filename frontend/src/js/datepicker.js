/**
 * Datepicker Personalizado Premium (datepicker.js).
 * Implementa una interfaz de calendario fluida y moderna que sustituye
 * los selectores de fechas nativos del navegador.
 */

class DatepickerCustom {
    constructor(contenedor) {
        this.contenedor = contenedor;
        this.input = contenedor.querySelector('.input-datepicker');
        this.popover = null;
        this.fechaActual = new Date(); // Fecha de navegación del calendario
        this.fechaSeleccionada = null; // Fecha real seleccionada

        this.nombresMeses = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
        ];

        this.inicializar();
    }

    inicializar() {
        // 1. Crear la estructura del popover dinámicamente si no existe
        this.popover = document.createElement('div');
        this.popover.className = 'datepicker-popover';
        this.popover.style.display = 'none';
        this.contenedor.appendChild(this.popover);

        // 2. Interceptar la propiedad .value del input usando getters/setters personalizados
        this.aplicarInterceptorValue();

        // 3. Escuchar clics en el input para abrir/cerrar
        this.input.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePopover();
        });

        // 4. Registrar el valor por defecto si el input ya tiene valor o atributo value/data-valor
        const valDefecto = this.input.getAttribute('value') || this.input.value || '';
        if (valDefecto) {
            this.input.value = valDefecto; // Esto pasará por nuestro setter interceptor
        } else {
            this.setFechaHoy();
        }

        // 5. Cerrar al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!this.contenedor.contains(e.target)) {
                this.cerrar();
            }
        });
    }

    aplicarInterceptorValue() {
        const inputElement = this.input;
        const self = this;
        
        // Obtener el descriptor original del prototipo del HTMLInputElement
        const descriptorOriginal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

        Object.defineProperty(inputElement, 'value', {
            get: function() {
                // Al leer la propiedad .value, retornamos el formato DB (YYYY-MM-DD) para no romper APIs externas
                return this.getAttribute('data-valor') || '';
            },
            set: function(val) {
                if (!val) {
                    this.removeAttribute('data-valor');
                    descriptorOriginal.set.call(this, '');
                    return;
                }

                // Si se asigna formato YYYY-MM-DD
                if (val.includes('-')) {
                    const partes = val.split('-');
                    if (partes.length === 3) {
                        this.setAttribute('data-valor', val);
                        const valVisual = `${partes[2]}/${partes[1]}/${partes[0]}`;
                        descriptorOriginal.set.call(this, valVisual);

                        self.fechaSeleccionada = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
                        self.fechaActual = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, 1);
                    }
                } 
                // Si se asigna formato visual DD/MM/YYYY
                else if (val.includes('/')) {
                    const partes = val.split('/');
                    if (partes.length === 3) {
                        const valDb = `${partes[2]}-${partes[1]}-${partes[0]}`;
                        this.setAttribute('data-valor', valDb);
                        descriptorOriginal.set.call(this, val);

                        self.fechaSeleccionada = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
                        self.fechaActual = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, 1);
                    }
                } 
                // Cualquier otro valor de fallback
                else {
                    descriptorOriginal.set.call(this, val);
                    this.setAttribute('data-valor', val);
                }
            },
            configurable: true
        });
    }

    setFechaHoy() {
        const hoy = new Date();
        const y = hoy.getFullYear();
        const m = String(hoy.getMonth() + 1).padStart(2, '0');
        const d = String(hoy.getDate()).padStart(2, '0');
        this.input.value = `${y}-${m}-${d}`;
    }

    togglePopover() {
        const estaVisible = this.popover.style.display === 'block';
        
        // Cerrar todos los demás datepickers abiertos primero
        document.querySelectorAll('.datepicker-popover').forEach(p => p.style.display = 'none');

        if (estaVisible) {
            this.cerrar();
        } else {
            this.abrir();
        }
    }

    abrir() {
        if (this.fechaSeleccionada) {
            this.fechaActual = new Date(this.fechaSeleccionada.getFullYear(), this.fechaSeleccionada.getMonth(), 1);
        }
        this.renderCalendario();
        this.popover.style.display = 'block';
    }

    cerrar() {
        this.popover.style.display = 'none';
    }

    renderCalendario() {
        const anio = this.fechaActual.getFullYear();
        const mes = this.fechaActual.getMonth();

        // Primer día del mes (0 = Domingo, 1 = Lunes, etc.)
        const primerDiaSemana = new Date(anio, mes, 1).getDay();
        // Total de días del mes actual
        const totalDiasMes = new Date(anio, mes + 1, 0).getDate();
        // Total de días del mes anterior
        const totalDiasMesAnterior = new Date(anio, mes, 0).getDate();

        // 1. Armar cabecera del popover
        this.popover.innerHTML = `
            <div class="datepicker-header">
                <button type="button" class="btn-prev-mes">&lt;</button>
                <span class="datepicker-mes-anio">${this.nombresMeses[mes]} ${anio}</span>
                <button type="button" class="btn-next-mes">&gt;</button>
            </div>
            <div class="datepicker-dias-semana">
                <div>Do</div><div>Lu</div><div>Ma</div><div>Mi</div><div>Ju</div><div>Vi</div><div>Sá</div>
            </div>
            <div class="datepicker-cuadricula-dias"></div>
        `;

        // Vincular eventos de la cabecera
        this.popover.querySelector('.btn-prev-mes').addEventListener('click', (e) => {
            e.stopPropagation();
            this.cambiarMes(-1);
        });
        this.popover.querySelector('.btn-next-mes').addEventListener('click', (e) => {
            e.stopPropagation();
            this.cambiarMes(1);
        });

        const cuadricula = this.popover.querySelector('.datepicker-cuadricula-dias');

        // 2. Rellenar días del mes anterior (si los hay)
        for (let i = primerDiaSemana - 1; i >= 0; i--) {
            const diaNum = totalDiasMesAnterior - i;
            const divDia = document.createElement('div');
            divDia.className = 'datepicker-dia otro-mes deshabilitado';
            divDia.innerText = diaNum;
            cuadricula.appendChild(divDia);
        }

        // 3. Rellenar días del mes actual
        const hoy = new Date();
        for (let diaNum = 1; diaNum <= totalDiasMes; diaNum++) {
            const divDia = document.createElement('div');
            divDia.className = 'datepicker-dia';
            divDia.innerText = diaNum;

            // Verificar si es hoy
            if (hoy.getDate() === diaNum && hoy.getMonth() === mes && hoy.getFullYear() === anio) {
                divDia.classList.add('hoy');
            }

            // Verificar si está seleccionado
            if (this.fechaSeleccionada &&
                this.fechaSeleccionada.getDate() === diaNum &&
                this.fechaSeleccionada.getMonth() === mes &&
                this.fechaSeleccionada.getFullYear() === anio) {
                divDia.classList.add('seleccionado');
            }

            // Evento al seleccionar el día
            divDia.addEventListener('click', (e) => {
                e.stopPropagation();
                this.seleccionarDia(diaNum);
            });

            cuadricula.appendChild(divDia);
        }

        // 4. Rellenar días del mes siguiente para completar la cuadrícula (seis filas = 42 celdas)
        const totalCeldasActuales = primerDiaSemana + totalDiasMes;
        const celdasFaltantes = 42 - totalCeldasActuales;
        for (let i = 1; i <= celdasFaltantes; i++) {
            const divDia = document.createElement('div');
            divDia.className = 'datepicker-dia otro-mes deshabilitado';
            divDia.innerText = i;
            cuadricula.appendChild(divDia);
        }
    }

    cambiarMes(delta) {
        this.fechaActual.setMonth(this.fechaActual.getMonth() + delta);
        this.renderCalendario();
    }

    seleccionarDia(diaNum) {
        const anio = this.fechaActual.getFullYear();
        const mes = this.fechaActual.getMonth();
        const y = anio;
        const m = String(mes + 1).padStart(2, '0');
        const d = String(diaNum).padStart(2, '0');

        // Asignar el valor (esto disparará nuestro setter personalizado)
        this.input.value = `${y}-${m}-${d}`;
        this.cerrar();

        // Disparar evento de cambio nativo para que los listeners externos se enteren
        const evento = new Event('change', { bubbles: true });
        this.input.dispatchEvent(evento);
    }
}

// Función global de auto-inicialización
function inicializarDatepickersGlobales() {
    document.querySelectorAll('.custom-datepicker').forEach(contenedor => {
        if (!contenedor.dataset.inicializado) {
            contenedor.dataset.inicializado = 'true';
            new DatepickerCustom(contenedor);
        }
    });
}

// Inicializar al cargar el DOM
document.addEventListener("DOMContentLoaded", inicializarDatepickersGlobales);

// Exponer globalmente
window.inicializarDatepickersGlobales = inicializarDatepickersGlobales;
window.DatepickerCustom = DatepickerCustom;
