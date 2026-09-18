// Informes: ocupación, estados, servicios más pedidos y tasa de ausencias.
import { api } from './api.js';
import { alRefrescar, estado } from './estado.js';
import { colorEstado, colorLibre } from './tema.js';
import { el, vaciar, hoyISO, sumarDias, fmtFecha, duracionTexto, aviso } from './util.js';

export async function vistaInformes(contenedor) {
  const filtros = { desde: sumarDias(hoyISO(), -30), hasta: hoyISO() };
  const zona = el('div');
  const campoDesde = el('input', { type: 'date', value: filtros.desde });
  const campoHasta = el('input', { type: 'date', value: filtros.hasta });

  const recargar = async () => {
    if (!zona.firstChild) zona.append(el('p', { clase: 'sutil', texto: 'Calculando…' }));
    const d = await api.informes(filtros);
    const hechas = d.porEstado.find((e) => e.estado === 'entregada')?.n || 0;

    vaciar(zona).append(
      el('div', { clase: 'rejilla rejilla-4', estilo: { marginBottom: '16px' } },
        kpi('Citas en el periodo', d.total),
        kpi('Entregadas', hechas),
        kpi('Tasa de ausencias', `${d.tasa_no_show} %`, d.tasa_no_show > 10 ? 'var(--rojo)' : null),
        kpi('Días hábiles', d.dias_habiles)),
      el(
        'div',
        { clase: 'rejilla rejilla-2' },
        tarjetaBarras('Ocupación por bahía', d.porBahia.map((b) => ({
          etiqueta: b.bahia,
          valor: b.porcentaje,
          texto: `${b.porcentaje}% · ${duracionTexto(b.minutos)}`,
          color: colorLibre(b.color),
        })), 100),
        tarjetaBarras('Citas por estado', d.porEstado.filter((e) => e.n).map((e) => ({
          etiqueta: e.etiqueta,
          valor: e.n,
          texto: String(e.n),
          color: colorEstado(e.estado, estado.estados).fondo,
        })), Math.max(1, ...d.porEstado.map((e) => e.n))),
        tarjetaBarras('Servicios más pedidos', d.porServicio.slice(0, 10).map((s) => ({
          etiqueta: s.servicio,
          valor: s.n,
          texto: `${s.n} · ${duracionTexto(s.minutos || 0)}`,
        })), Math.max(1, ...d.porServicio.map((s) => s.n))),
        tarjetaBarras('Clientes más frecuentes', d.topClientes.map((c) => ({
          etiqueta: c.cliente,
          valor: c.n,
          texto: String(c.n),
        })), Math.max(1, ...d.topClientes.map((c) => c.n)))
      )
    );
  };

  const cambiarPeriodo = (desde, hasta) => {
    // Si alguien escribe las fechas al revés, se ordenan en lugar de dar un informe vacío
    [filtros.desde, filtros.hasta] = desde && hasta && desde > hasta ? [hasta, desde] : [desde, hasta];
    campoDesde.value = filtros.desde;
    campoHasta.value = filtros.hasta;
    recargar().catch((e) => aviso(e.message, 'mal'));
  };
  campoDesde.addEventListener('change', () => cambiarPeriodo(campoDesde.value, filtros.hasta));
  campoHasta.addEventListener('change', () => cambiarPeriodo(filtros.desde, campoHasta.value));

  const atajo = (texto, desde) =>
    el('button', { clase: 'btn btn-mini', texto, onclick: () => cambiarPeriodo(desde, hoyISO()) });

  vaciar(contenedor).append(
    el('h2', { texto: 'Informes' }),
    el('div', { clase: 'tarjeta fila', estilo: { marginBottom: '14px' } },
      el('label', {}, 'Desde', campoDesde),
      el('label', {}, 'Hasta', campoHasta),
      atajo('Últimos 30 días', sumarDias(hoyISO(), -30)),
      atajo('Este año', `${new Date().getFullYear()}-01-01`),
      el('button', {
        clase: 'btn btn-mini',
        texto: '⬇️ Exportar citas (CSV)',
        onclick: () => exportarCSV(filtros),
      })),
    zona
  );
  await recargar();
  alRefrescar(recargar);
}

function kpi(titulo, valor, color) {
  return el('div', { clase: 'kpi' },
    el('div', { clase: 'titulo', texto: titulo }),
    el('div', { clase: 'valor', estilo: color ? { color } : {}, texto: String(valor) }));
}

function tarjetaBarras(titulo, filas, maximo) {
  return el(
    'div',
    { clase: 'tarjeta' },
    el('h3', { texto: titulo }),
    filas.length
      ? el('div', { clase: 'rejilla', estilo: { gap: '10px' } },
          ...filas.map((f) =>
            el('div', {},
              el('div', { clase: 'fila-entre', estilo: { fontSize: '.85rem', marginBottom: '3px' } },
                el('span', { texto: f.etiqueta }),
                el('span', { clase: 'sutil', texto: f.texto })),
              el('div', { clase: 'barra-fondo' },
                el('div', {
                  clase: 'barra-valor',
                  estilo: { width: `${Math.min(100, (f.valor / maximo) * 100)}%`, background: f.color || 'var(--marca-gris-osc)' },
                })))))
      : el('p', { clase: 'sutil', texto: 'Sin datos en el periodo.' })
  );
}

/**
 * Celda de CSV segura: Excel ejecuta como fórmula lo que empieza por = + - @,
 * así que se antepone un apóstrofo. Las comillas se duplican.
 */
function celdaCSV(valor) {
  let texto = String(valor ?? '');
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replaceAll('"', '""')}"`;
}

async function exportarCSV(filtros) {
  try {
    const citas = await api.citas({ ...filtros, limite: 5000 });
    const cabecera = ['Fecha', 'Hora', 'Duracion', 'Matricula', 'Cliente', 'Telefono', 'Servicio', 'Bahia', 'Mecanico', 'Estado', 'Km'];
    const filas = citas.map((c) => [
      fmtFecha(c.fecha), c.hora_inicio, c.duracion_min, c.matricula || '', c.cliente_nombre || '',
      c.cliente_telefono || '', c.servicio_nombre || c.titulo || '', c.bahia_nombre || '',
      c.mecanico_nombre || '', c.estado, c.km_entrada || '',
    ]);
    const csv = [cabecera, ...filas].map((f) => f.map(celdaCSV).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: `citas_${filtros.desde}_${filtros.hasta}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    aviso(`${citas.length} citas exportadas${citas.length >= 5000 ? ' (máximo 5000: acote las fechas)' : ''}`, 'ok');
  } catch (e) {
    aviso(e.message, 'mal');
  }
}
