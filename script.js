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

let dataActual = { texto: [], fotos: [], zocalo: [], eventos: [] };
let configActual = null;
let configFirma = "";
let youtubeReady = false;
const TIEMPO_FOTO = 12000;
const estadoBloques = {}; // { [blockId]: { idxMensaje, idxFoto, intervalMsg, intervalFoto, player, seguroVideo } }

function estadoDe(blockId) {
    if (!estadoBloques[blockId]) estadoBloques[blockId] = { idxMensaje: 0, idxFoto: -1, intervalMsg: null, intervalFoto: null, player: null, seguroVideo: null };
    return estadoBloques[blockId];
}

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
        const zocaloRaw = val.zocalo;
        const zocaloArr = Array.isArray(zocaloRaw) ? zocaloRaw : (zocaloRaw ? [zocaloRaw] : []);
        dataActual = { texto: val.texto || [], fotos: val.fotos || [], zocalo: zocaloArr, eventos: val.eventos || [] };

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
    actualizarReloj();
}

// ---------- FILTRO DE VIGENCIA (fecha / hora / día o franjas por día) ----------
function minutosDeHora(str) {
    if (!str) return null;
    const [h, m] = str.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
}

function estaVigente(item) {
    if (typeof item !== 'object' || item === null) return true; // datos viejos sin programación
    const ahora = new Date();
    const offset = ahora.getTimezoneOffset() * 60000;
    const fechaHoy = (new Date(ahora - offset)).toISOString().split('T')[0];
    const minutosActuales = ahora.getHours() * 60 + ahora.getMinutes();
    const diaHoy = ahora.getDay();

    if (item.fechaInicio && fechaHoy < item.fechaInicio) return false;
    if (item.fechaFin && fechaHoy > item.fechaFin) return false;

    // Modo calendario visual: franjas por día { "1": {inicio,fin}, ... }
    if (item.franjas && Object.keys(item.franjas).length) {
        const f = item.franjas[diaHoy];
        if (!f) return false;
        const ini = minutosDeHora(f.inicio), fin = minutosDeHora(f.fin);
        if (ini === null || fin === null) return true; // dato mal formado: no bloquear la visualización
        return minutosActuales >= ini && minutosActuales <= fin;
    }

    // Modo clásico: días + horario único
    if (item.dias && item.dias.length && !item.dias.includes(diaHoy)) return false;
    if (item.inicio && item.fin) {
        const ini = minutosDeHora(item.inicio), fin = minutosDeHora(item.fin);
        if (ini !== null && fin !== null && !(minutosActuales >= ini && minutosActuales <= fin)) return false;
    }
    return true;
}

// ---------- FILTRO DE DESTINO (a qué bloque/área de la pantalla va cada contenido) ----------
// Si el ítem no tiene "destino" (o está vacío), se muestra en TODOS los bloques de ese tipo.
// Si tiene "destino" pero ese/esos bloques YA NO EXISTEN (se borraron/recrearon en la Pizarra),
// también se muestra en todos lados en vez de desaparecer (auto-reparable, nunca deja contenido huérfano oculto).
let idsPorTipo = {};
function aplicaABloque(item, blockId, tipoBloque) {
    if (typeof item !== 'object' || item === null) return true;
    if (!item.destino || item.destino.length === 0) return true;
    const idsValidos = idsPorTipo[tipoBloque] || [];
    const algunoDestinoSigueExistiendo = item.destino.some(id => idsValidos.includes(id));
    if (!algunoDestinoSigueExistiendo) return true; // destino huérfano -> se muestra igual, no se pierde
    return item.destino.includes(blockId);
}
function mensajesPara(blockId) { return (dataActual.texto || []).filter(t => estaVigente(t) && aplicaABloque(t, blockId, 'mensajes')); }
function fotosPara(blockId) { return (dataActual.fotos || []).filter(f => estaVigente(f) && aplicaABloque(f, blockId, 'fotos')); }
function zocaloPara(blockId) { return (dataActual.zocalo || []).filter(z => estaVigente(z) && aplicaABloque(z, blockId, 'zocalo')); }

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
    // limpiar timers/estado de la grilla anterior antes de reconstruir
    Object.keys(estadoBloques).forEach(id => {
        const e = estadoBloques[id];
        clearInterval(e.intervalMsg);
        clearInterval(e.intervalFoto);
        clearTimeout(e.seguroVideo);
        if (e.player && e.player.destroy) { try { e.player.destroy(); } catch (err) {} }
        delete estadoBloques[id];
    });

    const grid = document.getElementById('grid-cartelera');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${cfg.layout.cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${cfg.layout.rows}, 1fr)`;

    const mostrar = cfg.diseño.mostrar;
    const visibleMap = { logo: mostrar.logo, imagen: true, fecha: (mostrar.fechaGreg || mostrar.fechaHeb), reloj: mostrar.reloj, mensajes: mostrar.mensajes, fotos: mostrar.fotos, zocalo: mostrar.zocalo };

    idsPorTipo = {};
    cfg.layout.blocks.forEach(b => {
        if (!visibleMap[b.tipo]) return;
        (idsPorTipo[b.tipo] = idsPorTipo[b.tipo] || []).push(b.id);
    });

    cfg.layout.blocks.forEach(b => {
        if (!visibleMap[b.tipo]) return;
        const el = crearBloque(b, cfg.diseño);
        el.style.gridColumn = `${b.col} / span ${b.colSpan}`;
        el.style.gridRow = `${b.row} / span ${b.rowSpan}`;
        grid.appendChild(el);

        if (b.tipo === 'mensajes') {
            const e = estadoDe(b.id);
            e.intervalMsg = setInterval(() => rotarMensajesBloque(b.id), 6000);
        }
    });
}

function crearBloque(block, d) {
    const tipo = block.tipo;
    const el = document.createElement('div');
    el.className = 'bloque bloque-' + tipo;
    el.dataset.blockId = block.id;

    if (tipo === 'logo') {
        const img1 = document.createElement('img');
        img1.className = 'rl-logo';
        img1.src = block.url || d.logoUrl || 'logo.png.png';
        el.appendChild(img1);
        if (!block.url && d.logoUrl2) {
            const img2 = document.createElement('img');
            img2.className = 'rl-logo';
            img2.src = d.logoUrl2;
            el.appendChild(img2);
        }
    } else if (tipo === 'imagen') {
        const img = document.createElement('img');
        img.className = 'rl-imagen-libre';
        if (block.url) img.src = block.url;
        el.appendChild(img);
    } else if (tipo === 'fecha') {
        if (d.mostrar.fechaGreg) { const g = document.createElement('div'); g.className = 'rl-fecha-greg'; g.innerText = 'Cargando fecha...'; el.appendChild(g); }
        if (d.mostrar.fechaHeb) { const h = document.createElement('div'); h.className = 'rl-fecha-heb'; el.appendChild(h); }
    } else if (tipo === 'reloj') {
        const r = document.createElement('div'); r.className = 'rl-reloj'; r.innerText = '00:00'; el.appendChild(r);
    } else if (tipo === 'mensajes') {
        const c = document.createElement('div'); c.className = 'rl-mensajes'; el.appendChild(c);
    } else if (tipo === 'fotos') {
        const img = document.createElement('img'); img.className = 'rl-foto-principal'; img.style.display = 'none'; el.appendChild(img);
        const yt = document.createElement('div'); yt.className = 'rl-contenedor-youtube'; yt.style.display = 'none';
        const p = document.createElement('div'); p.className = 'rl-player-yt'; yt.appendChild(p);
        el.appendChild(yt);
    } else if (tipo === 'zocalo') {
        const m = document.createElement('div'); m.className = 'marquee-track rl-zocalo'; el.appendChild(m);
    }
    return el;
}

// ---------- RELOJ Y FECHAS (aplica a todas las instancias de cada tipo) ----------
function actualizarReloj() {
    const ahora = new Date();
    const horaTxt = ahora.getHours().toString().padStart(2, '0') + ":" + ahora.getMinutes().toString().padStart(2, '0');
    document.querySelectorAll('.rl-reloj').forEach(el => el.innerText = horaTxt);

    const fechaTxt = ahora.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    document.querySelectorAll('.rl-fecha-greg').forEach(el => el.innerText = fechaTxt);

    const hebEls = document.querySelectorAll('.rl-fecha-heb');
    if (hebEls.length) {
        fetch('https://www.hebcal.com/converter?cfg=json&gy=' + ahora.getFullYear() + '&gm=' + (ahora.getMonth() + 1) + '&gd=' + ahora.getDate() + '&g2h=1')
            .then(res => res.json()).then(d => { const txt = d.hd + " de " + d.hm + ", " + d.hy; hebEls.forEach(el => el.innerText = txt); }).catch(() => {});
    }

    verificarEventos();
}

// ---------- CONTENIDO, ahora independiente por cada bloque ----------
function renderContenido() {
    // Zócalos: uno por bloque, concatenando los que apliquen a ese bloque puntual
    document.querySelectorAll('.bloque-zocalo').forEach(wrapper => {
        const blockId = wrapper.dataset.blockId;
        const el = wrapper.querySelector('.rl-zocalo');
        if (!el) return;
        const items = zocaloPara(blockId);
        el.innerText = items.map(z => (typeof z === 'object') ? z.msg : z).join('     •     ');
    });

    // Mensajes: cada bloque arma su propia lista según su "destino"
    document.querySelectorAll('.bloque-mensajes').forEach(wrapper => {
        const blockId = wrapper.dataset.blockId;
        const cont = wrapper.querySelector('.rl-mensajes');
        if (!cont) return;
        cont.innerHTML = '';
        mensajesPara(blockId).forEach((t, i) => {
            const div = document.createElement('div');
            div.className = 'mensaje-item' + (i === 0 ? ' enfocado' : '');
            div.innerText = (typeof t === 'object') ? t.msg : t;
            cont.appendChild(div);
        });
        estadoDe(blockId).idxMensaje = 0;
    });

    // Fotos/Video: cada bloque arranca su propia rotación si todavía no la tiene corriendo
    document.querySelectorAll('.bloque-fotos').forEach(wrapper => {
        const blockId = wrapper.dataset.blockId;
        const e = estadoDe(blockId);
        if (!e.intervalFoto && !e.player) rotarFotoBloque(blockId);
    });
}

function rotarMensajesBloque(blockId) {
    const wrapper = document.querySelector(`.bloque-mensajes[data-block-id="${blockId}"]`);
    if (!wrapper) return;
    const items = wrapper.querySelectorAll('.mensaje-item');
    if (items.length <= 1) return;
    const e = estadoDe(blockId);
    items.forEach(m => m.classList.remove('enfocado'));
    e.idxMensaje = (e.idxMensaje + 1) % items.length;
    items[e.idxMensaje].classList.add('enfocado');
    registrarImpresion('mensajes');
}

// ---------- FOTOS / VIDEOS: rotación totalmente independiente por bloque ----------
function rotarFotoBloque(blockId) {
    const wrapper = document.querySelector(`.bloque-fotos[data-block-id="${blockId}"]`);
    if (!wrapper) return;
    const e = estadoDe(blockId);
    const fotos = fotosPara(blockId);
    if (fotos.length === 0) { clearInterval(e.intervalFoto); e.intervalFoto = null; return; }

    e.idxFoto = (e.idxFoto + 1) % fotos.length;
    const item = fotos[e.idxFoto];
    const img = wrapper.querySelector('.rl-foto-principal');
    const ytContainer = wrapper.querySelector('.rl-contenedor-youtube');
    const playerDiv = wrapper.querySelector('.rl-player-yt');
    if (!img || !ytContainer) return;

    const esVideo = item.formato === 'video' || (item.url && (item.url.includes('youtube.com') || item.url.includes('youtu.be')));

    if (esVideo) {
        if (!youtubeReady) { setTimeout(() => rotarFotoBloque(blockId), 1500); return; }
        clearInterval(e.intervalFoto); e.intervalFoto = null;
        let videoId = "";
        if (item.url.includes('v=')) videoId = item.url.split('v=')[1].split('&')[0];
        else if (item.url.includes('/shorts/')) videoId = item.url.split('/shorts/')[1].split('?')[0];
        else videoId = item.url.split('/').pop().split('?')[0];

        img.style.display = 'none'; ytContainer.style.display = 'block';
        if (!e.player) {
            e.player = new YT.Player(playerDiv, {
                height: '100%', width: '100%', videoId,
                playerVars: { autoplay: 1, mute: 1, controls: 0, modestbranding: 1, rel: 0 },
                events: {
                    onStateChange: ev => { if (ev.data === YT.PlayerState.ENDED) { clearTimeout(e.seguroVideo); rotarFotoBloque(blockId); reiniciarIntervaloFoto(blockId); } },
                    onReady: ev => { ev.target.playVideo(); programarSeguroBloque(blockId, ev.target.getDuration()); },
                    onError: () => rotarFotoBloque(blockId)
                }
            });
        } else {
            e.player.loadVideoById({ videoId }); e.player.mute(); e.player.playVideo();
            setTimeout(() => programarSeguroBloque(blockId, e.player.getDuration()), 1500);
        }
    } else {
        ytContainer.style.display = 'none';
        if (e.player && e.player.stopVideo) e.player.stopVideo();
        clearTimeout(e.seguroVideo);
        img.src = item.url;
        img.style.display = 'block';
        if (!e.intervalFoto) reiniciarIntervaloFoto(blockId);
    }
    registrarImpresion('fotos');
}

function programarSeguroBloque(blockId, dur) {
    const e = estadoDe(blockId);
    clearTimeout(e.seguroVideo);
    if (dur > 0) e.seguroVideo = setTimeout(() => { rotarFotoBloque(blockId); reiniciarIntervaloFoto(blockId); }, (dur + 5) * 1000);
}
function reiniciarIntervaloFoto(blockId) {
    const e = estadoDe(blockId);
    clearInterval(e.intervalFoto);
    e.intervalFoto = setInterval(() => rotarFotoBloque(blockId), TIEMPO_FOTO);
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

