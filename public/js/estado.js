// Estado compartido por toda la aplicación (datos que casi no cambian).
import { api } from './api.js';

export const estado = {
  usuario: null,
  estados: {},
  estadosTaller: [],
  version: null,
  ajustes: {},
  servicios: [],
  bahias: [],
  mecanicos: [],
};

/**
 * ¿Puede el usuario actual hacer esto? (ver, estado, gestionar, configurar)
 * Solo sirve para no enseñar botones inútiles: quien decide es el servidor.
 */
export const puede = (permiso) => !!estado.usuario && (estado.usuario.permisos || []).includes(permiso);

export async function cargarMaestros() {
  const [ajustes, servicios, recursos] = await Promise.all([
    api.ajustes(),
    api.servicios(),
    api.recursos({}),
  ]);
  estado.ajustes = ajustes;
  estado.servicios = servicios;
  estado.bahias = recursos.filter((r) => r.tipo === 'bahia');
  estado.mecanicos = recursos.filter((r) => r.tipo === 'mecanico');
  const logo = document.getElementById('marca-logo');
  if (logo) logo.alt = ajustes.nombre_taller || 'Taller';
  document.title = `Citas · ${ajustes.nombre_taller || 'Taller'}`;
}

export const nombreServicio = (id) => (estado.servicios.find((s) => s.id === id) || {}).nombre || '';
export const colorServicio = (id) => (estado.servicios.find((s) => s.id === id) || {}).color || '#4e4e4e';

// ---------------------------------------------------------------------------
// Refresco de la pantalla actual
// ---------------------------------------------------------------------------
// Cada vista registra aquí cómo recargar SUS DATOS sin perder lo que el usuario
// tiene escrito (búsquedas, filtros, fecha de la agenda). La aplicación lo
// llama cuando llega un cambio del servidor, venga de este equipo o de otro.
let refrescoVista = null;
let refrescando = null;
let repetir = false;

export function alRefrescar(fn) {
  refrescoVista = fn;
}

export async function refrescarVista() {
  if (!refrescoVista) return;
  if (refrescando) {
    repetir = true;
    return refrescando;
  }
  const vista = document.getElementById('vista');
  const desplazables = () => [vista, ...vista.querySelectorAll('.agenda, .tabla-envoltorio')];
  const posiciones = desplazables().map((n) => [n.scrollTop, n.scrollLeft]);
  const fn = refrescoVista;
  refrescando = (async () => {
    try {
      await fn();
    } finally {
      desplazables().forEach((n, i) => {
        if (posiciones[i]) [n.scrollTop, n.scrollLeft] = posiciones[i];
      });
      refrescando = null;
    }
  })();
  await refrescando;
  if (repetir) {
    repetir = false;
    await refrescarVista();
  }
}
