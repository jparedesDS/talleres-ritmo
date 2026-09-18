// Panel de inicio: lo que hay que mirar al abrir el programa por la mañana.
import { api } from './api.js';
import { estado, puede, alRefrescar } from './estado.js';
import { fichaCita, formularioCita } from './citas.js';
import {
  el, vaciar, aviso, fmtFecha, fmtFechaCorta, diasHasta, chapaEstado, matricula, duracionTexto,
} from './util.js';

/**
 * Aviso cuando la copia de seguridad fuera de este equipo no se está haciendo.
 * Una copia que falla en silencio es peor que no tenerla, así que se ve en la
 * primera pantalla que se mira por la mañana.
 */
function avisoCopias() {
  if (!puede('configurar')) return null;
  const aj = estado.ajustes || {};
  const carpeta = String(aj.carpeta_copias || '').trim();
  if (!carpeta) return null;

  const error = String(aj.copia_externa_error || '');
  const ultima = aj.copia_externa_ultima ? new Date(aj.copia_externa_ultima) : null;
  const dias = ultima ? Math.floor((Date.now() - ultima.getTime()) / 86400000) : null;
  if (!error && dias !== null && dias <= 3) return null;

  const texto = error
    ? `La copia de seguridad en "${carpeta}" está fallando. Compruebe que el disco o la carpeta de red están conectados.`
    : `Hace ${dias === null ? 'mucho' : dias} día(s) que no se guarda copia en "${carpeta}".`;
  return el('div', { clase: 'aviso-linea', estilo: { marginBottom: '14px' } }, texto,
    ' ', el('a', { href: '#/ajustes', texto: 'Ver copias' }));
}

export async function vistaPanel(contenedor) {
  // "Cargando…" solo si la pantalla está vacía: al refrescar se sustituye sin parpadeo
  if (!contenedor.firstChild) contenedor.append(el('p', { clase: 'sutil', texto: 'Cargando…' }));
  const d = await api.panel();
  const recargar = () => vistaPanel(contenedor);

  const enTaller = d.citasHoy.filter((c) => ['en_taller', 'en_reparacion'].includes(c.estado)).length;
  const kpis = el(
    'div',
    { clase: 'rejilla rejilla-4', estilo: { marginBottom: '16px' } },
    kpi('Citas hoy', d.citasHoy.length),
    kpi('En el taller ahora', enTaller, enTaller ? 'var(--acento-texto)' : null),
    kpi('Sin confirmar', d.sinConfirmar.length, d.sinConfirmar.length ? 'var(--ambar)' : null),
    kpi('No presentados (30 d)', d.totales.no_presentados_mes, d.totales.no_presentados_mes ? 'var(--rojo)' : null)
  );

  const hoy = el(
    'div',
    { clase: 'tarjeta' },
    el('div', { clase: 'fila-entre' },
      el('h3', { texto: `Hoy · ${fmtFecha(d.hoy)}` }),
      puede('gestionar')
        ? el('button', { clase: 'btn btn-mini', texto: '+ Cita', onclick: () => formularioCita({ inicial: { fecha: d.hoy }, alGuardar: recargar }) })
        : null),
    d.citasHoy.length
      ? tablaCitas(d.citasHoy, recargar, false, true)
      : el('p', { clase: 'sutil', texto: 'No hay ninguna cita para hoy.' })
  );

  const porConfirmar = el(
    'div',
    { clase: 'tarjeta' },
    el('h3', { texto: 'Pendientes de confirmar' }),
    d.sinConfirmar.length
      ? el('div', {}, ...d.sinConfirmar.slice(0, 10).map((c) => lineaPorConfirmar(c, recargar)))
      : el('p', { clase: 'sutil', texto: 'Todas las citas futuras están confirmadas.' })
  );

  const vencimientos = [
    ...d.itv.map((v) => ({ ...v, tipo: 'ITV', cuando: v.proxima_itv })),
    ...d.revisiones.map((v) => ({ ...v, tipo: 'Revisión', cuando: v.proxima_revision })),
  ].sort((a, b) => a.cuando.localeCompare(b.cuando));

  const avisosItv = el(
    'div',
    { clase: 'tarjeta' },
    el('h3', { texto: `ITV y revisiones (próximos ${d.ajustes.aviso_itv_dias} días)` }),
    vencimientos.length
      ? el('div', {}, ...vencimientos.slice(0, 12).map((v) => lineaVencimiento(v, recargar)))
      : el('p', { clase: 'sutil', texto: 'Ningún vehículo con ITV o revisión próxima.' })
  );

  const proximas = el(
    'div',
    { clase: 'tarjeta' },
    el('h3', { texto: 'Próximos 7 días' }),
    d.proximas.length
      ? tablaCitas(d.proximas.slice(0, 20), recargar, true)
      : el('p', { clase: 'sutil', texto: 'Sin citas en los próximos 7 días.' })
  );

  vaciar(contenedor).append(
    avisoCopias(),
    kpis,
    el('div', { clase: 'panel-rejilla' }, hoy, el('div', { clase: 'rejilla' }, porConfirmar, avisosItv)),
    el('div', { estilo: { marginTop: '14px' } }, proximas)
  );
  alRefrescar(recargar);
}

function lineaPorConfirmar(c, recargar) {
  return el(
    'div',
    { clase: 'linea-lista' },
    el('div', { clase: 'datos' },
      el('div', { clase: 'fila-principal' },
        matricula(c.matricula),
        el('span', { clase: 'sutil', texto: `${c.fecha.slice(8, 10)}/${c.fecha.slice(5, 7)} · ${c.hora_inicio}` })),
      el('div', { clase: 'sutil det-corto', texto: c.titulo || c.servicio_nombre || '' })),
    el(
      'div',
      { clase: 'acciones' },
      puede('gestionar')
        ? el('button', {
            clase: 'btn btn-mini btn-primario',
            texto: 'Confirmar',
            onclick: async (ev) => {
              const boton = ev.currentTarget;
              boton.disabled = true;
              try {
                await api.estadoCita(c.id, { estado: 'confirmada' });
                aviso('Cita confirmada', 'ok');
                recargar();
              } catch (e) {
                boton.disabled = false;
                aviso(e.message, 'mal');
              }
            },
          })
        : null,
      el('button', { clase: 'btn btn-mini', texto: 'Ver', onclick: () => fichaCita(c.id, { alCambiar: recargar }) })
    )
  );
}

function lineaVencimiento(v, recargar) {
  const dias = diasHasta(v.cuando);
  const color = dias < 0 ? 'var(--rojo)' : dias < 15 ? 'var(--ambar)' : 'var(--texto-sutil)';
  return el(
    'div',
    { clase: 'linea-lista' },
    el('div', { clase: 'datos' },
      el('div', { clase: 'fila-principal' },
        matricula(v.matricula),
        el('span', {
          clase: 'chapa',
          estilo: { background: color },
          texto: dias < 0 ? `vencida hace ${-dias} d` : dias === 0 ? 'hoy' : `en ${dias} d`,
        })),
      el('div', { clase: 'sutil det-corto', texto: `${v.tipo} ${fmtFecha(v.cuando)} · ${v.cliente_nombre || 'sin cliente'}` })),
    el('div', { clase: 'acciones' },
      puede('gestionar') && el('button', {
        clase: 'btn btn-mini',
        texto: 'Dar cita',
        onclick: () =>
          formularioCita({
            inicial: {
              vehiculo: v,
              servicio_id: (estado.servicios.find((s) => /pre-?itv/i.test(s.nombre)) || {}).id,
            },
            alGuardar: recargar,
          }),
      }))
  );
}

function kpi(titulo, valor, color) {
  return el('div', { clase: 'kpi' },
    el('div', { clase: 'titulo', texto: titulo }),
    el('div', { clase: 'valor', estilo: color ? { color } : {}, texto: String(valor) }));
}

export function tablaCitas(citas, recargar, conFecha = false, compacta = false) {
  const filas = citas.map((c) =>
    el(
      'tr',
      { clase: 'clicable', onclick: () => fichaCita(c.id, { alCambiar: recargar }) },
      conFecha ? el('td', { texto: fmtFechaCorta(c.fecha) }) : null,
      el('td', {}, el('b', { texto: c.hora_inicio }), el('div', { clase: 'sutil', texto: duracionTexto(c.duracion_min) })),
      el('td', {}, matricula(c.matricula), c.espera ? ' ⏳' : ''),
      compacta
        ? el('td', { clase: 'cliente', texto: c.cliente_nombre || '—' })
        : el('td', {}, c.cliente_nombre || '—', el('div', { clase: 'sutil', texto: c.cliente_telefono || '' })),
      el('td', { clase: 'servicio', texto: c.titulo || c.servicio_nombre || '' }),
      compacta ? null : el('td', { texto: c.bahia_nombre || '—' }),
      el('td', {}, chapaEstado(c.estado, estado.estados))
    )
  );

  const cabecera = el(
    'tr',
    {},
    conFecha ? el('th', { texto: 'Fecha' }) : null,
    el('th', { texto: 'Hora' }),
    el('th', { texto: 'Matrícula' }),
    el('th', { texto: 'Cliente' }),
    el('th', { texto: 'Servicio' }),
    compacta ? null : el('th', { texto: 'Bahía' }),
    el('th', { texto: 'Estado' })
  );

  return el(
    'div',
    { clase: 'tabla-envoltorio' },
    el('table', { clase: compacta ? 'tabla-compacta' : '' }, el('thead', {}, cabecera), el('tbody', {}, ...filas))
  );
}
