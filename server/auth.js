'use strict';
const crypto = require('node:crypto');
const { all, get, run, hashClave, verificarClave } = require('./db');

const DURACION_SESION_H = 12;
const COOKIE = 'taller_sid';

// --- Permisos por rol ---------------------------------------------------
//   ver         consultar todo
//   estado      cambiar el estado de una cita (recepcionar, terminar...)
//   gestionar   crear, editar y borrar citas, clientes y vehículos
//   configurar  ajustes, servicios, bahías, mecánicos y usuarios
const PERMISOS = {
  admin: ['ver', 'estado', 'gestionar', 'configurar'],
  recepcion: ['ver', 'estado', 'gestionar'],
  mecanico: ['ver', 'estado'],
};
const ROLES = Object.keys(PERMISOS);

const permisosDe = (rol) => PERMISOS[rol] || [];
const tienePermiso = (usuario, permiso) => !!usuario && permisosDe(usuario.rol).includes(permiso);

// --- Contraseñas --------------------------------------------------------
const CLAVES_PROHIBIDAS = ['admin', 'administrador', 'password', 'contraseña', '12345678', '123456789', 'qwertyui', 'taller', 'ritmo'];

/** Devuelve el motivo por el que una contraseña no vale, o null si es válida. */
function problemaClave(clave, nombreUsuario) {
  const c = String(clave || '');
  if (c.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (c.length > 200) return 'La contraseña es demasiado larga';
  const baja = c.toLowerCase();
  if (nombreUsuario && baja === String(nombreUsuario).toLowerCase()) return 'La contraseña no puede ser igual al usuario';
  if (CLAVES_PROHIBIDAS.includes(baja) || /^(.)\1+$/.test(c)) return 'Esa contraseña es demasiado fácil de adivinar';
  return null;
}

// Hash de relleno para que "usuario inexistente" tarde lo mismo que "clave errónea"
const RELLENO = hashClave(crypto.randomBytes(12).toString('hex'));

// --- Control de intentos fallidos por IP --------------------------------
const intentos = new Map();
const MAX_INTENTOS = 8;
const VENTANA_MS = 10 * 60 * 1000;

function limpiarIntentosCaducados() {
  const ahora = Date.now();
  for (const [ip, dato] of intentos) if (ahora - dato.desde > VENTANA_MS) intentos.delete(ip);
}

function registrarFallo(ip) {
  limpiarIntentosCaducados();
  const previo = intentos.get(ip);
  if (!previo) intentos.set(ip, { n: 1, desde: Date.now() });
  else previo.n += 1;
}

function bloqueado(ip) {
  limpiarIntentosCaducados();
  const previo = intentos.get(ip);
  return !!previo && previo.n >= MAX_INTENTOS;
}

const limpiarIntentos = (ip) => intentos.delete(ip);

// --- Sesiones -----------------------------------------------------------
// En la base de datos solo se guarda el hash del token: quien copie el
// fichero no puede usar las sesiones abiertas.
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function purgarSesiones() {
  run('DELETE FROM sesiones WHERE expira_en < ?', new Date().toISOString());
}

function crearSesion(usuarioId) {
  purgarSesiones();
  const token = crypto.randomBytes(32).toString('hex');
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + DURACION_SESION_H * 3600 * 1000);
  run(
    'INSERT INTO sesiones (id, usuario_id, creada_en, expira_en) VALUES (?,?,?,?)',
    hashToken(token),
    usuarioId,
    ahora.toISOString(),
    expira.toISOString()
  );
  return { token, expira };
}

function leerCookies(req) {
  const cabecera = req.headers.cookie || '';
  const out = {};
  for (const parte of cabecera.split(';')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    try {
      out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
    } catch {
      /* cookie mal formada: se ignora */
    }
  }
  return out;
}

/** Usuario de la petición (o null). `sid` es el hash de la sesión. */
function usuarioDeReq(req) {
  const token = leerCookies(req)[COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const sid = hashToken(token);
  const fila = get(
    `SELECT u.id, u.usuario, u.nombre, u.rol, u.debe_cambiar_clave, s.expira_en
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = ? AND u.activo = 1`,
    sid
  );
  if (!fila) return null;
  if (new Date(fila.expira_en) < new Date()) {
    run('DELETE FROM sesiones WHERE id = ?', sid);
    return null;
  }
  return {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    rol: fila.rol,
    debe_cambiar_clave: !!fila.debe_cambiar_clave,
    permisos: permisosDe(fila.rol),
    sid,
  };
}

/** true si la sesión sigue existiendo, no ha caducado y el usuario está activo. */
function sesionValida(sid) {
  const fila = get(
    `SELECT s.expira_en FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = ? AND u.activo = 1`,
    sid
  );
  return !!fila && new Date(fila.expira_en) >= new Date();
}

function login(usuario, clave) {
  const nombre = String(usuario || '').trim().slice(0, 60);
  const fila = nombre ? get('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1', nombre) : null;
  if (!fila) {
    verificarClave(String(clave || ''), RELLENO.hash, RELLENO.salt);
    return null;
  }
  if (!verificarClave(String(clave || '').slice(0, 200), fila.hash, fila.salt)) return null;
  return {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    rol: fila.rol,
    debe_cambiar_clave: !!fila.debe_cambiar_clave,
    permisos: permisosDe(fila.rol),
  };
}

function comprobarClave(usuarioId, clave) {
  const fila = get('SELECT hash, salt FROM usuarios WHERE id = ?', usuarioId);
  return !!fila && verificarClave(String(clave || '').slice(0, 200), fila.hash, fila.salt);
}

const logout = (sid) => sid && run('DELETE FROM sesiones WHERE id = ?', sid);

/**
 * Cambia la contraseña. Cierra las demás sesiones del usuario (conservando la
 * actual si se indica) y marca si tendrá que cambiarla al entrar.
 */
function cambiarClave(usuarioId, clave, { conservarSid = null, debeCambiar = false } = {}) {
  const { hash, salt } = hashClave(String(clave));
  run('UPDATE usuarios SET hash = ?, salt = ?, debe_cambiar_clave = ? WHERE id = ?', hash, salt, debeCambiar ? 1 : 0, usuarioId);
  if (conservarSid) run('DELETE FROM sesiones WHERE usuario_id = ? AND id <> ?', usuarioId, conservarSid);
  else run('DELETE FROM sesiones WHERE usuario_id = ?', usuarioId);
}

const cerrarSesionesDe = (usuarioId) => run('DELETE FROM sesiones WHERE usuario_id = ?', usuarioId);

function cookieSesion(token, expira) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${expira.toUTCString()}`;
}

function cookieBorrada() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

module.exports = {
  COOKIE,
  ROLES,
  permisosDe,
  tienePermiso,
  problemaClave,
  crearSesion,
  usuarioDeReq,
  sesionValida,
  login,
  comprobarClave,
  logout,
  cambiarClave,
  cerrarSesionesDe,
  cookieSesion,
  cookieBorrada,
  registrarFallo,
  bloqueado,
  limpiarIntentos,
  purgarSesiones,
  listarUsuarios: () =>
    all('SELECT id, usuario, nombre, rol, activo, debe_cambiar_clave, creado_en FROM usuarios ORDER BY usuario'),
};
