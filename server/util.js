'use strict';

// --- Fechas y horas -----------------------------------------------------
/** Fecha local en formato YYYY-MM-DD (no usa UTC, evita el desfase de zona). */
function hoyISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const f = new Date(y, m - 1, d);
  f.setDate(f.getDate() + dias);
  return hoyISO(f);
}

/** Dia de la semana 1=lunes ... 7=domingo */
function diaSemana(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const js = new Date(y, m - 1, d).getDay();
  return js === 0 ? 7 : js;
}

function aMinutos(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function aHora(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** AAAA-MM-DD y además una fecha que existe (rechaza 2026-02-30). */
function esFechaISO(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 1900 || y > 2200) return false;
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** HH:MM entre 00:00 y 23:59. */
function esHora(v) {
  if (typeof v !== 'string' || !/^\d{2}:\d{2}$/.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h <= 23 && m <= 59;
}

// --- Texto --------------------------------------------------------------
function normalizarMatricula(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Quita caracteres de control (salvo tabulador y saltos de línea). */
function sinControl(texto) {
  return Array.from(texto)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127);
    })
    .join('');
}

/** Recorta, quita caracteres de control y limita la longitud. */
function limpiarTexto(v, max = 500) {
  if (v === undefined || v === null) return null;
  const s = sinControl(String(v)).trim();
  return s === '' ? null : s.slice(0, max);
}

function aEntero(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function aDecimal(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function esColor(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

function esEmail(v) {
  return typeof v === 'string' && v.length <= 120 && /^[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}$/i.test(v);
}

/** Solo los dígitos de un teléfono, sin prefijo español (+34 / 0034). */
function telefonoNormalizado(v) {
  let t = String(v || '').replace(/\D/g, '');
  if (t.startsWith('0034')) t = t.slice(4);
  // Los teléfonos españoles empiezan por 6, 7, 8 o 9: un "34" delante es el prefijo
  else if (t.startsWith('34') && t.length > 9) t = t.slice(2);
  return t;
}

/** Texto de búsqueda para LIKE con los comodines escapados (usar con ESCAPE '\'). */
function patronLike(q) {
  const limpio = String(q || '').trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${limpio}%`;
}

// --- Dominio ------------------------------------------------------------
const ESTADOS = {
  pendiente: { etiqueta: 'Pendiente', color: '#767676', orden: 1 },
  confirmada: { etiqueta: 'Confirmada', color: '#2f78b3', orden: 2 },
  en_taller: { etiqueta: 'En taller', color: '#0e7490', orden: 3 },
  en_reparacion: { etiqueta: 'En reparación', color: '#b45309', orden: 4 },
  terminada: { etiqueta: 'Terminada', color: '#17803f', orden: 5 },
  entregada: { etiqueta: 'Entregada', color: '#1e1e1e', orden: 6 },
  no_presentado: { etiqueta: 'No presentado', color: '#c0261b', orden: 7 },
  anulada: { etiqueta: 'Anulada', color: '#7f1d1d', orden: 8 },
};

/** Estados que no ocupan hueco en la agenda. */
const ESTADOS_LIBERAN = ['anulada', 'no_presentado'];

/** Estados a los que puede pasar una cita quien solo trabaja en el taller (mecánico). */
const ESTADOS_TALLER = ['en_taller', 'en_reparacion', 'terminada', 'entregada'];

/** Estados de una cita ya cerrada: su cliente se conserva como histórico. */
const ESTADOS_CERRADOS = ['entregada', 'no_presentado', 'anulada'];

module.exports = {
  hoyISO,
  sumarDias,
  diaSemana,
  aMinutos,
  aHora,
  esFechaISO,
  esHora,
  normalizarMatricula,
  limpiarTexto,
  aEntero,
  aDecimal,
  esColor,
  esEmail,
  telefonoNormalizado,
  patronLike,
  ESTADOS,
  ESTADOS_LIBERAN,
  ESTADOS_CERRADOS,
  ESTADOS_TALLER,
};
