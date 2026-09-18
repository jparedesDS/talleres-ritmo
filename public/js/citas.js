// Formulario de cita, ficha de cita y aviso al cliente.
import { api, ErrorApi } from './api.js';
import { estado, puede } from './estado.js';
import { guardarClienteComprobando, leerKm } from './acciones.js';
import {
  el, modal, aviso, confirmar, debounce, hoyISO, fmtFecha, fmtFechaLarga,
  duracionTexto, chapaEstado, matricula, aMinutos, aHora, eur,
} from './util.js';

// ---------------------------------------------------------------------------
// Selector de vehículo con autocompletar + alta rápida
// ---------------------------------------------------------------------------
function selectorVehiculo(vehiculoInicial, alElegir) {
  let elegido = vehiculoInicial || null;

  const resumen = el('div', { clase: 'sutil' });
  const entrada = el('input', {
    placeholder: 'Matrícula, cliente o teléfono…',
    autocomplete: 'off',
  });
  const lista = el('div', { clase: 'auto-lista oculto' });

  function pintarResumen() {
    resumen.replaceChildren();
    if (!elegido) {
      resumen.append('Sin vehículo asignado');
      return;
    }
    resumen.append(
      matricula(elegido.matricula),
      ' ',
      el('b', { texto: [elegido.marca, elegido.modelo].filter(Boolean).join(' ') }),
      elegido.cliente_nombre ? ` · ${elegido.cliente_nombre}` : ' · (sin cliente)',
      elegido.cliente_telefono ? ` · ${elegido.cliente_telefono}` : '',
      ' ',
      el('button', {
        clase: 'btn btn-mini',
        type: 'button',
        texto: 'Cambiar',
        onclick: () => {
          elegido = null;
          alElegir(null);
          pintarResumen();
          entrada.value = '';
          entrada.focus();
        },
      })
    );
  }

  const buscar = debounce(async () => {
    const q = entrada.value.trim();
    if (q.length < 2) {
      lista.classList.add('oculto');
      return;
    }
    const encontrados = await api.vehiculos({ q, limite: 8 });
    lista.replaceChildren();
    if (!encontrados.length) {
      lista.append(el('div', { clase: 'sutil', estilo: { padding: '8px 10px' } }, 'Sin resultados'));
    }
    for (const v of encontrados) {
      lista.append(
        el('button', {
          type: 'button',
          onclick: () => {
            elegido = v;
            alElegir(v);
            pintarResumen();
            lista.classList.add('oculto');
            entrada.value = '';
          },
        },
        el('b', { texto: v.matricula }),
        ` · ${[v.marca, v.modelo].filter(Boolean).join(' ')} `,
        el('span', { clase: 'sutil', texto: v.cliente_nombre || 'sin propietario' }))
      );
    }
    if (puede('gestionar')) lista.append(
      el('button', {
        type: 'button',
        clase: 'accion-alta',
        texto: '+ Dar de alta un vehículo nuevo',
        onclick: () => {
          lista.classList.add('oculto');
          altaRapidaVehiculo(entrada.value.trim(), (v) => {
            elegido = v;
            alElegir(v);
            pintarResumen();
            entrada.value = '';
          });
        },
      })
    );
    lista.classList.remove('oculto');
  }, 220);

  entrada.addEventListener('input', buscar);
  entrada.addEventListener('blur', () => setTimeout(() => lista.classList.add('oculto'), 180));

  pintarResumen();
  return el(
    'div',
    { clase: 'ancho-total' },
    el('label', {}, 'Vehículo', el('div', { clase: 'auto' }, entrada, lista)),
    el('div', { estilo: { marginTop: '6px' } }, resumen)
  );
}

// ---------------------------------------------------------------------------
// Alta rápida de cliente + vehículo
// ---------------------------------------------------------------------------
export function altaRapidaVehiculo(matriculaInicial, alCrear) {
  let clienteElegido = null;

  const campoCliente = el('input', { placeholder: 'Buscar cliente por nombre o teléfono…', autocomplete: 'off' });
  const listaCliente = el('div', { clase: 'auto-lista oculto' });
  const resumenCliente = el('div', { clase: 'sutil', texto: 'Sin cliente' });
  const nuevoCliente = el(
    'div',
    { clase: 'formulario oculto' },
    el('label', {}, 'Nombre del cliente', el('input', { name: 'cliente_nombre' })),
    el('label', {}, 'Teléfono', el('input', { name: 'cliente_telefono' })),
    el('label', {}, 'Email', el('input', { name: 'cliente_email', type: 'email' }))
  );

  const buscarCliente = debounce(async () => {
    const q = campoCliente.value.trim();
    if (q.length < 2) return listaCliente.classList.add('oculto');
    const encontrados = await api.clientes({ q, limite: 8 });
    listaCliente.replaceChildren();
    for (const c of encontrados) {
      listaCliente.append(
        el('button', {
          type: 'button',
          onclick: () => {
            clienteElegido = c;
            resumenCliente.textContent = `Cliente: ${c.nombre}${c.telefono ? ` · ${c.telefono}` : ''}`;
            listaCliente.classList.add('oculto');
            campoCliente.value = '';
            nuevoCliente.classList.add('oculto');
          },
        },
        el('b', { texto: c.nombre }),
        ' ',
        el('span', { clase: 'sutil', texto: [c.telefono, c.matriculas].filter(Boolean).join(' · ') }))
      );
    }
    listaCliente.append(
      el('button', {
        type: 'button',
        clase: 'accion-alta',
        texto: '+ Cliente nuevo',
        onclick: () => {
          clienteElegido = null;
          resumenCliente.textContent = 'Se creará un cliente nuevo';
          nuevoCliente.classList.remove('oculto');
          nuevoCliente.querySelector('[name=cliente_nombre]').value = campoCliente.value.trim();
          listaCliente.classList.add('oculto');
          campoCliente.value = '';
        },
      })
    );
    listaCliente.classList.remove('oculto');
  }, 220);
  campoCliente.addEventListener('input', buscarCliente);

  const form = el(
    'form',
    { clase: 'formulario', id: 'form-vehiculo-rapido' },
    el('label', {}, 'Matrícula *', el('input', { name: 'matricula', value: matriculaInicial || '', required: true })),
    el('label', {}, 'Marca', el('input', { name: 'marca' })),
    el('label', {}, 'Modelo', el('input', { name: 'modelo' })),
    el('label', {}, 'Año', el('input', { name: 'anio', type: 'number', min: '1950', max: '2100' })),
    el('label', {}, 'Kilómetros', el('input', { name: 'km', type: 'number', min: '0' })),
    el('label', {}, 'Próxima ITV', el('input', { name: 'proxima_itv', type: 'date' })),
    el(
      'div',
      { clase: 'ancho-total' },
      el('label', {}, 'Cliente', el('div', { clase: 'auto' }, campoCliente, listaCliente)),
      el('div', { estilo: { marginTop: '6px' } }, resumenCliente),
      nuevoCliente
    )
  );

  const ficha = modal({
    titulo: 'Nuevo vehículo',
    cuerpo: form,
    acciones: [
      { texto: 'Cancelar', accion: (cerrar) => cerrar() },
      {
        texto: 'Guardar',
        clase: 'btn-primario',
        accion: async (cerrar) => {
          const d = Object.fromEntries(new FormData(form));
          if (!d.matricula.trim()) return aviso('La matrícula es obligatoria', 'mal');
          try {
            let clienteId = clienteElegido ? clienteElegido.id : null;
            if (!clienteId && d.cliente_nombre && d.cliente_nombre.trim()) {
              const c = await guardarClienteComprobando(null, {
                nombre: d.cliente_nombre,
                telefono: d.cliente_telefono,
                email: d.cliente_email,
              });
              if (!c) return;
              clienteElegido = c;
              clienteId = c.id;
            }
            const v = await api.crearVehiculo({
              matricula: d.matricula,
              marca: d.marca,
              modelo: d.modelo,
              anio: d.anio,
              km: d.km,
              proxima_itv: d.proxima_itv,
              cliente_id: clienteId,
            });
            const completo = (await api.vehiculos({ q: v.matricula, limite: 1 }))[0] || v;
            aviso('Vehículo dado de alta', 'ok');
            cerrar();
            alCrear(completo);
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
    ],
  });
  return ficha;
}

// ---------------------------------------------------------------------------
// Formulario de cita (alta y edición)
// ---------------------------------------------------------------------------
export function formularioCita({ cita = null, inicial = {}, alGuardar } = {}) {
  let vehiculo = cita && cita.vehiculo_id
    ? {
        id: cita.vehiculo_id,
        matricula: cita.matricula,
        marca: cita.marca,
        modelo: cita.modelo,
        cliente_nombre: cita.cliente_nombre,
        cliente_telefono: cita.cliente_telefono,
        cliente_id: cita.cliente_id,
      }
    : inicial.vehiculo || null;

  const selServicio = el(
    'select',
    { name: 'servicio_id' },
    el('option', { value: '' }, '— Sin servicio —'),
    ...estado.servicios.map((s) =>
      el('option', { value: s.id, selected: cita ? cita.servicio_id === s.id : inicial.servicio_id === s.id }, s.nombre)
    )
  );
  const campoDuracion = el('input', {
    name: 'duracion_min',
    type: 'number',
    min: '5',
    step: '5',
    value: cita ? cita.duracion_min : inicial.duracion_min || 60,
  });
  selServicio.addEventListener('change', () => {
    const s = estado.servicios.find((x) => String(x.id) === selServicio.value);
    if (s) campoDuracion.value = s.duracion_min;
  });

  const campoFecha = el('input', { name: 'fecha', type: 'date', required: true, value: cita ? cita.fecha : inicial.fecha || hoyISO() });
  const campoHora = el('input', { name: 'hora_inicio', type: 'time', required: true, step: '300', value: cita ? cita.hora_inicio : inicial.hora_inicio || '09:00' });

  const selBahia = el(
    'select',
    { name: 'bahia_id' },
    el('option', { value: '' }, '— Sin asignar —'),
    ...estado.bahias.map((b) =>
      el('option', { value: b.id, selected: cita ? cita.bahia_id === b.id : inicial.bahia_id === b.id }, b.nombre)
    )
  );
  const selMecanico = el(
    'select',
    { name: 'mecanico_id' },
    el('option', { value: '' }, '— Sin asignar —'),
    ...estado.mecanicos.map((m) =>
      el('option', { value: m.id, selected: cita ? cita.mecanico_id === m.id : inicial.mecanico_id === m.id }, m.nombre)
    )
  );
  const selEstado = el(
    'select',
    { name: 'estado' },
    ...Object.entries(estado.estados).map(([k, v]) =>
      el('option', { value: k, selected: cita ? cita.estado === k : k === 'pendiente' }, v.etiqueta)
    )
  );

  const zonaHuecos = el('div', { clase: 'ancho-total oculto' });

  async function verHuecos() {
    zonaHuecos.replaceChildren(el('p', { clase: 'sutil', texto: 'Buscando huecos…' }));
    zonaHuecos.classList.remove('oculto');
    try {
      const r = await api.disponibilidad({
        fecha: campoFecha.value,
        duracion: campoDuracion.value,
        bahia_id: selBahia.value || undefined,
      });
      zonaHuecos.replaceChildren(
        el('div', { clase: 'sutil', estilo: { marginBottom: '6px' } },
          `Huecos libres el ${fmtFecha(r.fecha)} para ${duracionTexto(r.duracion)}:`),
        el(
          'div',
          { clase: 'fila' },
          r.huecos.length
            ? r.huecos.map((h) =>
                el('button', {
                  type: 'button',
                  clase: 'btn btn-mini',
                  texto: `${h.hora} (${h.bahias.length})`,
                  title: h.bahias.map((b) => b.nombre).join(', '),
                  onclick: () => {
                    campoHora.value = h.hora;
                    if (!selBahia.value) selBahia.value = h.bahias[0].id;
                    zonaHuecos.classList.add('oculto');
                  },
                })
              )
            : el('span', { clase: 'sutil', texto: 'No queda ningún hueco ese día con esa duración.' })
        )
      );
    } catch (e) {
      zonaHuecos.replaceChildren(el('p', { clase: 'error', texto: e.message }));
    }
  }

  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    selectorVehiculo(vehiculo, (v) => {
      vehiculo = v;
    }),
    el('label', { clase: 'ancho-total' }, 'Servicio', selServicio),
    el('label', {}, 'Fecha', campoFecha),
    el('label', {}, 'Hora', campoHora),
    el('label', {}, 'Duración (min)', campoDuracion),
    el(
      'div',
      { clase: 'ancho-total' },
      el('button', { type: 'button', clase: 'btn btn-mini', texto: '🔍 Ver huecos libres', onclick: verHuecos })
    ),
    zonaHuecos,
    el('label', {}, 'Bahía', selBahia),
    el('label', {}, 'Mecánico', selMecanico),
    el('label', {}, 'Estado', selEstado),
    el('label', {}, 'Km de entrada', el('input', { name: 'km_entrada', type: 'number', min: '0', value: cita && cita.km_entrada ? cita.km_entrada : '' })),
    el(
      'label',
      { clase: 'ancho-total', estilo: { flexDirection: 'row', alignItems: 'center', gap: '8px' } },
      el('input', { type: 'checkbox', name: 'espera', estilo: { width: 'auto' }, checked: cita ? !!cita.espera : false }),
      'El cliente espera en el taller'
    ),
    el('label', { clase: 'ancho-total' }, 'Trabajo a realizar / observaciones',
      el('textarea', { name: 'descripcion', rows: '3' }, cita ? cita.descripcion || '' : inicial.descripcion || '')),
  );

  async function guardar(cerrar, forzar = false) {
    const d = Object.fromEntries(new FormData(form));
    const datos = {
      vehiculo_id: vehiculo ? vehiculo.id : null,
      servicio_id: d.servicio_id || null,
      bahia_id: d.bahia_id || null,
      mecanico_id: d.mecanico_id || null,
      fecha: d.fecha,
      hora_inicio: d.hora_inicio,
      duracion_min: d.duracion_min,
      estado: d.estado,
      km_entrada: d.km_entrada || null,
      espera: !!d.espera,
      descripcion: d.descripcion,
      forzar,
    };
    if (!datos.fecha || !datos.hora_inicio) return aviso('Indique fecha y hora', 'mal');
    try {
      const r = cita ? await api.guardarCita(cita.id, datos) : await api.crearCita(datos);
      (r.advertencias || []).forEach((a) => aviso(a, 'avisa'));
      aviso(cita ? 'Cita actualizada' : 'Cita creada', 'ok');
      cerrar();
      if (alGuardar) alGuardar(r.cita);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 409 && e.datos.conflictos) {
        const lista = e.datos.conflictos.map((c) => `· ${c.recurso}: ${c.texto}`).join('\n');
        const ok = await confirmar(
          `Ese hueco ya está ocupado:\n\n${lista}\n\n¿Quiere guardar la cita igualmente?`,
          { titulo: 'Solape de citas', textoOk: 'Guardar igualmente', peligro: false }
        );
        if (ok) return guardar(cerrar, true);
      } else {
        aviso(e.message, 'mal');
      }
    }
  }

  return modal({
    titulo: cita ? `Editar cita #${cita.id}` : 'Nueva cita',
    cuerpo: form,
    acciones: [
      { texto: 'Cancelar', accion: (cerrar) => cerrar() },
      { texto: cita ? 'Guardar cambios' : 'Crear cita', clase: 'btn-primario', accion: (cerrar) => guardar(cerrar) },
    ],
  });
}

// ---------------------------------------------------------------------------
// Aviso al cliente
// ---------------------------------------------------------------------------
function ventanaAviso(cita, texto, telefono) {
  const area = el('textarea', { rows: '4', clase: 'ancho-total' }, texto);
  const cuerpo = el(
    'div',
    {},
    el('p', { clase: 'sutil' }, 'Revise el mensaje y elija cómo enviarlo. El texto se puede editar antes de enviar.'),
    area,
    el(
      'div',
      { clase: 'fila', estilo: { marginTop: '12px' } },
      el('button', {
        clase: 'btn btn-primario',
        texto: '💬 WhatsApp',
        disabled: !telefono,
        onclick: () => {
          window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(area.value)}`, '_blank', 'noopener');
          api.avisoCita(cita.id).catch(() => {});
        },
      }),
      el('button', {
        clase: 'btn',
        texto: '✉️ Correo',
        disabled: !cita.cliente_email,
        onclick: () => {
          const asunto = `Cita en ${estado.ajustes.nombre_taller || 'el taller'} · ${fmtFecha(cita.fecha)} ${cita.hora_inicio}`;
          window.location.href = `mailto:${encodeURIComponent(cita.cliente_email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(area.value)}`;
          api.avisoCita(cita.id).catch(() => {});
        },
      }),
      el('button', {
        clase: 'btn',
        texto: '📋 Copiar texto',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(area.value);
            aviso('Texto copiado', 'ok');
          } catch {
            area.select();
            document.execCommand('copy');
            aviso('Texto copiado', 'ok');
          }
          api.avisoCita(cita.id).catch(() => {});
        },
      }),
      !telefono ? el('span', { clase: 'sutil', texto: 'El cliente no tiene teléfono guardado.' }) : null
    )
  );
  modal({ titulo: 'Avisar al cliente', cuerpo, acciones: [{ texto: 'Cerrar', accion: (c) => c() }] });
}

// ---------------------------------------------------------------------------
// Ficha de la cita
// ---------------------------------------------------------------------------
const SIGUIENTES = {
  pendiente: ['confirmada', 'anulada'],
  confirmada: ['en_taller', 'no_presentado', 'anulada'],
  en_taller: ['en_reparacion', 'terminada'],
  en_reparacion: ['terminada'],
  terminada: ['entregada'],
  entregada: [],
  no_presentado: ['confirmada'],
  anulada: ['pendiente'],
};

/** Estados a los que el usuario actual puede pasar la cita. */
function estadosPosibles(actual) {
  const siguientes = SIGUIENTES[actual] || [];
  if (puede('gestionar')) return siguientes;
  if (puede('estado')) return siguientes.filter((e) => estado.estadosTaller.includes(e));
  return [];
}

export async function fichaCita(id, { alCambiar } = {}) {
  let datos;
  try {
    datos = await api.cita(id);
  } catch (e) {
    return aviso(e.message, 'mal');
  }
  const { cita, historial, aviso: avisoDatos } = datos;

  const dato = (titulo, valor) =>
    el('div', {}, el('div', { clase: 'sutil', texto: titulo }), el('div', {}, valor ?? '—'));

  const botonesEstado = el(
    'div',
    { clase: 'fila', estilo: { marginTop: '4px' } },
    ...estadosPosibles(cita.estado).map((e) =>
      el('button', {
        clase: `btn btn-mini ${e === 'anulada' || e === 'no_presentado' ? 'btn-peligro' : 'btn-primario'}`,
        texto: estado.estados[e].etiqueta,
        onclick: async () => {
          let km;
          if (e === 'en_taller') {
            const v = prompt('Kilómetros del vehículo al entrar (opcional):', cita.km_entrada || '');
            if (v === null) return; // cancelado
            const leido = leerKm(v);
            if (!leido.ok) return aviso('Los kilómetros deben ser un número sin decimales', 'mal');
            km = leido.km;
          }
          try {
            await api.estadoCita(cita.id, { estado: e, km_entrada: km });
            aviso(`Cita marcada como "${estado.estados[e].etiqueta}"`, 'ok');
            ficha.cerrar();
            if (alCambiar) alCambiar();
          } catch (err) {
            aviso(err.message, 'mal');
          }
        },
      })
    )
  );

  const cuerpo = el(
    'div',
    {},
    el(
      'div',
      { clase: 'fila-entre', estilo: { marginBottom: '14px' } },
      el('div', { clase: 'fila' }, matricula(cita.matricula), el('b', { texto: [cita.marca, cita.modelo].filter(Boolean).join(' ') })),
      chapaEstado(cita.estado, estado.estados)
    ),
    el(
      'div',
      { clase: 'rejilla rejilla-3', estilo: { marginBottom: '14px' } },
      dato('Fecha', `${fmtFechaLarga(cita.fecha)}`),
      dato('Hora', `${cita.hora_inicio} – ${aHora(aMinutos(cita.hora_inicio) + cita.duracion_min)} (${duracionTexto(cita.duracion_min)})`),
      dato('Servicio', cita.servicio_nombre),
      dato('Bahía', cita.bahia_nombre),
      dato('Mecánico', cita.mecanico_nombre),
      dato('Cliente', cita.cliente_nombre),
      dato('Teléfono', cita.cliente_telefono),
      dato('Km de entrada', cita.km_entrada),
      dato('Precio orientativo', cita.precio_orientativo ? eur(cita.precio_orientativo) : null),
      cita.espera ? dato('Atención', '⏳ El cliente espera') : null,
      cita.aviso_enviado_en ? dato('Aviso enviado', new Date(cita.aviso_enviado_en).toLocaleString('es-ES')) : null
    ),
    cita.descripcion
      ? el('div', { estilo: { marginBottom: '14px' } }, el('div', { clase: 'sutil', texto: 'Trabajo / observaciones' }), el('div', { texto: cita.descripcion }))
      : null,
    estadosPosibles(cita.estado).length ? el('div', { clase: 'sutil', texto: 'Cambiar estado' }) : null,
    botonesEstado,
    historial.length
      ? el(
          'details',
          { estilo: { marginTop: '16px' } },
          el('summary', { clase: 'sutil', texto: `Historial (${historial.length})` }),
          el(
            'ul',
            { estilo: { fontSize: '.85rem', color: 'var(--texto-sutil)' } },
            ...historial.map((h) =>
              el('li', {}, `${new Date(h.fecha).toLocaleString('es-ES')} · ${h.accion}${h.detalle ? `: ${h.detalle}` : ''} · ${h.usuario || ''}`)
            )
          )
        )
      : null
  );

  const ficha = modal({
    titulo: `Cita #${cita.id}`,
    cuerpo,
    acciones: [
      puede('gestionar') && {
        texto: '💬 Avisar cliente',
        accion: () => ventanaAviso(cita, avisoDatos.texto, avisoDatos.telefono),
      },
      { texto: '🖨️ Imprimir', accion: () => window.print() },
      { separador: true },
      puede('gestionar') && {
        texto: 'Borrar',
        clase: 'btn-peligro',
        accion: async (cerrar) => {
          if (!(await confirmar('¿Borrar definitivamente esta cita? Se perderá su historial.'))) return;
          try {
            await api.borrarCita(cita.id);
            aviso('Cita borrada', 'ok');
            cerrar();
            if (alCambiar) alCambiar();
          } catch (err) {
            aviso(err.message, 'mal');
          }
        },
      },
      puede('gestionar') && {
        texto: 'Editar',
        clase: 'btn-primario',
        accion: (cerrar) => {
          cerrar();
          formularioCita({ cita, alGuardar: () => alCambiar && alCambiar() });
        },
      },
    ],
  });
  return ficha;
}
