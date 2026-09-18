// Utilidades comunes: DOM, fechas, avisos y ventanas modales.
import { colorEstado } from './tema.js';

/**
 * Crea un elemento. Todo el contenido se inserta como TEXTO, nunca como HTML:
 * así un dato con código (p. ej. un nombre "<img onerror=...>") no se ejecuta.
 */
export function el(etiqueta, props = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'html' || k === 'style' || k === 'innerHTML') {
      throw new Error(`el(): la propiedad "${k}" no está permitida; use "texto" o "estilo"`);
    }
    if (k === 'clase') nodo.className = v;
    else if (k === 'texto') nodo.textContent = v;
    else if (k === 'estilo') Object.assign(nodo.style, v);
    else if (k === 'datos') for (const [dk, dv] of Object.entries(v)) nodo.dataset[dk] = dv;
    else if (k.startsWith('on') && typeof v === 'function') nodo.addEventListener(k.slice(2), v);
    else nodo.setAttribute(k, v === true ? '' : v);
  }
  for (const h of hijos.flat(9)) {
    if (h === null || h === undefined || h === false) continue;
    nodo.append(h.nodeType ? h : document.createTextNode(String(h)));
  }
  return nodo;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function vaciar(nodo) {
  while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  return nodo;
}

// ---------- Fechas ----------
export const hoyISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const f = new Date(y, m - 1, d);
  f.setDate(f.getDate() + dias);
  return hoyISO(f);
}

export function aDate(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const fmtFecha = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export function fmtFechaLarga(iso) {
  return aDate(iso).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function fmtFechaCorta(iso) {
  return aDate(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function diasHasta(iso) {
  return Math.round((aDate(iso) - aDate(hoyISO())) / 86400000);
}

/** 1 = lunes … 7 = domingo */
export function diaSemana(iso) {
  const n = aDate(iso).getDay();
  return n === 0 ? 7 : n;
}

/** Lunes de la semana de la fecha dada. */
export const lunesDe = (iso) => sumarDias(iso, -(diaSemana(iso) - 1));

export const aMinutos = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const aHora = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;

export function duracionTexto(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

export const eur = (n) =>
  n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

// ---------- Avisos ----------
export function aviso(mensaje, tipo = '') {
  const caja = document.getElementById('avisos');
  const nodo = el('div', { clase: `aviso ${tipo}`, texto: mensaje });
  caja.append(nodo);
  setTimeout(() => {
    nodo.style.opacity = '0';
    nodo.style.transition = 'opacity .25s';
    setTimeout(() => nodo.remove(), 250);
  }, tipo === 'mal' ? 6000 : 3200);
}

// ---------- Modal ----------
const pila = [];

export const hayModalAbierto = () => pila.length > 0;

export function modal({ titulo, cuerpo, acciones = [], ancho = false, alCerrar, obligatorio = false }) {
  const capa = document.getElementById('capa-modal');
  const cerrar = () => {
    const i = pila.indexOf(ficha);
    if (i >= 0) pila.splice(i, 1);
    ficha.nodo.remove();
    if (!pila.length) capa.classList.add('oculto');
    else pila[pila.length - 1].nodo.classList.remove('oculto');
    if (alCerrar) alCerrar();
  };

  const pie = el('footer', {});
  for (const a of acciones) {
    if (!a) continue;
    if (a.separador) {
      pie.append(el('span', { clase: 'izquierda' }));
      continue;
    }
    pie.append(
      el('button', {
        clase: `btn ${a.clase || ''}`,
        onclick: () => a.accion && a.accion(cerrar),
        texto: a.texto,
      })
    );
  }

  const nodo = el(
    'div',
    { clase: `modal ${ancho ? 'ancho' : ''}` },
    el(
      'header',
      {},
      el('h3', { texto: titulo }),
      obligatorio ? null : el('button', { clase: 'btn btn-plano', texto: '✕', title: 'Cerrar', onclick: () => cerrar() })
    ),
    el('div', { clase: 'cuerpo' }, cuerpo),
    acciones.length ? pie : null
  );

  const ficha = { nodo, cerrar, obligatorio };
  if (pila.length) pila[pila.length - 1].nodo.classList.add('oculto');
  pila.push(ficha);
  capa.classList.remove('oculto');
  capa.append(nodo);
  const primero = nodo.querySelector('input, select, textarea, button.btn-primario');
  if (primero) setTimeout(() => primero.focus(), 40);
  return ficha;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pila.length && !pila[pila.length - 1].obligatorio) pila[pila.length - 1].cerrar();
});

/** Cierra todas las ventanas abiertas (al caducar la sesión, por ejemplo). */
export function cerrarModales() {
  while (pila.length) {
    const ficha = pila.pop();
    ficha.nodo.remove();
  }
  document.getElementById('capa-modal').classList.add('oculto');
}

export function confirmar(mensaje, { titulo = 'Confirmar', textoOk = 'Sí, continuar', textoCancelar = 'Cancelar', peligro = true } = {}) {
  return new Promise((resolve) => {
    let respondido = false;
    const ficha = modal({
      titulo,
      cuerpo: el('p', { texto: mensaje }),
      alCerrar: () => !respondido && resolve(false),
      acciones: [
        { texto: textoCancelar, accion: (cerrar) => cerrar() },
        {
          texto: textoOk,
          clase: peligro ? 'btn-peligro' : 'btn-primario',
          accion: (cerrar) => {
            respondido = true;
            resolve(true);
            cerrar();
          },
        },
      ],
    });
    return ficha;
  });
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function chapaEstado(estado, estados) {
  const info = estados[estado] || { etiqueta: estado };
  const c = colorEstado(estado, estados);
  const estilo = { background: c.fondo, color: textoSobre(c.fondo) };
  if (c.borde) estilo.boxShadow = `inset 0 0 0 1px ${c.borde}`;
  return el('span', {
    clase: `chapa ${c.rayado ? 'chapa-rayada' : ''}`,
    estilo,
    texto: info.etiqueta || estado,
  });
}

export function matricula(texto) {
  return texto ? el('span', { clase: 'matricula', texto }) : el('span', { clase: 'sutil', texto: '—' });
}

/** Color de texto legible (casi negro o blanco) sobre un fondo hexadecimal. */
export function textoSobre(hex) {
  const c = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c)) return '#fff';
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? '#121212' : '#fff';
}

/** Aclara u oscurece un color hexadecimal (-1 a 1). */
export function tinte(hex, factor) {
  const c = (hex || '#4e4e4e').replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  const canal = (v) => Math.max(0, Math.min(255, Math.round(v + (factor > 0 ? (255 - v) * factor : v * factor))));
  const r = canal((n >> 16) & 255);
  const g = canal((n >> 8) & 255);
  const b = canal(n & 255);
  return `rgb(${r},${g},${b})`;
}
