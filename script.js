/* =========================================================
   CARTELERA DIGITAL — Motor de renderizado (multi-organización)
   Ruta de datos: organizaciones/{orgId}/sedes/{sedeId}
   Estado de la cuenta: organizaciones/{orgId}/meta.activo
   ========================================================= */

const firebaseConfig = {
    apiKey: "AIzaSyAzBO8TzuGeAV-_nsGDgIWckWhV_vkOhTY",
    authDomain: "cartelera-nube.firebaseapp.com",
    databaseURL: "https://cartelera-nube-default-rtdb.firebaseio.com",
    projectId: "cartelera-nube",
    storageBucket: "cartelera-nube.firebasestorage.app",
    messagingSenderId: "333887658907",
    appId: "1:333887658907:web:c9d3904ad02a8fd9fe1f3e"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* ---------- Resolución de organización y sede ----------
   Prioridad: parámetro ?org= (funciona en cualquier hosting).
   Si no viene, se intenta con el subdominio (para el día que
   configuren DNS comodín; no molesta si no lo usan). */
function resolverOrgId() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('org')) return params.get('org');
    const host = window.location.hostname.split('.');
    if (host.length >= 3 && host[0] !== 'www') return host[0];
    return null;
}
const urlParams = new URLSearchParams(window.location.search);
const orgId = resolverOrgId();
const sedeActual = urlParams.get('sede') || 'principal';

// ---------- CONFIGURACIÓN POR DEFECTO (si la sede no tiene diseño guardado) ----------
const CONFIG_DEFAULT = {
    diseño: {
        colorFondo: "#2e314f", colorHeaderFondo: "rgba(0,0,0,0.5)", colorFooterFondo: "#5d1a1a",
        colorTexto: "#ffffff", colorAcento: "#d4af37", colorMensaje: "#f5d76e", colorZocaloTexto: "#ffffff",
        fuente: "Inter", tamMensaje: 4.5, tamReloj: 4, tamZocalo: 2.5, tamFecha: 1.4, radio: 20, velocidadZocalo: 25,
        logoUrl: "logo.png.png", logoUrl2: "",
        mostrar: { logo: true, fechaGreg: true, fechaHeb: true, reloj: true, mensajes: true, fotos: true, zocalo: true }
    },
    layout: {
        cols: 12, rows: 12,
        blocks: [
            { id: "logo",     tipo: "logo",     col: 1, row: 1, colSpan: 3, rowSpan: 2 },
            { id: "fecha",    tipo: "fecha",    col: 4, row: 1, colSpan: 6, rowSpan: 2 },
            { id: "reloj",    tipo: "reloj",    col: 10, row: 1, colSpan: 3, rowSpan: 2 },
            { id: "mensajes", tipo: "mensajes", col: 1, row: 3, colSpan: 5, rowSpan: 9 },
            { id: "fotos",    tipo: "fotos",    col: 6, row: 3, colSpan: 7, rowSpan: 9 },
            { id: "zocalo",   tipo: "zocalo",   col: 1, row: 12, colSpan: 12, rowSpan: 1 }
        ]
    }
};

function fusionarConfig(guardado) {
    const c = JSON.parse(JSON.stringify(CONFIG_DEFAULT));
    if (guardado && guardado.diseño) Object.assign(c.diseño, guardado.diseño, { mostrar: Object.assign({}, c.diseño.mostrar, guardado.diseño.mostrar || {}) });
    if (guardado && guardado.layout && guardado.layout.blocks && guardado.layout.blocks.length) {
        c.layout.cols = guardado.layout.cols || c.layout.cols;
        c.layout.rows = guardado.layout.rows || c.layout.rows;
        c.layout.blocks = guardado.layout.blocks;
    }
    return c;
}

let dataActual = { texto: [], fotos: [], zocalo: "", eventos: [] };
let configActual = null;
let configFirma = "";
let idxFoto = -1;
let idxMensaje = 0;
let rotacionFotoInterval = null;
let player = null, youtubeReady = false, seguroVideo = null;
const TIEMPO_FOTO = 12000;

function onYouTubeIframeAPIReady() { youtubeReady = true; }

function mostrarPantallaVacia(icono, titulo, detalle, suspendida) {
    const p = document.getElementById('pantalla-vacia');
    p.className = suspendida ? 'suspendida' : '';
    p.innerHTML = `<div class="icono">${icono}</div><h1>${titulo}</h1><p>${detalle}</p>`;
    p.style.display = 'flex';
}

// ---------- ARRANQUE ----------
if (!orgId) {
    mostrarPantallaVacia('📺', 'Cartelera Digital', 'Agregá <code>?org=NOMBRE-ESCUELA</code> a la URL (y opcionalmente <code>&sede=NOMBRE</code>).', false);
} else {
    const refMeta = db.ref('organizaciones/' + orgId + '/meta');
    refMeta.on('value', metaSnap => {
        const meta = metaSnap.val();
        if (!meta) {
            mostrarPantallaVacia('❓', 'Institución no encontrada', `No existe ninguna cartelera configurada para <code>${orgId}</code>.`, false);
            return;
        }
        if (meta.activo === false) {
            mostrarPantallaVacia('⏸️', 'Cartelera suspendida', 'Esta cuenta está dada de baja o pendiente de pago. Contactá al administrador del servicio.', true);
            document.getElementById('grid-cartelera').innerHTML = '';
            return;
        }
        document.getElementById('pantalla-vacia').style.display = 'none';
    });

    const dbRemota = db.ref('organizaciones/' + orgId + '/sedes/' + sedeActual);
    dbRemota.on('value', snap => {
        const val = snap.val() || {};
        dataActual = { texto: val.texto || [], fotos: val.fotos || [], zocalo: val.zocalo || "", eventos: val.eventos || [] };

        const nuevoConfig = fusionarConfig(val.config);
        const firma = JSON.stringify(nuevoConfig);
        if (firma !== configFirma) {
            configFirma = firma;
            configActual = nuevoConfig;
            aplicarDiseño(configActual.diseño);
            construirGrid(configActual);
        }
        renderContenido();
    });

    setInterval(actualizarReloj, 1000);
    setInterval(rotarMensajes, 6000);
    actualizarReloj();
}

// ---------- FILTRO DE VIGENCIA (fecha / hora / día o franjas por día) ----------
function estaVigente(item) {
    if (typeof item !== 'object' || item === null) return true; // datos viejos sin programación
    const ahora = new Date();
    const offset = ahora.getTimezoneOffset() * 60000;
    const fechaHoy = (new Date(ahora - offset)).toISOString().split('T')[0];
    const hActual = ahora.getHours().toString().padStart(2, '0') + ":" + ahora.getMinutes().toString().padStart(2, '0');
    const diaHoy = ahora.getDay();

    if (item.fechaInicio && fechaHoy < item.fechaInicio) return false;
    if (item.fechaFin && fechaHoy > item.fechaFin) return false;

    // Modo calendario visual: franjas por día { "1": {inicio,fin}, ... }
    if (item.franjas && Object.keys(item.franjas).length) {
        const f = item.franjas[diaHoy];
        if (!f) return false;
        return hActual >= f.inicio && hActual <= f.fin;
    }

    // Modo clásico: días + horario único
    if (item.dias && item.dias.length && !item.dias.includes(diaHoy)) return false;
    if (item.inicio && item.fin && !(hActual >= item.inicio && hActual <= item.fin)) return false;
    return true;
}

// ---------- DISEÑO (variables CSS) ----------
function aplicarDiseño(d) {
    const r = document.documentElement.style;
    r.setProperty('--color-fondo', d.colorFondo);
    r.setProperty('--color-header-fondo', d.colorHeaderFondo);
    r.setProperty('--color-footer-fondo', d.colorFooterFondo);
    r.setProperty('--color-texto', d.colorTexto);
    r.setProperty('--color-acento', d.colorAcento);
    r.setProperty('--color-mensaje', d.colorMensaje);
    r.setProperty('--color-zocalo-texto', d.colorZocaloTexto);
    r.setProperty('--fuente', `'${d.fuente}', sans-serif`);
    r.setProperty('--tam-mensaje', d.tamMensaje + 'rem');
    r.setProperty('--tam-reloj', d.tamReloj + 'rem');
    r.setProperty('--tam-zocalo', d.tamZocalo + 'rem');
    r.setProperty('--tam-fecha', d.tamFecha + 'rem');
    r.setProperty('--radio', d.radio + 'px');
    r.setProperty('--vel-zocalo', d.velocidadZocalo + 's');
}

// ---------- CONSTRUCCIÓN DE LA GRILLA (pizarra) ----------
function construirGrid(cfg) {
    const grid = document.getElementById('grid-cartelera');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${cfg.layout.cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${cfg.layout.rows}, 1fr)`;

    const mostrar = cfg.diseño.mostrar;
    const visibleMap = { logo: mostrar.logo, fecha: (mostrar.fechaGreg || mostrar.fechaHeb), reloj: mostrar.reloj, mensajes: mostrar.mensajes, fotos: mostrar.fotos, zocalo: mostrar.zocalo };

    cfg.layout.blocks.forEach(b => {
        if (!visibleMap[b.tipo]) return;
        const el = crearBloque(b.tipo, cfg.diseño);
        el.style.gridColumn = `${b.col} / span ${b.colSpan}`;
        el.style.gridRow = `${b.row} / span ${b.rowSpan}`;
        grid.appendChild(el);
    });
}

function crearBloque(tipo, d) {
    const el = document.createElement('div');
    el.className = 'bloque bloque-' + tipo;

    if (tipo === 'logo') {
        const img1 = document.createElement('img');
        img1.id = 'logo-institucional';
        img1.src = d.logoUrl || 'logo.png.png';
        el.appendChild(img1);
        if (d.logoUrl2) {
            const img2 = document.createElement('img');
            img2.id = 'logo-secundario';
            img2.src = d.logoUrl2;
            el.appendChild(img2);
        }
    } else if (tipo === 'fecha') {
        if (d.mostrar.fechaGreg) { const g = document.createElement('div'); g.id = 'fecha-greg'; g.innerText = 'Cargando fecha...'; el.appendChild(g); }
        if (d.mostrar.fechaHeb) { const h = document.createElement('div'); h.id = 'fecha-heb'; el.appendChild(h); }
    } else if (tipo === 'reloj') {
        const r = document.createElement('div'); r.id = 'reloj'; r.innerText = '00:00'; el.appendChild(r);
    } else if (tipo === 'mensajes') {
        const c = document.createElement('div'); c.id = 'escalera-mensajes'; el.appendChild(c);
    } else if (tipo === 'fotos') {
        const img = document.createElement('img'); img.id = 'foto-principal'; img.style.display = 'none'; el.appendChild(img);
        const yt = document.createElement('div'); yt.id = 'contenedor-youtube'; yt.style.display = 'none';
        const p = document.createElement('div'); p.id = 'player-yt'; yt.appendChild(p);
        el.appendChild(yt);
    } else if (tipo === 'zocalo') {
        const m = document.createElement('div'); m.className = 'marquee-track'; m.id = 'texto-zocalo'; el.appendChild(m);
    }
    return el;
}

// ---------- RELOJ Y FECHAS ----------
function actualizarReloj() {
    const ahora = new Date();
    const reloj = document.getElementById('reloj');
    if (reloj) reloj.innerText = ahora.getHours().toString().padStart(2, '0') + ":" + ahora.getMinutes().toString().padStart(2, '0');

    const fg = document.getElementById('fecha-greg');
    if (fg) fg.innerText = ahora.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

    const fh = document.getElementById('fecha-heb');
    if (fh) {
        fetch('https://www.hebcal.com/converter?cfg=json&gy=' + ahora.getFullYear() + '&gm=' + (ahora.getMonth() + 1) + '&gd=' + ahora.getDate() + '&g2h=1')
            .then(res => res.json()).then(d => { fh.innerText = d.hd + " de " + d.hm + ", " + d.hy; }).catch(() => {});
    }

    verificarEventos();
}

// ---------- CONTENIDO (mensajes / zócalo), filtrado por vigencia ----------
function mensajesVigentes() { return (dataActual.texto || []).filter(estaVigente); }
function fotosVigentes() { return (dataActual.fotos || []).filter(estaVigente); }

function renderContenido() {
    const zoc = document.getElementById('texto-zocalo');
    if (zoc) {
        const z = dataActual.zocalo;
        const zVigente = z && estaVigente(z);
        zoc.innerText = zVigente ? (typeof z === 'object' ? z.msg : z) : "";
    }

    const cont = document.getElementById('escalera-mensajes');
    if (cont) {
        cont.innerHTML = '';
        idxMensaje = 0;
        mensajesVigentes().forEach((t, i) => {
            const div = document.createElement('div');
            div.className = 'mensaje-item' + (i === 0 ? ' enfocado' : '');
            div.innerText = (typeof t === 'object') ? t.msg : t;
            cont.appendChild(div);
        });
    }

    if (document.getElementById('foto-principal') && !rotacionFotoInterval) {
        rotarFoto();
        rotacionFotoInterval = setInterval(rotarFoto, TIEMPO_FOTO);
    }
}

function rotarMensajes() {
    const mensajes = document.querySelectorAll('.mensaje-item');
    if (mensajes.length <= 1) return;
    mensajes.forEach(m => m.classList.remove('enfocado'));
    idxMensaje = (idxMensaje + 1) % mensajes.length;
    mensajes[idxMensaje].classList.add('enfocado');
    registrarImpresion('mensajes');
}

// ---------- FOTOS / VIDEOS ----------
function rotarFoto() {
    const fotos = fotosVigentes();
    if (fotos.length === 0) return;
    idxFoto = (idxFoto + 1) % fotos.length;
    const item = fotos[idxFoto];
    const img = document.getElementById('foto-principal');
    const ytContainer = document.getElementById('contenedor-youtube');
    if (!img || !ytContainer) return;

    const esVideo = item.formato === 'video' || (item.url && (item.url.includes('youtube.com') || item.url.includes('youtu.be')));

    if (esVideo) {
        if (!youtubeReady) { setTimeout(rotarFoto, 1500); return; }
        clearInterval(rotacionFotoInterval); rotacionFotoInterval = null;
        let videoId = "";
        if (item.url.includes('v=')) videoId = item.url.split('v=')[1].split('&')[0];
        else if (item.url.includes('/shorts/')) videoId = item.url.split('/shorts/')[1].split('?')[0];
        else videoId = item.url.split('/').pop().split('?')[0];

        img.style.display = 'none'; ytContainer.style.display = 'block';
        if (!player) {
            player = new YT.Player('player-yt', {
                height: '100%', width: '100%', videoId,
                playerVars: { autoplay: 1, mute: 1, controls: 0, modestbranding: 1, rel: 0 },
                events: {
                    onStateChange: e => { if (e.data === YT.PlayerState.ENDED) { clearTimeout(seguroVideo); rotarFoto(); reiniciarIntervalo(); } },
                    onReady: e => { e.target.playVideo(); programarSeguro(e.target.getDuration()); },
                    onError: () => rotarFoto()
                }
            });
        } else {
            player.loadVideoById({ videoId }); player.mute(); player.playVideo();
            setTimeout(() => programarSeguro(player.getDuration()), 1500);
        }
    } else {
        ytContainer.style.display = 'none';
        if (player && player.stopVideo) player.stopVideo();
        clearTimeout(seguroVideo);
        img.src = item.url;
        img.style.display = 'block';
        if (!rotacionFotoInterval) reiniciarIntervalo();
    }
    registrarImpresion('fotos');
}

function programarSeguro(dur) {
    clearTimeout(seguroVideo);
    if (dur > 0) seguroVideo = setTimeout(() => { rotarFoto(); reiniciarIntervalo(); }, (dur + 5) * 1000);
}
function reiniciarIntervalo() {
    clearInterval(rotacionFotoInterval);
    rotacionFotoInterval = setInterval(rotarFoto, TIEMPO_FOTO);
}

// ---------- ANALÍTICA LIVIANA (impresiones por día) ----------
function registrarImpresion(tipo) {
    if (!orgId) return;
    const hoy = new Date().toISOString().split('T')[0];
    const ref = db.ref(`organizaciones/${orgId}/analytics/${hoy}/${sedeActual}/${tipo}`);
    ref.transaction(v => (v || 0) + 1);
}

// ---------- MENSAJE IMPORTANTE (bloqueo de pantalla) ----------
function verificarEventos() {
    const overlay = document.getElementById('overlay-evento');
    if (!overlay) return;
    if (!dataActual.eventos || dataActual.eventos.length === 0) { overlay.style.display = 'none'; return; }

    const evento = dataActual.eventos.find(estaVigente);

    if (evento) {
        const c = document.getElementById('texto-evento-contenido');
        if (c) c.innerText = evento.msg;
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
}

// Mantener la pantalla despierta y refrescar de madrugada
setInterval(() => { if ('wakeLock' in navigator) navigator.wakeLock.request('screen').catch(() => {}); }, 30000);
(function programarRefrescoNocturno() {
    const ahora = new Date();
    const noche = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 3, 0, 0);
    let restante = noche.getTime() - ahora.getTime();
    if (restante < 0) restante += 86400000;
    setTimeout(() => location.reload(), restante);
})();
