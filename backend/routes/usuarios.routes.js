/**
 * Enrutador de Express para la API de Usuarios (usuarios.routes.js).
 * Define los endpoints REST mapeados al controlador correspondiente.
 */

const express = require("express");
const enrutador = express.Router();
const controladorUsuarios = require("../controllers/usuarios.controller");

// Endpoint de login para la aplicacion cliente C#
enrutador.post("/login", async (req, res) => {
  try {
    const { nombre_usuario, pin } = req.body;
    if (!nombre_usuario || !pin) {
      return res
        .status(400)
        .json({ ok: false, mensaje: "Usuario y PIN requeridos." });
    }

    const usuario = await controladorUsuarios.loginUsuario(nombre_usuario, pin);
    if (usuario) {
      return res.json({ ok: true, usuario });
    } else {
      return res
        .status(401)
        .json({ ok: false, mensaje: "Usuario o PIN incorrectos." });
    }
  } catch (error) {
    return res
      .status(500)
      .json({ ok: false, mensaje: "Error en el servidor: " + error.message });
  }
});

// Obtener todos los usuarios (Vista admin)
enrutador.get("/", async (req, res) => {
  try {
    const usuarios = await controladorUsuarios.obtenerTodosUsuarios();
    return res.json({ ok: true, usuarios });
  } catch (error) {
    return res
      .status(500)
      .json({
        ok: false,
        mensaje: "Error al obtener usuarios: " + error.message,
      });
  }
});

// Crear un nuevo usuario
enrutador.post("/", async (req, res) => {
  try {
    const { nombre_completo, nombre_usuario, pin, turno } = req.body;
    if (!nombre_completo || !nombre_usuario || !pin || pin.length !== 4) {
      return res
        .status(400)
        .json({
          ok: false,
          mensaje: "Faltan datos obligatorios o el PIN no es de 4 digitos.",
        });
    }

    const nuevoId = await controladorUsuarios.crearUsuario(
      nombre_completo,
      nombre_usuario,
      pin,
      turno || "Matutino",
    );
    return res.json({
      ok: true,
      mensaje: "Usuario creado con éxito.",
      id: nuevoId,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ ok: false, mensaje: "Ese nombre de usuario ya existe." });
    }
    return res
      .status(500)
      .json({ ok: false, mensaje: "Error al crear usuario: " + error.message });
  }
});

// Actualizar un usuario existente
enrutador.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre_completo, nombre_usuario, pin, turno } = req.body;
    if (!nombre_completo || !nombre_usuario || !pin || pin.length !== 4) {
      return res
        .status(400)
        .json({
          ok: false,
          mensaje: "Faltan datos obligatorios o el PIN no es de 4 digitos.",
        });
    }

    await controladorUsuarios.actualizarUsuario(
      id,
      nombre_completo,
      nombre_usuario,
      pin,
      turno || "Matutino",
    );
    return res.json({
      ok: true,
      mensaje: "Usuario actualizado correctamente.",
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({
          ok: false,
          mensaje: "Ese nombre de usuario ya existe en otro registro.",
        });
    }
    return res
      .status(500)
      .json({
        ok: false,
        mensaje: "Error al actualizar usuario: " + error.message,
      });
  }
});

// Eliminar un usuario
enrutador.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await controladorUsuarios.eliminarUsuario(id);
    return res.json({ ok: true, mensaje: "Usuario eliminado correctamente." });
  } catch (error) {
    return res
      .status(500)
      .json({
        ok: false,
        mensaje: "Error al eliminar usuario: " + error.message,
      });
  }
});

// Intercambio de turnos masivo
enrutador.post("/intercambiar-turnos", async (req, res) => {
  try {
    const actualizados = await controladorUsuarios.intercambiarTurnos();
    return res.json({
      ok: true,
      mensaje: `Se han intercambiado los turnos de ${actualizados} usuarios.`,
    });
  } catch (error) {
    return res
      .status(500)
      .json({
        ok: false,
        mensaje: "Error al intercambiar turnos: " + error.message,
      });
  }
});

module.exports = enrutador;
