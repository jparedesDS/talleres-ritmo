// Apariencia de la aplicación. Cada usuario elige la suya y se recuerda en
// ESTE equipo (no viaja al servidor): en el mismo taller uno puede trabajar
// con los colores de la marca y otro en gris.
//
//   color   Colores de Ritmo Talleres (el de siempre).
//   sobrio  Monocromático: todo en escala de grises.
//
// En el modo sobrio no se puede distinguir por el tono, así que los estados
// se reparten por CLARIDAD siguiendo el avance del trabajo (pendiente = casi
// blanco, entregada = casi negro) y los dos estados en los que el coche no
// llegó a pasar por el taller se marcan además con un rayado.

const CLAVE = 'taller-apariencia';

export const TEMAS = {
  color: { nombre: 'Color', descripcion: 'Colores del taller' },
  sobrio: { nombre: 'Sobrio', descripcion: 'Escala de grises' },
};

const POR_DEFECTO = 'color';
let actual = POR_DEFECTO;
const oyentes = new Set();

/** Escala de grises de los estados, de menos a más avanzado el trabajo. */
const GRISES_ESTADO = {
  pendiente: { fondo: '#f2f2ef', borde: '#c9c9c4' },
  confirmada: { fondo: '#d2d2ce' },
  en_taller: { fondo: '#adada8' },
  en_reparacion: { fondo: '#888884' },
  terminada: { fondo: '#626260' },
  entregada: { fondo: '#2f2f2d' },
  no_presentado: { fondo: '#4a4a48', rayado: true },
  anulada: { fondo: '#a8a8a4', rayado: true },
};
const GRIS_GENERICO = { fondo: '#767676' };

export const temaActual = () => actual;
export const esSobrio = () => actual === 'sobrio';

/** Avisa a las vistas de que el color cambió y hay que volver a pintar. */
export function alCambiarTema(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export function aplicarTema(tema, { recordar = true } = {}) {
  actual = TEMAS[tema] ? tema : POR_DEFECTO;
  document.documentElement.dataset.tema = actual;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', actual === 'sobrio' ? '#232323' : '#1e1e1e');
  if (recordar) {
    try {
      localStorage.setItem(CLAVE, actual);
    } catch {
      /* navegador sin almacenamiento: el tema durará lo que dure la sesión */
    }
  }
  for (const fn of oyentes) fn(actual);
  return actual;
}

export function iniciarTema() {
  let guardado = null;
  try {
    guardado = localStorage.getItem(CLAVE);
  } catch {
    /* sin almacenamiento */
  }
  return aplicarTema(guardado || POR_DEFECTO, { recordar: false });
}

export const alternarTema = () => aplicarTema(actual === 'sobrio' ? 'color' : 'sobrio');

// ---------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------

/** Luminancia percibida (0 negro, 1 blanco) de un color hexadecimal. */
function luminancia(hex) {
  const c = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c)) return 0.5;
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * Gris equivalente a un color cualquiera. Se comprime al tramo medio para que
 * ningún color elegido a mano acabe siendo blanco sobre blanco.
 */
function aGris(hex) {
  const l = Math.max(0, Math.min(1, luminancia(hex)));
  const v = Math.round(255 * (0.24 + l ** (1 / 2.2) * 0.58));
  const h = v.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

/**
 * Color de un estado de cita. Devuelve siempre {fondo, borde?, rayado?}:
 * quien pinta no tiene que saber en qué tema estamos.
 */
export function colorEstado(nombre, estados = {}) {
  const info = estados[nombre] || {};
  if (!esSobrio()) return { fondo: info.color || '#4e4e4e' };
  return GRISES_ESTADO[nombre] || (info.color ? { fondo: aGris(info.color) } : GRIS_GENERICO);
}

/**
 * Color libre elegido por el usuario (servicios, bahías, mecánicos). En sobrio
 * se apaga a gris; en color se respeta tal cual.
 */
export const colorLibre = (hex, defecto = '#4e4e4e') => {
  const c = hex || defecto;
  return esSobrio() ? aGris(c) : c;
};
