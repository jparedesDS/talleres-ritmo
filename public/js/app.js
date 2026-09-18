// Arranque de la aplicación: acceso, menú, buscador global, navegación y
// actualización en directo de las pantallas.
import { api } from './api.js';
import { estado, cargarMaestros, puede, alRefrescar, refrescarVista } from './estado.js';
import { el, $, $$, vaciar, aviso, debounce, hayModalAbierto, cerrarModales } from './util.js';
import { vistaPanel } from './panel.js';
import { vistaAgenda } from './agenda.js';
import { vistaCitas, vistaClientes, vistaVehiculos, fichaCliente, fichaVehiculo } from './listados.js';
import { vistaInformes } from './informes.js';
import { vistaAjustes, formularioClave } from './ajustes.js';
import { formularioCita, fichaCita } from './citas.js';

const VISTAS = {
  panel: vistaPanel,
  agenda: vistaAgenda,
  citas: vistaCitas,
  clientes: vistaClientes,
  vehiculos: vistaVehiculos,
  informes: vistaInformes,
  ajustes: vistaAjustes,
};

const NOMBRES_ROL = { admin: 'Administrador', recepcion: 'Recepción', mecanico: 'Mecánico' };

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
async function arrancar() {
  const sesion = await api.sesion();
  estado.estados = sesion.estados;
  estado.estadosTaller = sesion.estados_taller || [];
  estado.version = sesion.version;
  if (sesion.taller) {
    $('#login-logo').alt = sesion.taller;
    document.title = `Citas · ${sesion.taller}`;
  }
  if (!sesion.usuario) return mostrarLogin();
  estado.usuario = sesion.usuario;
  await mostrarApp();
}

function mostrarLogin() {
  $('#cargando').classList.add('oculto');
  $('#app').classList.add('oculto');
  $('#login').classList.remove('oculto');
  $('#form-login [name=usuario]').focus();
}

async function mostrarApp() {
  $('#cargando').classList.add('oculto');
  $('#login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  pintarUsuario();

  if (estado.usuario.debe_cambiar_clave) {
    pedirCambioClave();
    return;
  }
  await empezarATrabajar();
}

async function empezarATrabajar() {
  await cargarMaestros();
  await navegar();
  conectarEventos();
}

function pintarUsuario() {
  const u = estado.usuario;
  $('#usuario-actual').textContent = `${u.nombre} · ${NOMBRES_ROL[u.rol] || u.rol}`;
  $('#btn-nueva-cita').classList.toggle('oculto', !puede('gestionar'));
}

let pidiendoClave = false;
function pedirCambioClave() {
  if (pidiendoClave || !estado.usuario) return;
  pidiendoClave = true;
  vaciar($('#vista'));
  formularioClave({
    usuarioId: estado.usuario.id,
    propio: true,
    obligatorio: true,
    alTerminar: async () => {
      pidiendoClave = false;
      estado.usuario.debe_cambiar_clave = false;
      await empezarATrabajar();
    },
  });
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formulario = e.target;
  const datos = Object.fromEntries(new FormData(formulario));
  const error = $('#login-error');
  const boton = formulario.querySelector('button[type=submit]');
  error.classList.add('oculto');
  boton.disabled = true;
  try {
    const r = await api.entrar(datos.usuario, datos.clave);
    formulario.reset();
    estado.usuario = r.usuario;
    await mostrarApp();
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove('oculto');
    formulario.querySelector('[name=clave]').select();
  } finally {
    boton.disabled = false;
  }
});

$('#btn-salir').addEventListener('click', async () => {
  desconectarEventos();
  try {
    await api.salir();
  } finally {
    window.location.reload();
  }
});

let avisadoCaducada = false;
document.addEventListener('sesion-caducada', () => {
  if (avisadoCaducada || !estado.usuario) return;
  avisadoCaducada = true;
  desconectarEventos();
  cerrarModales();
  aviso('La sesión ha caducado o se ha cerrado. Vuelva a entrar.', 'mal');
  setTimeout(() => window.location.reload(), 1800);
});

document.addEventListener('cambiar-clave', () => {
  if (!estado.usuario) return;
  estado.usuario.debe_cambiar_clave = true;
  desconectarEventos();
  cerrarModales();
  pedirCambioClave();
});

// Cualquier error no controlado se enseña en pantalla en vez de perderse
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  if (err && err.codigo === 401) return; // ya se avisa de la sesión caducada
  aviso((err && err.message) || 'Ha ocurrido un error inesperado', 'mal');
});

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------
async function navegar() {
  if (!estado.usuario || estado.usuario.debe_cambiar_clave) return;
  const ruta = (window.location.hash.replace('#/', '') || 'panel').split('?')[0];
  const vista = Object.hasOwn(VISTAS, ruta) ? ruta : 'panel';
  $$('#menu a').forEach((a) => a.classList.toggle('activo', a.dataset.vista === vista));
  $('.lateral').classList.remove('abierto');
  const contenedor = $('#vista');
  if (contenedor.dataset.vista !== vista) {
    delete contenedor.dataset.pestana;
    vaciar(contenedor);
  }
  contenedor.dataset.vista = vista;
  alRefrescar(null); // la vista anterior deja de recibir refrescos
  try {
    await VISTAS[vista](contenedor);
  } catch (e) {
    vaciar(contenedor).append(el('p', { clase: 'error', texto: e.message }));
  }
}

window.addEventListener('hashchange', navegar);

// Pinchar en el menú la sección en la que ya se está también la recarga
$('#menu').addEventListener('click', (e) => {
  const enlace = e.target.closest('a');
  if (enlace && enlace.getAttribute('href') === window.location.hash) navegar();
});

$('#btn-nueva-cita').addEventListener('click', () => formularioCita());

$('#btn-menu').addEventListener('click', () => $('.lateral').classList.toggle('abierto'));

// ---------------------------------------------------------------------------
// Actualización en directo
// ---------------------------------------------------------------------------
// El servidor avisa de cada cambio. La pantalla abierta recarga sus datos
// (sin perder búsquedas, filtros ni la fecha de la agenda), en este equipo y
// en todos los del taller.
let fuente = null;
let huboCorte = false;
let temporizadorRefresco = null;
let maestrosPendientes = false;
let usuariosPendiente = false;

function marcarConexion(conectado) {
  const indicador = $('#conexion');
  indicador.classList.toggle('desconectado', !conectado);
  indicador.lastChild.textContent = conectado ? ' En directo' : ' Sin conexión con el servidor';
  indicador.title = conectado
    ? 'Los cambios hechos en cualquier equipo del taller aparecen al momento'
    : 'Se reintenta solo. Si dura, compruebe que el programa sigue abierto en el equipo principal';
}

function programarRefresco(recurso) {
  if (['servicios', 'recursos', 'ajustes'].includes(recurso)) maestrosPendientes = true;
  if (recurso === 'usuarios') usuariosPendiente = true;
  clearTimeout(temporizadorRefresco);
  temporizadorRefresco = setTimeout(ejecutarRefresco, 250);
}

async function ejecutarRefresco() {
  if (!estado.usuario || estado.usuario.debe_cambiar_clave) return;
  // No interrumpir a quien está arrastrando una cita
  if (document.querySelector('.cita.arrastrando')) {
    temporizadorRefresco = setTimeout(ejecutarRefresco, 600);
    return;
  }
  try {
    if (usuariosPendiente) {
      usuariosPendiente = false;
      const sesion = await api.sesion();
      if (!sesion.usuario) return document.dispatchEvent(new CustomEvent('sesion-caducada'));
      if (sesion.usuario.rol !== estado.usuario.rol) {
        aviso('Han cambiado los permisos de su usuario. Se recarga la pantalla.', 'avisa');
        setTimeout(() => window.location.reload(), 1500);
        return;
      }
      estado.usuario = sesion.usuario;
      pintarUsuario();
    }
    if (maestrosPendientes) {
      maestrosPendientes = false;
      await cargarMaestros();
    }
    await refrescarVista();
  } catch (e) {
    if (e.codigo !== 401) console.warn('No se pudo actualizar la pantalla:', e.message);
  }
}

function conectarEventos() {
  desconectarEventos();
  fuente = new EventSource('/api/eventos');
  fuente.addEventListener('open', () => {
    marcarConexion(true);
    if (huboCorte) {
      huboCorte = false;
      comprobarVersion();
      // Mientras estuvo cortado pudo cambiar cualquier cosa
      maestrosPendientes = true;
      usuariosPendiente = true;
      programarRefresco('reconexion');
    }
  });
  fuente.addEventListener('cambio', (ev) => {
    let datos = {};
    try {
      datos = JSON.parse(ev.data);
    } catch {
      /* aviso ilegible: se refresca igualmente */
    }
    programarRefresco(datos.recurso);
  });
  fuente.addEventListener('error', () => {
    marcarConexion(false);
    huboCorte = true;
    // Si el servidor la ha cerrado del todo (sesión caducada), comprobar y reconectar
    if (fuente && fuente.readyState === EventSource.CLOSED) {
      setTimeout(async () => {
        try {
          const sesion = await api.sesion();
          if (!sesion.usuario) document.dispatchEvent(new CustomEvent('sesion-caducada'));
          else if (estado.usuario && !estado.usuario.debe_cambiar_clave) conectarEventos();
        } catch {
          setTimeout(conectarEventos, 5000);
        }
      }, 2000);
    }
  });
}

/** Si el programa se ha actualizado mientras la pantalla estaba abierta, recargarla. */
async function comprobarVersion() {
  try {
    const sesion = await api.sesion();
    if (!sesion.version || !estado.version || sesion.version === estado.version) return;
    if (hayModalAbierto()) {
      aviso('Se ha actualizado el programa. Termine lo que está haciendo y pulse F5.', 'avisa');
      return;
    }
    aviso('Se ha actualizado el programa. Recargando…', 'avisa');
    setTimeout(() => window.location.reload(), 1200);
  } catch {
    /* sin conexión: se comprobará en la próxima reconexión */
  }
}

function desconectarEventos() {
  if (fuente) {
    fuente.close();
    fuente = null;
  }
}

// Al volver a la pestaña (o despertar el equipo) se ponen los datos al día
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && estado.usuario) programarRefresco('visible');
});

// ---------------------------------------------------------------------------
// Buscador global
// ---------------------------------------------------------------------------
const caja = $('#buscador');
const panelResultados = $('#resultados-busqueda');

function resultado(principal, secundario, alPulsar) {
  return el('button', { type: 'button', onclick: alPulsar },
    el('b', { texto: principal }),
    secundario ? el('span', { clase: 'sutil', texto: ` ${secundario}` }) : null);
}

const buscar = debounce(async () => {
  const q = caja.value.trim();
  if (q.length < 2) return panelResultados.classList.add('oculto');
  try {
    const r = await api.buscar(q);
    if (caja.value.trim() !== q) return; // llegó tarde: ya se ha escrito otra cosa
    vaciar(panelResultados);
    const abrir = (fn) => {
      panelResultados.classList.add('oculto');
      caja.value = '';
      fn();
    };
    if (r.vehiculos.length) {
      panelResultados.append(el('div', { clase: 'grupo', texto: 'Vehículos' }));
      r.vehiculos.forEach((v) =>
        panelResultados.append(resultado(
          v.matricula,
          `${[v.marca, v.modelo].filter(Boolean).join(' ')} · ${v.cliente_nombre || 'sin propietario'}`,
          () => abrir(() => fichaVehiculo(v.id))
        ))
      );
    }
    if (r.clientes.length) {
      panelResultados.append(el('div', { clase: 'grupo', texto: 'Clientes' }));
      r.clientes.forEach((c) =>
        panelResultados.append(resultado(c.nombre, c.telefono || '', () => abrir(() => fichaCliente(c.id))))
      );
    }
    if (r.citas.length) {
      panelResultados.append(el('div', { clase: 'grupo', texto: 'Citas' }));
      r.citas.forEach((c) =>
        panelResultados.append(resultado(
          `${c.fecha.split('-').reverse().join('/')} ${c.hora_inicio} · ${c.matricula || ''}`,
          c.titulo || '',
          () => abrir(() => fichaCita(c.id))
        ))
      );
    }
    if (!r.vehiculos.length && !r.clientes.length && !r.citas.length) {
      panelResultados.append(el('div', { clase: 'grupo', texto: 'Sin resultados' }));
    }
    panelResultados.classList.remove('oculto');
  } catch {
    panelResultados.classList.add('oculto');
  }
}, 250);

caja.addEventListener('input', buscar);
caja.addEventListener('blur', () => setTimeout(() => panelResultados.classList.add('oculto'), 200));
caja.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    caja.value = '';
    panelResultados.classList.add('oculto');
  }
});

// Atajos: "/" enfoca el buscador, Alt+N crea una cita.
document.addEventListener('keydown', (e) => {
  if (!estado.usuario || estado.usuario.debe_cambiar_clave || hayModalAbierto()) return;
  const escribiendo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (e.key === '/' && !escribiendo) {
    e.preventDefault();
    caja.focus();
  }
  if (e.altKey && e.key.toLowerCase() === 'n' && puede('gestionar')) {
    e.preventDefault();
    formularioCita();
  }
});

arrancar().catch((e) => {
  $('#cargando').textContent = `No se pudo conectar con el servidor: ${e.message}`;
});
