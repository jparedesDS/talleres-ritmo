// Vista de agenda: planning diario por bahías (con arrastrar y soltar) y vista semanal.
import { api, ErrorApi } from './api.js';
import { estado, puede, alRefrescar } from './estado.js';
import { formularioCita, fichaCita } from './citas.js';
import {
  el, vaciar, aviso, confirmar, hoyISO, sumarDias, fmtFechaLarga, fmtFechaCorta, lunesDe,
  aMinutos, aHora, duracionTexto, textoSobre,
} from './util.js';
import { colorEstado, colorLibre } from './tema.js';

const PX_MIN = 1.15;
let modo = 'dia';
let fecha = hoyISO();

export async function vistaAgenda(contenedor, params = {}) {
  if (params.fecha) fecha = params.fecha;
  if (params.modo) modo = params.modo;
  vaciar(contenedor);
  contenedor.append(barra(contenedor));
  const zona = el('div', { id: 'zona-agenda' });
  contenedor.append(zona);
  await pintar(zona);
  // Al llegar un cambio se repinta solo la agenda: la fecha y el modo se conservan
  alRefrescar(refrescar);
}

function refrescar() {
  const zona = document.getElementById('zona-agenda');
  return zona ? pintar(zona) : Promise.resolve();
}

function barra(contenedor) {
  const titulo = el('div', { clase: 'fecha-titulo' });
  const selFecha = el('input', { type: 'date', value: fecha, estilo: { width: 'auto' } });
  selFecha.addEventListener('change', () => {
    fecha = selFecha.value || hoyISO();
    actualizarTitulo();
    refrescar();
  });

  function actualizarTitulo() {
    titulo.textContent =
      modo === 'dia'
        ? fmtFechaLarga(fecha)
        : `Semana del ${fmtFechaCorta(lunesDe(fecha))} al ${fmtFechaCorta(sumarDias(lunesDe(fecha), 6))}`;
    selFecha.value = fecha;
  }

  const mover = (dias) => {
    fecha = sumarDias(fecha, dias);
    actualizarTitulo();
    refrescar();
  };

  const botonModo = (valor, texto) =>
    el('button', {
      clase: `btn btn-mini ${modo === valor ? 'btn-primario' : ''}`,
      texto,
      onclick: () => {
        modo = valor;
        vistaAgenda(contenedor);
      },
    });

  actualizarTitulo();
  return el(
    'div',
    { clase: 'agenda-barra' },
    el('button', { clase: 'btn', texto: '◀', onclick: () => mover(modo === 'dia' ? -1 : -7) }),
    el('button', { clase: 'btn', texto: 'Hoy', onclick: () => { fecha = hoyISO(); actualizarTitulo(); refrescar(); } }),
    el('button', { clase: 'btn', texto: '▶', onclick: () => mover(modo === 'dia' ? 1 : 7) }),
    titulo,
    selFecha,
    el('div', { clase: 'fila', estilo: { marginLeft: 'auto' } }, botonModo('dia', 'Día'), botonModo('semana', 'Semana'),
      el('button', { clase: 'btn btn-mini', texto: '🖨️', title: 'Imprimir la hoja del día', onclick: () => window.print() }))
  );
}

async function pintar(zona) {
  // "Cargando…" solo la primera vez: al refrescar se sustituye sin parpadeo
  if (!zona.firstChild) zona.append(el('p', { clase: 'sutil', texto: 'Cargando…' }));
  try {
    if (modo === 'dia') await pintarDia(zona);
    else await pintarSemana(zona);
  } catch (e) {
    vaciar(zona).append(el('p', { clase: 'error', texto: e.message }));
  }
}

// ---------------------------------------------------------------------------
// Planning del día
// ---------------------------------------------------------------------------
async function pintarDia(zona) {
  const datos = await api.agenda(fecha);
  const aj = datos.ajustes;
  const apertura = aMinutos(aj.hora_apertura);
  const cierre = Math.max(apertura + 60, aMinutos(aj.hora_cierre));
  const slot = Math.max(5, Number(aj.slot_min) || 30);
  const alto = (cierre - apertura) * PX_MIN;

  const columnas = [
    ...datos.bahias.map((b) => ({ id: b.id, nombre: b.nombre, color: b.color })),
    { id: null, nombre: 'Sin asignar', color: '#b6b6b6' },
  ];

  const colHoras = el('div', { clase: 'col-horas' },
    el('div', { clase: 'col-cabecera' }, ''));
  const pistaHoras = el('div', { clase: 'pista', estilo: { height: `${alto}px`, position: 'relative' } });
  for (let m = apertura; m <= cierre; m += 60) {
    pistaHoras.append(
      el('div', {
        clase: `marca-hora ${m === apertura ? 'primera' : ''}`,
        estilo: { top: `${(m - apertura) * PX_MIN}px` },
        texto: aHora(m),
      })
    );
  }
  colHoras.append(pistaHoras);

  const cols = el('div', { clase: 'agenda-cols' });

  for (const col of columnas) {
    const ocup = datos.ocupacion.find((o) => o.bahia_id === col.id);
    const pista = el('div', { clase: 'pista', estilo: { height: `${alto}px` } });

    // líneas de hora y franja de pausa
    for (let m = apertura; m <= cierre; m += slot) {
      pista.append(
        el('div', {
          clase: `linea-hora ${m % 60 === 0 ? 'fuerte' : ''}`,
          estilo: { top: `${(m - apertura) * PX_MIN}px` },
        })
      );
    }
    if (aj.usar_pausa === '1') {
      const pi = Math.max(apertura, aMinutos(aj.pausa_inicio));
      const pf = Math.min(cierre, aMinutos(aj.pausa_fin));
      if (pf > pi) {
        pista.append(
          el('div', {
            clase: 'franja-pausa',
            estilo: { top: `${(pi - apertura) * PX_MIN}px`, height: `${(pf - pi) * PX_MIN}px` },
          })
        );
      }
    }
    if (fecha === hoyISO()) {
      const ahora = new Date().getHours() * 60 + new Date().getMinutes();
      if (ahora >= apertura && ahora <= cierre) {
        pista.append(el('div', { clase: 'linea-ahora', estilo: { top: `${(ahora - apertura) * PX_MIN}px` } }));
      }
    }

    // citas de esta columna
    const citas = datos.citas.filter((c) => (c.bahia_id || null) === col.id);
    for (const c of citas) pista.append(tarjetaCita(c, apertura));

    // crear cita pinchando en un hueco
    pista.addEventListener('click', (e) => {
      if (e.target.closest('.cita') || !puede('gestionar')) return;
      const y = e.clientY - pista.getBoundingClientRect().top;
      const minuto = Math.round((y / PX_MIN + apertura) / slot) * slot;
      formularioCita({
        inicial: { fecha, hora_inicio: aHora(Math.max(apertura, Math.min(cierre - slot, minuto))), bahia_id: col.id },
        alGuardar: refrescar,
      });
    });

    // soltar una cita arrastrada
    const columna = el(
      'div',
      { clase: 'col-bahia' },
      el(
        'div',
        { clase: 'col-cabecera', estilo: { borderTop: `3px solid ${colorLibre(col.color)}` } },
        el('span', { texto: col.nombre }),
        ocup ? el('span', { clase: 'ocupacion', texto: `${ocup.porcentaje}%` }) : null
      ),
      pista
    );
    columna.addEventListener('dragover', (e) => {
      if (!puede('gestionar')) return;
      e.preventDefault();
      columna.classList.add('destino');
    });
    columna.addEventListener('dragleave', () => columna.classList.remove('destino'));
    columna.addEventListener('drop', async (e) => {
      e.preventDefault();
      columna.classList.remove('destino');
      let carga;
      try {
        carga = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        return;
      }
      const y = e.clientY - pista.getBoundingClientRect().top - (carga.agarreMin || 0) * PX_MIN;
      const minuto = Math.max(0, Math.round((y / PX_MIN + apertura) / slot) * slot);
      await mover(carga.id, { fecha, hora_inicio: aHora(minuto), bahia_id: col.id });
    });
    cols.append(columna);
  }

  vaciar(zona);
  if (datos.cerrado) {
    zona.append(
      el('div', { clase: 'tarjeta aviso-cerrado' },
        '⚠️ Según los ajustes, este día el taller está cerrado.')
    );
  }
  zona.append(el('div', { clase: 'agenda' }, colHoras, cols));
  zona.append(resumenDia(datos));
}

async function mover(id, datos, forzar = false) {
  try {
    const r = await api.moverCita(id, { ...datos, forzar });
    (r.advertencias || []).forEach((a) => aviso(a, 'avisa'));
    aviso('Cita reprogramada', 'ok');
    refrescar();
  } catch (e) {
    if (e instanceof ErrorApi && e.codigo === 409 && e.datos.conflictos) {
      const lista = e.datos.conflictos.map((c) => `· ${c.recurso}: ${c.texto}`).join('\n');
      const ok = await confirmar(`Ese hueco ya está ocupado:\n\n${lista}\n\n¿Mover la cita igualmente?`, {
        titulo: 'Solape de citas',
        textoOk: 'Mover igualmente',
        peligro: false,
      });
      if (ok) return mover(id, datos, true);
      refrescar();
    } else {
      aviso(e.message, 'mal');
      refrescar();
    }
  }
}

function tarjetaCita(c, apertura) {
  const inicio = aMinutos(c.hora_inicio);
  const color = colorLibre(c.servicio_color || c.bahia_color);
  const est = colorEstado(c.estado, estado.estados);
  const finalizada = ['entregada', 'anulada', 'no_presentado'].includes(c.estado);
  const anulada = c.estado === 'anulada';
  const nodo = el(
    'div',
    {
      clase: `cita ${finalizada ? 'finalizada' : ''} ${est.rayado ? 'rayada' : ''}`,
      draggable: puede('gestionar') ? 'true' : null,
      estilo: {
        top: `${(inicio - apertura) * PX_MIN}px`,
        height: `${Math.max(22, c.duracion_min * PX_MIN - 3)}px`,
        background: anulada ? est.fondo : color,
        color: textoSobre(anulada ? est.fondo : color),
        borderLeftColor: est.fondo,
      },
      title: `${c.hora_inicio} · ${c.matricula || ''} · ${c.titulo || ''} · ${(estado.estados[c.estado] || {}).etiqueta}`,
    },
    el('div', { clase: 'punto-estado', estilo: { background: est.fondo } }),
    el('div', {}, el('span', { clase: 'hora', texto: c.hora_inicio }), ' ', el('span', { clase: 'mat', texto: c.matricula || '' })),
    c.duracion_min >= 40 ? el('div', { clase: 'det', texto: c.titulo || c.servicio_nombre || '' }) : null,
    c.duracion_min >= 70 ? el('div', { clase: 'det', texto: `${c.cliente_nombre || ''}${c.espera ? ' ⏳' : ''}` }) : null
  );

  nodo.addEventListener('click', (e) => {
    e.stopPropagation();
    fichaCita(c.id, { alCambiar: refrescar });
  });
  nodo.addEventListener('dragstart', (ev) => {
    const agarreMin = (ev.clientY - nodo.getBoundingClientRect().top) / PX_MIN;
    ev.dataTransfer.setData('text/plain', JSON.stringify({ id: c.id, agarreMin }));
    ev.dataTransfer.effectAllowed = 'move';
    nodo.classList.add('arrastrando');
  });
  nodo.addEventListener('dragend', () => nodo.classList.remove('arrastrando'));
  return nodo;
}

function resumenDia(datos) {
  const activas = datos.citas.filter((c) => !['anulada', 'no_presentado'].includes(c.estado));
  const minutos = activas.reduce((s, c) => s + c.duracion_min, 0);
  const esperan = activas.filter((c) => c.espera).length;
  const sinConfirmar = activas.filter((c) => c.estado === 'pendiente').length;
  return el(
    'div',
    { clase: 'fila', estilo: { marginTop: '12px' } },
    el('span', { clase: 'chapa chapa-clara', texto: `${activas.length} ${activas.length === 1 ? 'cita' : 'citas'}` }),
    el('span', { clase: 'chapa chapa-clara', texto: `${duracionTexto(minutos)} de trabajo` }),
    esperan ? el('span', { clase: 'chapa', estilo: { background: 'var(--ambar)' }, texto: `${esperan} esperan` }) : null,
    sinConfirmar ? el('span', { clase: 'chapa', estilo: { background: 'var(--texto-sutil)' }, texto: `${sinConfirmar} sin confirmar` }) : null
  );
}

// ---------------------------------------------------------------------------
// Vista semanal
// ---------------------------------------------------------------------------
async function pintarSemana(zona) {
  const lunes = lunesDe(fecha);
  const datos = await api.semana(lunes);
  const rejilla = el('div', { clase: 'semana' });
  for (const dia of datos.dias) {
    const activas = dia.citas.filter((c) => !['anulada', 'no_presentado'].includes(c.estado));
    const minutos = activas.reduce((s, c) => s + c.duracion_min, 0);
    const lista = el('div', { clase: 'lista' });
    for (const c of dia.citas) {
      lista.append(
        el('div', {
          clase: `cita-mini ${colorEstado(c.estado, estado.estados).rayado ? 'rayada' : ''}`,
          estilo: {
            background: colorLibre(c.servicio_color),
            color: textoSobre(colorLibre(c.servicio_color)),
            opacity: ['entregada', 'anulada', 'no_presentado'].includes(c.estado) ? '.6' : '1',
          },
          onclick: () => fichaCita(c.id, { alCambiar: refrescar }),
        },
        el('div', {}, el('b', { texto: c.hora_inicio }), ` ${c.matricula || ''}`),
        el('div', { estilo: { opacity: '.9' }, texto: c.titulo || '' }))
      );
    }

    rejilla.append(
      el(
        'div',
        { clase: `dia-semana ${dia.fecha === hoyISO() ? 'hoy' : ''}` },
        el(
          'header',
          { clase: 'clicable', onclick: () => { fecha = dia.fecha; modo = 'dia'; vistaAgenda(document.getElementById('vista')); } },
          el('div', { texto: fmtFechaCorta(dia.fecha) }),
          el('div', {
            clase: 'sutil',
            texto: activas.length
              ? `${activas.length} ${activas.length === 1 ? 'cita' : 'citas'} · ${duracionTexto(minutos)}`
              : 'Sin citas',
          })
        ),
        lista,
        puede('gestionar')
          ? el('div', { estilo: { padding: '6px' } },
              el('button', {
                clase: 'btn btn-mini',
                texto: '+ Cita',
                onclick: () => formularioCita({ inicial: { fecha: dia.fecha }, alGuardar: refrescar }),
              }))
          : null
      )
    );
  }
  vaciar(zona).append(rejilla);
}

export const agenda = { refrescar, irA: (f) => { fecha = f; modo = 'dia'; } };
