// Acciones compartidas por varias pantallas.
import { api, ErrorApi } from './api.js';
import { confirmar } from './util.js';

/**
 * Crea o guarda un cliente. Si el servidor avisa de que ya hay otro con el
 * mismo teléfono o NIF, pregunta antes de seguir. Devuelve null si se cancela.
 */
export async function guardarClienteComprobando(id, datos) {
  const enviar = (extra = {}) => (id ? api.guardarCliente(id, { ...datos, ...extra }) : api.crearCliente({ ...datos, ...extra }));
  try {
    return await enviar();
  } catch (e) {
    if (!(e instanceof ErrorApi) || e.codigo !== 409 || !e.datos.duplicados) throw e;
    const lista = e.datos.duplicados
      .map((d) => `· ${d.nombre}${d.telefono ? ` · ${d.telefono}` : ''}${d.nif ? ` · ${d.nif}` : ''}`)
      .join('\n');
    const seguir = await confirmar(
      `Ya hay un cliente con ese teléfono o NIF:\n\n${lista}\n\nSi es la misma persona, use su ficha en vez de crear otra. ¿Guardar igualmente?`,
      { titulo: 'Posible cliente repetido', textoOk: 'Guardar igualmente', textoCancelar: 'Volver', peligro: false }
    );
    return seguir ? enviar({ forzar: true }) : null;
  }
}

/** Kilómetros pedidos al recepcionar: número entero positivo o vacío. */
export function leerKm(texto) {
  const limpio = String(texto ?? '').replace(/[.\s]/g, '');
  if (!limpio) return { ok: true, km: undefined };
  if (!/^\d{1,7}$/.test(limpio)) return { ok: false };
  return { ok: true, km: Number(limpio) };
}
