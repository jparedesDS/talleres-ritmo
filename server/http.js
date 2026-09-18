'use strict';
const fs = require('node:fs');
const path = require('node:path');

class ErrorHttp extends Error {
  constructor(codigo, mensaje, extra = null) {
    super(mensaje);
    this.codigo = codigo;
    this.extra = extra;
  }
}

const noEncontrado = (m = 'No encontrado') => new ErrorHttp(404, m);
const peticionMala = (m = 'Datos incorrectos') => new ErrorHttp(400, m);
const prohibido = (m = 'No tiene permiso para hacer esto', extra = null) => new ErrorHttp(403, m, extra);
const conflicto = (m, extra) => new ErrorHttp(409, m, extra);

// --- Cabeceras de seguridad para todas las respuestas ---------------------
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function cabecerasSeguridad(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}

function enviarJSON(res, codigo, datos, cabeceras = {}) {
  const cuerpo = JSON.stringify(datos ?? null);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...cabeceras,
  });
  res.end(cuerpo);
}

function leerCuerpo(req, limite = 1024 * 512) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    let cancelado = false;
    req.on('data', (t) => {
      if (cancelado) return;
      total += t.length;
      if (total > limite) {
        cancelado = true;
        reject(new ErrorHttp(413, 'Petición demasiado grande'));
        req.resume();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => {
      if (cancelado) return;
      const texto = Buffer.concat(trozos).toString('utf8');
      if (!texto) return resolve({});
      try {
        const datos = JSON.parse(texto);
        if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return reject(peticionMala('Formato de datos no válido'));
        resolve(datos);
      } catch {
        reject(peticionMala('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

// --- Router -------------------------------------------------------------
function crearRouter() {
  const rutas = [];

  function agregar(metodo, patron, manejador, opciones = {}) {
    const nombres = [];
    const regex = new RegExp(
      '^' +
        patron
          .replace(/\/:([A-Za-z_]+)/g, (_, n) => {
            nombres.push(n);
            // los identificadores numéricos solo aceptan dígitos
            return n === 'id' ? '/(\\d{1,12})' : '/([^/]+)';
          })
          .replace(/\//g, '\\/') +
        '$'
    );
    rutas.push({ metodo, regex, nombres, manejador, opciones });
  }

  return {
    get: (p, h, o) => agregar('GET', p, h, o),
    post: (p, h, o) => agregar('POST', p, h, o),
    put: (p, h, o) => agregar('PUT', p, h, o),
    patch: (p, h, o) => agregar('PATCH', p, h, o),
    delete: (p, h, o) => agregar('DELETE', p, h, o),
    resolver(metodo, ruta) {
      for (const r of rutas) {
        if (r.metodo !== metodo) continue;
        const m = r.regex.exec(ruta);
        if (!m) continue;
        const params = {};
        r.nombres.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
        if ('id' in params) params.id = Number(params.id);
        return { ...r, params };
      }
      return null;
    },
    metodosDe(ruta) {
      return rutas.filter((r) => r.regex.test(ruta)).map((r) => r.metodo);
    },
  };
}

// --- Ficheros estaticos -------------------------------------------------
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** Sirve un fichero de `raizPublica`. Devuelve false si no existe. */
function servirEstatico(res, raizPublica, rutaUrl) {
  let rel;
  try {
    rel = decodeURIComponent(rutaUrl.split('?')[0]);
  } catch {
    throw peticionMala('Ruta mal formada');
  }
  if (rel.includes('\0')) throw peticionMala('Ruta mal formada');
  if (rel === '/' || rel === '') rel = '/index.html';

  const raiz = path.resolve(raizPublica);
  const destino = path.resolve(raiz, '.' + rel);
  // Debe quedar DENTRO de la carpeta pública (el separador evita "public2")
  if (!destino.startsWith(raiz + path.sep)) throw new ErrorHttp(403, 'Prohibido');
  if (path.basename(destino).startsWith('.')) return false;

  const tipo = TIPOS[path.extname(destino).toLowerCase()];
  if (!tipo) return false;

  let stat;
  try {
    stat = fs.statSync(destino);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': tipo,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(destino).pipe(res);
  return true;
}

module.exports = {
  ErrorHttp,
  noEncontrado,
  peticionMala,
  prohibido,
  conflicto,
  cabecerasSeguridad,
  enviarJSON,
  leerCuerpo,
  crearRouter,
  servirEstatico,
};
