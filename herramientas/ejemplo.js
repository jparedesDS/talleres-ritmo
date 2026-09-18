'use strict';
// Carga (o borra) un juego de datos de ejemplo para ver el programa con contenido.
//   node herramientas/ejemplo.js            -> añade los datos
//   node herramientas/ejemplo.js --borrar   -> quita solo los datos de ejemplo
//
// Todo lo de ejemplo queda marcado con la etiqueta EJEMPLO en las notas, así que
// nunca se toca nada que haya metido el taller.

const { all, get, run } = require('../server/db');
const U = require('../server/util');

const MARCA = '[EJEMPLO]';
const ahora = () => new Date().toISOString();
const hoy = U.hoyISO();
const d = (n) => U.sumarDias(hoy, n);

// --------------------------------------------------------------------------
function borrar() {
  const clientes = all("SELECT id FROM clientes WHERE notas LIKE '%' || ? || '%'", MARCA);
  const vehiculos = all("SELECT id FROM vehiculos WHERE notas LIKE '%' || ? || '%'", MARCA);
  const idsV = vehiculos.map((v) => v.id);
  let citas = 0;
  for (const id of idsV) {
    citas += get('SELECT COUNT(*) AS n FROM citas WHERE vehiculo_id = ?', id).n;
    run('DELETE FROM citas WHERE vehiculo_id = ?', id);
    run('DELETE FROM vehiculos WHERE id = ?', id);
  }
  for (const c of clientes) run('DELETE FROM clientes WHERE id = ?', c.id);
  console.log(`Borrados: ${clientes.length} clientes, ${idsV.length} vehículos y ${citas} citas de ejemplo.`);
}

// --------------------------------------------------------------------------
function crearCliente(c) {
  const t = ahora();
  const res = run(
    `INSERT INTO clientes (nombre, nif, telefono, email, direccion, poblacion, cp, notas, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    c.nombre, c.nif, c.telefono, c.email, c.direccion, c.poblacion, c.cp, `${MARCA} ${c.notas || ''}`.trim(), t, t
  );
  return Number(res.lastInsertRowid);
}

function crearVehiculo(v) {
  const t = ahora();
  const res = run(
    `INSERT INTO vehiculos (cliente_id, matricula, marca, modelo, anio, bastidor, combustible, km,
                            proxima_itv, proxima_revision, notas, creado_en, actualizado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    v.cliente_id, v.matricula, v.marca, v.modelo, v.anio, v.bastidor, v.combustible, v.km,
    v.proxima_itv, v.proxima_revision, `${MARCA} ${v.notas || ''}`.trim(), t, t
  );
  return Number(res.lastInsertRowid);
}

function crearCita(c) {
  const t = ahora();
  const res = run(
    `INSERT INTO citas (cliente_id, vehiculo_id, servicio_id, bahia_id, mecanico_id, fecha, hora_inicio,
                        duracion_min, estado, titulo, descripcion, km_entrada, espera, aviso_enviado_en,
                        creado_en, actualizado_en, creado_por)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    c.cliente_id, c.vehiculo_id, c.servicio_id, c.bahia_id, c.mecanico_id, c.fecha, c.hora,
    c.duracion, c.estado, c.titulo, c.descripcion, c.km_entrada, c.espera ? 1 : 0, c.aviso || null,
    t, t, 'ejemplo'
  );
  const id = Number(res.lastInsertRowid);
  run('INSERT INTO historial (cita_id, usuario, accion, detalle, fecha) VALUES (?,?,?,?,?)',
    id, 'ejemplo', 'creada', `${c.fecha} ${c.hora}`, t);
  if (!['pendiente'].includes(c.estado)) {
    run('INSERT INTO historial (cita_id, usuario, accion, detalle, fecha) VALUES (?,?,?,?,?)',
      id, 'ejemplo', 'estado', `Pendiente → ${U.ESTADOS[c.estado].etiqueta}`, t);
  }
  return id;
}

// --------------------------------------------------------------------------
function cargar() {
  if (get("SELECT COUNT(*) AS n FROM clientes WHERE notas LIKE '%' || ? || '%'", MARCA).n > 0) {
    console.log('Los datos de ejemplo ya estaban cargados. Se vuelven a generar desde cero.');
    borrar();
  }

  // Referencias a lo que ya existe (bahías, mecánicos y servicios)
  const bahias = all("SELECT * FROM recursos WHERE tipo = 'bahia' AND activo = 1 ORDER BY orden, id");
  const mecanicos = all("SELECT * FROM recursos WHERE tipo = 'mecanico' AND activo = 1 ORDER BY orden, id");
  if (!bahias.length) {
    console.error('No hay bahías dadas de alta. Arranque el programa una vez antes de cargar el ejemplo.');
    process.exit(1);
  }
  const B = (i) => (bahias[i] || bahias[bahias.length - 1]).id;
  const M = (i) => (mecanicos.length ? (mecanicos[i] || mecanicos[0]).id : null);

  const servicios = {};
  for (const s of all('SELECT * FROM servicios')) servicios[s.nombre] = s;
  const S = (trozo) => {
    const clave = Object.keys(servicios).find((n) => n.toLowerCase().includes(trozo));
    return clave ? servicios[clave] : null;
  };
  const sv = {
    aceite: S('aceite'),
    revision: S('revisión general'),
    neumaticos: S('neumáticos'),
    frenos: S('frenos'),
    diagnosis: S('diagnosis'),
    preitv: S('pre-itv'),
    distribucion: S('distribución'),
    aire: S('aire'),
  };

  // ---- Clientes --------------------------------------------------------
  const maria = crearCliente({
    nombre: 'María Ortega Pardo',
    nif: '52447891H',
    telefono: '600 123 456',
    email: 'maria.ortega@correo.es',
    direccion: 'C/ Mayor 14, 2º B',
    poblacion: 'Alcalá de Henares',
    cp: '28801',
    notas: 'Prefiere que la avisen por WhatsApp y recoger el coche por la tarde.',
  });

  const rueda = crearCliente({
    nombre: 'Transportes Rueda S.L.',
    nif: 'B85471203',
    telefono: '918 452 117',
    email: 'flota@transportesrueda.es',
    direccion: 'Pol. Ind. Las Monjas, nave 12',
    poblacion: 'Torrejón de Ardoz',
    cp: '28850',
    notas: 'Flota de 2 furgonetas. Facturación mensual. Avisar siempre a Ana (jefa de tráfico).',
  });

  const javier = crearCliente({
    nombre: 'Javier Domínguez Sáez',
    nif: '05298447K',
    telefono: '622 887 411',
    email: 'jdominguez88@correo.es',
    direccion: 'Avda. de la Constitución 3',
    poblacion: 'Alcalá de Henares',
    cp: '28802',
    notas: 'Suele traer el coche muy justo de mantenimiento.',
  });

  // ---- Vehículos -------------------------------------------------------
  const clio = crearVehiculo({
    cliente_id: maria,
    matricula: '4821LMN',
    marca: 'Renault',
    modelo: 'Clio TCe 90',
    anio: 2021,
    bastidor: 'VF1RJA00X66123456',
    combustible: 'Gasolina',
    km: 61250,
    proxima_itv: d(19),
    proxima_revision: d(96),
    notas: 'Neumáticos delanteros cambiados en marzo.',
  });

  const jumpy = crearVehiculo({
    cliente_id: rueda,
    matricula: '7712JKP',
    marca: 'Citroën',
    modelo: 'Jumpy 2.0 BlueHDi',
    anio: 2019,
    bastidor: 'VF7VFAHXMHZ012345',
    combustible: 'Diésel',
    km: 238400,
    proxima_itv: d(9),
    proxima_revision: d(41),
    notas: 'Reparto diario: no puede estar parada más de un día.',
  });

  const transit = crearVehiculo({
    cliente_id: rueda,
    matricula: '3390GHT',
    marca: 'Ford',
    modelo: 'Transit Custom',
    anio: 2017,
    bastidor: 'WF0YXXTTGYHR54321',
    combustible: 'Diésel',
    km: 315780,
    proxima_itv: d(-6),
    proxima_revision: d(12),
    notas: 'ITV caducada: avisar a la empresa.',
  });

  const leon = crearVehiculo({
    cliente_id: javier,
    matricula: '1145BCD',
    marca: 'Seat',
    modelo: 'León 1.5 TSI',
    anio: 2018,
    bastidor: 'VSSZZZ5FZJR098765',
    combustible: 'Gasolina',
    km: 128900,
    proxima_itv: d(74),
    proxima_revision: d(3),
    notas: null,
  });

  // ---- Citas -----------------------------------------------------------
  const citas = [
    // --- Historial (semanas anteriores) ---
    { cliente_id: maria, vehiculo_id: clio, s: sv.aceite, b: 0, m: 0, fecha: d(-21), hora: '09:00',
      estado: 'entregada', km_entrada: 58120, desc: 'Cambio de aceite 5W30 y filtro. Revisados niveles.' },
    { cliente_id: rueda, vehiculo_id: jumpy, s: sv.frenos, b: 1, m: 1, fecha: d(-14), hora: '08:30',
      estado: 'entregada', km_entrada: 231050, desc: 'Pastillas y discos delanteros. Purgado de circuito.' },
    { cliente_id: javier, vehiculo_id: leon, s: sv.neumaticos, b: 0, m: 0, fecha: d(-12), hora: '16:00',
      estado: 'no_presentado', desc: 'No se presentó ni avisó. Llamar antes de la próxima cita.' },
    { cliente_id: rueda, vehiculo_id: transit, s: sv.diagnosis, b: 2, m: 1, fecha: d(-7), hora: '11:00',
      estado: 'entregada', km_entrada: 312440, desc: 'Testigo de motor: sensor de presión de admisión.' },
    { cliente_id: maria, vehiculo_id: clio, s: sv.revision, b: 1, m: 0, fecha: d(-5), hora: '10:00',
      estado: 'anulada', desc: 'Anulada por la clienta, la pasamos a la semana que viene.' },

    // --- Hoy ---
    { cliente_id: maria, vehiculo_id: clio, s: sv.aceite, b: 0, m: 0, fecha: hoy, hora: '08:30',
      estado: 'entregada', km_entrada: 61250, aviso: ahora(),
      desc: 'Cambio de aceite y filtros. Entregado a las 10:15.' },
    { cliente_id: javier, vehiculo_id: leon, s: sv.revision, b: 1, m: 0, fecha: hoy, hora: '09:30',
      estado: 'terminada', km_entrada: 128900, espera: true,
      desc: 'Revisión de los 130.000 km. Pendiente de que pase a recogerlo.' },
    { cliente_id: rueda, vehiculo_id: transit, s: sv.distribucion, b: 2, m: 1, fecha: hoy, hora: '08:00',
      estado: 'en_reparacion', km_entrada: 315780,
      desc: 'Kit de distribución + bomba de agua. Trabajo de todo el día.' },
    { cliente_id: rueda, vehiculo_id: jumpy, s: sv.diagnosis, b: 0, m: 0, fecha: hoy, hora: '11:00',
      estado: 'en_taller', km_entrada: 238400,
      desc: 'Pierde potencia en caliente. Revisar turbo y EGR.' },
    { cliente_id: maria, vehiculo_id: clio, s: sv.neumaticos, b: 1, m: 1, fecha: hoy, hora: '16:00',
      estado: 'confirmada', desc: 'Dos neumáticos traseros 205/55 R16 y equilibrado.' },

    // --- Próximos días ---
    { cliente_id: rueda, vehiculo_id: jumpy, s: sv.preitv, b: 0, m: 0, fecha: d(1), hora: '09:00',
      estado: 'confirmada', aviso: ahora(), desc: 'Pre-ITV antes de la inspección de la semana que viene.' },
    { cliente_id: javier, vehiculo_id: leon, s: sv.frenos, b: 1, m: 1, fecha: d(1), hora: '10:30',
      estado: 'confirmada', desc: 'Chirría al frenar en frío. Revisar pastillas traseras.' },
    { cliente_id: rueda, vehiculo_id: transit, s: sv.preitv, b: 0, m: 0, fecha: d(2), hora: '08:30',
      estado: 'pendiente', desc: 'ITV caducada: dar cita en la estación en cuanto pase la pre-ITV.' },
    { cliente_id: maria, vehiculo_id: clio, s: sv.aire, b: 1, m: 0, fecha: d(2), hora: '11:00',
      estado: 'pendiente', espera: true, desc: 'El aire no enfría. Carga de gas y comprobación de fugas.' },
    { cliente_id: javier, vehiculo_id: leon, s: sv.revision, b: 2, m: 1, fecha: d(7), hora: '09:30',
      estado: 'pendiente', desc: 'Revisión anual.' },
  ];

  for (const c of citas) {
    crearCita({
      cliente_id: c.cliente_id,
      vehiculo_id: c.vehiculo_id,
      servicio_id: c.s ? c.s.id : null,
      bahia_id: B(c.b),
      mecanico_id: M(c.m),
      fecha: c.fecha,
      hora: c.hora,
      duracion: c.s ? c.s.duracion_min : 60,
      estado: c.estado,
      titulo: c.s ? c.s.nombre : 'Cita',
      descripcion: c.desc,
      km_entrada: c.km_entrada || null,
      espera: c.espera,
      aviso: c.aviso,
    });
  }

  console.log('Datos de ejemplo cargados:');
  console.log('  3 clientes (María Ortega, Transportes Rueda S.L. y Javier Domínguez)');
  console.log('  4 vehículos, uno con la ITV ya caducada y otro a punto de caducar');
  console.log(`  ${citas.length} citas entre el ${U.sumarDias(hoy, -21)} y el ${U.sumarDias(hoy, 7)}`);
  console.log('');
  console.log('Para quitarlos: node herramientas/ejemplo.js --borrar');
}

// --------------------------------------------------------------------------
if (process.argv.includes('--borrar')) borrar();
else cargar();
