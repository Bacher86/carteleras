# Cartelera Digital — Multi-institución (PRO)

## Qué cambió respecto a la versión anterior

- Cada institución tiene **su propia cartelera aislada**, identificada por `?org=identificador` en la URL (por ejemplo `admin.html?org=colegio-jose-caro` y `index.html?org=colegio-jose-caro`). No hace falta subdominio para que funcione; si más adelante configurás DNS comodín (`*.tudominio.com`), el sistema también lee el subdominio automáticamente sin tocar código.
- Cada institución puede tener **varias sedes/pantallas**, que ahora se crean y nombran desde el propio panel (ya no están fijas en el código).
- El panel de cada institución **requiere login** (Firebase Auth). Solo vos, desde `superadmin.html`, das de alta usuarios.
- Vos administrás todas las instituciones desde `superadmin.html`: alta, baja, plan, vencimiento y solicitudes nuevas.
- Nuevo: calendario visual semanal para programar horarios, y una pestaña de Analítica con lo más mostrado por día.

## Paso a paso para poner esto en marcha

### 1. Habilitar autenticación en Firebase
En la [consola de Firebase](https://console.firebase.google.com/) → tu proyecto `cartelera-nube` → **Authentication** → pestaña "Sign-in method" → activá **Email/contraseña**.

### 2. Cargar las reglas de seguridad
En **Realtime Database** → pestaña "Reglas", pegá el contenido de `firebase-rules.json` (incluido en este paquete) y publicá.

> Nota honesta: `analytics` queda con escritura pública porque la pantalla (que nadie loguea) necesita poder registrar impresiones. Es un límite razonable para un sistema sin servidor propio: en el peor caso alguien podría escribir basura ahí, nunca en el contenido ni en el diseño de la cartelera.

### 3. Crear tu usuario de Super Admin
1. En Authentication → Users → "Add user", creá tu propio email/contraseña.
2. Copiá el UID que te genera.
3. En Realtime Database, andá a la raíz y creá manualmente: `superadmins/{TU_UID} = true`.
4. Entrá a `superadmin.html`, logueate, y ya podés dar de alta instituciones.

### 4. Subir los archivos
Subí todo el contenido de este zip (menos este README) a tu hosting actual, tal cual está.

### 5. Dar de alta la primera institución
Desde `superadmin.html` → pestaña "Nueva institución": completá nombre, identificador (se autogenera), email y contraseña del admin de esa escuela, plan. Al crearla te va a mostrar las URLs:
- Panel: `admin.html?org=identificador`
- Pantalla: `index.html?org=identificador`

Se la pasás a la escuela y listo — la cartelera arranca con el diseño clásico por defecto, lista para personalizar.

## Cómo funciona el cobro (versión manual, sin backend)

No hay cobro automático con tarjeta todavía — eso requiere un servidor que reciba la confirmación de Mercado Pago/Stripe (un "webhook"), y este proyecto es 100% archivos estáticos + Firebase, sin servidor propio. El flujo que sí queda armado:

1. Vos generás un link de pago (Mercado Pago, transferencia, lo que uses) y opcionalmente lo guardás en el campo "Link de pago" de cada institución.
2. Cuando la escuela paga, entrás a `superadmin.html` y apretás **"💰 Pago recibido (+30 días)"** — eso extiende el vencimiento y reactiva la cuenta si estaba suspendida.
3. Si una escuela no paga, la suspendés con **"⏸️ Suspender"** y su pantalla muestra automáticamente "Cartelera suspendida" en vez del contenido.

El día que quieras automatizar esto de verdad, el siguiente paso es una **Cloud Function de Firebase** que reciba el webhook de Mercado Pago/Stripe y llame `marcarPago` sola. Es una pieza chica de agregar sobre esta base — avisame cuando quieras y la sumamos.

## Notificación de nuevas solicitudes

`solicitud.html` es la página pública ("Quiero mi cartelera"). Cuando alguien la completa, aparece automáticamente en `superadmin.html` → pestaña "Solicitudes", con un contador en rojo. Si además querés recibir un **email** apenas llega una solicitud (sin backend), podés sumar [EmailJS](https://www.emailjs.com) (tiene plan gratuito): creás una cuenta, un "service" y un "template", y descomentás las 3 líneas indicadas dentro de `solicitud.html`.

## Calendario visual de horarios

En la pestaña "Contenido" del panel, en vez de tildar días sueltos, ahora pintás directamente sobre una grilla semanal (como Google Calendar) los horarios en los que cada mensaje/foto/video debe mostrarse. Si no pintás nada, se muestra siempre. Esto reemplaza al selector de días anterior y además ahora si filtra correctamente los mensajes y fotos por vigencia (antes solo los "Mensajes Importantes" respetaban el horario).

## Estructura de datos (Firebase Realtime Database)

```
organizaciones/
  {orgId}/
    meta/        → nombre, email, activo, plan, fechaVencimiento, sedes:[{id,nombre}]
    sedes/
      {sedeId}/  → texto[], fotos[], zocalo, eventos[], config:{diseño, layout}
    analytics/
      {fecha}/{sedeId}/ → mensajes, fotos (contadores)
usuarios/{uid}   → orgId, email   (a qué institución pertenece cada login)
superadmins/{uid} → true          (lista blanca de administradores de la plataforma)
solicitudes/{id} → nombre, email, telefono, mensaje, estado
```

## Archivos del proyecto

| Archivo | Para qué es |
|---|---|
| `index.html` + `script.js` + `style.css` | La pantalla pública (la cartelera en sí). |
| `admin.html` | Panel de cada institución (login propio). |
| `superadmin.html` | Tu panel para dar de alta/baja instituciones y marcar pagos. |
| `solicitud.html` | Página pública para que una escuela nueva pida el servicio. |
| `firebase-rules.json` | Reglas de seguridad a pegar en Firebase. |
