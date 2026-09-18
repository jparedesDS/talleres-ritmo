# Datos de demostración

`taller-demo.db` es una base de datos de prueba para ver el programa
funcionando sin tener que escribir nada a mano.

**Todo lo que contiene es inventado**: los clientes, los teléfonos, las
matrículas y las citas no corresponden a ninguna persona real.

| Contiene       |    |
| -------------- | -- |
| Clientes       |  4 |
| Vehículos      |  5 |
| Citas          | 16 |
| Historial      | 29 |

## Cómo usarla

Desde la carpeta del programa:

```
node herramientas/usar-demo.js
```

En Windows basta con hacer doble clic en `DATOS-DE-DEMOSTRACION.bat`.

El script copia esta base a `datos/taller.db` y **desplaza las citas a la
semana actual**, para que el panel del día y la agenda tengan trabajo que
mostrar sea cual sea la fecha en la que se pruebe.

Si ya existe `datos/taller.db` no la toca: avisa y se detiene. Para
sustituirla de todos modos hay que ejecutarlo con `--forzar`, y aun así
guarda antes una copia de la base anterior.

## Acceso

Usuario `admin`, contraseña `admin`. Al entrar pedirá cambiarla: es el
comportamiento normal del programa con cualquier contraseña provisional.
