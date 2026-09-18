'use strict';
const {
  all, get, run, transaccion, leerAjustes, guardarAjuste, hashClave, AJUSTES_DEFECTO, ESTADOS_CERRADOS_SQL,
  copiaCompleta, DIR_DATOS,
} = require('./db');
const path = require('node:path');
const { noEncontrado, peticionMala, prohibido, conflicto } = require('./http');
const U = require('./util');
const auth = require('./auth');
const eventos = require('./eventos');

const ahora = () => new Date().toISOString();
const COMBUSTIBLES = ['Gasolina', 'Diésel', 'Híbrido', 'Eléctrico', 'GLP', 'GNC'];

/** Número de filas pedido por la pantalla, dentro de unos límites sensatos. */
const limiteSeguro = (v, defecto = 200, maximo = 500) => Math.min(Math.max(U.aEntero(v) || defecto, 1), maximo);

/** Patrón LIKE, o null (no coincide con nada) si el texto queda vacío. */
const patronONulo = (texto) => (String(texto || '').trim() ? U.patronLike(texto) : null);

// ======================= CLIENTES =======================================
function listarClientes(q, limite) {
  const texto = String(q || '').trim();
  const like = U.patronLike(texto);
  const digitos = texto.replace(/\D/g, '');
  const likeTel = digitos.length >= 3 ? U.patronLike(digitos) : null;
  const likeMat = patronONulo(U.normalizarMatricula(texto));
  return all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM vehiculos v WHERE v.cliente_id = c.id) AS n_vehiculos,
            (SELECT GROUP_CONCAT(v.matricula, ', ') FROM vehiculos v WHERE v.cliente_id = c.id) AS matriculas
       FROM clientes c
      WHERE ? = ''
         OR LOWER(c.nombre) LIKE ? ESCAPE '\\'
         OR LOWER(IFNULL(c.email,'')) LIKE ? ESCAPE '\\'
         OR LOWER(IFNULL(c.nif,'')) LIKE ? ESCAPE '\\'
         OR REPLACE(REPLACE(REPLACE(IFNULL(c.telefono,''),' ',''),'-',''),'.','') LIKE ? ESCAPE '\\'
         OR c.id IN (SELECT v.cliente_id FROM vehiculos v WHERE LOWER(v.matricula) LIKE ? ESCAPE '\\')
      ORDER BY c.nombre COLLATE NOCASE
      LIMIT ?`,
    texto, like, like, like, likeTel, likeMat, limiteSeguro(limite)
  );
}

function datosCliente(c) {
  const nombre = U.limpiarTexto(c.nombre, 150);
  if (!nombre) throw peticionMala('El nombre del cliente es obligatorio');
  const telefono = U.limpiarTexto(c.telefono, 30);
  if (telefono && telefono.replace(/\D/g, '').length < 6) throw peticionMala('El teléfono no es válido (mínimo 6 cifras)');
  const email = U.limpiarTexto(c.email, 120);
  if (email && !U.esEmail(email)) throw peticionMala('El email no es válido');
  const nif = U.limpiarTexto(c.nif, 20);
  return {
    nombre,
    nif: nif ? nif.toUpperCase().replace(/[\s.-]/g, '') : null,
    telefono,
    email: email ? email.toLowerCase() : null,
    direccion: U.limpiarTexto(c.direccion, 200),
    poblacion: U.limpiarTexto(c.poblacion, 100),
    cp: U.limpiarTexto(c.cp, 10),
    notas: U.limpiarTexto(c.notas, 2000),
  };
}

/** Clientes que ya tienen el mismo NIF o el mismo teléfono. */
function buscarDuplicados(d, excluirId = null) {
  const tel = U.telefonoNormalizado(d.telefono);
  if (!d.nif && tel.length < 9) return [];
  return all('SELECT id, nombre, telefono, nif FROM clientes WHERE id <> IFNULL(?, -1)', excluirId).filter(
    (c) => (d.nif && c.nif && c.nif === d.nif) || (tel.length >= 9 && U.telefonoNormalizado(c.telefono) === tel)
  );
}

// ======================= VEHICULOS ======================================
function listarVehiculos({ q, cliente_id, sin_cliente, limite }) {
  const texto = String(q || '').trim();
  const like = U.patronLike(texto);
  const likeMat = patronONulo(U.normalizarMatricula(texto));
  const clienteId = U.aEntero(cliente_id);
  return all(
    `SELECT v.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM vehiculos v
       LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE (? IS NULL OR v.cliente_id = ?)
        AND (? = 0 OR v.cliente_id IS NULL)
        AND (? = ''
             OR LOWER(v.matricula) LIKE ? ESCAPE '\\'
             OR LOWER(IFNULL(v.marca,'') || ' ' || IFNULL(v.modelo,'')) LIKE ? ESCAPE '\\'
             OR LOWER(IFNULL(c.nombre,'')) LIKE ? ESCAPE '\\'
             OR LOWER(IFNULL(v.bastidor,'')) LIKE ? ESCAPE '\\')
      ORDER BY v.matricula
      LIMIT ?`,
    clienteId, clienteId, sin_cliente === '1' ? 1 : 0,
    texto, likeMat, like, like, like, limiteSeguro(limite)
  );
}

function fechaOpcional(v, campo) {
  if (v === undefined || v === null || v === '') return null;
  if (!U.esFechaISO(v)) throw peticionMala(`La fecha de ${campo} no es válida`);
  return v;
}

function enteroOpcional(v, { min, max, campo }) {
  if (v === undefined || v === null || v === '') return null;
  const n = U.aEntero(v);
  if (n === null || n < min || n > max) throw peticionMala(`${campo} no es válido`);
  return n;
}

function datosVehiculo(v) {
  const matricula = U.normalizarMatricula(v.matricula);
  if (!matricula) throw peticionMala('La matrícula es obligatoria');
  if (matricula.length < 4 || matricula.length > 12) throw peticionMala('La matrícula no es válida');
  const clienteId = U.aEntero(v.cliente_id);
  if (clienteId && !get('SELECT id FROM clientes WHERE id = ?', clienteId)) throw peticionMala('El cliente indicado no existe');
  const combustible = U.limpiarTexto(v.combustible, 30);
  if (combustible && !COMBUSTIBLES.includes(combustible)) throw peticionMala('Combustible no válido');
  const bastidor = U.limpiarTexto(v.bastidor, 20);
  return {
    cliente_id: clienteId,
    matricula,
    marca: U.limpiarTexto(v.marca, 60),
    modelo: U.limpiarTexto(v.modelo, 60),
    anio: enteroOpcional(v.anio, { min: 1900, max: new Date().getFullYear() + 1, campo: 'El año' }),
    bastidor: bastidor ? bastidor.toUpperCase().replace(/\s/g, '') : null,
    combustible,
    km: enteroOpcional(v.km, { min: 0, max: 9999999, campo: 'El kilometraje' }),
    proxima_itv: fechaOpcional(v.proxima_itv, 'la próxima ITV'),
    proxima_revision: fechaOpcional(v.proxima_revision, 'la próxima revisión'),
    notas: U.limpiarTexto(v.notas, 2000),
  };
}

const CAMPOS_VEHICULO = ['cliente_id', 'matricula', 'marca', 'modelo', 'anio', 'bastidor', 'combustible', 'km', 'proxima_itv', 'proxima_revision', 'notas'];

// ======================= RECURSOS Y SERVICIOS ===========================
const colorValido = (v) => (U.esColor(v) ? v.toLowerCase() : '#4e4e4e');
const ordenValido = (v) => Math.min(Math.max(U.aEntero(v) ?? 0, 0), 999);

// ======================= AJUSTES ========================================
function validarAjustes(a) {
  const e = (m) => { throw peticionMala(m); };
  if (!String(a.nombre_taller || '').trim()) e('El nombre del taller es obligatorio');
  if (String(a.nombre_taller).length > 80) e('El nombre del taller es demasiado largo');
  if (a.email_taller && !U.esEmail(a.email_taller)) e('El email del taller no es válido');
  if (!/^\d{1,3}$/.test(a.prefijo_pais)) e('El prefijo del país debe tener de 1 a 3 cifras (34 para España)');
  for (const campo of ['hora_apertura', 'hora_cierre', 'pausa_inicio', 'pausa_fin']) {
    if (!U.esHora(a[campo])) e('Alguna de las horas no es válida');
  }
  const ap = U.aMinutos(a.hora_apertura);
  const ci = U.aMinutos(a.hora_cierre);
  if (ap >= ci) e('La hora de cierre debe ser posterior a la de apertura');
  if (!['0', '1'].includes(String(a.usar_pausa))) e('Valor de pausa no válido');
  if (String(a.usar_pausa) === '1') {
    const pi = U.aMinutos(a.pausa_inicio);
    const pf = U.aMinutos(a.pausa_fin);
    if (pi >= pf || pi < ap || pf > ci) e('La pausa debe empezar antes de acabar y estar dentro del horario');
  }
  if (!/^[1-7](,[1-7])*$/.test(a.dias_laborables)) e('Marque al menos un día de apertura');
  if (!['10', '15', '20', '30', '60'].includes(String(a.slot_min))) e('Intervalo de agenda no válido');
  const itv = U.aEntero(a.aviso_itv_dias);
  if (itv === null || itv < 1 || itv > 365) e('Los días de aviso de ITV deben estar entre 1 y 365');
  const carpeta = String(a.carpeta_copias || '').trim();
  if (carpeta) {
    if (carpeta.length > 240) e('La ruta de la carpeta de copias es demasiado larga');
    if (carpeta !== U.sinControl(carpeta)) e('La ruta de la carpeta de copias tiene caracteres no válidos');
    if (!path.isAbsolute(carpeta) && !carpeta.startsWith('\\')) {
      e('Escriba la ruta completa de la carpeta, por ejemplo D:\copias-taller o \\SERVIDOR\copias');
    }
    if (path.resolve(carpeta) === path.resolve(DIR_DATOS, 'copias')) {
      e('Esa es la carpeta de copias de este mismo equipo: elija otra unidad u otro ordenador');
    }
  }
  if (!String(a.plantilla_recordatorio || '').trim()) e('La plantilla del recordatorio no puede estar vacía');
  if (String(a.plantilla_recordatorio).length > 1000) e('La plantilla del recordatorio es demasiado larga');
}

// ======================= USUARIOS =======================================
const adminsActivosSalvo = (id) =>
  get("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?", id).n;

const usuarioPublico = (id) =>
  get('SELECT id, usuario, nombre, rol, activo, debe_cambiar_clave FROM usuarios WHERE id = ?', id);

// ======================= REGISTRO DE RUTAS ==============================
function registrar(r) {
  // ---- Clientes --------------------------------------------------------
  r.get('/api/clientes', ({ query }) => listarClientes(query.q, query.limite));

  r.get('/api/clientes/:id', ({ params }) => {
    const cliente = get('SELECT * FROM clientes WHERE id = ?', params.id);
    if (!cliente) throw noEncontrado('Cliente no encontrado');
    const vehiculos = all('SELECT * FROM vehiculos WHERE cliente_id = ? ORDER BY matricula', cliente.id);
    const citas = all(
      `SELECT ci.*, s.nombre AS servicio, v.matricula
         FROM citas ci
         LEFT JOIN servicios s ON s.id = ci.servicio_id
         LEFT JOIN vehiculos v ON v.id = ci.vehiculo_id
        WHERE ci.cliente_id = ?
        ORDER BY ci.fecha DESC, ci.hora_inicio DESC
        LIMIT 100`,
      cliente.id
    );
    return { cliente, vehiculos, citas };
  });

  r.post('/api/clientes', ({ cuerpo }) => {
    const d = datosCliente(cuerpo);
    const duplicados = buscarDuplicados(d);
    if (duplicados.length && !cuerpo.forzar) {
      throw conflicto('Ya hay un cliente con ese teléfono o NIF', { duplicados });
    }
    const t = ahora();
    const res = run(
      `INSERT INTO clientes (nombre, nif, telefono, email, direccion, poblacion, cp, notas, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      d.nombre, d.nif, d.telefono, d.email, d.direccion, d.poblacion, d.cp, d.notas, t, t
    );
    return get('SELECT * FROM clientes WHERE id = ?', Number(res.lastInsertRowid));
  });

  r.put('/api/clientes/:id', ({ params, cuerpo }) => {
    if (!get('SELECT id FROM clientes WHERE id = ?', params.id)) throw noEncontrado('Cliente no encontrado');
    const d = datosCliente(cuerpo);
    const duplicados = buscarDuplicados(d, params.id);
    if (duplicados.length && !cuerpo.forzar) {
      throw conflicto('Ya hay otro cliente con ese teléfono o NIF', { duplicados });
    }
    run(
      `UPDATE clientes SET nombre=?, nif=?, telefono=?, email=?, direccion=?, poblacion=?, cp=?, notas=?, actualizado_en=?
        WHERE id = ?`,
      d.nombre, d.nif, d.telefono, d.email, d.direccion, d.poblacion, d.cp, d.notas, ahora(), params.id
    );
    return get('SELECT * FROM clientes WHERE id = ?', params.id);
  });

  r.delete('/api/clientes/:id', ({ params }) => {
    if (!get('SELECT id FROM clientes WHERE id = ?', params.id)) throw noEncontrado('Cliente no encontrado');
    const n = get('SELECT COUNT(*) AS n FROM vehiculos WHERE cliente_id = ?', params.id).n;
    if (n > 0) throw conflicto(`El cliente tiene ${n} vehículo(s). Páselos a otro cliente o bórrelos primero.`);
    run('DELETE FROM clientes WHERE id = ?', params.id);
    return { ok: true };
  });

  // ---- Vehiculos -------------------------------------------------------
  r.get('/api/vehiculos', ({ query }) => listarVehiculos(query));

  r.get('/api/vehiculos/:id', ({ params }) => {
    const vehiculo = get(
      `SELECT v.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.email AS cliente_email
         FROM vehiculos v LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.id = ?`,
      params.id
    );
    if (!vehiculo) throw noEncontrado('Vehículo no encontrado');
    const citas = all(
      `SELECT ci.*, s.nombre AS servicio, b.nombre AS bahia, m.nombre AS mecanico
         FROM citas ci
         LEFT JOIN servicios s ON s.id = ci.servicio_id
         LEFT JOIN recursos b ON b.id = ci.bahia_id
         LEFT JOIN recursos m ON m.id = ci.mecanico_id
        WHERE ci.vehiculo_id = ?
        ORDER BY ci.fecha DESC, ci.hora_inicio DESC`,
      params.id
    );
    return { vehiculo, citas };
  });

  r.post('/api/vehiculos', ({ cuerpo }) => {
    const d = datosVehiculo(cuerpo);
    const existe = get('SELECT id FROM vehiculos WHERE matricula = ?', d.matricula);
    if (existe) throw conflicto(`La matrícula ${d.matricula} ya está dada de alta`, { id: existe.id });
    const t = ahora();
    const res = run(
      `INSERT INTO vehiculos (${CAMPOS_VEHICULO.join(', ')}, creado_en, actualizado_en)
       VALUES (${CAMPOS_VEHICULO.map(() => '?').join(',')}, ?, ?)`,
      ...CAMPOS_VEHICULO.map((k) => d[k]), t, t
    );
    return get('SELECT * FROM vehiculos WHERE id = ?', Number(res.lastInsertRowid));
  });

  r.put('/api/vehiculos/:id', ({ params, cuerpo }) => {
    const previo = get('SELECT * FROM vehiculos WHERE id = ?', params.id);
    if (!previo) throw noEncontrado('Vehículo no encontrado');
    const d = datosVehiculo(cuerpo);
    const otro = get('SELECT id FROM vehiculos WHERE matricula = ? AND id <> ?', d.matricula, params.id);
    if (otro) throw conflicto(`La matrícula ${d.matricula} pertenece a otro vehículo`, { id: otro.id });
    const t = ahora();

    transaccion(() => {
      run(
        `UPDATE vehiculos SET ${CAMPOS_VEHICULO.map((k) => `${k}=?`).join(', ')}, actualizado_en=? WHERE id = ?`,
        ...CAMPOS_VEHICULO.map((k) => d[k]), t, params.id
      );
      // Si cambia el propietario, sus citas abiertas pasan al nuevo cliente.
      // Las ya cerradas conservan a quien lo trajo entonces.
      if ((previo.cliente_id ?? null) !== (d.cliente_id ?? null)) {
        run(
          `UPDATE citas SET cliente_id = ?, actualizado_en = ?
            WHERE vehiculo_id = ? AND (cliente_id IS NULL OR estado NOT IN (${ESTADOS_CERRADOS_SQL}))`,
          d.cliente_id, t, params.id
        );
      }
    });
    return get('SELECT * FROM vehiculos WHERE id = ?', params.id);
  });

  r.delete('/api/vehiculos/:id', ({ params }) => {
    if (!get('SELECT id FROM vehiculos WHERE id = ?', params.id)) throw noEncontrado('Vehículo no encontrado');
    const n = get('SELECT COUNT(*) AS n FROM citas WHERE vehiculo_id = ?', params.id).n;
    if (n > 0) throw conflicto(`El vehículo tiene ${n} cita(s) registradas. No se puede borrar.`);
    run('DELETE FROM vehiculos WHERE id = ?', params.id);
    return { ok: true };
  });

  // ---- Recursos (bahias y mecanicos) -----------------------------------
  r.get('/api/recursos', ({ query }) => {
    const tipo = ['bahia', 'mecanico'].includes(query.tipo) ? query.tipo : null;
    return all(
      `SELECT * FROM recursos
        WHERE (? IS NULL OR tipo = ?) AND (? = 1 OR activo = 1)
        ORDER BY tipo, orden, nombre`,
      tipo, tipo, query.todos === '1' ? 1 : 0
    );
  });

  r.post('/api/recursos', ({ cuerpo }) => {
    const tipo = cuerpo.tipo === 'mecanico' ? 'mecanico' : 'bahia';
    const nombre = U.limpiarTexto(cuerpo.nombre, 80);
    if (!nombre) throw peticionMala('El nombre es obligatorio');
    const orden = cuerpo.orden === undefined || cuerpo.orden === ''
      ? get('SELECT IFNULL(MAX(orden),0)+1 AS o FROM recursos WHERE tipo = ?', tipo).o
      : ordenValido(cuerpo.orden);
    const res = run(
      'INSERT INTO recursos (tipo, nombre, color, orden, activo) VALUES (?,?,?,?,?)',
      tipo, nombre, colorValido(cuerpo.color), orden, cuerpo.activo === false ? 0 : 1
    );
    return get('SELECT * FROM recursos WHERE id = ?', Number(res.lastInsertRowid));
  }, { permiso: 'configurar' });

  r.put('/api/recursos/:id', ({ params, cuerpo }) => {
    if (!get('SELECT id FROM recursos WHERE id = ?', params.id)) throw noEncontrado('Recurso no encontrado');
    const nombre = U.limpiarTexto(cuerpo.nombre, 80);
    if (!nombre) throw peticionMala('El nombre es obligatorio');
    run(
      'UPDATE recursos SET nombre=?, color=?, orden=?, activo=? WHERE id=?',
      nombre, colorValido(cuerpo.color), ordenValido(cuerpo.orden),
      cuerpo.activo === false || cuerpo.activo === 0 ? 0 : 1, params.id
    );
    return get('SELECT * FROM recursos WHERE id = ?', params.id);
  }, { permiso: 'configurar' });

  r.delete('/api/recursos/:id', ({ params }) => {
    if (!get('SELECT id FROM recursos WHERE id = ?', params.id)) throw noEncontrado('Recurso no encontrado');
    const n = get('SELECT COUNT(*) AS n FROM citas WHERE bahia_id = ? OR mecanico_id = ?', params.id, params.id).n;
    if (n > 0) {
      run('UPDATE recursos SET activo = 0 WHERE id = ?', params.id);
      return { ok: true, desactivado: true, mensaje: 'Tiene citas asociadas: se ha desactivado en lugar de borrar.' };
    }
    run('DELETE FROM recursos WHERE id = ?', params.id);
    return { ok: true };
  }, { permiso: 'configurar' });

  // ---- Servicios -------------------------------------------------------
  r.get('/api/servicios', ({ query }) =>
    all('SELECT * FROM servicios WHERE (? = 1 OR activo = 1) ORDER BY orden, nombre', query.todos === '1' ? 1 : 0)
  );

  function datosServicio(cuerpo) {
    const nombre = U.limpiarTexto(cuerpo.nombre, 120);
    if (!nombre) throw peticionMala('El nombre del servicio es obligatorio');
    const duracion = U.aEntero(cuerpo.duracion_min) || 60;
    if (duracion < 5 || duracion > 1440) throw peticionMala('La duración debe estar entre 5 minutos y 24 horas');
    const precio = U.aDecimal(cuerpo.precio_orientativo);
    if (precio !== null && (precio < 0 || precio > 100000)) throw peticionMala('El precio orientativo no es válido');
    return { nombre, duracion, precio, color: colorValido(cuerpo.color), activo: cuerpo.activo === false || cuerpo.activo === 0 ? 0 : 1 };
  }

  r.post('/api/servicios', ({ cuerpo }) => {
    const d = datosServicio(cuerpo);
    const orden = cuerpo.orden === undefined || cuerpo.orden === ''
      ? get('SELECT IFNULL(MAX(orden),0)+1 AS o FROM servicios').o
      : ordenValido(cuerpo.orden);
    const res = run(
      'INSERT INTO servicios (nombre, duracion_min, color, precio_orientativo, orden, activo) VALUES (?,?,?,?,?,?)',
      d.nombre, d.duracion, d.color, d.precio, orden, d.activo
    );
    return get('SELECT * FROM servicios WHERE id = ?', Number(res.lastInsertRowid));
  }, { permiso: 'configurar' });

  r.put('/api/servicios/:id', ({ params, cuerpo }) => {
    if (!get('SELECT id FROM servicios WHERE id = ?', params.id)) throw noEncontrado('Servicio no encontrado');
    const d = datosServicio(cuerpo);
    run(
      'UPDATE servicios SET nombre=?, duracion_min=?, color=?, precio_orientativo=?, orden=?, activo=? WHERE id=?',
      d.nombre, d.duracion, d.color, d.precio, ordenValido(cuerpo.orden), d.activo, params.id
    );
    return get('SELECT * FROM servicios WHERE id = ?', params.id);
  }, { permiso: 'configurar' });

  r.delete('/api/servicios/:id', ({ params }) => {
    if (!get('SELECT id FROM servicios WHERE id = ?', params.id)) throw noEncontrado('Servicio no encontrado');
    const n = get('SELECT COUNT(*) AS n FROM citas WHERE servicio_id = ?', params.id).n;
    if (n > 0) {
      run('UPDATE servicios SET activo = 0 WHERE id = ?', params.id);
      return { ok: true, desactivado: true, mensaje: 'Tiene citas asociadas: se ha desactivado en lugar de borrar.' };
    }
    run('DELETE FROM servicios WHERE id = ?', params.id);
    return { ok: true };
  }, { permiso: 'configurar' });

  // ---- Ajustes ---------------------------------------------------------
  r.get('/api/ajustes', () => {
    const aj = leerAjustes();
    delete aj.version_esquema;
    return aj;
  });

  r.put('/api/ajustes', ({ cuerpo }) => {
    const nuevos = { ...leerAjustes() };
    for (const clave of Object.keys(AJUSTES_DEFECTO)) {
      if (clave in cuerpo) nuevos[clave] = String(cuerpo[clave] ?? '').trim();
    }
    validarAjustes(nuevos);
    transaccion(() => {
      for (const clave of Object.keys(AJUSTES_DEFECTO)) guardarAjuste(clave, nuevos[clave]);
    });
    const aj = leerAjustes();
    delete aj.version_esquema;
    return aj;
  }, { permiso: 'configurar' });

  // ---- Copias de seguridad ---------------------------------------------
  // Hace una copia ahora mismo, para comprobar que la carpeta externa existe
  // y que el programa puede escribir en ella.
  r.post('/api/copias/probar', () => {
    const carpeta = String(leerAjustes().carpeta_copias || '').trim();
    const hecha = copiaCompleta();
    const aj = leerAjustes();
    if (!carpeta) return { local: hecha.local, externa: null, mensaje: 'Copia local hecha. No hay carpeta externa configurada.' };
    if (!hecha.externa) {
      const motivo = String(aj.copia_externa_error || '').split('|').slice(1).join('|') || 'no se pudo escribir';
      throw peticionMala(`No se pudo copiar a "${carpeta}": ${motivo}`);
    }
    return { local: hecha.local, externa: hecha.externa, mensaje: `Copia guardada en ${hecha.externa}` };
  }, { permiso: 'configurar', codigo: 200 });

  // ---- Usuarios --------------------------------------------------------
  r.get('/api/usuarios', () => auth.listarUsuarios(), { permiso: 'configurar' });

  r.post('/api/usuarios', ({ cuerpo }) => {
    const nombreUsuario = String(cuerpo.usuario || '').trim().toLowerCase();
    const nombre = U.limpiarTexto(cuerpo.nombre, 80);
    if (!/^[a-z0-9._-]{3,40}$/.test(nombreUsuario)) {
      throw peticionMala('El usuario debe tener entre 3 y 40 letras o números, sin espacios ni tildes');
    }
    if (!nombre) throw peticionMala('El nombre es obligatorio');
    if (!auth.ROLES.includes(cuerpo.rol)) throw peticionMala('Rol no válido');
    const problema = auth.problemaClave(cuerpo.clave, nombreUsuario);
    if (problema) throw peticionMala(problema);
    if (get('SELECT id FROM usuarios WHERE usuario = ?', nombreUsuario)) throw conflicto('Ese usuario ya existe');
    const { hash, salt } = hashClave(String(cuerpo.clave));
    // La contraseña la pone el administrador: el usuario la cambiará al entrar
    const res = run(
      'INSERT INTO usuarios (usuario, nombre, rol, hash, salt, activo, debe_cambiar_clave, creado_en) VALUES (?,?,?,?,?,1,1,?)',
      nombreUsuario, nombre, cuerpo.rol, hash, salt, ahora()
    );
    return usuarioPublico(Number(res.lastInsertRowid));
  }, { permiso: 'configurar' });

  // Cada uno puede cambiar su propia contraseña; el resto de cambios, solo un administrador.
  r.put('/api/usuarios/:id', ({ params, cuerpo, usuario }) => {
    const id = params.id;
    const destino = get('SELECT * FROM usuarios WHERE id = ?', id);
    if (!destino) throw noEncontrado('Usuario no encontrado');
    const esPropio = usuario.id === id;
    const esAdmin = auth.tienePermiso(usuario, 'configurar');
    if (!esPropio && !esAdmin) throw prohibido('Solo puede modificar su propio usuario');
    if (usuario.debe_cambiar_clave && (!esPropio || !cuerpo.clave)) {
      throw prohibido('Tiene que cambiar su contraseña antes de continuar.', { cambiar_clave: true });
    }

    transaccion(() => {
      if (esAdmin && !usuario.debe_cambiar_clave && ('rol' in cuerpo || 'activo' in cuerpo || 'nombre' in cuerpo)) {
        const nombre = U.limpiarTexto(cuerpo.nombre, 80) || destino.nombre;
        const rol = 'rol' in cuerpo ? cuerpo.rol : destino.rol;
        if (!auth.ROLES.includes(rol)) throw peticionMala('Rol no válido');
        let activo = 'activo' in cuerpo ? (cuerpo.activo === false || cuerpo.activo === 0 ? 0 : 1) : destino.activo;
        if (esPropio && !activo) throw peticionMala('No puede desactivar su propio usuario');
        const dejaDeSerAdmin = destino.rol === 'admin' && (rol !== 'admin' || !activo);
        if (dejaDeSerAdmin && destino.activo && adminsActivosSalvo(id) === 0) {
          throw peticionMala('Debe quedar al menos un administrador activo');
        }
        run('UPDATE usuarios SET nombre=?, rol=?, activo=? WHERE id=?', nombre, rol, activo, id);
        if (!activo) {
          auth.cerrarSesionesDe(id);
          eventos.cerrarDeUsuario(id);
        }
      } else if (esPropio && cuerpo.nombre && !usuario.debe_cambiar_clave) {
        run('UPDATE usuarios SET nombre=? WHERE id=?', U.limpiarTexto(cuerpo.nombre, 80) || destino.nombre, id);
      }

      if (cuerpo.clave) {
        const problema = auth.problemaClave(cuerpo.clave, destino.usuario);
        if (problema) throw peticionMala(problema);
        if (esPropio) {
          if (!auth.comprobarClave(id, cuerpo.clave_actual)) throw peticionMala('La contraseña actual no es correcta');
          if (auth.comprobarClave(id, cuerpo.clave)) throw peticionMala('La contraseña nueva debe ser distinta de la actual');
          auth.cambiarClave(id, cuerpo.clave, { conservarSid: usuario.sid, debeCambiar: false });
          eventos.cerrarDeUsuario(id, { salvoSid: usuario.sid });
        } else {
          // Un administrador pone una contraseña provisional
          auth.cambiarClave(id, cuerpo.clave, { debeCambiar: true });
          eventos.cerrarDeUsuario(id);
        }
      }
    });
    return usuarioPublico(id);
  }, { permiso: 'propio', conClaveProvisional: true });

  r.delete('/api/usuarios/:id', ({ params, usuario }) => {
    const destino = get('SELECT * FROM usuarios WHERE id = ?', params.id);
    if (!destino) throw noEncontrado('Usuario no encontrado');
    if (destino.id === usuario.id) throw peticionMala('No puede borrar su propio usuario');
    if (destino.rol === 'admin' && destino.activo && adminsActivosSalvo(destino.id) === 0) {
      throw peticionMala('Debe quedar al menos un administrador activo');
    }
    run('DELETE FROM usuarios WHERE id = ?', destino.id);
    eventos.cerrarDeUsuario(destino.id);
    return { ok: true };
  }, { permiso: 'configurar' });
}

module.exports = { registrar, listarClientes, listarVehiculos };
