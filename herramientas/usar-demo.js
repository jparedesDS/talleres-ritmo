'use strict';
/**
 * Instala la base de datos de demostración (demo/taller-demo.db) como base de
 * trabajo, desplazando las fechas para que las citas caigan en la semana
 * actual. Sirve para probar el programa sin escribir nada a mano.
 *
 *   node herramientas/usar-demo.js [--forzar]
 *
 * Si ya existe datos/taller.db no hace nada, salvo que se pase --forzar: así
 * no se puede borrar por descuido la base de datos del taller.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const raiz = path.join(__dirname, '..');
const origen = path.join(raiz, 'demo', 'taller-demo.db');
const dirDatos = process.env.TALLER_DATOS || path.join(raiz, 'datos');
const destino = path.join(dirDatos, 'taller.db');
const forzar = process.argv.includes('--forzar');

if (!fs.existsSync(origen)) {
  console.error(`No encuentro la base de demostración en ${origen}`);
  process.exit(1);
}

if (fs.existsSync(destino) && !forzar) {
  console.error('');
  console.error('  Ya hay una base de datos en uso:');
  console.error(`  ${destino}`);
  console.error('');
  console.error('  No la toco. Si de verdad quiere sustituirla por la de');
  console.error('  demostración, haga antes una copia y vuelva a ejecutar');
  console.error('  esto con  --forzar  al final.');
  console.error('');
  process.exit(2);
}

fs.mkdirSync(dirDatos, { recursive: true });
if (fs.existsSync(destino)) {
  const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const guardada = path.join(dirDatos, `taller-antes-de-la-demo-${sello}.db`);
  fs.copyFileSync(destino, guardada);
  console.log(`Guardada la base anterior en ${guardada}`);
}
for (const sufijo of ['', '-wal', '-shm']) fs.rmSync(destino + sufijo, { force: true });
fs.copyFileSync(origen, destino);

// --- Traer las citas a la semana actual ---------------------------------
const diaISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lunesDe = (d) => {
  const f = new Date(d);
  f.setDate(f.getDate() - ((f.getDay() + 6) % 7));
  return f;
};

const db = new DatabaseSync(destino);
const citas = db.prepare('SELECT id, fecha FROM citas ORDER BY fecha').all();
if (citas.length) {
  // La demo se armó alrededor de una semana concreta: la desplazamos entera
  // para que el día con más trabajo caiga en el lunes de esta semana.
  const cuenta = new Map();
  for (const c of citas) cuenta.set(c.fecha, (cuenta.get(c.fecha) || 0) + 1);
  const masCargado = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const [y, m, d] = masCargado.split('-').map(Number);
  const dias = Math.round((lunesDe(new Date()) - lunesDe(new Date(y, m - 1, d))) / 86400000);

  if (dias !== 0) {
    const mover = db.prepare('UPDATE citas SET fecha = ? WHERE id = ?');
    for (const c of citas) {
      const [cy, cm, cd] = c.fecha.split('-').map(Number);
      const f = new Date(cy, cm - 1, cd);
      f.setDate(f.getDate() + dias);
      mover.run(diaISO(f), c.id);
    }
    console.log(`Citas desplazadas ${dias} día(s) para caer en la semana actual.`);
  }
}
const n = db.prepare('SELECT COUNT(*) AS n FROM citas').all()[0].n;
db.close();

console.log('');
console.log('  Datos de demostración instalados.');
console.log(`  ${n} citas, con clientes y vehículos de ejemplo (todo inventado).`);
console.log('  Entre con usuario "admin" y contraseña "admin"; le pedirá cambiarla.');
console.log('');
