'use strict';
/**
 * Pruebas automáticas del programa.
 *
 *   node herramientas/pruebas.js          (o doble clic en PROBAR.bat)
 *
 * Arranca una copia del programa con una base de datos VACÍA en una carpeta
 * temporal y otro puerto, hace por HTTP lo mismo que haría una persona
 * probando a mano, y dice si algo se ha roto.
 *
 * NUNCA toca la base de datos real: ni la de este equipo ni la del taller.
 *
 * Sirve para lanzarlo antes de llevar una versión nueva al taller: si algo
 * dejó de funcionar, sale aquí y no allí.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-pruebas-'));
const CARPETA_COPIAS = path.join(CARPETA, 'copia-externa');

let servidor = null;
let base = '';
let cookie = '';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------
let correctas = 0;
const fallos = [];
let grupoActual = '';

function grupo(nombre) {
  grupoActual = nombre;
  console.log(`\n  ${nombre}`);
}

function comprobar(titulo, condicion, detalle = '') {
  if (condicion) {
    correctas += 1;
    console.log(`    OK    ${titulo}`);
  } else {
    fallos.push({ grupo: grupoActual, titulo, detalle });
    console.log(`    FALLA ${titulo}${detalle ? `  ->  ${detalle}` : ''}`);
  }
}

async function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Petición al programa, guardando la cookie de sesión como hace el navegador. */
async function pedir(metodo, ruta, cuerpo, opciones = {}) {
  const cabeceras = {};
  if (opciones.sinCabeceraTaller !== true) cabeceras['X-Taller'] = '1';
  if (cookie && !opciones.sinCookie) cabeceras.Cookie = cookie;
  if (opciones.origen) cabeceras.Origin = opciones.origen;
  const init = { method: metodo, headers: cabeceras };
  if (cuerpo !== undefined) {
    cabeceras['Content-Type'] = 'application/json';
    init.body = JSON.stringify(cuerpo);
  }
  const res = await fetch(base + ruta, init);
  const recibida = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of recibida) {
    const trozo = c.split(';')[0];
    // El servidor manda "taller_sid=...". Se guarda tal cual, y si llega
    // vacía (al salir) se olvida, igual que haría el navegador.
    if (trozo.includes('=')) cookie = trozo.endsWith('=') ? '' : trozo;
  }
  let datos = null;
  try {
    datos = await res.json();
  } catch {
    datos = null;
  }
  return { codigo: res.status, datos };
}

async function arrancarServidor() {
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  servidor = spawn(process.execPath, ['--no-warnings', path.join(RAIZ, 'server', 'index.js')], {
    cwd: RAIZ,
    env: { ...process.env, TALLER_DATOS: CARPETA, PUERTO: String(puerto), HOST: '127.0.0.1', TALLER_ABRIR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  servidor.stdout.on('data', (d) => { salida += d; });
  servidor.stderr.on('data', (d) => { salida += d; });

  const limite = Date.now() + 20000;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`${base}/api/sesion`, { headers: { 'X-Taller': '1' } });
      if (r.ok) return;
    } catch {
      /* todavía no escucha */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`El programa no arrancó en 20 segundos.\n${salida}`);
}

function limpiar() {
  if (servidor && !servidor.killed) servidor.kill();
  try {
    fs.rmSync(CARPETA, { recursive: true, force: true });
  } catch {
    /* Windows a veces retiene el fichero un instante; es temporal, da igual */
  }
}

// ---------------------------------------------------------------------------
// Las pruebas
// ---------------------------------------------------------------------------
async function acceso() {
  grupo('Acceso y contraseñas');

  let r = await pedir('GET', '/api/citas');
  comprobar('sin entrar no se ven las citas', r.codigo === 401, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/login', { usuario: 'admin', clave: 'noesesta' });
  comprobar('contraseña incorrecta no deja entrar', r.codigo === 401, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/login', { usuario: 'admin', clave: 'admin' });
  comprobar('admin/admin entra la primera vez', r.codigo === 200, `devolvió ${r.codigo}`);
  comprobar('avisa de que hay que cambiar la contraseña', r.datos && r.datos.usuario && r.datos.usuario.debe_cambiar_clave === true);

  r = await pedir('GET', '/api/citas');
  comprobar('con contraseña provisional no se puede trabajar', r.codigo === 403, `devolvió ${r.codigo}`);
  comprobar('y dice que hay que cambiarla', !!(r.datos && r.datos.cambiar_clave));

  r = await pedir('PUT', '/api/usuarios/1', { clave_actual: 'admin', clave: '1234' });
  comprobar('rechaza una contraseña demasiado corta', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('PUT', '/api/usuarios/1', { clave_actual: 'admin', clave: 'password' });
  comprobar('rechaza una contraseña obvia', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('PUT', '/api/usuarios/1', { clave_actual: 'esanoera', clave: 'TallerRitmo26' });
  comprobar('para cambiar la propia hay que acertar la actual', r.codigo >= 400, `devolvió ${r.codigo}`);

  r = await pedir('PUT', '/api/usuarios/1', { clave_actual: 'admin', clave: 'TallerRitmo26' });
  comprobar('acepta una contraseña buena', r.codigo === 200, `devolvió ${r.codigo}`);

  r = await pedir('GET', '/api/citas');
  comprobar('después ya se puede trabajar', r.codigo === 200, `devolvió ${r.codigo}`);
}

async function seguridad() {
  grupo('Seguridad');

  let r = await pedir('POST', '/api/clientes', { nombre: 'Prueba CSRF' }, { sinCabeceraTaller: true });
  comprobar('rechaza escrituras que no vienen de la aplicación', r.codigo === 403, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/clientes', { nombre: 'Prueba origen' }, { origen: 'http://otra-web.example' });
  comprobar('rechaza escrituras desde otra web', r.codigo === 403, `devolvió ${r.codigo}`);

  r = await pedir('GET', '/api/clientes', undefined, { sinCookie: true });
  comprobar('sin cookie de sesión no se entra', r.codigo === 401, `devolvió ${r.codigo}`);

  r = await pedir('GET', '/api/no-existe-esta-ruta');
  comprobar('una ruta inventada da 404', r.codigo === 404, `devolvió ${r.codigo}`);

  r = await pedir('DELETE', '/api/sesion');
  comprobar('un método no permitido da 404 o 405', [404, 405].includes(r.codigo), `devolvió ${r.codigo}`);

  // Host: el servidor solo acepta IPs, localhost, el nombre del equipo o TALLER_HOSTS
  const puerto = new URL(base).port;
  const conHost = (host) => new Promise((resolve) => {
    const req = require('node:http').request(
      { host: '127.0.0.1', port: puerto, path: '/api/sesion', method: 'GET', headers: { Host: host, 'X-Taller': '1' } },
      (res) => { res.resume(); resolve(res.statusCode); }
    );
    req.on('error', () => resolve(0));
    req.end();
  });
  comprobar('acepta entrar por la IP', (await conHost(`127.0.0.1:${puerto}`)) === 200);
  comprobar('rechaza un nombre de equipo desconocido', (await conHost('taller-falso.example')) === 421);
}

async function clientesYVehiculos() {
  grupo('Clientes y vehículos');

  let r = await pedir('POST', '/api/clientes', { nombre: '' });
  comprobar('no deja crear un cliente sin nombre', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/clientes', { nombre: 'Cliente Prueba', telefono: '600111222', email: 'no-es-un-email' });
  comprobar('rechaza un email mal escrito', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/clientes', { nombre: 'Ana Prueba Uno', telefono: '600111222', email: 'ana@correo.es' });
  comprobar('crea un cliente', r.codigo === 201 && r.datos && r.datos.id > 0, `devolvió ${r.codigo}`);
  const cliente1 = r.datos.id;

  r = await pedir('POST', '/api/clientes', { nombre: 'Otro Con Mismo Telefono', telefono: '600 111 222' });
  comprobar('avisa de que ese teléfono ya existe', r.codigo === 409 && !!(r.datos && r.datos.duplicados), `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/clientes', { nombre: 'Otro Con Mismo Telefono', telefono: '600 111 222', forzar: true });
  comprobar('deja crearlo igualmente si se confirma', r.codigo === 201, `devolvió ${r.codigo}`);
  const repetido = r.datos.id;

  r = await pedir('POST', '/api/clientes', { nombre: 'Bea Prueba Dos', telefono: '+34 622 333 444' });
  comprobar('guarda un teléfono con prefijo internacional', r.codigo === 201, `devolvió ${r.codigo}`);
  const cliente2 = r.datos.id;

  // Un nombre con código HTML se guarda tal cual (la pantalla lo pinta como texto)
  const nombreConCodigo = '<img src=x onerror=alert(1)>';
  r = await pedir('POST', '/api/clientes', { nombre: nombreConCodigo, telefono: '655000111' });
  comprobar('acepta un nombre con código y lo devuelve tal cual', r.codigo === 201 && r.datos.nombre === nombreConCodigo);
  const clienteCodigo = r.datos.id;

  r = await pedir('POST', '/api/vehiculos', { matricula: '', marca: 'Seat' });
  comprobar('no deja crear un coche sin matrícula', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/vehiculos', { matricula: '1234 abc', marca: 'Seat', modelo: 'León', cliente_id: cliente1 });
  comprobar('crea un coche y normaliza la matrícula', r.codigo === 201 && r.datos.matricula === '1234ABC', r.datos && r.datos.matricula);
  const vehiculo = r.datos.id;

  r = await pedir('GET', '/api/vehiculos?q=1234%20abc');
  comprobar('encuentra la matrícula aunque se busque con espacios', Array.isArray(r.datos) && r.datos.some((v) => v.id === vehiculo));

  r = await pedir('GET', '/api/vehiculos?q=%25');
  comprobar('buscar un % no devuelve toda la lista', Array.isArray(r.datos) && r.datos.length === 0, `devolvió ${r.datos && r.datos.length}`);

  r = await pedir('POST', '/api/vehiculos', { matricula: '1234ABC', marca: 'Otro' });
  comprobar('avisa de que esa matrícula ya existe', r.codigo === 409, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/vehiculos', { matricula: '5678DEF', marca: 'Renault', modelo: 'Clio', cliente_id: cliente1, km: -5 });
  comprobar('rechaza kilómetros negativos', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/vehiculos', { matricula: '5678DEF', marca: 'Renault', modelo: 'Clio', cliente_id: cliente1 });
  comprobar('un mismo cliente puede tener varios coches', r.codigo === 201, `devolvió ${r.codigo}`);
  const vehiculo2 = r.datos.id;

  r = await pedir('GET', `/api/clientes/${cliente1}`);
  comprobar('la ficha del cliente muestra sus dos coches', r.datos && Array.isArray(r.datos.vehiculos) && r.datos.vehiculos.length === 2,
    r.datos && r.datos.vehiculos && String(r.datos.vehiculos.length));

  return { cliente1, cliente2, repetido, clienteCodigo, vehiculo, vehiculo2 };
}

async function citas(datos) {
  grupo('Citas');

  let r = await pedir('POST', '/api/citas', { fecha: '2026-02-30', hora_inicio: '09:00', vehiculo_id: datos.vehiculo });
  comprobar('rechaza el 30 de febrero', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/citas', { fecha: '2026-10-05', hora_inicio: '25:00', vehiculo_id: datos.vehiculo });
  comprobar('rechaza una hora imposible', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/citas', { fecha: '2026-10-05', hora_inicio: '09:00', duracion_min: 4, vehiculo_id: datos.vehiculo });
  comprobar('rechaza una cita de 4 minutos', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/citas', { fecha: '2026-10-05', hora_inicio: '23:30', duracion_min: 120, vehiculo_id: datos.vehiculo });
  comprobar('rechaza una cita que pasa de medianoche', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/citas', {
    fecha: '2026-10-05', hora_inicio: '09:00', duracion_min: 60, vehiculo_id: datos.vehiculo, titulo: 'Revisión de prueba',
  });
  comprobar('crea una cita', r.codigo === 201 && !!(r.datos && r.datos.cita), `devolvió ${r.codigo}`);
  const cita = r.datos.cita.id;
  comprobar('la cita toma como cliente al dueño del coche', r.datos.cita.cliente_id === datos.cliente1,
    `cliente_id = ${r.datos.cita.cliente_id}`);

  // --- La regla importante: el cliente sale SIEMPRE del dueño del coche ---
  r = await pedir('PUT', `/api/vehiculos/${datos.vehiculo}`, {
    matricula: '1234ABC', marca: 'Seat', modelo: 'León', cliente_id: datos.cliente2,
  });
  comprobar('se puede cambiar el coche de dueño', r.codigo === 200, `devolvió ${r.codigo}`);

  r = await pedir('GET', `/api/citas/${cita}`);
  comprobar('al cambiar de dueño, la cita abierta pasa al nuevo', !!(r.datos && r.datos.cita) && r.datos.cita.cliente_id === datos.cliente2,
    `cliente_id = ${r.datos && r.datos.cita && r.datos.cita.cliente_id}`);

  // Una cita ya entregada conserva a quien trajo el coche entonces
  r = await pedir('POST', '/api/citas', {
    fecha: '2026-10-06', hora_inicio: '09:00', duracion_min: 60, vehiculo_id: datos.vehiculo2, titulo: 'Cita cerrada',
  });
  const citaCerrada = r.datos.cita.id;
  await pedir('PATCH', `/api/citas/${citaCerrada}/estado`, { estado: 'entregada' });
  await pedir('PUT', `/api/vehiculos/${datos.vehiculo2}`, {
    matricula: '5678DEF', marca: 'Renault', modelo: 'Clio', cliente_id: datos.cliente2,
  });
  r = await pedir('GET', `/api/citas/${citaCerrada}`);
  comprobar('una cita ya entregada conserva su cliente', !!(r.datos && r.datos.cita) && r.datos.cita.cliente_id === datos.cliente1,
    `cliente_id = ${r.datos && r.datos.cita && r.datos.cita.cliente_id}`);

  r = await pedir('PATCH', `/api/citas/${cita}/estado`, { estado: 'inventado' });
  comprobar('rechaza un estado que no existe', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('PATCH', `/api/citas/${cita}/estado`, { estado: 'confirmada' });
  comprobar('confirma una cita', r.codigo === 200 && r.datos.estado === 'confirmada', `devolvió ${r.codigo}`);

  r = await pedir('GET', `/api/citas/${cita}`);
  comprobar('el cambio queda en el historial', !!(r.datos && Array.isArray(r.datos.historial)) && r.datos.historial.length > 0);

  r = await pedir('GET', '/api/citas/999999');
  comprobar('una cita que no existe da 404', r.codigo === 404, `devolvió ${r.codigo}`);

  return { cita };
}

async function permisos() {
  grupo('Permisos por rol');

  let r = await pedir('POST', '/api/usuarios', { usuario: 'mecanico1', nombre: 'Mecánico Uno', rol: 'mecanico', clave: 'ProvisionalMec26' });
  comprobar('el administrador crea un mecánico', r.codigo === 201, `devolvió ${r.codigo}`);
  const idMecanico = r.datos && r.datos.id;

  const cookieAdmin = cookie;

  await pedir('POST', '/api/login', { usuario: 'mecanico1', clave: 'ProvisionalMec26' });
  await pedir('PUT', `/api/usuarios/${idMecanico}`, { clave_actual: 'ProvisionalMec26', clave: 'MecanicoRitmo26' });

  r = await pedir('GET', '/api/citas');
  comprobar('el mecánico ve las citas', r.codigo === 200, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/clientes', { nombre: 'No deberia crearse' });
  comprobar('el mecánico no puede crear clientes', r.codigo === 403, `devolvió ${r.codigo}`);

  r = await pedir('GET', '/api/usuarios');
  comprobar('el mecánico no ve los usuarios', r.codigo === 403, `devolvió ${r.codigo}`);

  r = await pedir('PUT', '/api/ajustes', { nombre_taller: 'Taller Pirata' });
  comprobar('el mecánico no cambia los ajustes', r.codigo === 403, `devolvió ${r.codigo}`);

  const citasMec = await pedir('GET', '/api/citas');
  const alguna = Array.isArray(citasMec.datos) ? citasMec.datos.find((c) => c.estado === 'confirmada') : null;
  if (alguna) {
    r = await pedir('PATCH', `/api/citas/${alguna.id}/estado`, { estado: 'en_taller' });
    comprobar('el mecánico sí puede meter el coche en taller', r.codigo === 200, `devolvió ${r.codigo}`);

    r = await pedir('PATCH', `/api/citas/${alguna.id}/estado`, { estado: 'anulada' });
    comprobar('pero no puede anular una cita', r.codigo === 403, `devolvió ${r.codigo}`);
  } else {
    comprobar('había una cita confirmada para probar el mecánico', false, 'no se encontró ninguna');
  }

  cookie = cookieAdmin;
  r = await pedir('GET', '/api/usuarios');
  comprobar('el administrador recupera su sesión', r.codigo === 200, `devolvió ${r.codigo}`);

  r = await pedir('PUT', '/api/usuarios/1', { activo: false });
  comprobar('no deja desactivar al último administrador', r.codigo >= 400, `devolvió ${r.codigo}`);
}

async function ajustesYCopias() {
  grupo('Ajustes y copias de seguridad');

  const actuales = (await pedir('GET', '/api/ajustes')).datos;

  let r = await pedir('PUT', '/api/ajustes', { ...actuales, hora_apertura: '19:00', hora_cierre: '08:00' });
  comprobar('no deja cerrar antes de abrir', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('PUT', '/api/ajustes', { ...actuales, email_taller: 'esto-no-es-un-email' });
  comprobar('rechaza un email de taller mal escrito', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('PUT', '/api/ajustes', { ...actuales, carpeta_copias: 'copias' });
  comprobar('rechaza una carpeta de copias sin ruta completa', r.codigo === 400, `devolvió ${r.codigo}`);

  r = await pedir('PUT', '/api/ajustes', { ...actuales, carpeta_copias: CARPETA_COPIAS });
  comprobar('acepta una carpeta de copias con ruta completa', r.codigo === 200, `devolvió ${r.codigo}`);

  r = await pedir('POST', '/api/copias/probar');
  comprobar('hace la copia fuera del equipo', r.codigo === 200 && !!(r.datos && r.datos.externa), `devolvió ${r.codigo}`);
  const hayArchivo = fs.existsSync(CARPETA_COPIAS)
    && fs.readdirSync(CARPETA_COPIAS).some((f) => f.startsWith('taller-') && f.endsWith('.db'));
  comprobar('la copia existe de verdad en esa carpeta', hayArchivo);

  const copiado = hayArchivo ? fs.readdirSync(CARPETA_COPIAS)[0] : null;
  comprobar('la copia no está vacía', !!copiado && fs.statSync(path.join(CARPETA_COPIAS, copiado)).size > 1000);

  r = await pedir('PUT', '/api/ajustes', { ...actuales, carpeta_copias: path.join(CARPETA, 'no', 'se', 'puede' + String.fromCharCode(0)) });
  comprobar('rechaza una ruta con caracteres imposibles', r.codigo === 400, `devolvió ${r.codigo}`);
}

async function informes() {
  grupo('Informes');

  let r = await pedir('GET', '/api/informes?desde=2026-10-01&hasta=2026-10-31');
  comprobar('el informe del mes responde', r.codigo === 200 && r.datos && Array.isArray(r.datos.porEstado), `devolvió ${r.codigo}`);

  r = await pedir('GET', '/api/informes?desde=no-es-fecha&hasta=2026-10-31');
  comprobar('un informe con fechas ilegibles no rompe: usa un periodo por defecto',
    r.codigo === 200 && !!(r.datos && r.datos.porEstado), `devolvió ${r.codigo}`);
}

// ---------------------------------------------------------------------------
async function principal() {
  console.log('');
  console.log('  PRUEBAS DEL PROGRAMA DE CITAS');
  console.log(`  Base de datos de prueba: ${CARPETA}`);
  console.log('  (la base de datos real no se toca)');

  await arrancarServidor();
  await acceso();
  await seguridad();
  const datos = await clientesYVehiculos();
  await citas(datos);
  await permisos();
  await ajustesYCopias();
  await informes();

  const total = correctas + fallos.length;
  console.log('');
  console.log('  ' + '-'.repeat(54));
  if (fallos.length === 0) {
    console.log(`  TODO CORRECTO: ${correctas} de ${total} comprobaciones.`);
  } else {
    console.log(`  ${correctas} de ${total} correctas. HAN FALLADO ${fallos.length}:`);
    for (const f of fallos) console.log(`    - [${f.grupo}] ${f.titulo}${f.detalle ? `  (${f.detalle})` : ''}`);
  }
  console.log('  ' + '-'.repeat(54));
  console.log('');
  return fallos.length === 0 ? 0 : 1;
}

principal()
  .then((codigo) => {
    limpiar();
    process.exit(codigo);
  })
  .catch((e) => {
    console.error('\n  Las pruebas no se pudieron completar:', e.message);
    limpiar();
    process.exit(2);
  });
