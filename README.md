# Gestión de citas · Ritmo Talleres

Programa de agenda y fichero de clientes/vehículos para un taller mecánico.
Funciona en el navegador, se instala en un solo equipo y el resto del taller
entra desde la red local. No necesita internet ni instalar nada de `npm`.

---

## 1. Poner en marcha

1. Instale **Node.js 22 o superior** en el equipo que hará de servidor
   (normalmente el ordenador de recepción): <https://nodejs.org>.
2. Copie esta carpeta `TALLER` donde vaya a quedarse de forma definitiva.
3. Haga doble clic en **`INICIAR-TALLER.bat`**.

Se abre una ventana negra (el servidor: **no se cierra mientras se use el
programa**) y el navegador con la aplicación.

La ventana negra muestra las direcciones de acceso:

```
En este equipo:   http://localhost:4400
Desde la red:     http://10.80.200.150:4400
```

Los demás equipos del taller entran escribiendo esa segunda dirección en su
navegador. Conviene guardarla como marcador o acceso directo.

> Si el resto de equipos no llega, es el **cortafuegos de Windows**: permita
> las conexiones entrantes al puerto 4400 en el equipo servidor.

### Si al hacer doble clic no pasa nada

1. Ábralo desde una ventana de símbolo del sistema para poder leer el error:
   pulse `Windows+R`, escriba `cmd`, y dentro escriba `U:` y luego
   `cd "\USUARIOS\jose.paredes\Desktop\TALLER"` y `INICIAR-TALLER.bat`.
2. Si dice que **no encuentra Node.js**, instálelo desde <https://nodejs.org>.
3. Si dice que **el puerto 4400 está ocupado**, el programa ya estaba abierto:
   busque la ventana negra en la barra de tareas o abra el navegador en
   `http://localhost:4400`.

Si el programa se detiene por un fallo inesperado, la ventana negra lo
**vuelve a arrancar sola** a los 5 segundos.

Si desde otro equipo aparece *"Nombre de equipo no autorizado"*, entre por la
dirección con números (`http://10.x.x.x:4400`). Para usar un nombre propio de la
red, añádalo en `INICIAR-TALLER.bat` antes de la línea `:arrancar`, por ejemplo:
`set TALLER_HOSTS=citas.ritmo.local`.

### Primer acceso

| Usuario | Contraseña |
|---------|-----------|
| `admin` | `admin`   |

Nada más entrar, el programa **obliga a cambiarla** por una propia (mínimo
8 caracteres) y no deja hacer nada más hasta entonces. Después, cree un usuario
por persona en **Ajustes → Usuarios**.

### Usuarios y permisos

| Rol | Qué puede hacer |
|-----|-----------------|
| **Administrador** | Todo, incluidos ajustes, servicios, bahías, mecánicos y usuarios. |
| **Recepción** | Citas, clientes y vehículos: dar de alta, cambiar, borrar, confirmar, anular y avisar. |
| **Mecánico** | Consultar todo y avanzar el trabajo: *En taller*, *En reparación*, *Terminada* y *Entregada*. |

- La contraseña que pone el administrador al crear un usuario es **provisional**:
  la persona tiene que cambiarla la primera vez que entra.
- Para cambiar la propia hace falta escribir la actual.
- Al desactivar o borrar un usuario, se le cierra la sesión al momento en todos
  los equipos.
- Siempre debe quedar al menos un administrador activo: el programa no deja
  quitar el último.

### Todo al día en todos los equipos

Cualquier cambio (una cita nueva, un coche que cambia de dueño, una cita que
pasa a *En taller*…) aparece **al momento en todas las pantallas abiertas**, en
este equipo y en el resto del taller, sin pulsar F5. Las búsquedas, los filtros
y el día que se está mirando en la agenda se conservan.

Abajo a la izquierda, junto al usuario, un punto indica el estado:

- **Punto lima · En directo**: todo bien.
- **Punto naranja parpadeando · Sin conexión con el servidor**: el equipo
  principal está cerrado o sin red. Se reconecta solo en cuanto vuelve, y al
  hacerlo pone los datos al día.

Si se actualiza el programa, cada pantalla lo detecta al reconectar y se recarga
sola.

### Datos de ejemplo

Para ver el programa con contenido antes de meter los datos reales, haga doble
clic en **`DATOS-DE-EJEMPLO.bat`** y elija la opción 1. Carga 3 clientes,
4 vehículos (uno con la ITV caducada) y 15 citas repartidas entre las semanas
anterior y siguiente, en todos los estados posibles.

La opción 2 del mismo archivo los borra. Solo toca lo que él mismo creó —lo
marca con la etiqueta `[EJEMPLO]` en las notas—, así que nunca se lleva por
delante datos reales del taller.

### Base de datos de demostración

En la carpeta `demo/` hay una base de datos completa de prueba —4 clientes,
5 vehículos, 16 citas y su historial, **todo inventado**— para ver el programa
en marcha sin escribir nada.

Se instala con doble clic en **`DATOS-DE-DEMOSTRACION.bat`** (o
`node herramientas/usar-demo.js`). Al instalarla, las citas se desplazan a la
semana en curso, de modo que el panel del día y la agenda tienen contenido sea
cual sea la fecha.

Si ya existe una base de datos propia, **no la toca**: avisa y se detiene. Para
sustituirla hay que añadir `--forzar`, y aun así guarda antes una copia de la
anterior. Se entra con `admin` / `admin`, y pedirá cambiar la contraseña.

---

## 2. Cómo se usa

### Panel
Lo que hay que mirar al abrir por la mañana: citas de hoy, citas sin
confirmar, vehículos con la **ITV o la revisión a punto de vencer** y
ausencias del último mes.

### Agenda
- **Vista día**: una columna por bahía, la hora a la izquierda, la franja
  rayada es la pausa del mediodía y la línea roja marca la hora actual.
- **Pinche en un hueco** para crear una cita a esa hora y en esa bahía.
- **Arrastre una cita** para cambiarla de hora o de bahía. Si el hueco está
  ocupado, el programa avisa y deja decidir.
- El porcentaje de la cabecera de cada columna es la **ocupación del día**.
- **Vista semana**: las siete columnas de la semana de un vistazo.

### Estados de la cita
`Pendiente → Confirmada → En taller → En reparación → Terminada → Entregada`,
más `No presentado` y `Anulada`. Al pasar a *En taller* se pueden apuntar los
kilómetros, que se guardan también en la ficha del vehículo.

### Avisar al cliente
En la ficha de la cita, **Avisar cliente** prepara el mensaje con los datos ya
sustituidos y ofrece tres salidas: **WhatsApp** (abre WhatsApp Web con el texto
escrito), **Correo** (abre el programa de correo) o **Copiar texto**.
La plantilla se cambia en *Ajustes → Avisos*.

### Buscador
La barra de arriba busca a la vez en matrículas, clientes, teléfonos y citas.
Atajos: `/` para ir al buscador y `Alt+N` para una cita nueva.

### Ajustes
- **Taller**: nombre, teléfono y prefijo de país para WhatsApp.
- **Horario**: apertura, cierre, pausa, días que abre y el intervalo de la
  agenda (15, 30, 60 min…).
- **Servicios**: cada servicio lleva su **duración**, que es la que reserva el
  hueco en la agenda automáticamente, y un color.
- **Bahías y mecánicos**: las bahías son las columnas de la agenda.
- **Usuarios**: altas, roles y contraseñas.

### Apariencia

Abajo a la izquierda, debajo del nombre de usuario, hay un botón que cambia
entre dos apariencias:

- **Color** — la imagen de Ritmo Talleres, con el lima de la marca.
- **Sobrio** — todo en escala de grises, sin un solo color.

En el modo sobrio los estados de la cita no se distinguen por el tono, así que
se reparten por **claridad siguiendo el avance del trabajo**: *Pendiente* casi
blanco, *En taller* gris medio, *Entregada* casi negro. *Anulada* y *No
presentado* llevan además un rayado, que también se ve al imprimir en blanco y
negro.

Lo elige **cada usuario en su equipo** y se recuerda ahí: en el mismo taller
uno puede trabajar en color y otro en gris. El cambio es inmediato, sin
recargar ni perder lo que se esté mirando.

La única excepción son los colores de servicios y bahías dentro de *Ajustes*:
ahí se ven siempre de verdad, porque son el dato que se está eligiendo.

### Imagen de Ritmo Talleres
El programa usa el logotipo, el icono y los colores de ritmotalleres.es:
antracita `#1E1E1E`, gris `#4E4E4E` y amarillo lima `#D7FF01`.

- Logotipo e icono: `public/img/logo-ritmo.png` y `public/img/favicon.ico`.
  Para cambiarlos, sustituya esos archivos manteniendo el nombre.
- Colores: todos salen del bloque `:root` al principio de
  `public/css/estilos.css`. Cambiando ahí `--marca-lima` o `--marco-fondo`
  se recolorea todo el programa.
- Los colores de cada servicio, bahía y mecánico se cambian desde *Ajustes*.

---

## 3. Los datos

Todo se guarda en un único fichero: **`datos/taller.db`** (SQLite).

- Cada vez que arranca el programa se hace una **copia del día** en
  `datos/copias/`, y se conservan las de los últimos 30 días.
- Para llevarse los datos a otro equipo basta con copiar la carpeta `datos`.
- Para una copia externa (pendrive, disco de red), copie `datos/taller.db`
  con el programa cerrado, o cualquier fichero de `datos/copias/`.

Desde *Informes* se pueden exportar las citas de un periodo a **CSV** para
abrirlas en Excel.

> La carpeta `datos/` está excluida del repositorio (`.gitignore`): los datos
> del taller no se suben nunca a GitHub. Si el programa no la encuentra, la
> crea vacía al arrancar.

### Copia fuera del equipo (importante)

Las copias de `datos/copias/` están **en el mismo disco que el original**: si
ese ordenador se estropea, se pierden las dos cosas a la vez.

En *Ajustes → Copias* se puede indicar una **carpeta de copia externa**. A
partir de ahí, cada copia diaria se guarda también allí. Sirve cualquier ruta
completa:

| Dónde                                    | Protege de                       |
| ---------------------------------------- | -------------------------------- |
| Otro PC del taller (`\\RECEPCION2\copias`) | Que se estropee este ordenador   |
| Un USB o disco fijo (`D:\copias-taller`)  | Lo mismo, y es lo más sencillo   |
| Una carpeta de OneDrive o Drive          | Robo, incendio o inundación      |

El botón **Hacer una copia ahora** comprueba en el momento que la carpeta
existe y que se puede escribir en ella.

Si un día no se puede copiar (el USB desenchufado, la red caída), el programa
**sigue funcionando con normalidad** y lo apunta; si pasan más de tres días sin
conseguirlo, avisa en el *Panel*. Una copia que falla en silencio es peor que
no tener ninguna.

---

## 4. Mantenimiento

Esta parte es para quien cuida el programa, no para el taller.

### Comprobar que todo funciona

Doble clic en **`PROBAR.bat`** (o `node herramientas/pruebas.js`).

Arranca el programa con una base de datos vacía en una carpeta temporal y otro
puerto, y comprueba por su cuenta unas sesenta cosas: que sin contraseña no se
entra, que un mecánico no puede anular una cita, que cambiar un coche de dueño
arrastra sus citas abiertas, que una matrícula con espacios se encuentra, que
la copia externa se escribe de verdad...

**No toca ninguna base de datos real**, ni la de este equipo ni la del taller.
Termina diciendo `TODO CORRECTO: 65 de 65` o señalando exactamente qué ha
fallado.

Conviene lanzarlo **antes de llevar una versión nueva al taller**: si algo se
ha roto, sale aquí y no allí.

### Actualizar el programa del taller

El programa se desarrolla en un equipo y funciona en otro, así que actualizar
es copiar la versión nueva **sin tocar la carpeta `datos`**, que es lo único
insustituible.

De eso se encarga **`ACTUALIZAR.bat`**, que se ejecuta desde la carpeta de la
versión nueva:

1. Pide la carpeta donde está instalado el programa (o se le pasa:
   `ACTUALIZAR.bat "D:\TALLER"`).
2. Comprueba que ahí hay de verdad una instalación.
3. Guarda una copia completa de `datos` al lado, con la fecha en el nombre.
4. Sustituye el programa, **excluyendo `datos`** y la base de demostración.

Antes de lanzarlo hay que **cerrar el programa** en el equipo servidor (la
ventana negra). Si algo sale mal, los datos de antes quedan en la carpeta
`copia-datos-taller-…` que deja al lado.

## 5. Detalles técnicos

- Node.js con `node:sqlite`, `node:http` y `node:crypto`: **cero dependencias
  externas**, no hay que ejecutar `npm install`.
- Interfaz en HTML/CSS/JavaScript sin framework.
- **Contraseñas**: PBKDF2 con 150 000 iteraciones y sal por usuario; mínimo 8
  caracteres y se rechazan las obvias; la de fábrica se cambia obligatoriamente.
- **Sesiones**: cookie `HttpOnly` y `SameSite=Strict` de 12 horas. En la base de
  datos solo se guarda un hash del token, así que copiar el fichero no permite
  entrar. Bloqueo de 10 minutos tras 8 intentos fallidos desde el mismo equipo.
- **Permisos por rol comprobados en el servidor** en cada petición: ocultar un
  botón no basta, el servidor rechaza lo que el rol no permite.
- **Protección de la web**: las escrituras solo se aceptan desde la propia
  aplicación (cabecera propia y comprobación del origen, contra CSRF); política
  de seguridad de contenido (CSP), sin iframes; todos los datos se pintan como
  texto, nunca como HTML; solo se aceptan peticiones dirigidas a la IP, a
  `localhost` o al nombre del equipo.
- **Datos**: validación de fechas, horas, teléfonos, emails, colores y
  kilómetros; operaciones de varios pasos en transacciones; las exportaciones a
  CSV no pueden ejecutar fórmulas en Excel; los errores internos no muestran
  detalles técnicos al usuario.
- El tráfico entre equipos va por HTTP **sin cifrar**: es adecuado para la red
  interna del taller, no para publicarlo en internet.

```
TALLER/
├─ INICIAR-TALLER.bat     arranque
├─ DATOS-DE-EJEMPLO.bat   cargar / borrar datos de prueba
├─ server/                servidor y API
├─ public/                interfaz
├─ herramientas/          scripts sueltos (datos de ejemplo)
├─ datos/taller.db        base de datos (y copias/)
└─ ROADMAP.md             lo que queda por hacer
```

Para cambiar el puerto, edite `INICIAR-TALLER.bat` y ponga antes de `node`:
`set PUERTO=5000`.
