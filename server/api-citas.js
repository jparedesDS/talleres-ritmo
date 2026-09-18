'use strict';
const { all, get, run, transaccion, leerAjustes } = require('./db');
const { noEncontrado, peticionMala, prohibido, conflicto } = require('./http');
const U = require('./util');
const auth = require('./auth');

const ahora = () => new Date().toISOString();

const SELECT_CITA = `
  SELECT ci.*,
         c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.email AS cliente_email,
         v.matricula, v.marca, v.modelo, v.proxima_itv,
         s.nombre AS servicio_nombre, s.color AS servicio_color, s.precio_orientativo,
         b.nombre AS bahia_nombre, b.color AS bahia_color,
         m.nombre AS mecanico_nombre
    FROM citas ci
    LEFT JOIN clientes c ON c.id = ci.cliente_id
    LEFT JOIN vehiculos v ON v.id = ci.vehiculo_id
    LEFT JOIN servicios s ON s.id = ci.servicio_id
    LEFT JOIN recursos b ON b.id = ci.bahia_id
    LEFT JOIN recursos m ON m.id = ci.mecanico_id`;

const traerCita = (id) => get(`${SELECT_CITA} WHERE ci.id = ?`, id);

// ---------------------------------------------------------------------------
// Validacion y normalizacion de una cita
// ---------------------------------------------------------------------------
/** Id de una bahía o mecánico existente del tipo pedido (o null si viene vacío). */
function recursoValido(valor, tipo) {
  const id = U.aEntero(valor);
  if (!id) return null;
  if (!get('SELECT id FROM recursos WHERE id = ? AND tipo = ?', id, tipo)) {
    throw peticionMala(tipo === 'bahia' ? 'La bahía indicada no existe' : 'El mecánico indicado no existe');
  }
  return id;
}

function kmValido(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const km = U.aEntero(valor);
  if (km === null || km < 0 || km > 9999999) throw peticionMala('Los kilómetros no son válidos');
  return km;
}

function duracionValida(inicio, duracion) {
  if (duracion < 5 || duracion > 24 * 60) throw peticionMala('La duración debe estar entre 5 minutos y 24 horas');
  if (U.aMinutos(inicio) + duracion > 24 * 60) throw peticionMala('La cita no puede pasar de medianoche');
}

function normalizarCita(cuerpo) {
  const fecha = cuerpo.fecha;
  if (!U.esFechaISO(fecha)) throw peticionMala('Fecha no válida');
  const hora = cuerpo.hora_inicio;
  if (!U.esHora(hora)) throw peticionMala('Hora no válida');

  const servicioId = U.aEntero(cuerpo.servicio_id);
  const servicio = servicioId ? get('SELECT * FROM servicios WHERE id = ?', servicioId) : null;
  if (servicioId && !servicio) throw peticionMala('El servicio indicado no existe');

  let duracion = U.aEntero(cuerpo.duracion_min);
  if (!duracion) duracion = servicio ? servicio.duracion_min : 60;
  duracionValida(hora, duracion);

  // El cliente de la cita es SIEMPRE el propietario actual del vehículo:
  // así no puede quedar una cita apuntando a un cliente que ya no es el dueño.
  const vehiculoId = U.aEntero(cuerpo.vehiculo_id);
  let clienteId = null;
  if (vehiculoId) {
    const veh = get('SELECT id, cliente_id FROM vehiculos WHERE id = ?', vehiculoId);
    if (!veh) throw peticionMala('El vehículo indicado no existe');
    clienteId = veh.cliente_id;
  }

  const estado = Object.hasOwn(U.ESTADOS, String(cuerpo.estado)) ? cuerpo.estado : 'pendiente';

  return {
    cliente_id: clienteId,
    vehiculo_id: vehiculoId,
    servicio_id: servicioId,
    bahia_id: recursoValido(cuerpo.bahia_id, 'bahia'),
    mecanico_id: recursoValido(cuerpo.mecanico_id, 'mecanico'),
    fecha,
    hora_inicio: hora,
    duracion_min: duracion,
    estado,
    titulo: U.limpiarTexto(cuerpo.titulo, 150) || (servicio ? servicio.nombre : null),
    descripcion: U.limpiarTexto(cuerpo.descripcion, 4000),
    km_entrada: kmValido(cuerpo.km_entrada),
    espera: cuerpo.espera ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Solapes y advertencias de horario
// ---------------------------------------------------------------------------
function buscarConflictos(c, idExcluir = null) {
  if (!c.bahia_id && !c.mecanico_id) return [];
  const inicio = U.aMinutos(c.hora_inicio);
  const fin = inicio + c.duracion_min;
  const estadosFuera = U.ESTADOS_LIBERAN.map(() => '?').join(',');
  const candidatas = all(
    `${SELECT_CITA}
      WHERE ci.fecha = ?
        AND ci.estado NOT IN (${estadosFuera})
        AND (? IS NULL OR ci.id <> ?)
        AND ((ci.bahia_id IS NOT NULL AND ci.bahia_id = ?) OR (ci.mecanico_id IS NOT NULL AND ci.mecanico_id = ?))`,
    c.fecha,
    ...U.ESTADOS_LIBERAN,
    idExcluir,
    idExcluir,
    c.bahia_id,
    c.mecanico_id
  );
  return candidatas
    .filter((o) => {
      const oi = U.aMinutos(o.hora_inicio);
      const of = oi + o.duracion_min;
      return inicio < of && oi < fin;
    })
    .map((o) => ({
      id: o.id,
      recurso:
        c.bahia_id && o.bahia_id === c.bahia_id
          ? o.bahia_nombre || 'la bahía'
          : o.mecanico_nombre || 'el mecánico',
      texto: `${o.hora_inicio} · ${o.matricula || 'sin matrícula'} · ${o.titulo || o.servicio_nombre || 'cita'}`,
    }));
}

function advertenciasHorario(c) {
  const aj = leerAjustes();
  const avisos = [];
  const laborables = String(aj.dias_laborables || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean);
  if (laborables.length && !laborables.includes(U.diaSemana(c.fecha))) {
    avisos.push('Ese día el taller está cerrado según los ajustes.');
  }
  const inicio = U.aMinutos(c.hora_inicio);
  const fin = inicio + c.duracion_min;
  const apertura = U.aMinutos(aj.hora_apertura);
  const cierre = U.aMinutos(aj.hora_cierre);
  if (inicio < apertura || fin > cierre) {
    avisos.push(`La cita se sale del horario del taller (${aj.hora_apertura}–${aj.hora_cierre}).`);
  }
  if (aj.usar_pausa === '1') {
    const pi = U.aMinutos(aj.pausa_inicio);
    const pf = U.aMinutos(aj.pausa_fin);
    if (inicio < pf && pi < fin) avisos.push(`La cita pisa la pausa (${aj.pausa_inicio}–${aj.pausa_fin}).`);
  }
  return avisos;
}

function apuntarHistorial(citaId, usuario, accion, detalle) {
  run(
    'INSERT INTO historial (cita_id, usuario, accion, detalle, fecha) VALUES (?,?,?,?,?)',
    citaId,
    usuario || null,
    accion,
    detalle || null,
    ahora()
  );
}

// ---------------------------------------------------------------------------
// Aviso al cliente (texto listo para WhatsApp / email)
// ---------------------------------------------------------------------------
function textoAviso(cita) {
  const aj = leerAjustes();
  const [y, m, d] = cita.fecha.split('-');
  return String(aj.plantilla_recordatorio)
    .replaceAll('{cliente}', cita.cliente_nombre || '')
    .replaceAll('{taller}', aj.nombre_taller || '')
    .replaceAll('{fecha}', `${d}/${m}/${y}`)
    .replaceAll('{hora}', cita.hora_inicio)
    .replaceAll('{servicio}', cita.servicio_nombre || cita.titulo || 'su cita')
    .replaceAll('{matricula}', cita.matricula || '')
    .replaceAll('{telefono_taller}', aj.telefono_taller || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function telefonoInternacional(telefono) {
  const aj = leerAjustes();
  let t = String(telefono || '').replace(/[^\d+]/g, '');
  if (!t) return '';
  if (t.startsWith('+')) return t.slice(1);
  if (t.startsWith('00')) return t.slice(2);
  if (t.length === 9) return `${aj.prefijo_pais}${t}`;
  return t;
}

// ---------------------------------------------------------------------------
// Huecos libres
// ---------------------------------------------------------------------------
function huecosLibres({ fecha, duracion, bahia_id, mecanico_id }) {
  const aj = leerAjustes();
  const paso = Math.max(5, U.aEntero(aj.slot_min) || 30);
  const dur = Math.min(Math.max(5, U.aEntero(duracion) || 60), 24 * 60);
  const apertura = U.aMinutos(aj.hora_apertura);
  const cierre = U.aMinutos(aj.hora_cierre);
  const pausa = aj.usar_pausa === '1' ? [U.aMinutos(aj.pausa_inicio), U.aMinutos(aj.pausa_fin)] : null;

  const bahias = U.aEntero(bahia_id)
    ? all("SELECT * FROM recursos WHERE id = ? AND tipo = 'bahia'", U.aEntero(bahia_id))
    : all("SELECT * FROM recursos WHERE tipo = 'bahia' AND activo = 1 ORDER BY orden, nombre");

  const ocupadas = all(
    `SELECT * FROM citas WHERE fecha = ? AND estado NOT IN ('anulada','no_presentado')`,
    fecha
  );

  const libre = (recursoId, ini, fin) =>
    !ocupadas.some((o) => {
      const mismo = o.bahia_id === recursoId || (mecanico_id && o.mecanico_id === U.aEntero(mecanico_id));
      if (!mismo) return false;
      const oi = U.aMinutos(o.hora_inicio);
      return ini < oi + o.duracion_min && oi < fin;
    });

  const resultado = [];
  for (let t = apertura; t + dur <= cierre; t += paso) {
    const fin = t + dur;
    if (pausa && t < pausa[1] && pausa[0] < fin) continue;
    const disponibles = bahias.filter((b) => libre(b.id, t, fin));
    if (disponibles.length) {
      resultado.push({
        hora: U.aHora(t),
        bahias: disponibles.map((b) => ({ id: b.id, nombre: b.nombre })),
      });
    }
  }
  return { fecha, duracion: dur, huecos: resultado };
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------
function registrar(r) {
  // ---- Listado / detalle ----------------------------------------------
  r.get('/api/citas', ({ query }) => {
    const desde = U.esFechaISO(query.desde) ? query.desde : null;
    const hasta = U.esFechaISO(query.hasta) ? query.hasta : null;
    const estado = Object.hasOwn(U.ESTADOS, String(query.estado)) ? query.estado : null;
    const texto = String(query.q || '').trim();
    const like = U.patronLike(texto);
    const matricula = U.normalizarMatricula(texto);
    const likeMat = matricula ? U.patronLike(matricula) : null;
    const digitos = texto.replace(/\D/g, '');
    const likeTel = digitos.length >= 3 ? U.patronLike(digitos) : null;
    const limite = Math.min(Math.max(U.aEntero(query.limite) || 300, 1), 5000);
    return all(
      `${SELECT_CITA}
        WHERE (? IS NULL OR ci.fecha >= ?)
          AND (? IS NULL OR ci.fecha <= ?)
          AND (? IS NULL OR ci.estado = ?)
          AND (? IS NULL OR ci.vehiculo_id = ?)
          AND (? = ''
               OR LOWER(IFNULL(v.matricula,'')) LIKE ? ESCAPE '\\'
               OR LOWER(IFNULL(c.nombre,'')) LIKE ? ESCAPE '\\'
               OR REPLACE(REPLACE(IFNULL(c.telefono,''),' ',''),'-','') LIKE ? ESCAPE '\\'
               OR LOWER(IFNULL(ci.titulo,'')) LIKE ? ESCAPE '\\')
        ORDER BY ci.fecha DESC, ci.hora_inicio DESC
        LIMIT ?`,
      desde, desde, hasta, hasta, estado, estado,
      U.aEntero(query.vehiculo_id), U.aEntero(query.vehiculo_id),
      texto, likeMat, like, likeTel, like,
      limite
    );
  });

  r.get('/api/citas/:id', ({ params }) => {
    const cita = traerCita(params.id);
    if (!cita) throw noEncontrado('Cita no encontrada');
    const historial = all('SELECT * FROM historial WHERE cita_id = ? ORDER BY id DESC', params.id);
    return { cita, historial, aviso: { texto: textoAviso(cita), telefono: telefonoInternacional(cita.cliente_telefono) } };
  });

  // ---- Alta ------------------------------------------------------------
  r.post('/api/citas', ({ cuerpo, usuario }) => {
    const c = normalizarCita(cuerpo);
    const conflictos = buscarConflictos(c);
    if (conflictos.length && !cuerpo.forzar) {
      throw conflicto('Hay otra cita en ese hueco', { conflictos, advertencias: advertenciasHorario(c) });
    }
    const t = ahora();
    const id = transaccion(() => {
      const res = run(
        `INSERT INTO citas (cliente_id, vehiculo_id, servicio_id, bahia_id, mecanico_id, fecha, hora_inicio,
                            duracion_min, estado, titulo, descripcion, km_entrada, espera, creado_en, actualizado_en, creado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        c.cliente_id, c.vehiculo_id, c.servicio_id, c.bahia_id, c.mecanico_id, c.fecha, c.hora_inicio,
        c.duracion_min, c.estado, c.titulo, c.descripcion, c.km_entrada, c.espera, t, t, usuario.usuario
      );
      const nuevo = Number(res.lastInsertRowid);
      apuntarHistorial(nuevo, usuario.usuario, 'creada', `${c.fecha} ${c.hora_inicio}`);
      return nuevo;
    });
    return { cita: traerCita(id), advertencias: advertenciasHorario(c), conflictos_forzados: conflictos };
  });

  // ---- Modificacion ----------------------------------------------------
  r.put('/api/citas/:id', ({ params, cuerpo, usuario }) => {
    const previa = get('SELECT * FROM citas WHERE id = ?', params.id);
    if (!previa) throw noEncontrado('Cita no encontrada');
    const c = normalizarCita({ ...cuerpo, estado: cuerpo.estado || previa.estado });
    const conflictos = buscarConflictos(c, Number(params.id));
    if (conflictos.length && !cuerpo.forzar) {
      throw conflicto('Hay otra cita en ese hueco', { conflictos, advertencias: advertenciasHorario(c) });
    }
    transaccion(() => {
      run(
        `UPDATE citas SET cliente_id=?, vehiculo_id=?, servicio_id=?, bahia_id=?, mecanico_id=?, fecha=?, hora_inicio=?,
                          duracion_min=?, estado=?, titulo=?, descripcion=?, km_entrada=?, espera=?, actualizado_en=?
          WHERE id = ?`,
        c.cliente_id, c.vehiculo_id, c.servicio_id, c.bahia_id, c.mecanico_id, c.fecha, c.hora_inicio,
        c.duracion_min, c.estado, c.titulo, c.descripcion, c.km_entrada, c.espera, ahora(), params.id
      );
      if (previa.fecha !== c.fecha || previa.hora_inicio !== c.hora_inicio) {
        apuntarHistorial(params.id, usuario.usuario, 'reprogramada', `${previa.fecha} ${previa.hora_inicio} → ${c.fecha} ${c.hora_inicio}`);
      } else {
        apuntarHistorial(params.id, usuario.usuario, 'modificada', null);
      }
      if (previa.estado !== c.estado) {
        apuntarHistorial(params.id, usuario.usuario, 'estado', `${U.ESTADOS[previa.estado].etiqueta} → ${U.ESTADOS[c.estado].etiqueta}`);
      }
    });
    return { cita: traerCita(params.id), advertencias: advertenciasHorario(c), conflictos_forzados: conflictos };
  });

  // ---- Arrastrar en la agenda -----------------------------------------
  r.patch('/api/citas/:id/mover', ({ params, cuerpo, usuario }) => {
    const previa = get('SELECT * FROM citas WHERE id = ?', params.id);
    if (!previa) throw noEncontrado('Cita no encontrada');
    if (cuerpo.fecha !== undefined && !U.esFechaISO(cuerpo.fecha)) throw peticionMala('Fecha no válida');
    if (cuerpo.hora_inicio !== undefined && !U.esHora(cuerpo.hora_inicio)) throw peticionMala('Hora no válida');
    const c = {
      ...previa,
      fecha: cuerpo.fecha ?? previa.fecha,
      hora_inicio: cuerpo.hora_inicio ?? previa.hora_inicio,
      bahia_id: cuerpo.bahia_id === undefined ? previa.bahia_id : recursoValido(cuerpo.bahia_id, 'bahia'),
      duracion_min: U.aEntero(cuerpo.duracion_min) || previa.duracion_min,
    };
    duracionValida(c.hora_inicio, c.duracion_min);
    const conflictos = buscarConflictos(c, Number(params.id));
    if (conflictos.length && !cuerpo.forzar) {
      throw conflicto('Hay otra cita en ese hueco', { conflictos, advertencias: advertenciasHorario(c) });
    }
    run(
      'UPDATE citas SET fecha=?, hora_inicio=?, bahia_id=?, duracion_min=?, actualizado_en=? WHERE id=?',
      c.fecha, c.hora_inicio, c.bahia_id, c.duracion_min, ahora(), params.id
    );
    apuntarHistorial(
      params.id,
      usuario.usuario,
      'reprogramada',
      `${previa.fecha} ${previa.hora_inicio} → ${c.fecha} ${c.hora_inicio}`
    );
    return { cita: traerCita(params.id), advertencias: advertenciasHorario(c) };
  });

  // ---- Cambio de estado ------------------------------------------------
  r.patch('/api/citas/:id/estado', ({ params, cuerpo, usuario }) => {
    const previa = get('SELECT * FROM citas WHERE id = ?', params.id);
    if (!previa) throw noEncontrado('Cita no encontrada');
    const estado = cuerpo.estado;
    if (!Object.hasOwn(U.ESTADOS, String(estado))) throw peticionMala('Estado no válido');
    // Confirmar, anular o marcar ausencia es cosa de recepción; en el taller solo se avanza el trabajo
    if (!auth.tienePermiso(usuario, 'gestionar') && !U.ESTADOS_TALLER.includes(estado)) {
      throw prohibido('Solo recepción puede confirmar, anular o marcar una cita como no presentada.');
    }
    const km = kmValido(cuerpo.km_entrada);
    transaccion(() => {
      run('UPDATE citas SET estado=?, actualizado_en=? WHERE id=?', estado, ahora(), params.id);
      apuntarHistorial(
        params.id,
        usuario.usuario,
        'estado',
        `${U.ESTADOS[previa.estado].etiqueta} → ${U.ESTADOS[estado].etiqueta}`
      );
      // Al recepcionar el vehículo se aprovechan los km indicados (sin bajar los que ya tenía)
      if (estado === 'en_taller' && km !== null) {
        run('UPDATE citas SET km_entrada=? WHERE id=?', km, params.id);
        if (previa.vehiculo_id) {
          run(
            'UPDATE vehiculos SET km = MAX(IFNULL(km, 0), ?), actualizado_en = ? WHERE id = ?',
            km, ahora(), previa.vehiculo_id
          );
        }
      }
    });
    return traerCita(params.id);
  }, { permiso: 'estado' });

  r.delete('/api/citas/:id', ({ params }) => {
    if (!get('SELECT id FROM citas WHERE id = ?', params.id)) throw noEncontrado('Cita no encontrada');
    run('DELETE FROM citas WHERE id = ?', params.id);
    return { ok: true };
  });

  // ---- Aviso al cliente ------------------------------------------------
  r.post('/api/citas/:id/aviso', ({ params, usuario }) => {
    const cita = traerCita(params.id);
    if (!cita) throw noEncontrado('Cita no encontrada');
    run('UPDATE citas SET aviso_enviado_en=? WHERE id=?', ahora(), params.id);
    apuntarHistorial(params.id, usuario.usuario, 'aviso', 'Recordatorio marcado como enviado');
    return { ok: true, texto: textoAviso(cita), telefono: telefonoInternacional(cita.cliente_telefono) };
  }, { codigo: 200 });

  // ---- Agenda del dia --------------------------------------------------
  r.get('/api/agenda', ({ query }) => {
    const fecha = U.esFechaISO(query.fecha) ? query.fecha : U.hoyISO();
    const aj = leerAjustes();
    const bahias = all("SELECT * FROM recursos WHERE tipo = 'bahia' AND activo = 1 ORDER BY orden, nombre");
    const mecanicos = all("SELECT * FROM recursos WHERE tipo = 'mecanico' AND activo = 1 ORDER BY orden, nombre");
    const citas = all(`${SELECT_CITA} WHERE ci.fecha = ? ORDER BY ci.hora_inicio`, fecha);

    // minutos ocupados por bahia para calcular ocupacion del dia
    const jornada = Math.max(1, U.aMinutos(aj.hora_cierre) - U.aMinutos(aj.hora_apertura));
    const ocupacion = bahias.map((b) => {
      const min = citas
        .filter((c) => c.bahia_id === b.id && !U.ESTADOS_LIBERAN.includes(c.estado))
        .reduce((s, c) => s + c.duracion_min, 0);
      return { bahia_id: b.id, minutos: min, porcentaje: Math.round((min / jornada) * 100) };
    });

    return {
      fecha,
      ajustes: aj,
      bahias,
      mecanicos,
      citas,
      ocupacion,
      cerrado: !String(aj.dias_laborables).split(',').map(Number).includes(U.diaSemana(fecha)),
    };
  });

  // ---- Agenda semanal --------------------------------------------------
  r.get('/api/agenda/semana', ({ query }) => {
    const desde = U.esFechaISO(query.desde) ? query.desde : U.hoyISO();
    const hasta = U.sumarDias(desde, 6);
    const citas = all(
      `${SELECT_CITA} WHERE ci.fecha BETWEEN ? AND ? ORDER BY ci.fecha, ci.hora_inicio`,
      desde,
      hasta
    );
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const f = U.sumarDias(desde, i);
      dias.push({ fecha: f, citas: citas.filter((c) => c.fecha === f) });
    }
    return { desde, hasta, dias, ajustes: leerAjustes() };
  });

  // ---- Huecos libres ---------------------------------------------------
  r.get('/api/disponibilidad', ({ query }) => {
    const fecha = U.esFechaISO(query.fecha) ? query.fecha : U.hoyISO();
    return huecosLibres({
      fecha,
      duracion: query.duracion,
      bahia_id: query.bahia_id,
      mecanico_id: query.mecanico_id,
    });
  });

  // ---- Panel de inicio -------------------------------------------------
  r.get('/api/panel', () => {
    const aj = leerAjustes();
    const hoy = U.hoyISO();
    const citasHoy = all(`${SELECT_CITA} WHERE ci.fecha = ? ORDER BY ci.hora_inicio`, hoy);
    const proximas = all(
      `${SELECT_CITA} WHERE ci.fecha > ? AND ci.fecha <= ? AND ci.estado NOT IN ('anulada','no_presentado')
        ORDER BY ci.fecha, ci.hora_inicio LIMIT 50`,
      hoy,
      U.sumarDias(hoy, 7)
    );
    const sinConfirmar = all(
      `${SELECT_CITA} WHERE ci.fecha >= ? AND ci.estado = 'pendiente' ORDER BY ci.fecha, ci.hora_inicio LIMIT 50`,
      hoy
    );
    const limiteItv = U.sumarDias(hoy, U.aEntero(aj.aviso_itv_dias) || 30);
    const itv = all(
      `SELECT v.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
         FROM vehiculos v LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.proxima_itv IS NOT NULL AND v.proxima_itv <= ?
        ORDER BY v.proxima_itv LIMIT 100`,
      limiteItv
    );
    const revisiones = all(
      `SELECT v.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
         FROM vehiculos v LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.proxima_revision IS NOT NULL AND v.proxima_revision <= ?
        ORDER BY v.proxima_revision LIMIT 100`,
      limiteItv
    );
    const totales = {
      clientes: get('SELECT COUNT(*) AS n FROM clientes').n,
      vehiculos: get('SELECT COUNT(*) AS n FROM vehiculos').n,
      citas_mes: get('SELECT COUNT(*) AS n FROM citas WHERE fecha >= ?', U.sumarDias(hoy, -30)).n,
      no_presentados_mes: get(
        "SELECT COUNT(*) AS n FROM citas WHERE estado = 'no_presentado' AND fecha >= ?",
        U.sumarDias(hoy, -30)
      ).n,
    };
    return { hoy, ajustes: aj, citasHoy, proximas, sinConfirmar, itv, revisiones, totales };
  });

  // ---- Informes --------------------------------------------------------
  r.get('/api/informes', ({ query }) => {
    const hasta = U.esFechaISO(query.hasta) ? query.hasta : U.hoyISO();
    let desde = U.esFechaISO(query.desde) ? query.desde : U.sumarDias(hasta, -30);
    if (desde > hasta) desde = hasta;
    // Como máximo cinco años de golpe
    if (desde < U.sumarDias(hasta, -1830)) desde = U.sumarDias(hasta, -1830);
    const citas = all('SELECT * FROM citas WHERE fecha BETWEEN ? AND ?', desde, hasta);
    const aj = leerAjustes();

    const porEstado = Object.keys(U.ESTADOS).map((e) => ({
      estado: e,
      etiqueta: U.ESTADOS[e].etiqueta,
      color: U.ESTADOS[e].color,
      n: citas.filter((c) => c.estado === e).length,
    }));

    const porServicio = all(
      `SELECT IFNULL(s.nombre, 'Sin servicio') AS servicio, COUNT(*) AS n, SUM(ci.duracion_min) AS minutos
         FROM citas ci LEFT JOIN servicios s ON s.id = ci.servicio_id
        WHERE ci.fecha BETWEEN ? AND ? AND ci.estado NOT IN ('anulada','no_presentado')
        GROUP BY servicio ORDER BY n DESC`,
      desde,
      hasta
    );

    const laborables = String(aj.dias_laborables).split(',').map(Number).filter(Boolean);
    let diasHabiles = 0;
    for (let f = desde; f <= hasta; f = U.sumarDias(f, 1)) {
      if (laborables.includes(U.diaSemana(f))) diasHabiles++;
    }
    const jornada = Math.max(1, U.aMinutos(aj.hora_cierre) - U.aMinutos(aj.hora_apertura));
    const porBahia = all("SELECT * FROM recursos WHERE tipo = 'bahia' ORDER BY orden, nombre").map((b) => {
      const minutos = citas
        .filter((c) => c.bahia_id === b.id && !U.ESTADOS_LIBERAN.includes(c.estado))
        .reduce((s, c) => s + c.duracion_min, 0);
      const capacidad = Math.max(1, jornada * diasHabiles);
      return { bahia: b.nombre, color: b.color, minutos, porcentaje: Math.round((minutos / capacidad) * 100) };
    });

    const topClientes = all(
      `SELECT IFNULL(c.nombre,'Sin cliente') AS cliente, COUNT(*) AS n
         FROM citas ci LEFT JOIN clientes c ON c.id = ci.cliente_id
        WHERE ci.fecha BETWEEN ? AND ?
        GROUP BY cliente ORDER BY n DESC LIMIT 10`,
      desde,
      hasta
    );

    const total = citas.length;
    const noShow = citas.filter((c) => c.estado === 'no_presentado').length;
    return {
      desde,
      hasta,
      total,
      dias_habiles: diasHabiles,
      tasa_no_show: total ? Math.round((noShow / total) * 1000) / 10 : 0,
      porEstado,
      porServicio,
      porBahia,
      topClientes,
    };
  });

  // ---- Buscador global -------------------------------------------------
  r.get('/api/buscar', ({ query }) => {
    const q = String(query.q || '').trim().slice(0, 100);
    if (q.length < 2) return { clientes: [], vehiculos: [], citas: [] };
    const like = U.patronLike(q);
    const matricula = U.normalizarMatricula(q);
    const likeMat = matricula ? U.patronLike(matricula) : null;
    const digitos = q.replace(/\D/g, '');
    const likeTel = digitos.length >= 3 ? U.patronLike(digitos) : null;
    return {
      clientes: all(
        `SELECT id, nombre, telefono, email FROM clientes
          WHERE LOWER(nombre) LIKE ? ESCAPE '\\'
             OR REPLACE(REPLACE(IFNULL(telefono,''),' ',''),'-','') LIKE ? ESCAPE '\\'
             OR LOWER(IFNULL(nif,'')) LIKE ? ESCAPE '\\'
          ORDER BY nombre LIMIT 10`,
        like, likeTel, like
      ),
      vehiculos: all(
        `SELECT v.id, v.matricula, v.marca, v.modelo, c.nombre AS cliente_nombre
           FROM vehiculos v LEFT JOIN clientes c ON c.id = v.cliente_id
          WHERE LOWER(v.matricula) LIKE ? ESCAPE '\\'
             OR LOWER(IFNULL(v.marca,'') || ' ' || IFNULL(v.modelo,'')) LIKE ? ESCAPE '\\'
          ORDER BY v.matricula LIMIT 10`,
        likeMat, like
      ),
      citas: all(
        `${SELECT_CITA}
          WHERE LOWER(IFNULL(ci.titulo,'')) LIKE ? ESCAPE '\\'
             OR LOWER(IFNULL(v.matricula,'')) LIKE ? ESCAPE '\\'
             OR LOWER(IFNULL(c.nombre,'')) LIKE ? ESCAPE '\\'
          ORDER BY ci.fecha DESC LIMIT 10`,
        like, likeMat, like
      ),
    };
  });
}

module.exports = { registrar, textoAviso, telefonoInternacional, buscarConflictos };
