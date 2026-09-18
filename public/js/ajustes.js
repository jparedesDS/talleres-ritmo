// Ajustes: datos del taller, horario, servicios, bahías/mecánicos, avisos y usuarios.
import { api } from './api.js';
import { estado, cargarMaestros, puede, alRefrescar } from './estado.js';
import { el, vaciar, modal, aviso, confirmar } from './util.js';

const DIAS = [
  [1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'],
  [5, 'Viernes'], [6, 'Sábado'], [7, 'Domingo'],
];

export async function vistaAjustes(contenedor) {
  const aj = await api.ajustes();
  const esAdmin = puede('configurar');
  const recargar = () => vistaAjustes(contenedor);

  const secciones = {
    Taller: () => seccionTaller(aj, esAdmin, recargar),
    Horario: () => seccionHorario(aj, esAdmin, recargar),
    Servicios: () => seccionServicios(recargar),
    'Bahías y mecánicos': () => seccionRecursos(recargar),
    Avisos: () => seccionAvisos(aj, esAdmin, recargar),
    Copias: () => seccionCopias(aj, esAdmin, recargar),
    Usuarios: () => seccionUsuarios(esAdmin, recargar),
  };

  let actual = contenedor.dataset.pestana && secciones[contenedor.dataset.pestana] ? contenedor.dataset.pestana : 'Taller';
  const zona = el('div');
  const pestanas = el('div', { clase: 'fila', estilo: { marginBottom: '14px' } });

  const pintar = async () => {
    contenedor.dataset.pestana = actual;
    vaciar(pestanas).append(
      ...Object.keys(secciones).map((nombre) =>
        el('button', {
          clase: `btn btn-mini ${nombre === actual ? 'btn-primario' : ''}`,
          texto: nombre,
          onclick: () => { actual = nombre; pintar(); },
        })
      )
    );
    vaciar(zona).append(await secciones[actual]());
  };

  vaciar(contenedor).append(el('h2', { texto: 'Ajustes' }), pestanas, zona);
  await pintar();
  // Las listas se actualizan solas; los formularios no, para no borrar lo que se está escribiendo
  alRefrescar(async () => {
    if (['Servicios', 'Bahías y mecánicos', 'Usuarios'].includes(actual) && document.body.contains(zona)) await pintar();
  });
}

// --------------------------------------------------------------------------
function guardarAjustes(datos, recargar) {
  return api
    .guardarAjustes(datos)
    .then(async () => {
      await cargarMaestros();
      aviso('Ajustes guardados', 'ok');
      recargar();
    })
    .catch((e) => aviso(e.message, 'mal'));
}

function seccionTaller(aj, esAdmin, recargar) {
  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    el('label', { clase: 'ancho-total' }, 'Nombre del taller', el('input', { name: 'nombre_taller', value: aj.nombre_taller })),
    el('label', {}, 'Teléfono', el('input', { name: 'telefono_taller', value: aj.telefono_taller })),
    el('label', {}, 'Email', el('input', { name: 'email_taller', value: aj.email_taller })),
    el('label', {}, 'Prefijo del país (WhatsApp)', el('input', { name: 'prefijo_pais', value: aj.prefijo_pais })),
    el('label', { clase: 'ancho-total' }, 'Dirección', el('input', { name: 'direccion_taller', value: aj.direccion_taller }))
  );
  return tarjetaFormulario('Datos del taller', form, esAdmin, () =>
    guardarAjustes(Object.fromEntries(new FormData(form)), recargar)
  );
}

function seccionHorario(aj, esAdmin, recargar) {
  const laborables = String(aj.dias_laborables).split(',').map(Number);
  const casillas = DIAS.map(([n, nombre]) =>
    el('label', { estilo: { flexDirection: 'row', alignItems: 'center', gap: '6px' } },
      el('input', { type: 'checkbox', value: n, name: 'dia', checked: laborables.includes(n), estilo: { width: 'auto' } }),
      nombre)
  );

  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    el('label', {}, 'Hora de apertura', el('input', { name: 'hora_apertura', type: 'time', value: aj.hora_apertura })),
    el('label', {}, 'Hora de cierre', el('input', { name: 'hora_cierre', type: 'time', value: aj.hora_cierre })),
    el('label', {}, 'Intervalo de la agenda',
      el('select', { name: 'slot_min' },
        ...[10, 15, 20, 30, 60].map((m) => el('option', { value: m, selected: String(aj.slot_min) === String(m) }, `${m} minutos`)))),
    el('label', { estilo: { flexDirection: 'row', alignItems: 'center', gap: '6px' } },
      el('input', { type: 'checkbox', name: 'usar_pausa', checked: aj.usar_pausa === '1', estilo: { width: 'auto' } }),
      'Cerramos a mediodía'),
    el('label', {}, 'Inicio de la pausa', el('input', { name: 'pausa_inicio', type: 'time', value: aj.pausa_inicio })),
    el('label', {}, 'Fin de la pausa', el('input', { name: 'pausa_fin', type: 'time', value: aj.pausa_fin })),
    el('div', { clase: 'ancho-total' },
      el('div', { clase: 'sutil', estilo: { marginBottom: '6px' } }, 'Días que abre el taller'),
      el('div', { clase: 'fila' }, ...casillas))
  );

  return tarjetaFormulario('Horario del taller', form, esAdmin, () => {
    const d = Object.fromEntries(new FormData(form));
    d.usar_pausa = form.querySelector('[name=usar_pausa]').checked ? '1' : '0';
    d.dias_laborables = [...form.querySelectorAll('[name=dia]:checked')].map((c) => c.value).join(',');
    return guardarAjustes(d, recargar);
  });
}

function seccionAvisos(aj, esAdmin, recargar) {
  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    el('label', { clase: 'ancho-total' }, 'Plantilla del recordatorio',
      el('textarea', { name: 'plantilla_recordatorio', rows: '4' }, aj.plantilla_recordatorio)),
    el('div', { clase: 'ancho-total sutil' },
      'Campos que se sustituyen: {cliente}, {taller}, {fecha}, {hora}, {servicio}, {matricula}, {telefono_taller}'),
    el('label', {}, 'Avisar de la ITV con antelación (días)',
      el('input', { name: 'aviso_itv_dias', type: 'number', min: '1', max: '365', value: aj.aviso_itv_dias }))
  );
  return tarjetaFormulario('Avisos al cliente', form, esAdmin, () =>
    guardarAjustes(Object.fromEntries(new FormData(form)), recargar)
  );
}

function seccionCopias(aj, esAdmin, recargar) {
  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    el('label', { clase: 'ancho-total' },
      'Carpeta de copia externa',
      el('input', {
        name: 'carpeta_copias',
        value: aj.carpeta_copias || '',
        placeholder: 'D:\\copias-taller   o   \\\\RECEPCION2\\copias',
      })),
    el('div', { clase: 'ancho-total sutil' },
      'Cada día se guarda ahí una segunda copia, además de la de este equipo. ',
      'Escriba la ruta completa de un disco USB, de otro ordenador del taller o de una carpeta de OneDrive. ',
      'Déjelo vacío para no hacer copia fuera.')
  );

  const estadoCopia = el('div', { clase: 'ancho-total' }, ...lineasEstadoCopia(aj));

  const probar = el('button', {
    clase: 'btn',
    texto: 'Hacer una copia ahora',
    onclick: async () => {
      probar.disabled = true;
      probar.textContent = 'Copiando…';
      try {
        const r = await api.probarCopia();
        aviso(r.mensaje, 'ok');
        recargar();
      } catch (e) {
        aviso(e.message, 'mal');
      } finally {
        probar.disabled = false;
        probar.textContent = 'Hacer una copia ahora';
      }
    },
  });

  const tarjeta = tarjetaFormulario('Copias de seguridad', form, esAdmin, () =>
    guardarAjustes(Object.fromEntries(new FormData(form)), recargar)
  );
  tarjeta.append(estadoCopia);
  if (esAdmin) tarjeta.append(el('div', { estilo: { marginTop: '10px' } }, probar));
  return tarjeta;
}

/** Resumen legible de cómo va la copia externa. */
function lineasEstadoCopia(aj) {
  const fuera = [];
  const carpeta = String(aj.carpeta_copias || '').trim();
  fuera.push(el('h4', { texto: 'Estado', estilo: { margin: '16px 0 6px' } }));
  fuera.push(el('p', { clase: 'sutil', texto: 'Copia en este equipo: cada día, en la carpeta datos\copias (se guardan 30 días).' }));

  if (!carpeta) {
    fuera.push(el('p', { clase: 'aviso-linea', texto: 'No hay copia fuera de este equipo. Si se estropea este ordenador, se pierden los datos y las copias.' }));
    return fuera;
  }

  const error = String(aj.copia_externa_error || '');
  const ultima = String(aj.copia_externa_ultima || '');
  if (error) {
    fuera.push(el('p', { clase: 'aviso-linea', texto: `No se pudo copiar a "${carpeta}": ${error.split('|').slice(1).join('|')}` }));
  }
  if (ultima) {
    const f = new Date(ultima);
    const dias = Math.floor((Date.now() - f.getTime()) / 86400000);
    fuera.push(el('p', {
      clase: dias > 3 ? 'aviso-linea' : 'sutil',
      texto: `Última copia fuera: ${f.toLocaleString('es-ES')}${dias > 3 ? ` · hace ${dias} días` : ''}`,
    }));
  } else if (!error) {
    fuera.push(el('p', { clase: 'sutil', texto: 'Todavía no se ha hecho ninguna copia fuera. Pulse "Hacer una copia ahora" para comprobar que la carpeta funciona.' }));
  }
  return fuera;
}

function tarjetaFormulario(titulo, form, habilitado, alGuardar) {
  if (!habilitado) [...form.elements].forEach((c) => (c.disabled = true));
  return el(
    'div',
    { clase: 'tarjeta' },
    el('h3', { texto: titulo }),
    form,
    habilitado
      ? el('div', { estilo: { marginTop: '14px' } }, el('button', { clase: 'btn btn-primario', texto: 'Guardar', onclick: alGuardar }))
      : el('p', { clase: 'sutil', texto: 'Solo un administrador puede modificar estos ajustes.' })
  );
}

// --------------------------------------------------------------------------
async function borrarConAviso(pregunta, borrar, recargar) {
  if (!(await confirmar(pregunta))) return;
  try {
    const r = await borrar();
    aviso((r && r.mensaje) || 'Borrado', 'ok');
    await cargarMaestros();
    recargar();
  } catch (e) {
    aviso(e.message, 'mal');
  }
}

async function seccionServicios(recargar) {
  const servicios = await api.servicios({ todos: 1 });
  const editable = puede('configurar');
  const filas = servicios.map((s) =>
    el('tr', {},
      el('td', {}, el('span', { clase: 'chapa', estilo: { background: s.color || '#4e4e4e' }, texto: ' ' }), ' ', s.nombre),
      el('td', { texto: `${s.duracion_min} min` }),
      el('td', { texto: s.precio_orientativo ? `${s.precio_orientativo} €` : '—' }),
      el('td', { texto: s.activo ? 'Sí' : 'No' }),
      editable
        ? el('td', {},
            el('button', { clase: 'btn btn-mini', texto: 'Editar', onclick: () => formServicio(s, recargar) }),
            ' ',
            el('button', {
              clase: 'btn btn-mini btn-peligro',
              texto: 'Borrar',
              onclick: () => borrarConAviso(`¿Borrar el servicio "${s.nombre}"?`, () => api.borrarServicio(s.id), recargar),
            }))
        : null)
  );

  return el(
    'div',
    { clase: 'tarjeta' },
    el('div', { clase: 'fila-entre' },
      el('h3', { texto: 'Servicios y duraciones' }),
      editable
        ? el('button', { clase: 'btn btn-mini btn-primario', texto: '+ Nuevo servicio', onclick: () => formServicio(null, recargar) })
        : null),
    el('p', { clase: 'sutil' }, 'La duración se usa para reservar el hueco en la agenda automáticamente.'),
    el('div', { clase: 'tabla-envoltorio' },
      el('table', {},
        el('thead', {}, el('tr', {},
          el('th', { texto: 'Servicio' }), el('th', { texto: 'Duración' }),
          el('th', { texto: 'Precio orientativo' }), el('th', { texto: 'Activo' }), editable ? el('th', {}) : null)),
        el('tbody', {}, ...filas)))
  );
}

function formServicio(servicio, recargar) {
  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    el('label', { clase: 'ancho-total' }, 'Nombre *', el('input', { name: 'nombre', value: servicio?.nombre || '', required: true, maxlength: '120' })),
    el('label', {}, 'Duración (min)', el('input', { name: 'duracion_min', type: 'number', min: '5', max: '1440', step: '5', value: servicio?.duracion_min || 60 })),
    el('label', {}, 'Precio orientativo (€)', el('input', { name: 'precio_orientativo', type: 'number', min: '0', step: '0.01', value: servicio?.precio_orientativo ?? '' })),
    el('label', {}, 'Color', el('input', { name: 'color', type: 'color', value: servicio?.color || '#4e4e4e' })),
    el('label', { estilo: { flexDirection: 'row', alignItems: 'center', gap: '6px' } },
      el('input', { type: 'checkbox', name: 'activo', checked: servicio ? !!servicio.activo : true, estilo: { width: 'auto' } }), 'Activo')
  );

  modal({
    titulo: servicio ? 'Editar servicio' : 'Nuevo servicio',
    cuerpo: form,
    acciones: [
      { texto: 'Cancelar', accion: (c) => c() },
      {
        texto: 'Guardar',
        clase: 'btn-primario',
        accion: async (cerrar) => {
          const d = Object.fromEntries(new FormData(form));
          d.activo = form.querySelector('[name=activo]').checked;
          try {
            if (servicio) await api.guardarServicio(servicio.id, d);
            else await api.crearServicio(d);
            await cargarMaestros();
            aviso('Servicio guardado', 'ok');
            cerrar();
            recargar();
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
    ],
  });
}

// --------------------------------------------------------------------------
async function seccionRecursos(recargar) {
  const recursos = await api.recursos({ todos: 1 });
  const editable = puede('configurar');
  const bloque = (tipo, titulo, descripcion) => {
    const lista = recursos.filter((r) => r.tipo === tipo);
    return el(
      'div',
      { clase: 'tarjeta' },
      el('div', { clase: 'fila-entre' },
        el('h3', { texto: titulo }),
        editable
          ? el('button', { clase: 'btn btn-mini btn-primario', texto: '+ Añadir', onclick: () => formRecurso(null, tipo, recargar) })
          : null),
      el('p', { clase: 'sutil', texto: descripcion }),
      lista.length
        ? el('div', { clase: 'tabla-envoltorio' },
            el('table', {},
              el('tbody', {}, ...lista.map((r) =>
                el('tr', {},
                  el('td', {}, el('span', { clase: 'chapa', estilo: { background: r.color || '#4e4e4e' }, texto: ' ' }), ' ', r.nombre),
                  el('td', { texto: r.activo ? 'Activo' : 'Inactivo' }),
                  editable
                    ? el('td', {},
                        el('button', { clase: 'btn btn-mini', texto: 'Editar', onclick: () => formRecurso(r, tipo, recargar) }),
                        ' ',
                        el('button', {
                          clase: 'btn btn-mini btn-peligro',
                          texto: 'Borrar',
                          onclick: () => borrarConAviso(`¿Borrar "${r.nombre}"?`, () => api.borrarRecurso(r.id), recargar),
                        }))
                    : null)))))
        : el('p', { clase: 'sutil', texto: 'Nada dado de alta todavía.' })
    );
  };

  return el(
    'div',
    { clase: 'rejilla rejilla-2' },
    bloque('bahia', 'Bahías / puestos de trabajo', 'Cada bahía es una columna de la agenda diaria.'),
    bloque('mecanico', 'Mecánicos', 'Se pueden asignar a cada cita; el programa avisa si se solapan.')
  );
}

function formRecurso(recurso, tipo, recargar) {
  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    el('label', { clase: 'ancho-total' }, 'Nombre *', el('input', { name: 'nombre', value: recurso?.nombre || '', required: true, maxlength: '80' })),
    el('label', {}, 'Color', el('input', { name: 'color', type: 'color', value: recurso?.color || '#4e4e4e' })),
    el('label', {}, 'Orden', el('input', { name: 'orden', type: 'number', min: '0', max: '999', value: recurso?.orden ?? 0 })),
    el('label', { estilo: { flexDirection: 'row', alignItems: 'center', gap: '6px' } },
      el('input', { type: 'checkbox', name: 'activo', checked: recurso ? !!recurso.activo : true, estilo: { width: 'auto' } }), 'Activo')
  );

  modal({
    titulo: recurso ? 'Editar' : tipo === 'bahia' ? 'Nueva bahía' : 'Nuevo mecánico',
    cuerpo: form,
    acciones: [
      { texto: 'Cancelar', accion: (c) => c() },
      {
        texto: 'Guardar',
        clase: 'btn-primario',
        accion: async (cerrar) => {
          const d = Object.fromEntries(new FormData(form));
          d.activo = form.querySelector('[name=activo]').checked;
          d.tipo = tipo;
          try {
            if (recurso) await api.guardarRecurso(recurso.id, d);
            else await api.crearRecurso(d);
            await cargarMaestros();
            aviso('Guardado', 'ok');
            cerrar();
            recargar();
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
    ],
  });
}

// --------------------------------------------------------------------------
const NOMBRES_ROL = { admin: 'Administrador', recepcion: 'Recepción', mecanico: 'Mecánico' };

async function seccionUsuarios(esAdmin, recargar) {
  const miClave = el(
    'div',
    { clase: 'tarjeta', estilo: { marginBottom: '14px' } },
    el('h3', { texto: 'Mi contraseña' }),
    el('p', { clase: 'sutil', texto: `Ha entrado como ${estado.usuario.nombre} (${NOMBRES_ROL[estado.usuario.rol] || estado.usuario.rol}).` }),
    el('button', {
      clase: 'btn btn-primario',
      texto: 'Cambiar mi contraseña',
      onclick: () => formularioClave({ usuarioId: estado.usuario.id, propio: true }),
    })
  );
  if (!esAdmin) return miClave;

  const usuarios = await api.usuarios();

  const borrar = async (u) => {
    if (!(await confirmar(`¿Borrar el usuario ${u.usuario}?`))) return;
    try {
      await api.borrarUsuario(u.id);
      aviso('Usuario borrado', 'ok');
      recargar();
    } catch (e) {
      aviso(e.message, 'mal');
    }
  };

  const filas = usuarios.map((u) => {
    const esYo = u.id === estado.usuario.id;
    return el(
      'tr',
      {},
      el('td', {}, u.usuario, esYo ? el('span', { clase: 'sutil', texto: ' (usted)' }) : null),
      el('td', { texto: u.nombre }),
      el('td', { texto: NOMBRES_ROL[u.rol] || u.rol }),
      el('td', {},
        u.activo ? 'Activo' : el('span', { clase: 'chapa', estilo: { background: 'var(--texto-sutil)' }, texto: 'Inactivo' }),
        u.debe_cambiar_clave ? el('div', { clase: 'sutil', texto: 'Contraseña provisional' }) : null),
      el('td', {},
        el('button', { clase: 'btn btn-mini', texto: 'Editar', onclick: () => formUsuario(u, recargar) }),
        ' ',
        el('button', {
          clase: 'btn btn-mini',
          texto: 'Contraseña',
          onclick: () => formularioClave({ usuarioId: u.id, propio: esYo, nombre: u.usuario, alTerminar: recargar }),
        }),
        ' ',
        esYo ? null : el('button', { clase: 'btn btn-mini btn-peligro', texto: 'Borrar', onclick: () => borrar(u) }))
    );
  });

  return el(
    'div',
    {},
    miClave,
    el(
      'div',
      { clase: 'tarjeta' },
      el('div', { clase: 'fila-entre' },
        el('h3', { texto: 'Usuarios del taller' }),
        el('button', { clase: 'btn btn-mini btn-primario', texto: '+ Nuevo usuario', onclick: () => formUsuario(null, recargar) })),
      el('p', {
        clase: 'sutil',
        texto: 'Administrador: todo. Recepción: citas, clientes y vehículos. Mecánico: consulta y cambia el estado de las citas.',
      }),
      el('div', { clase: 'tabla-envoltorio' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', { texto: 'Usuario' }), el('th', { texto: 'Nombre' }), el('th', { texto: 'Rol' }),
            el('th', { texto: 'Estado' }), el('th', {}))),
          el('tbody', {}, ...filas))))
  );
}

function formUsuario(usuario, recargar) {
  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    el('label', {}, 'Usuario *',
      el('input', { name: 'usuario', value: usuario?.usuario || '', required: true, disabled: !!usuario, maxlength: '40', autocomplete: 'off' })),
    el('label', {}, 'Nombre *', el('input', { name: 'nombre', value: usuario?.nombre || '', required: true, maxlength: '80' })),
    el('label', {}, 'Rol',
      el('select', { name: 'rol' },
        ...Object.entries(NOMBRES_ROL).map(([v, t]) =>
          el('option', { value: v, selected: (usuario?.rol || 'recepcion') === v }, t)))),
    usuario
      ? null
      : el('label', {}, 'Contraseña provisional *',
          el('input', { name: 'clave', type: 'password', required: true, minlength: '8', autocomplete: 'new-password' })),
    el('label', { estilo: { flexDirection: 'row', alignItems: 'center', gap: '6px' } },
      el('input', { type: 'checkbox', name: 'activo', checked: usuario ? !!usuario.activo : true, estilo: { width: 'auto' } }), 'Activo'),
    usuario
      ? null
      : el('p', {
          clase: 'sutil ancho-total',
          texto: 'Mínimo 8 caracteres. La persona tendrá que cambiarla por una suya la primera vez que entre.',
        })
  );

  modal({
    titulo: usuario ? `Editar ${usuario.usuario}` : 'Nuevo usuario',
    cuerpo: form,
    acciones: [
      { texto: 'Cancelar', accion: (c) => c() },
      {
        texto: 'Guardar',
        clase: 'btn-primario',
        accion: async (cerrar) => {
          const d = Object.fromEntries(new FormData(form));
          d.activo = form.querySelector('[name=activo]').checked;
          try {
            if (usuario) await api.guardarUsuario(usuario.id, d);
            else await api.crearUsuario(d);
            aviso('Usuario guardado', 'ok');
            cerrar();
            recargar();
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
    ],
  });
}

/**
 * Formulario de contraseña.
 *  - propio: pide la actual y deja la sesión abierta.
 *  - de otro usuario (administrador): pone una provisional que habrá que cambiar.
 *  - obligatorio: no se puede cerrar (primer acceso con contraseña provisional).
 */
export function formularioClave({ usuarioId, propio = true, nombre = '', obligatorio = false, alTerminar } = {}) {
  const form = el(
    'form',
    { clase: 'formulario', onsubmit: (e) => e.preventDefault() },
    obligatorio
      ? el('p', {
          clase: 'ancho-total',
          texto: 'Está usando una contraseña provisional. Para seguir, elija una contraseña propia que solo conozca usted.',
        })
      : null,
    propio
      ? el('label', { clase: 'ancho-total' }, 'Contraseña actual',
          el('input', { name: 'clave_actual', type: 'password', required: true, autocomplete: 'current-password' }))
      : el('p', {
          clase: 'sutil ancho-total',
          texto: `Contraseña provisional para ${nombre}. Tendrá que cambiarla al entrar y se le cerrarán las sesiones abiertas.`,
        }),
    el('label', { clase: 'ancho-total' }, 'Contraseña nueva',
      el('input', { name: 'clave', type: 'password', required: true, minlength: '8', autocomplete: 'new-password' })),
    el('label', { clase: 'ancho-total' }, 'Repetir contraseña nueva',
      el('input', { name: 'clave2', type: 'password', required: true, minlength: '8', autocomplete: 'new-password' })),
    el('p', { clase: 'sutil ancho-total', texto: 'Mínimo 8 caracteres. Evite nombres, fechas o "12345678".' })
  );

  const ventana = modal({
    titulo: obligatorio ? 'Cambie su contraseña' : 'Cambiar contraseña',
    cuerpo: form,
    obligatorio,
    acciones: [
      obligatorio ? null : { texto: 'Cancelar', accion: (c) => c() },
      {
        texto: 'Guardar contraseña',
        clase: 'btn-primario',
        accion: async (cerrar) => {
          const d = Object.fromEntries(new FormData(form));
          if (d.clave.length < 8) return aviso('La contraseña nueva debe tener al menos 8 caracteres', 'mal');
          if (d.clave !== d.clave2) return aviso('Las dos contraseñas nuevas no coinciden', 'mal');
          try {
            const datos = { clave: d.clave };
            if (propio) datos.clave_actual = d.clave_actual;
            await api.guardarUsuario(usuarioId, datos);
            aviso(propio ? 'Contraseña cambiada' : 'Contraseña provisional guardada', 'ok');
            cerrar();
            if (alTerminar) alTerminar();
          } catch (e) {
            aviso(e.message, 'mal');
          }
        },
      },
    ],
  });
  // Enter en el último campo guarda
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ventana.nodo.querySelector('footer .btn-primario').click();
    }
  });
  return ventana;
}
