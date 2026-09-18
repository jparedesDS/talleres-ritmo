'use strict';
// Avisos en directo (Server-Sent Events): cuando alguien cambia algo, todas las
// pantallas abiertas —en este equipo y en el resto del taller— se actualizan.
const auth = require('./auth');

const conexiones = new Set();
const MAX_CONEXIONES = 300;

function suscribir(req, res, usuario) {
  if (conexiones.size >= MAX_CONEXIONES) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Demasiadas conexiones abiertas');
    return;
  }
  req.socket.setTimeout(0);
  req.socket.setKeepAlive(true);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const c = { res, sid: usuario.sid, usuarioId: usuario.id };
  conexiones.add(c);
  const quitar = () => conexiones.delete(c);
  req.on('close', quitar);
  res.on('error', quitar);
}

function emitir(datos) {
  const texto = `event: cambio\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const c of conexiones) {
    try {
      c.res.write(texto);
    } catch {
      conexiones.delete(c);
    }
  }
}

/** Corta las conexiones de un usuario (desactivado, borrado o con la clave cambiada). */
function cerrarDeUsuario(usuarioId, { salvoSid = null } = {}) {
  for (const c of conexiones) {
    if (c.usuarioId === usuarioId && c.sid !== salvoSid) {
      c.res.end();
      conexiones.delete(c);
    }
  }
}

function cerrarSesion(sid) {
  for (const c of conexiones) {
    if (c.sid === sid) {
      c.res.end();
      conexiones.delete(c);
    }
  }
}

// Latido cada 25 s: mantiene viva la conexión y expulsa sesiones caducadas.
setInterval(() => {
  for (const c of conexiones) {
    if (!auth.sesionValida(c.sid)) {
      c.res.end();
      conexiones.delete(c);
      continue;
    }
    try {
      c.res.write(': latido\n\n');
    } catch {
      conexiones.delete(c);
    }
  }
}, 25000).unref();

module.exports = { suscribir, emitir, cerrarDeUsuario, cerrarSesion, total: () => conexiones.size };
