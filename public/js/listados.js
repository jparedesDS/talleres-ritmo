// Vistas de listado: citas, clientes y vehículos, con sus fichas y formularios.
import { api } from './api.js';
import { estado, puede, alRefrescar } from './estado.js';
import { guardarClienteComprobando } from './acciones.js';
import { fichaCita, formularioCita } from './citas.js';
import { tablaCitas } from './panel.js';
import {
  el, vaciar, modal, aviso, confirmar, debounce, hoyISO, sumarDias, fmtFecha,
  diasHasta, chapaEstado, matricula,
} from './util.js';

// ===========================================================================
// CITAS
// ===========================================================================
export async function vistaCitas(contenedor) {
  const filtros = {
    desde: sumarDias(hoyISO(), -7),
    hasta: sumarDias(hoyISO(), 60),
    estado: '',
    q: '',
  };

  const zona = el('div');
  const LIMITE = 300;
  const recargar = async () => {
    if (!zona.firstChild) zona.append(el('p', { clase: 'sutil', texto: 'Cargando…' }));
    const citas = await api.citas({ ...filtros, limite: LIMITE });
    vaciar(zona).append(
      el('div', { clase: 'fila', estilo: { marginBottom: '8px' } },
        el('span', { clase: 'chapa chapa-clara', texto: `${citas.length} ${citas.length === 1 ? 'cita' : 'citas'}` }),
        citas.length >= LIMITE
          ? el('span', { clase: 'sutil', texto: `Se muestran las ${LIMITE} más recientes: acote las fechas para ver el resto.` })
          : null),
      citas.length ? tablaCitas(citas, recargar, true) : el('p', { clase: 'vacio', texto: 'No hay citas con esos filtros.' })
    );
  };

  const cambio = (campo) => (e) => {
    filtros[campo] = e.target.value;
    recargar();
  };

  vaciar(contenedor).append(
    el('div', { clase: 'fila-entre', estilo: { marginBottom: '12px' } },
      el('h2', { texto: 'Citas' }),
      puede('gestionar')
        ? el('button', { clase: 'btn btn-primario', texto: '+ Nueva cita', onclick: () => formularioCita({ alGuardar: recargar }) })
        : null),
    el(
      'div',
      { clase: 'tarjeta fila', estilo: { marginBottom: '12px' } },
      el('label', {}, 'Desde', el('input', { type: 'date', value: filtros.desde, onchange: cambio('desde') })),
      el('label', {}, 'Hasta', el('input', { type: 'date', value: filtros.hasta, onchange: cambio('hasta') })),
      el('label', {}, 'Estado',
        el('select', { onchange: cambio('estado') },
          el('option', { value: '' }, 'Todos'),
          ...Object.entries(estado.estados).map(([k, v]) => el('option', { value: k }, v.etiqueta)))),
      el('label', { estilo: { flex: '1', minWidth: '180px' } }, 'Buscar',
        el('input', { placeholder: 'Matrícula, cliente, teléfono…', oninput: debounce(cambio('q'), 300) }))
    ),
    zona
  );
  await recargar();
  alRefrescar(recargar);
}

// ===========================================================================
// CLIENTES
// ===========================================================================
export async function vistaClientes(contenedor) {
  let q = '';
  const zona = el('div');

  const recargar = async () => {
    const clientes = await api.clientes({ q, limite: 300 });
    vaciar(zona).append(
      clientes.length
        ? el(
            'div',
            { clase: 'tabla-envoltorio' },
            el(
              'table',
              {},
              el('thead', {}, el('tr', {},
                el('th', { texto: 'Cliente' }), el('th', { texto: 'Teléfono' }),
                el('th', { texto: 'Email' }), el('th', { texto: 'Vehículos' }))),
              el('tbody', {}, ...clientes.map((c) =>
                el('tr', { clase: 'clicable', onclick: () => fichaCliente(c.id, recargar) },
                  el('td', {}, el('b', { texto: c.nombre }), c.nif ? el('div', { clase: 'sutil', texto: c.nif }) : null),
                  el('td', { texto: c.telefono || '—' }),
                  el('td', { texto: c.email || '—' }),
                  el('td', { texto: c.matriculas || '—' }))))
            )
          )
        : el('p', { clase: 'vacio', texto: 'No hay clientes que coincidan.' })
    );
  };

  vaciar(contenedor).append(
    el('div', { clase: 'fila-entre', estilo: { marginBottom: '12px' } },
      el('h2', { texto: 'Clientes' }),
      el('div', { clase: 'fila' },
        el('input', { placeholder: 'Buscar…', estilo: { width: '240px' }, oninput: debounce((e) => { q = e.target.value; recargar(); }, 300) }),
        puede('gestionar')
          ? el('button', { clase: 'btn btn-primario', texto: '+ Nuevo cliente', onclick: () => formularioCliente(null, recargar) })
          : null)),
    zona
  );
  await recargar();
  alRefrescar(recargar);
}

export function formularioCliente(cliente, alGuardar, previo = {}, { ofrecerVehiculo = true } = {}) {
  const valor = (campo) => cliente?.[campo] || previo[campo] || '';
  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    el('label', { clase: 'ancho-total' }, 'Nombre o razón social *', el('input', { name: 'nombre', required: true, value: valor('nombre') })),
    el('label', {}, 'NIF / CIF', el('input', { name: 'nif', value: valor('nif') })),
    el('label', {}, 'Teléfono', el('input', { name: 'telefono', value: valor('telefono') })),
    el('label', {}, 'Email', el('input', { name: 'email', type: 'email', value: valor('email') })),
    el('label', {}, 'Dirección', el('input', { name: 'direccion', value: valor('direccion') })),
    el('label', {}, 'Población', el('input', { name: 'poblacion', value: valor('poblacion') })),
    el('label', {}, 'Código postal', el('input', { name: 'cp', value: valor('cp') })),
    el('label', { clase: 'ancho-total' }, 'Notas', el('textarea', { name: 'notas', rows: '2' }, valor('notas')))
  );

  return modal({
    titulo: cliente ? 'Editar cliente' : 'Nuevo cliente',
    cuerpo: form,
    acciones: [
      { texto: 'Cancelar', accion: (c) => c() },
      {
        texto: 'Guardar',
        clase: 'btn-primario',
        accion: async (cerrar) => {
          const d = Object.fromEntries(new FormData(form));
          if (!d.nombre.trim()) return aviso('El nombre es obligatorio', 'mal');
          try {
            const guardado = await guardarClienteComprobando(cliente ? cliente.id : null, d);
            if (!guardado) return; // se canceló al avisar de un posible duplicado
            aviso('Cliente guardado', 'ok');
            cerrar();
            if (alGuardar) alGuardar(guardado);
            // Cliente recién creado: lo natural es dar de alta su coche a continuación
            if (!cliente && ofrecerVehiculo) {
              const ahora = await confirmar(`¿Quiere dar de alta ahora el vehículo de ${guardado.nombre}?`, {
                titulo: 'Cliente creado',
                textoOk: '+ Añadir su vehículo',
                textoCancelar: 'Ahora no',
                peligro: false,
              });
              if (ahora) {
                formularioVehiculo(null, () => {
                  if (alGuardar) alGuardar(guardado);
                  fichaCliente(guardado.id, alGuardar);
                }, guardado);
              }
            }
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
    ],
  });
}

export async function fichaCliente(id, alCambiar) {
  const { cliente, vehiculos, citas } = await api.cliente(id);

  // Tras añadir o asignar un coche se vuelve a abrir la ficha con los datos al día
  const reabrir = () => {
    ficha.cerrar();
    fichaCliente(id, alCambiar);
    if (alCambiar) alCambiar();
  };

  const cuerpo = el(
    'div',
    {},
    el('div', { clase: 'rejilla rejilla-3', estilo: { marginBottom: '14px' } },
      campo('Teléfono', cliente.telefono), campo('Email', cliente.email), campo('NIF', cliente.nif),
      campo('Dirección', [cliente.direccion, cliente.cp, cliente.poblacion].filter(Boolean).join(', ')),
      campo('Notas', cliente.notas)),
    el('div', { clase: 'fila-entre' },
      el('h3', { texto: `Vehículos (${vehiculos.length})` }),
      puede('gestionar') && el('div', { clase: 'fila', estilo: { marginBottom: '10px' } },
        el('button', {
          clase: 'btn btn-mini btn-primario',
          texto: '+ Vehículo nuevo',
          onclick: () => formularioVehiculo(null, reabrir, cliente),
        }),
        el('button', {
          clase: 'btn btn-mini',
          texto: 'Asignar un vehículo que ya existe',
          onclick: () => asignarVehiculoExistente(cliente, reabrir),
        }))),
    vehiculos.length
      ? el('div', { clase: 'tarjeta', estilo: { padding: '4px 12px', marginBottom: '16px', boxShadow: 'none' } },
          ...vehiculos.map((v) => {
            const itv = v.proxima_itv ? diasHasta(v.proxima_itv) : null;
            return el('div', { clase: 'linea-lista' },
              el('div', { clase: 'datos' },
                el('div', { clase: 'fila-principal' },
                  matricula(v.matricula),
                  el('b', { texto: [v.marca, v.modelo].filter(Boolean).join(' ') || 'Sin marca ni modelo' }),
                  v.proxima_itv && itv < 30
                    ? el('span', { clase: 'chapa', estilo: { background: itv < 0 ? 'var(--rojo)' : 'var(--ambar)' }, texto: itv < 0 ? 'ITV vencida' : `ITV en ${itv} d` })
                    : null),
                el('div', {
                  clase: 'sutil',
                  texto: [
                    v.anio,
                    v.km ? `${v.km.toLocaleString('es-ES')} km` : null,
                    v.proxima_itv ? `ITV ${fmtFecha(v.proxima_itv)}` : null,
                    v.notas,
                  ].filter(Boolean).join(' · ') || ' ',
                })),
              el('div', { clase: 'acciones' },
                puede('gestionar') && el('button', {
                  clase: 'btn btn-mini btn-primario',
                  texto: '+ Cita',
                  onclick: () => {
                    ficha.cerrar();
                    formularioCita({
                      inicial: { vehiculo: { ...v, cliente_nombre: cliente.nombre, cliente_telefono: cliente.telefono } },
                      alGuardar: alCambiar,
                    });
                  },
                }),
                el('button', { clase: 'btn btn-mini', texto: 'Ver', onclick: () => { ficha.cerrar(); fichaVehiculo(v.id, alCambiar); } })));
          }))
      : el('p', {
          clase: 'sutil',
          texto: puede('gestionar')
            ? 'Este cliente todavía no tiene ningún vehículo. Añádalo con los botones de arriba.'
            : 'Este cliente todavía no tiene ningún vehículo.',
        }),
    el('h3', { texto: `Historial de citas (${citas.length})` }),
    citas.length
      ? el('div', { clase: 'tabla-envoltorio', estilo: { maxHeight: '260px' } },
          el('table', {},
            el('tbody', {}, ...citas.map((c) =>
              el('tr', { clase: 'clicable', onclick: () => { ficha.cerrar(); fichaCita(c.id, { alCambiar }); } },
                el('td', { texto: fmtFecha(c.fecha) }),
                el('td', { texto: c.hora_inicio }),
                el('td', {}, matricula(c.matricula)),
                el('td', { texto: c.servicio || c.titulo || '' }),
                el('td', {}, chapaEstado(c.estado, estado.estados)))))))
      : el('p', { clase: 'sutil', texto: 'Todavía no ha tenido ninguna cita.' })
  );

  const ficha = modal({
    titulo: cliente.nombre,
    ancho: true,
    cuerpo,
    acciones: [
      { separador: true },
      puede('gestionar') && {
        texto: 'Borrar',
        clase: 'btn-peligro',
        accion: async (cerrar) => {
          if (!(await confirmar(`¿Borrar el cliente ${cliente.nombre}?`))) return;
          try {
            await api.borrarCliente(cliente.id);
            aviso('Cliente borrado', 'ok');
            cerrar();
            if (alCambiar) alCambiar();
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
      puede('gestionar') && {
        texto: 'Editar',
        clase: 'btn-primario',
        accion: (cerrar) => { cerrar(); formularioCliente(cliente, alCambiar); },
      },
    ],
  });
  return ficha;
}

/** Busca un vehículo ya dado de alta y lo pasa a nombre del cliente. */
function asignarVehiculoExistente(cliente, alTerminar) {
  const entrada = el('input', { placeholder: 'Matrícula, marca o dueño actual…', autocomplete: 'off' });
  const titulo = el('div', { clase: 'sutil', estilo: { margin: '12px 0 4px' } });
  const lista = el('div');

  const asignar = async (v) => {
    if (v.cliente_id === cliente.id) return aviso(`${v.matricula} ya es de ${cliente.nombre}`, 'avisa');
    if (v.cliente_id) {
      const ok = await confirmar(`${v.matricula} figura ahora a nombre de ${v.cliente_nombre}. ¿Pasarlo a ${cliente.nombre}?`, {
        titulo: 'Cambiar de propietario',
        textoOk: 'Sí, cambiar propietario',
        peligro: false,
      });
      if (!ok) return;
    }
    try {
      await api.guardarVehiculo(v.id, { ...v, cliente_id: cliente.id });
      aviso(`${v.matricula} asignado a ${cliente.nombre}`, 'ok');
      ventana.cerrar();
      alTerminar();
    } catch (e) {
      aviso(e.message, 'mal');
    }
  };

  const buscar = async () => {
    const q = entrada.value.trim();
    const vehiculos = q.length >= 2
      ? await api.vehiculos({ q, limite: 15 })
      : await api.vehiculos({ sin_cliente: 1, limite: 15 });
    titulo.textContent = q.length >= 2 ? 'Resultados' : 'Vehículos que todavía no tienen propietario';
    vaciar(lista).append(
      vehiculos.length
        ? el('div', {}, ...vehiculos.map((v) =>
            el('div', { clase: 'linea-lista' },
              el('div', { clase: 'datos' },
                el('div', { clase: 'fila-principal' },
                  matricula(v.matricula),
                  el('span', { texto: [v.marca, v.modelo].filter(Boolean).join(' ') })),
                el('div', { clase: 'sutil', texto: v.cliente_nombre ? `Propietario actual: ${v.cliente_nombre}` : 'Sin propietario' })),
              el('div', { clase: 'acciones' },
                el('button', { clase: 'btn btn-mini btn-primario', texto: 'Asignar', onclick: () => asignar(v) })))))
        : el('p', {
            clase: 'sutil',
            texto: q.length >= 2 ? 'No hay ningún vehículo con esa matrícula.' : 'Todos los vehículos tienen ya propietario. Busque por matrícula.',
          })
    );
  };
  entrada.addEventListener('input', debounce(buscar, 250));

  const ventana = modal({
    titulo: `Asignar vehículo a ${cliente.nombre}`,
    cuerpo: el('div', {}, el('label', {}, 'Buscar vehículo', entrada), titulo, lista),
    acciones: [{ texto: 'Cerrar', accion: (c) => c() }],
  });
  buscar();
  return ventana;
}

// ===========================================================================
// VEHÍCULOS
// ===========================================================================
export async function vistaVehiculos(contenedor) {
  let q = '';
  const zona = el('div');

  const recargar = async () => {
    const vehiculos = await api.vehiculos({ q, limite: 300 });
    vaciar(zona).append(
      vehiculos.length
        ? el(
            'div',
            { clase: 'tabla-envoltorio' },
            el('table', {},
              el('thead', {}, el('tr', {},
                el('th', { texto: 'Matrícula' }), el('th', { texto: 'Vehículo' }),
                el('th', { texto: 'Propietario' }), el('th', { texto: 'Km' }),
                el('th', { texto: 'Próxima ITV' }))),
              el('tbody', {}, ...vehiculos.map((v) => {
                const dias = v.proxima_itv ? diasHasta(v.proxima_itv) : null;
                return el('tr', { clase: 'clicable', onclick: () => fichaVehiculo(v.id, recargar) },
                  el('td', {}, matricula(v.matricula)),
                  el('td', { texto: [v.marca, v.modelo, v.anio ? `(${v.anio})` : ''].filter(Boolean).join(' ') }),
                  el('td', {}, v.cliente_nombre
                    ? v.cliente_nombre
                    : el('span', { clase: 'chapa', estilo: { background: 'var(--ambar)' }, texto: 'Sin propietario' })),
                  el('td', { texto: v.km ? v.km.toLocaleString('es-ES') : '—' }),
                  el('td', {}, v.proxima_itv
                    ? el('span', { clase: 'chapa', estilo: { background: dias < 0 ? 'var(--rojo)' : dias < 30 ? 'var(--ambar)' : 'var(--texto-sutil)' } },
                        fmtFecha(v.proxima_itv))
                    : '—'));
              })))
          )
        : el('p', { clase: 'vacio', texto: 'No hay vehículos que coincidan.' })
    );
  };

  vaciar(contenedor).append(
    el('div', { clase: 'fila-entre', estilo: { marginBottom: '12px' } },
      el('h2', { texto: 'Vehículos' }),
      el('div', { clase: 'fila' },
        el('input', { placeholder: 'Matrícula, marca, cliente…', estilo: { width: '260px' }, oninput: debounce((e) => { q = e.target.value; recargar(); }, 300) }),
        puede('gestionar')
          ? el('button', { clase: 'btn btn-primario', texto: '+ Nuevo vehículo', onclick: () => formularioVehiculo(null, recargar) })
          : null)),
    zona
  );
  await recargar();
  alRefrescar(recargar);
}

/**
 * Bloque "Propietario": muestra el cliente asignado o un buscador con la
 * opción de crear el cliente sin salir del formulario del vehículo.
 */
function selectorCliente(inicial, alCambiar) {
  let actual = inicial || null;
  const caja = el('div', { clase: 'selector-cliente ancho-total' });

  const asignar = (c) => {
    actual = c;
    alCambiar(c);
    pintar();
  };

  function pintar() {
    vaciar(caja).append(el('div', { clase: 'selector-titulo', texto: 'Propietario del vehículo' }));

    if (actual) {
      caja.append(
        el('div', { clase: 'propietario' },
          el('div', {},
            el('b', { texto: `👤 ${actual.nombre}` }),
            el('div', { clase: 'sutil', texto: [actual.telefono, actual.nif].filter(Boolean).join(' · ') || 'Sin teléfono' })),
          el('button', {
            type: 'button',
            clase: 'btn btn-mini',
            texto: 'Cambiar',
            onclick: () => {
              actual = null;
              alCambiar(null);
              pintar();
              caja.querySelector('input').focus();
            },
          }))
      );
      return;
    }

    const entrada = el('input', { placeholder: 'Escriba el nombre, teléfono o NIF del cliente…', autocomplete: 'off' });
    const lista = el('div', { clase: 'auto-lista oculto' });

    const buscar = debounce(async () => {
      const texto = entrada.value.trim();
      vaciar(lista);
      if (texto.length >= 2) {
        const encontrados = await api.clientes({ q: texto, limite: 8 });
        if (!encontrados.length) {
          lista.append(el('div', { clase: 'sutil', estilo: { padding: '8px 10px' }, texto: 'No hay ningún cliente con esos datos.' }));
        }
        for (const c of encontrados) {
          lista.append(
            el('button', { type: 'button', onclick: () => asignar(c) },
              el('b', { texto: c.nombre }), ' ',
              el('span', { clase: 'sutil', texto: [c.telefono, c.matriculas].filter(Boolean).join(' · ') }))
          );
        }
      }
      lista.append(
        el('button', {
          type: 'button',
          clase: 'accion-alta',
          texto: texto ? `+ Crear cliente nuevo: «${texto}»` : '+ Crear cliente nuevo',
          onclick: () => {
            const previo = /^[\d\s+]+$/.test(texto) ? { telefono: texto } : { nombre: texto };
            formularioCliente(null, asignar, previo, { ofrecerVehiculo: false });
          },
        })
      );
      lista.classList.remove('oculto');
    }, 220);

    entrada.addEventListener('input', buscar);
    entrada.addEventListener('focus', buscar);
    entrada.addEventListener('blur', () => setTimeout(() => lista.classList.add('oculto'), 200));

    caja.append(
      el('div', { clase: 'auto' }, entrada, lista),
      el('div', { clase: 'sutil', estilo: { marginTop: '6px' }, texto: 'Busque al dueño del coche o, si es un cliente nuevo, créelo aquí mismo.' })
    );
  }

  pintar();
  return caja;
}

export function formularioVehiculo(vehiculo, alGuardar, clientePrefijado = null) {
  const inicial = vehiculo?.cliente_id
    ? { id: vehiculo.cliente_id, nombre: vehiculo.cliente_nombre, telefono: vehiculo.cliente_telefono }
    : clientePrefijado;
  let clienteId = inicial?.id || null;

  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    selectorCliente(inicial, (c) => { clienteId = c ? c.id : null; }),
    el('label', {}, 'Matrícula *', el('input', { name: 'matricula', required: true, value: vehiculo?.matricula || '' })),
    el('label', {}, 'Marca', el('input', { name: 'marca', value: vehiculo?.marca || '' })),
    el('label', {}, 'Modelo', el('input', { name: 'modelo', value: vehiculo?.modelo || '' })),
    el('label', {}, 'Año', el('input', { name: 'anio', type: 'number', min: '1950', max: '2100', value: vehiculo?.anio || '' })),
    el('label', {}, 'Combustible',
      el('select', { name: 'combustible' },
        ...['', 'Gasolina', 'Diésel', 'Híbrido', 'Eléctrico', 'GLP', 'GNC'].map((x) =>
          el('option', { value: x, selected: (vehiculo?.combustible || '') === x }, x || '—')))),
    el('label', {}, 'Kilómetros', el('input', { name: 'km', type: 'number', min: '0', value: vehiculo?.km || '' })),
    el('label', {}, 'Bastidor (VIN)', el('input', { name: 'bastidor', value: vehiculo?.bastidor || '' })),
    el('label', {}, 'Próxima ITV', el('input', { name: 'proxima_itv', type: 'date', value: vehiculo?.proxima_itv || '' })),
    el('label', {}, 'Próxima revisión', el('input', { name: 'proxima_revision', type: 'date', value: vehiculo?.proxima_revision || '' })),
    el('label', { clase: 'ancho-total' }, 'Notas', el('textarea', { name: 'notas', rows: '2' }, vehiculo?.notas || ''))
  );

  return modal({
    titulo: vehiculo ? `Editar ${vehiculo.matricula}` : 'Nuevo vehículo',
    cuerpo: form,
    acciones: [
      { texto: 'Cancelar', accion: (c) => c() },
      {
        texto: 'Guardar',
        clase: 'btn-primario',
        accion: async (cerrar) => {
          const d = Object.fromEntries(new FormData(form));
          d.cliente_id = clienteId;
          if (!d.matricula.trim()) return aviso('La matrícula es obligatoria', 'mal');
          if (!clienteId) {
            const seguir = await confirmar('El vehículo no tiene propietario. Sin cliente no se le podrá avisar de citas ni de la ITV.', {
              titulo: 'Vehículo sin propietario',
              textoOk: 'Guardar sin propietario',
              textoCancelar: 'Volver y asignarlo',
              peligro: false,
            });
            if (!seguir) return;
          }
          try {
            const guardado = vehiculo ? await api.guardarVehiculo(vehiculo.id, d) : await api.crearVehiculo(d);
            aviso('Vehículo guardado', 'ok');
            cerrar();
            if (alGuardar) alGuardar(guardado);
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
    ],
  });
}

export async function fichaVehiculo(id, alCambiar) {
  const { vehiculo, citas } = await api.vehiculo(id);
  const dias = vehiculo.proxima_itv ? diasHasta(vehiculo.proxima_itv) : null;
  const reabrir = () => {
    fichaVehiculo(id, alCambiar);
    if (alCambiar) alCambiar();
  };

  const propietario = el('div', {},
    el('div', { clase: 'sutil', texto: 'Propietario' }),
    vehiculo.cliente_id
      ? el('button', {
          clase: 'enlace-ficha',
          texto: vehiculo.cliente_nombre,
          title: 'Abrir la ficha del cliente',
          onclick: () => { ficha.cerrar(); fichaCliente(vehiculo.cliente_id, alCambiar); },
        })
      : puede('gestionar')
        ? el('button', {
            clase: 'btn btn-mini btn-primario',
            texto: '+ Asignar propietario',
            onclick: () => { ficha.cerrar(); formularioVehiculo(vehiculo, reabrir); },
          })
        : el('div', { texto: 'Sin propietario' }));

  const cuerpo = el(
    'div',
    {},
    el('div', { clase: 'rejilla rejilla-3', estilo: { marginBottom: '14px' } },
      campo('Vehículo', [vehiculo.marca, vehiculo.modelo, vehiculo.anio ? `(${vehiculo.anio})` : ''].filter(Boolean).join(' ')),
      propietario,
      campo('Teléfono', vehiculo.cliente_telefono),
      campo('Kilómetros', vehiculo.km ? vehiculo.km.toLocaleString('es-ES') : null),
      campo('Combustible', vehiculo.combustible),
      campo('Bastidor', vehiculo.bastidor),
      campo('Próxima ITV', vehiculo.proxima_itv ? `${fmtFecha(vehiculo.proxima_itv)} (${dias < 0 ? `vencida hace ${-dias} d` : `en ${dias} d`})` : null),
      campo('Próxima revisión', vehiculo.proxima_revision ? fmtFecha(vehiculo.proxima_revision) : null),
      campo('Notas', vehiculo.notas)),
    el('h3', { texto: `Historial (${citas.length} citas)` }),
    citas.length
      ? el('div', { clase: 'tabla-envoltorio', estilo: { maxHeight: '300px' } },
          el('table', {},
            el('thead', {}, el('tr', {},
              el('th', { texto: 'Fecha' }), el('th', { texto: 'Servicio' }),
              el('th', { texto: 'Km' }), el('th', { texto: 'Mecánico' }), el('th', { texto: 'Estado' }))),
            el('tbody', {}, ...citas.map((c) =>
              el('tr', { clase: 'clicable', onclick: () => { ficha.cerrar(); fichaCita(c.id, { alCambiar }); } },
                el('td', {}, fmtFecha(c.fecha), el('div', { clase: 'sutil', texto: c.hora_inicio })),
                el('td', { texto: c.titulo || c.servicio || '' }),
                el('td', { texto: c.km_entrada ? c.km_entrada.toLocaleString('es-ES') : '—' }),
                el('td', { texto: c.mecanico || '—' }),
                el('td', {}, chapaEstado(c.estado, estado.estados)))))))
      : el('p', { clase: 'sutil', texto: 'Este vehículo todavía no tiene citas.' })
  );

  const ficha = modal({
    titulo: vehiculo.matricula,
    ancho: true,
    cuerpo,
    acciones: [
      puede('gestionar') && {
        texto: '+ Cita para este vehículo',
        accion: () => {
          ficha.cerrar();
          formularioCita({ inicial: { vehiculo }, alGuardar: alCambiar });
        },
      },
      { separador: true },
      puede('gestionar') && {
        texto: 'Borrar',
        clase: 'btn-peligro',
        accion: async (cerrar) => {
          if (!(await confirmar(`¿Borrar el vehículo ${vehiculo.matricula}?`))) return;
          try {
            await api.borrarVehiculo(vehiculo.id);
            aviso('Vehículo borrado', 'ok');
            cerrar();
            if (alCambiar) alCambiar();
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
      puede('gestionar') && {
        texto: 'Editar',
        clase: 'btn-primario',
        accion: (cerrar) => { cerrar(); formularioVehiculo(vehiculo, reabrir); },
      },
    ],
  });
  return ficha;
}

function campo(titulo, valor) {
  return el('div', {}, el('div', { clase: 'sutil', texto: titulo }), el('div', { texto: valor || '—' }));
}
