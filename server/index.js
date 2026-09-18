'use strict';
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  ErrorHttp, prohibido, cabecerasSeguridad, enviarJSON, leerCuerpo, crearRouter, servirEstatico,
} = require('./http');
const auth = require('./auth');
const eventos = require('./eventos');
const { RUTA_BD, copiaCompleta, programarCopias, leerAjustes, citasReparadas, get } = require('./db');
const U = require('./util');

const PUERTO = Number(process.env.PUERTO || process.env.PORT || 4400);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLICO = path.join(__dirname, '..', 'public');

/**
 * Huella de la interfaz: cambia cuando se actualiza algún archivo de public/.
 * Las pantallas abiertas la comparan al reconectar y se recargan si es otra.
 */
function huellaInterfaz(dir = PUBLICO) {
  const fs = require('node:fs');
  const hash = require('node:crypto').createHash('sha1');
  const recorrer = (d) => {
    for (const nombre of fs.readdirSync(d).sort()) {
      const ruta = path.join(d, nombre);
      const st = fs.statSync(ruta);
      if (st.isDirectory()) recorrer(ruta);
      else hash.update(`${path.relative(dir, ruta)}:${st.size}:${st.mtimeMs}`);
    }
  };
  recorrer(dir);
  return hash.digest('hex').slice(0, 12);
}
const VERSION_INTERFAZ = huellaInterfaz();

// Nombres con los que se permite entrar además de IPs, localhost y el nombre
// del equipo. Ej.: set TALLER_HOSTS=citas.ritmo.local
const HOSTS_EXTRA = String(process.env.TALLER_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const router = crearRouter();

// --- Rutas publicas (sin sesion) ---------------------------------------
router.post('/api/login', ({ req, res, cuerpo }) => {
  const ip = req.socket.remoteAddress || 'desconocida';
  if (auth.bloqueado(ip)) throw new ErrorHttp(429, 'Demasiados intentos fallidos. Espere unos minutos.');
  const usuario = auth.login(cuerpo.usuario, cuerpo.clave);
  if (!usuario) {
    auth.registrarFallo(ip);
    console.warn(`[acceso] intento fallido para "${String(cuerpo.usuario || '').slice(0, 40)}" desde ${ip}`);
    throw new ErrorHttp(401, 'Usuario o contraseña incorrectos');
  }
  auth.limpiarIntentos(ip);
  const sesion = auth.crearSesion(usuario.id);
  res.setHeader('Set-Cookie', auth.cookieSesion(sesion.token, sesion.expira));
  return { usuario };
}, { publica: true, codigo: 200 });

router.post('/api/logout', ({ req, res }) => {
  const u = auth.usuarioDeReq(req);
  if (u) {
    auth.logout(u.sid);
    eventos.cerrarSesion(u.sid);
  }
  res.setHeader('Set-Cookie', auth.cookieBorrada());
  return { ok: true };
}, { publica: true, codigo: 200 });

router.get('/api/sesion', ({ req }) => {
  const usuario = auth.usuarioDeReq(req);
  if (usuario) delete usuario.sid;
  return {
    usuario,
    taller: leerAjustes().nombre_taller,
    estados: U.ESTADOS,
    estados_taller: U.ESTADOS_TALLER,
    version: VERSION_INTERFAZ,
    hoy: U.hoyISO(),
  };
}, { publica: true });

// --- Rutas con sesion ---------------------------------------------------
router.get('/api/eventos', ({ req, res, usuario }) => {
  eventos.suscribir(req, res, usuario);
});

require('./api-datos').registrar(router);
require('./api-citas').registrar(router);

// --- Comprobaciones de seguridad ---------------------------------------
function hostPermitido(cabecera) {
  if (!cabecera) return false;
  const host = String(cabecera).toLowerCase().replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
  if (net.isIP(host) || host === 'localhost') return true;
  const equipo = os.hostname().toLowerCase();
  if (host === equipo || host.startsWith(`${equipo}.`)) return true;
  return HOSTS_EXTRA.includes(host);
}

/** Las escrituras solo se aceptan desde la propia aplicación (evita CSRF). */
function comprobarOrigen(req) {
  if (req.headers['x-taller'] !== '1') throw prohibido('Petición no válida');
  const origen = req.headers.origin;
  if (origen) {
    let hostOrigen = '';
    try {
      hostOrigen = new URL(origen).host;
    } catch {
      /* origen ilegible */
    }
    if (hostOrigen !== req.headers.host) throw prohibido('Origen no permitido');
  }
}

// --- Servidor -----------------------------------------------------------
const servidor = http.createServer(async (req, res) => {
  cabecerasSeguridad(res);

  if (!hostPermitido(req.headers.host)) {
    res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nombre de equipo no autorizado. Entre por la IP o añada el nombre en TALLER_HOSTS.');
    return;
  }

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400).end();
    return;
  }
  const ruta = url.pathname;
  const esEscritura = !['GET', 'HEAD'].includes(req.method);

  try {
    if (ruta.startsWith('/api/')) {
      const encontrada = router.resolver(req.method, ruta);
      if (!encontrada) {
        const otros = router.metodosDe(ruta);
        throw new ErrorHttp(otros.length ? 405 : 404, otros.length ? 'Método no permitido' : 'Ruta no encontrada');
      }
      const { opciones } = encontrada;

      if (esEscritura) comprobarOrigen(req);

      let usuario = null;
      if (!opciones.publica) {
        usuario = auth.usuarioDeReq(req);
        if (!usuario) throw new ErrorHttp(401, 'Sesión caducada. Vuelva a entrar.');
        if (usuario.debe_cambiar_clave && !opciones.conClaveProvisional) {
          throw prohibido('Tiene que cambiar su contraseña antes de continuar.', { cambiar_clave: true });
        }
        const permiso = opciones.permiso || (esEscritura ? 'gestionar' : 'ver');
        if (permiso !== 'propio' && !auth.tienePermiso(usuario, permiso)) {
          throw prohibido('Su usuario no tiene permiso para hacer esto.');
        }
      }

      const cuerpo = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await leerCuerpo(req) : {};
      const query = Object.fromEntries(url.searchParams.entries());
      const datos = await encontrada.manejador({ req, res, params: encontrada.params, query, cuerpo, usuario });

      if (res.headersSent) return; // respuestas que se gestionan solas (eventos en directo)
      enviarJSON(res, opciones.codigo || (req.method === 'POST' ? 201 : 200), datos);

      // Todo cambio se anuncia a las pantallas abiertas
      if (esEscritura && usuario) {
        eventos.emitir({ recurso: ruta.split('/')[2], metodo: req.method, usuario: usuario.usuario, en: Date.now() });
      }
      return;
    }

    if (esEscritura) throw new ErrorHttp(405, 'Método no permitido');
    if (servirEstatico(res, PUBLICO, ruta)) return;
    // Rutas del navegador (hash routing): devolvemos el index
    if (!path.extname(ruta) && servirEstatico(res, PUBLICO, '/index.html')) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  } catch (err) {
    const codigo = err instanceof ErrorHttp ? err.codigo : 500;
    if (codigo >= 500) console.error('[error]', req.method, ruta, err);
    if (!res.headersSent) {
      const cuerpo = codigo >= 500
        ? { error: 'Error interno del servidor. Inténtelo de nuevo; si se repite, avise al responsable.' }
        : { error: err.message, ...(err.extra || {}) };
      enviarJSON(res, codigo, cuerpo);
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

// Evita conexiones que se quedan a medias enviando la petición
servidor.headersTimeout = 20000;
servidor.requestTimeout = 30000;

function ipsLocales() {
  const out = [];
  for (const [, lista] of Object.entries(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

servidor.listen(PUERTO, HOST, () => {
  const linea = '─'.repeat(58);
  console.log(linea);
  console.log('  GESTIÓN DE CITAS DEL TALLER');
  console.log(linea);
  console.log(`  En este equipo:   http://localhost:${PUERTO}`);
  for (const ip of ipsLocales()) console.log(`  Desde la red:     http://${ip}:${PUERTO}`);
  console.log(`  Base de datos:    ${RUTA_BD}`);
  const copia = copiaCompleta();
  if (copia.local) console.log(`  Copia del día:    ${copia.local}`);
  const carpetaFuera = String(leerAjustes().carpeta_copias || '').trim();
  if (carpetaFuera) {
    console.log(copia.externa
      ? `  Copia fuera:      ${copia.externa}`
      : `  ATENCIÓN:         no se pudo copiar a "${carpetaFuera}" (¿disco o red desconectados?)`);
  }
  programarCopias();
  if (citasReparadas) console.log(`  Reparadas:        ${citasReparadas} cita(s) con el cliente desactualizado`);
  const provisionales = get('SELECT COUNT(*) AS n FROM usuarios WHERE activo = 1 AND debe_cambiar_clave = 1').n;
  if (provisionales) console.log(`  Aviso:            ${provisionales} usuario(s) deberán cambiar la contraseña al entrar`);
  console.log(linea);
  console.log('  Para cerrar el programa: cierre esta ventana o pulse Ctrl+C.');
  console.log('');

  // El navegador se abre aquí, ya con el servidor escuchando.
  if (process.env.TALLER_ABRIR === '1') {
    const url = `http://localhost:${PUERTO}`;
    const orden = process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
    require('node:child_process').exec(orden, (err) => {
      if (err) console.log(`  (Abra el navegador manualmente en ${url})`);
    });
  }
});

servidor.on('error', (err) => {
  console.error('');
  if (err.code === 'EADDRINUSE') {
    console.error(`  No se puede arrancar: el puerto ${PUERTO} ya está ocupado.`);
    console.error('  Seguramente el programa ya está abierto en este equipo.');
    console.error(`  Abra el navegador en http://localhost:${PUERTO} o cierre la otra ventana.`);
    console.error('');
    process.exit(3); // el .bat no reintenta con este código
  }
  if (err.code === 'EACCES') {
    console.error(`  Windows no permite abrir el puerto ${PUERTO}.`);
    console.error('  Pruebe con otro puerto añadiendo "set PUERTO=5000" en INICIAR-TALLER.bat.');
    console.error('');
    process.exit(3);
  }
  console.error('  Error al arrancar el servidor:', err.message);
  process.exit(1);
});

// Un fallo inesperado deja el proceso en estado dudoso: se registra y se sale
// para que INICIAR-TALLER.bat lo vuelva a arrancar limpio.
function fallo(tipo, err) {
  console.error(`\n  [${new Date().toLocaleString('es-ES')}] ${tipo}:`, err && err.stack ? err.stack : err);
  console.error('  El programa se reiniciará automáticamente.\n');
  process.exit(1);
}
process.on('uncaughtException', (err) => fallo('Error inesperado', err));
process.on('unhandledRejection', (err) => fallo('Error inesperado (promesa)', err));

function cerrar() {
  console.log('\nCerrando...');
  servidor.close(() => process.exit(0));
  servidor.closeAllConnections();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
