// Cliente HTTP contra la API del servidor.

export class ErrorApi extends Error {
  constructor(mensaje, codigo, datos) {
    super(mensaje);
    this.codigo = codigo;
    this.datos = datos || {};
  }
}

async function peticion(metodo, ruta, cuerpo) {
  // X-Taller identifica las peticiones hechas desde la propia aplicación:
  // el servidor rechaza escrituras que no la lleven (protección CSRF).
  const opciones = { method: metodo, headers: { 'X-Taller': '1' }, credentials: 'same-origin', cache: 'no-store' };
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  let res;
  try {
    res = await fetch(ruta, opciones);
  } catch {
    throw new ErrorApi('No hay conexión con el servidor del taller. Compruebe que el programa sigue abierto.', 0);
  }

  let datos = null;
  try {
    datos = await res.json();
  } catch {
    datos = null;
  }
  if (!res.ok) {
    if (res.status === 401 && !ruta.endsWith('/api/login')) {
      document.dispatchEvent(new CustomEvent('sesion-caducada'));
    }
    if (res.status === 403 && datos && datos.cambiar_clave) {
      document.dispatchEvent(new CustomEvent('cambiar-clave'));
    }
    throw new ErrorApi((datos && datos.error) || `Error ${res.status}`, res.status, datos);
  }
  return datos;
}

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // sesión
  sesion: () => peticion('GET', '/api/sesion'),
  entrar: (usuario, clave) => peticion('POST', '/api/login', { usuario, clave }),
  salir: () => peticion('POST', '/api/logout', {}),

  // citas y agenda
  agenda: (fecha) => peticion('GET', `/api/agenda${qs({ fecha })}`),
  semana: (desde) => peticion('GET', `/api/agenda/semana${qs({ desde })}`),
  citas: (filtros) => peticion('GET', `/api/citas${qs(filtros)}`),
  cita: (id) => peticion('GET', `/api/citas/${id}`),
  crearCita: (datos) => peticion('POST', '/api/citas', datos),
  guardarCita: (id, datos) => peticion('PUT', `/api/citas/${id}`, datos),
  moverCita: (id, datos) => peticion('PATCH', `/api/citas/${id}/mover`, datos),
  estadoCita: (id, datos) => peticion('PATCH', `/api/citas/${id}/estado`, datos),
  borrarCita: (id) => peticion('DELETE', `/api/citas/${id}`),
  avisoCita: (id) => peticion('POST', `/api/citas/${id}/aviso`, {}),
  disponibilidad: (filtros) => peticion('GET', `/api/disponibilidad${qs(filtros)}`),

  // datos maestros
  clientes: (filtros) => peticion('GET', `/api/clientes${qs(filtros)}`),
  cliente: (id) => peticion('GET', `/api/clientes/${id}`),
  crearCliente: (d) => peticion('POST', '/api/clientes', d),
  guardarCliente: (id, d) => peticion('PUT', `/api/clientes/${id}`, d),
  borrarCliente: (id) => peticion('DELETE', `/api/clientes/${id}`),

  vehiculos: (filtros) => peticion('GET', `/api/vehiculos${qs(filtros)}`),
  vehiculo: (id) => peticion('GET', `/api/vehiculos/${id}`),
  crearVehiculo: (d) => peticion('POST', '/api/vehiculos', d),
  guardarVehiculo: (id, d) => peticion('PUT', `/api/vehiculos/${id}`, d),
  borrarVehiculo: (id) => peticion('DELETE', `/api/vehiculos/${id}`),

  recursos: (filtros) => peticion('GET', `/api/recursos${qs(filtros)}`),
  crearRecurso: (d) => peticion('POST', '/api/recursos', d),
  guardarRecurso: (id, d) => peticion('PUT', `/api/recursos/${id}`, d),
  borrarRecurso: (id) => peticion('DELETE', `/api/recursos/${id}`),

  servicios: (filtros) => peticion('GET', `/api/servicios${qs(filtros)}`),
  crearServicio: (d) => peticion('POST', '/api/servicios', d),
  guardarServicio: (id, d) => peticion('PUT', `/api/servicios/${id}`, d),
  borrarServicio: (id) => peticion('DELETE', `/api/servicios/${id}`),

  ajustes: () => peticion('GET', '/api/ajustes'),
  probarCopia: () => peticion('POST', '/api/copias/probar'),
  guardarAjustes: (d) => peticion('PUT', '/api/ajustes', d),

  usuarios: () => peticion('GET', '/api/usuarios'),
  crearUsuario: (d) => peticion('POST', '/api/usuarios', d),
  guardarUsuario: (id, d) => peticion('PUT', `/api/usuarios/${id}`, d),
  borrarUsuario: (id) => peticion('DELETE', `/api/usuarios/${id}`),

  panel: () => peticion('GET', '/api/panel'),
  informes: (filtros) => peticion('GET', `/api/informes${qs(filtros)}`),
  buscar: (q) => peticion('GET', `/api/buscar${qs({ q })}`),
};
