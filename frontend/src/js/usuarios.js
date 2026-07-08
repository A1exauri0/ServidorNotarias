/**
 * JS Modular para la Administración de Usuarios (Pestaña Usuarios).
 * Controla toda la interacción del CRUD, buscador y PIN Maestro con la API local.
 */

let listaUsuariosLocal = [];

// Inicializador principal expuesto globalmente
async function inicializarVistaUsuarios() {
    // 1. Obtener y configurar el PIN Maestro
    await consultarPinMaestro();

    // 2. Cargar listado inicial de usuarios en la tabla
    await cargarTablaUsuarios();

    // 3. Vincular evento para guardar el PIN Maestro
    const btnGuardarPin = document.getElementById('btnGuardarPinMaestro');
    if (btnGuardarPin) {
        btnGuardarPin.addEventListener('click', guardarPinMaestro);
    }

    // 4. Vincular el buscador en tiempo real de usuarios
    const buscador = document.getElementById('buscadorUsuarios');
    if (buscador) {
        buscador.addEventListener('input', (e) => {
            const termino = e.target.value.toLowerCase().trim();
            filtrarYRenderizarTablaUsuarios(termino);
        });
    }

    // 5. Vincular botones del modal y formulario
    const btnAgregar = document.getElementById('btnAgregarUsuario');
    if (btnAgregar) btnAgregar.addEventListener('click', abrirModalCrear);

    const btnCerrar = document.getElementById('btnCerrarModal');
    if (btnCerrar) btnCerrar.addEventListener('click', cerrarModalUsuario);

    const btnCancelar = document.getElementById('btnCancelarUsuario');
    if (btnCancelar) btnCancelar.addEventListener('click', cerrarModalUsuario);

    const formulario = document.getElementById('formularioUsuario');
    if (formulario) formulario.addEventListener('submit', guardarUsuario);

    // 6. Vincular botón de intercambiar turnos masivamente
    const btnSwap = document.getElementById('btnIntercambiarTurnos');
    if (btnSwap) btnSwap.addEventListener('click', intercambiarTurnosUsuarios);
}

// Consulta el PIN Maestro actual a la API
async function consultarPinMaestro() {
    try {
        const respuesta = await fetch('http://localhost:3000/api/usuarios/pin-maestro');
        const datos = await respuesta.json();
        if (datos.ok) {
            const inputPin = document.getElementById('txtPinMaestro');
            if (inputPin) inputPin.value = datos.pin_maestro;
        }
    } catch (error) {
        console.error('Error al obtener PIN Maestro:', error);
    }
}

// Guarda/Actualiza el PIN Maestro
async function guardarPinMaestro() {
    const inputPin = document.getElementById('txtPinMaestro');
    if (!inputPin) return;

    const pinVal = inputPin.value.trim();
    if (pinVal.length !== 4 || isNaN(pinVal)) {
        alert('El PIN Maestro debe ser exactamente de 4 dígitos numéricos.');
        return;
    }

    try {
        const respuesta = await fetch('http://localhost:3000/api/usuarios/pin-maestro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pinVal })
        });
        const datos = await respuesta.json();
        if (datos.ok) {
            alert('PIN Maestro guardado con éxito.');
        } else {
            alert('Error: ' + datos.mensaje);
        }
    } catch (error) {
        console.error('Error al guardar PIN Maestro:', error);
        alert('Error de red al guardar el PIN Maestro.');
    }
}

// Carga la lista de usuarios de MySQL
async function cargarTablaUsuarios() {
    try {
        const respuesta = await fetch('http://localhost:3000/api/usuarios');
        const datos = await respuesta.json();
        if (datos.ok) {
            listaUsuariosLocal = datos.usuarios || [];
            const buscador = document.getElementById('buscadorUsuarios');
            const termino = buscador ? buscador.value.toLowerCase().trim() : '';
            filtrarYRenderizarTablaUsuarios(termino);
        }
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
    }
}

// Renderiza y filtra localmente la tabla en base a la entrada
function filtrarYRenderizarTablaUsuarios(termino) {
    const tbody = document.getElementById('tablaUsuariosBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const filtrados = listaUsuariosLocal.filter(u => {
        const nombre = (u.nombre_completo || '').toLowerCase();
        const user = (u.nombre_usuario || '').toLowerCase();
        return nombre.includes(termino) || user.includes(termino);
    });

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--color-texto-secundario); padding: 30px;">No se encontraron usuarios.</td></tr>`;
        return;
    }

    filtrados.forEach(u => {
        const fila = document.createElement('tr');
        
        fila.innerHTML = `
            <td style="text-align: center; font-weight: bold; color: var(--color-texto-secundario);">${u.id}</td>
            <td style="font-weight: 500;">${u.nombre_completo}</td>
            <td style="color: var(--color-primario); font-family: monospace;">${u.nombre_usuario}</td>
            <td style="text-align: center; letter-spacing: 2px;">••••</td>
            <td>${u.turno || 'Matutino'}</td>
            <td style="text-align: right;">
                <button class="btn-accion-tabla editar" title="Editar Usuario" onclick="abrirModalEditar(${u.id})">
                    <iconify-icon icon="mdi:pencil-outline"></iconify-icon>
                </button>
                <button class="btn-accion-tabla eliminar" title="Eliminar Usuario" onclick="confirmarEliminarUsuario(${u.id}, '${u.nombre_completo}')">
                    <iconify-icon icon="mdi:trash-can-outline"></iconify-icon>
                </button>
            </td>
        `;
        tbody.appendChild(fila);
    });
}

// Limpia e inicializa el modal para creación
function abrirModalCrear() {
    const titulo = document.getElementById('modalUsuarioTitulo');
    if (titulo) titulo.innerText = 'Nuevo Usuario';

    document.getElementById('txtIdUsuario').value = '';
    document.getElementById('txtNombreCompleto').value = '';
    document.getElementById('txtNombreUsuario').value = '';
    document.getElementById('txtPin').value = '';
    document.getElementById('cmbTurno').value = 'Matutino';

    const modal = document.getElementById('modalUsuario');
    if (modal) modal.style.display = 'flex';
}

// Carga los datos del usuario en el modal para edición
function abrirModalEditar(id) {
    const usuario = listaUsuariosLocal.find(u => u.id === id);
    if (!usuario) return;

    const titulo = document.getElementById('modalUsuarioTitulo');
    if (titulo) titulo.innerText = 'Editar Usuario';

    document.getElementById('txtIdUsuario').value = usuario.id;
    document.getElementById('txtNombreCompleto').value = usuario.nombre_completo;
    document.getElementById('txtNombreUsuario').value = usuario.nombre_usuario;
    document.getElementById('txtPin').value = usuario.pin;
    document.getElementById('cmbTurno').value = usuario.turno || 'Matutino';

    const modal = document.getElementById('modalUsuario');
    if (modal) modal.style.display = 'flex';
}

// Cierra el modal
function cerrarModalUsuario() {
    const modal = document.getElementById('modalUsuario');
    if (modal) modal.style.display = 'none';
}

// Envia los datos a la API (POST para crear, PUT para editar)
async function guardarUsuario() {
    const id = document.getElementById('txtIdUsuario').value;
    const nombreCompleto = document.getElementById('txtNombreCompleto').value.trim();
    const nombreUsuario = document.getElementById('txtNombreUsuario').value.trim();
    const pin = document.getElementById('txtPin').value.trim();
    const turno = document.getElementById('cmbTurno').value;

    if (!nombreCompleto || !nombreUsuario || pin.length !== 4 || isNaN(pin)) {
        alert('Por favor llene todos los campos obligatorios. El PIN debe ser exactamente de 4 dígitos numéricos.');
        return;
    }

    const payload = {
        nombre_completo: nombreCompleto,
        nombre_usuario: nombreUsuario,
        pin: pin,
        turno: turno
    };

    const url = id ? `http://localhost:3000/api/usuarios/${id}` : 'http://localhost:3000/api/usuarios';
    const metodo = id ? 'PUT' : 'POST';

    try {
        const respuesta = await fetch(url, {
            method: metodo,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const datos = await respuesta.json();
        
        if (datos.ok) {
            cerrarModalUsuario();
            await cargarTablaUsuarios();
        } else {
            alert('Error: ' + datos.mensaje);
        }
    } catch (error) {
        console.error('Error al guardar usuario:', error);
        alert('Error de red al guardar el usuario.');
    }
}

// Confirma y elimina un usuario de MySQL
async function confirmarEliminarUsuario(id, nombre) {
    const confirmar = confirm(`¿Está seguro de que desea eliminar permanentemente al capturista "${nombre}"?`);
    if (!confirmar) return;

    try {
        const respuesta = await fetch(`http://localhost:3000/api/usuarios/${id}`, {
            method: 'DELETE'
        });
        const datos = await respuesta.json();
        if (datos.ok) {
            await cargarTablaUsuarios();
        } else {
            alert('Error: ' + datos.mensaje);
        }
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        alert('Error de red al eliminar el usuario.');
    }
}

// Ejecuta el intercambio de turnos masivo en el servidor
async function intercambiarTurnosUsuarios() {
    const confirmar = confirm('Esta acción cambiará los turnos de todos los usuarios registrados (de Matutino a Vespertino y viceversa).\n¿Desea continuar?');
    if (!confirmar) return;

    try {
        const respuesta = await fetch('http://localhost:3000/api/usuarios/intercambiar-turnos', {
            method: 'POST'
        });
        const datos = await respuesta.json();
        if (datos.ok) {
            alert(datos.mensaje);
            await cargarTablaUsuarios();
        } else {
            alert('Error: ' + datos.mensaje);
        }
    } catch (error) {
        console.error('Error al intercambiar turnos:', error);
    }
}

// Expone las funciones de edición y eliminación al window para que funcionen con los atributos onclick del HTML
window.inicializarVistaUsuarios = inicializarVistaUsuarios;
window.abrirModalEditar = abrirModalEditar;
window.confirmarEliminarUsuario = confirmarEliminarUsuario;
