'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DIR_DATOS = process.env.TALLER_DATOS || path.join(__dirname, '..', 'datos');
fs.mkdirSync(DIR_DATOS, { recursive: true });
const RUTA_BD = path.join(DIR_DATOS, 'taller.db');

const db = new DatabaseSync(RUTA_BD);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// Si otro proceso está escribiendo (p. ej. el cargador de ejemplo), esperar en vez de fallar
db.exec('PRAGMA busy_timeout = 5000');

// --- Helpers de consulta ------------------------------------------------
// node:sqlite no acepta undefined ni booleanos como parametros.
function limpiar(params) {
  return params.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}
const all = (sql, ...p) => db.prepare(sql).all(...limpiar(p));
const get = (sql, ...p) => db.prepare(sql).get(...limpiar(p)) || null;
const run = (sql, ...p) => db.prepare(sql).run(...limpiar(p));

/** Ejecuta fn dentro de una transacción: o se guarda todo o no se guarda nada. */
let enTransaccion = false;
function transaccion(fn) {
  if (enTransaccion) return fn();
  db.exec('BEGIN IMMEDIATE');
  enTransaccion = true;
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    enTransaccion = false;
  }
}

// --- Esquema ------------------------------------------------------------
db.exec([
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'recepcion',
    hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS sesiones (
    id TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada_en TEXT NOT NULL,
    expira_en TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    nif TEXT,
    telefono TEXT,
    email TEXT,
    direccion TEXT,
    poblacion TEXT,
    cp TEXT,
    notas TEXT,
    creado_en TEXT NOT NULL,
    actualizado_en TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);`,
  `CREATE INDEX IF NOT EXISTS idx_clientes_telefono ON clientes(telefono);`,
  `CREATE TABLE IF NOT EXISTS vehiculos (
    id INTEGER PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    matricula TEXT NOT NULL UNIQUE,
    marca TEXT,
    modelo TEXT,
    anio INTEGER,
    bastidor TEXT,
    combustible TEXT,
    km INTEGER,
    proxima_itv TEXT,
    proxima_revision TEXT,
    notas TEXT,
    creado_en TEXT NOT NULL,
    actualizado_en TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente ON vehiculos(cliente_id);`,
  `CREATE TABLE IF NOT EXISTS recursos (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    color TEXT,
    orden INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1
  );`,
  `CREATE TABLE IF NOT EXISTS servicios (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    duracion_min INTEGER NOT NULL DEFAULT 60,
    color TEXT,
    precio_orientativo REAL,
    orden INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1
  );`,
  `CREATE TABLE IF NOT EXISTS citas (
    id INTEGER PRIMARY KEY,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    vehiculo_id INTEGER REFERENCES vehiculos(id) ON DELETE SET NULL,
    servicio_id INTEGER REFERENCES servicios(id) ON DELETE SET NULL,
    bahia_id INTEGER REFERENCES recursos(id) ON DELETE SET NULL,
    mecanico_id INTEGER REFERENCES recursos(id) ON DELETE SET NULL,
    fecha TEXT NOT NULL,
    hora_inicio TEXT NOT NULL,
    duracion_min INTEGER NOT NULL DEFAULT 60,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    titulo TEXT,
    descripcion TEXT,
    km_entrada INTEGER,
    espera INTEGER NOT NULL DEFAULT 0,
    aviso_enviado_en TEXT,
    creado_en TEXT NOT NULL,
    actualizado_en TEXT NOT NULL,
    creado_por TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_citas_fecha ON citas(fecha);`,
  `CREATE INDEX IF NOT EXISTS idx_citas_vehiculo ON citas(vehiculo_id);`,
  `CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY,
    cita_id INTEGER NOT NULL REFERENCES citas(id) ON DELETE CASCADE,
    usuario TEXT,
    accion TEXT NOT NULL,
    detalle TEXT,
    fecha TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_historial_cita ON historial(cita_id);`,
  `CREATE TABLE IF NOT EXISTS ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );`,
].join('\n'));

// --- Ajustes ------------------------------------------------------------
const AJUSTES_DEFECTO = {
  nombre_taller: 'Ritmo Talleres',
  telefono_taller: '913 154 107',
  direccion_taller: 'Calle Ailanto 25, 28029 Madrid',
  email_taller: 'info@ritmotalleres.es',
  prefijo_pais: '34',
  hora_apertura: '08:00',
  hora_cierre: '19:00',
  pausa_inicio: '13:30',
  pausa_fin: '15:00',
  usar_pausa: '1',
  dias_laborables: '1,2,3,4,5',
  slot_min: '30',
  aviso_itv_dias: '30',
  plantilla_recordatorio:
    'Hola {cliente}, le recordamos su cita en {taller} el {fecha} a las {hora} para {servicio} ({matricula}). Si no puede venir, avísenos al {telefono_taller}. Gracias.',
};

function leerAjustes() {
  const filas = all('SELECT clave, valor FROM ajustes');
  const out = { ...AJUSTES_DEFECTO };
  for (const f of filas) out[f.clave] = f.valor;
  return out;
}

function guardarAjuste(clave, valor) {
  run(
    'INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
    clave,
    String(valor ?? '')
  );
}

// --- Contrasenas --------------------------------------------------------
function hashClave(clave, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(clave, salt, 150000, 32, 'sha256').toString('hex');
  return { hash, salt };
}

function verificarClave(clave, hash, salt) {
  const calculado = crypto.pbkdf2Sync(clave, salt, 150000, 32, 'sha256').toString('hex');
  const a = Buffer.from(calculado, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Datos iniciales ----------------------------------------------------
function sembrar() {
  const ahora = new Date().toISOString();

  if (get('SELECT COUNT(*) AS n FROM usuarios').n === 0) {
    const { hash, salt } = hashClave('admin');
    run(
      'INSERT INTO usuarios (usuario, nombre, rol, hash, salt, activo, debe_cambiar_clave, creado_en) VALUES (?,?,?,?,?,1,1,?)',
      'admin',
      'Administrador',
      'admin',
      hash,
      salt,
      ahora
    );
  }

  if (get('SELECT COUNT(*) AS n FROM recursos').n === 0) {
    const bahias = [
      ['Bahía 1', '#1e1e1e'],
      ['Bahía 2', '#4e4e4e'],
      ['Elevador', '#d7ff01'],
    ];
    bahias.forEach(([nombre, color], i) =>
      run('INSERT INTO recursos (tipo, nombre, color, orden, activo) VALUES (?,?,?,?,1)', 'bahia', nombre, color, i)
    );
    ['Mecánico 1', 'Mecánico 2'].forEach((nombre, i) =>
      run('INSERT INTO recursos (tipo, nombre, color, orden, activo) VALUES (?,?,?,?,1)', 'mecanico', nombre, '#4e4e4e', i)
    );
  }

  if (get('SELECT COUNT(*) AS n FROM servicios').n === 0) {
    const servicios = [
      ['Cambio de aceite y filtros', 45, '#1e1e1e', 75],
      ['Revisión general', 90, '#d7ff01', 60],
      ['Neumáticos (cambio y equilibrado)', 60, '#4e4e4e', 50],
      ['Frenos (pastillas / discos)', 120, '#b42318', 140],
      ['Diagnosis electrónica', 60, '#2f78b3', 45],
      ['Pre-ITV', 45, '#5c7000', 40],
      ['Distribución', 300, '#8a5a00', 450],
      ['Aire acondicionado', 90, '#0e7490', 90],
      ['Presupuesto / valoración', 30, '#b6b6b6', 0],
    ];
    servicios.forEach(([nombre, dur, color, precio], i) =>
      run(
        'INSERT INTO servicios (nombre, duracion_min, color, precio_orientativo, orden, activo) VALUES (?,?,?,?,?,1)',
        nombre,
        dur,
        color,
        precio,
        i
      )
    );
  }

  for (const [clave, valor] of Object.entries(AJUSTES_DEFECTO)) {
    if (!get('SELECT clave FROM ajustes WHERE clave = ?', clave)) guardarAjuste(clave, valor);
  }

  aplicarMarcaRitmo();
}

// Pasa a la imagen de Ritmo Talleres lo que todavía conserve los valores de
// fábrica de la primera versión. Lo que el taller haya cambiado a mano no se toca.
function aplicarMarcaRitmo() {
  const datosAntiguos = { nombre_taller: 'Mi Taller', telefono_taller: '', direccion_taller: '', email_taller: '' };
  for (const [clave, antiguo] of Object.entries(datosAntiguos)) {
    const fila = get('SELECT valor FROM ajustes WHERE clave = ?', clave);
    if (fila && (fila.valor ?? '') === antiguo) guardarAjuste(clave, AJUSTES_DEFECTO[clave]);
  }
  const coloresAntiguos = [
    ['bahia', 'Bahía 1', '#2f6fed', '#1e1e1e'],
    ['bahia', 'Bahía 2', '#12a370', '#4e4e4e'],
    ['bahia', 'Elevador', '#d97706', '#d7ff01'],
  ];
  for (const [tipo, nombre, antiguo, nuevo] of coloresAntiguos) {
    run('UPDATE recursos SET color = ? WHERE tipo = ? AND nombre = ? AND color = ?', nuevo, tipo, nombre, antiguo);
  }
  run("UPDATE recursos SET color = '#4e4e4e' WHERE tipo = 'mecanico' AND color = '#64748b'");

  const serviciosAntiguos = [
    ['Cambio de aceite y filtros', '#2f6fed', '#1e1e1e'],
    ['Revisión general', '#12a370', '#d7ff01'],
    ['Neumáticos (cambio y equilibrado)', '#7c3aed', '#4e4e4e'],
    ['Frenos (pastillas / discos)', '#dc2626', '#b42318'],
    ['Diagnosis electrónica', '#d97706', '#2f78b3'],
    ['Pre-ITV', '#0891b2', '#5c7000'],
    ['Distribución', '#be185d', '#8a5a00'],
    ['Aire acondicionado', '#0284c7', '#0e7490'],
    ['Presupuesto / valoración', '#64748b', '#b6b6b6'],
  ];
  for (const [nombre, antiguo, nuevo] of serviciosAntiguos) {
    run('UPDATE servicios SET color = ? WHERE nombre = ? AND color = ?', nuevo, nombre, antiguo);
  }
}

// --- Migraciones de bases ya existentes ---------------------------------
function columnas(tabla) {
  return all(`PRAGMA table_info(${tabla})`).map((c) => c.name);
}

function migrar() {
  if (!columnas('usuarios').includes('debe_cambiar_clave')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN debe_cambiar_clave INTEGER NOT NULL DEFAULT 0');
  }
  const version = Number((get("SELECT valor FROM ajustes WHERE clave = 'version_esquema'") || {}).valor || 1);
  if (version < 2) {
    // Las sesiones pasan a guardarse cifradas: las antiguas dejan de valer
    run('DELETE FROM sesiones');
    guardarAjuste('version_esquema', '2');
  }
}

/** Obliga a cambiar la contraseña a quien siga con la de fábrica admin/admin. */
function marcarClaveDeFabrica() {
  const admin = get("SELECT * FROM usuarios WHERE usuario = 'admin' AND debe_cambiar_clave = 0");
  if (admin && verificarClave('admin', admin.hash, admin.salt)) {
    run('UPDATE usuarios SET debe_cambiar_clave = 1 WHERE id = ?', admin.id);
  }
}

/**
 * El cliente de una cita abierta es siempre el propietario actual del coche.
 * Arregla las citas que se quedaron sin cliente (o con el anterior) cuando el
 * coche se asignó después. Las citas cerradas con cliente conservan el suyo.
 */
function repararClientesDeCitas() {
  const cerrados = ESTADOS_CERRADOS_SQL;
  const res = run(
    `UPDATE citas
        SET cliente_id = (SELECT v.cliente_id FROM vehiculos v WHERE v.id = citas.vehiculo_id)
      WHERE vehiculo_id IS NOT NULL
        AND (cliente_id IS NULL OR estado NOT IN (${cerrados}))
        AND IFNULL(cliente_id, -1) <> IFNULL((SELECT v.cliente_id FROM vehiculos v WHERE v.id = citas.vehiculo_id), -1)`
  );
  return Number(res.changes || 0);
}
const ESTADOS_CERRADOS_SQL = "'entregada','no_presentado','anulada'";

migrar();
sembrar();
marcarClaveDeFabrica();
const citasReparadas = repararClientesDeCitas();

// --- Copia de seguridad diaria -----------------------------------------
// VACUUM INTO crea una copia consistente aunque la base esté en uso (WAL).
function copiaSeguridad(diasAConservar = 30) {
  try {
    const dir = path.join(DIR_DATOS, 'copias');
    fs.mkdirSync(dir, { recursive: true });
    const hoy = new Date();
    const sello = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const destino = path.join(dir, `taller-${sello}.db`);
    if (!fs.existsSync(destino)) {
      db.exec(`VACUUM INTO '${destino.replace(/\\/g, '/').replace(/'/g, "''")}'`);
    }
    const limite = Date.now() - diasAConservar * 86400000;
    for (const f of fs.readdirSync(dir)) {
      const ruta = path.join(dir, f);
      if (f.startsWith('taller-') && fs.statSync(ruta).mtimeMs < limite) fs.unlinkSync(ruta);
    }
    return destino;
  } catch (e) {
    console.error('[copia de seguridad] no se pudo crear:', e.message);
    return null;
  }
}

/** Repite la copia cada hora: si el programa lleva días abierto, cada día tiene la suya. */
function programarCopias() {
  setInterval(() => copiaSeguridad(), 60 * 60 * 1000).unref();
}

module.exports = {
  copiaSeguridad,
  programarCopias,
  citasReparadas,
  ESTADOS_CERRADOS_SQL,
  transaccion,
  db,
  all,
  get,
  run,
  leerAjustes,
  guardarAjuste,
  hashClave,
  verificarClave,
  RUTA_BD,
  DIR_DATOS,
  AJUSTES_DEFECTO,
};
