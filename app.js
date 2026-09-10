const LOCALE = 'es-AR';
const STORAGE_KEY = 'dexterDashboard_v2';
const HISTORY_KEY = 'dexterDashboard_history_v2';
const NOMINA_KEY = 'dexterDashboard_nomina_v1';
const OBJETIVOS_KEY = 'dexterDashboard_objetivos_v1';

// Si en algún momento tenés un backend propio con API de nómina, poné la URL acá
// (debe ser https y permitir CORS). Si queda vacío, esta función no hace nada:
// no hay llamadas fallidas ni errores en consola.
const BACKEND_URL = '';

const DOUGHNUT_COLORS = ['#e52329', '#f59e0b', '#27272a', '#52525b', '#10b981', '#3f3f46'];

const COLUMNAS_OPS = {
    abastecimiento: ['Cantidad ingresada', 'cantidad ingresada'],
    almacenamiento: ['Cantidad guardada', 'cantidad guardada'],
    picking: ['Cantidad pickeada', 'cantidad pickeada'],
    control: ['Cantidad controlada', 'cantidad controlada'],
    despacho: ['Cantidad Despachada', 'cantidad despachada', 'despacho'],
};
const ETIQUETAS_OPS = {
    abastecimiento: 'Abastecimiento (Cantidad ingresada)',
    almacenamiento: 'Almacenamiento (Cantidad guardada)',
    picking: 'Picking (Cantidad pickeada)',
    control: 'Control (Cantidad controlada)',
    despacho: 'Despacho (Cantidad Despachada)',
};

const BADGE_COLORS = {
    DISPATCHED: 'bg-brand-success/20 text-brand-success', CANCELLED: 'bg-brand-danger/20 text-brand-danger',
    CREATED: 'bg-brand-accent/20 text-brand-accent', IN_BRANCH_POSITION: 'bg-brand-purple/20 text-brand-purple',
    PRE_DISPATCH: 'bg-blue-500/20 text-blue-400', CONTROL: 'bg-brand-success/20 text-brand-success',
    PACKING: 'bg-brand-warning/20 text-brand-warning', CONFERENCE: 'bg-blue-500/20 text-blue-400',
    PAUSED_WITH_DIFFERENCES: 'bg-brand-danger/20 text-brand-danger', FINALIZED: 'bg-brand-success/20 text-brand-success',
};

const OBJETIVOS_DEFAULT = {
    'Abastecimiento': 1600,
    'Almacenamiento': 2000,
    'Picking': 1000,
    'Control': 1500,
    'Despacho': 1500
};

// campo en currentOpsData -> {id del div de delta, nombre de zona a mostrar}
const CAMPOS_DELTA = {
    abast: 'Abastecimiento', almac: 'Almacenamiento', pick: 'Picking',
    ctrl: 'Control', desp: 'Despacho'
};

// Zonas que entran en la comparativa de turnos (a pedido: sin Despacho,
// que tiene su propia ambigüedad de unidad real vs. órdenes TR)
const ZONAS_COMPARATIVA = ['Abastecimiento', 'Almacenamiento', 'Picking', 'Control'];
// mismos colores que ya usan las tarjetas KPI y los badges de zona, para que
// una zona se vea siempre igual en todo el dashboard
const ZONA_COLOR_HEX = {
    Abastecimiento: '#f59e0b',
    Almacenamiento: '#e52329',
    Picking: '#8b5cf6',
    Control: '#10b981',
};

let barChartInstance = null;
let doughnutChartInstance = null;
let turnosChartInstance = null;
let nominaGlobal = [];
let OBJETIVOS_ZONA = cargarObjetivos();

let currentTRData = { "DISPATCHED": 0, "CREATED": 0 };
let currentOpsData = { abast: 0, almac: 0, pick: 0, ctrl: 0, desp: 0 };
let currentOperariosData = [];
let currentFechaReporte = "Reporte Inicial (Sin Carga)";
let despachoEsOrdenesTR = false; // true si el valor de "Despacho" vino del conteo de TR's, no de unidades reales

// --------------------------------------------------------
// ARREGLO DE CODIFICACIÓN (mojibake)
// El export de este WMS a veces guarda texto UTF-8 pero lo
// "lee" como Windows-1252, rompiendo tildes y Ñ (p.ej. "López"
// queda "LÃ³pez"). fixMojibake revierte ese round-trip. Si el
// texto ya está bien, lo deja intacto.
// --------------------------------------------------------
const CP1252_REVERSE = (() => {
    const specials = {
        0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
        0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
        0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›',
        0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ'
    };
    const map = {};
    Object.entries(specials).forEach(([byte, ch]) => { map[ch.codePointAt(0)] = Number(byte); });
    return map;
})();
function fixMojibake(str) {
    if (typeof str !== 'string' || !str) return str;
    if (!/[\u0080-\u024f\u2000-\u203a]/.test(str)) return str;
    try {
        const bytes = [];
        for (const ch of str) {
            const code = ch.codePointAt(0);
            if (code < 0x80) bytes.push(code);
            else if (code <= 0xFF) bytes.push(code);
            else if (CP1252_REVERSE[code] != null) bytes.push(CP1252_REVERSE[code]);
            else return str;
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    } catch (e) {
        return str;
    }
}

// --------------------------------------------------------
// PARSEO DE N\u00daMEROS
// Number() s\u00f3lo entiende punto decimal. Si una columna de
// cantidades viene como texto en formato AR ("1.234,56" o
// "1234,56"), Number() da NaN y el dato se pierde en silencio
// como si fuera 0. Esta funci\u00f3n normaliza antes de convertir.
// --------------------------------------------------------
function parseNumero(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (val == null) return 0;
    let s = String(val).trim();
    if (!s) return 0;
    const tieneComa = s.includes(',');
    const tienePunto = s.includes('.');
    if (tieneComa && tienePunto) {
        s = s.replace(/\./g, '').replace(',', '.'); // "1.234,56" -> "1234.56"
    } else if (tieneComa && !tienePunto) {
        s = s.replace(',', '.'); // "1234,56" -> "1234.56"
    }
    const n = Number(s);
    return isNaN(n) ? 0 : n;
}

// --------------------------------------------------------
// ESCAPE HTML
// Nombres de operarios, estados de TR y turnos vienen de
// archivos que sube el usuario y se insertan con innerHTML.
// Sin escapar, una celda con "<img onerror=...>" se ejecutar\u00eda
// en el navegador de quien vea el dashboard.
// --------------------------------------------------------
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --------------------------------------------------------
// NORMALIZACIÓN DE NOMBRES
// Agrupa "Juan Perez", "juan  perez" y "JUAN PEREZ" bajo el
// mismo operario. Sin esto, variaciones de mayúsculas o espacios
// entre filas del mismo Excel parten a un operario en dos filas
// distintas de la tabla de eficiencia.
// --------------------------------------------------------
function normalizarNombre(str) {
    return String(str).toLowerCase().replace(/\s+/g, ' ').trim();
}

// --------------------------------------------------------
// FECHAS
// Se guarda la fecha LOCAL (no la UTC de toISOString) porque una
// carga a las 22 hs en Argentina caería en el día siguiente si se
// usara UTC, rompiendo el agrupado por día del reporte semanal.
// --------------------------------------------------------
function fechaLocalISO(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

// Lunes (inicio de semana) de la semana que contiene `fecha`.
function lunesDeLaSemana(fecha) {
    const d = new Date(fecha);
    d.setHours(0, 0, 0, 0);
    const dia = d.getDay(); // 0=Dom, 1=Lun, ... 6=Sáb
    d.setDate(d.getDate() + (dia === 0 ? -6 : 1 - dia));
    return d;
}

// Devuelve { desde, hasta } en 'YYYY-MM-DD' para un preset.
function rangoPreset(preset, hoy) {
    const base = hoy || new Date();
    if (preset === 'semana') {
        return { desde: fechaLocalISO(lunesDeLaSemana(base)), hasta: fechaLocalISO(base) };
    }
    if (preset === 'semana-pasada') {
        const lunesEsta = lunesDeLaSemana(base);
        const lunesPasada = new Date(lunesEsta); lunesPasada.setDate(lunesPasada.getDate() - 7);
        const domingoPasada = new Date(lunesEsta); domingoPasada.setDate(domingoPasada.getDate() - 1);
        return { desde: fechaLocalISO(lunesPasada), hasta: fechaLocalISO(domingoPasada) };
    }
    if (preset === '7dias') {
        const hace7 = new Date(base); hace7.setDate(hace7.getDate() - 6);
        return { desde: fechaLocalISO(hace7), hasta: fechaLocalISO(base) };
    }
    // 'todo' se resuelve afuera (depende del historial); acá devolvemos un rango amplio
    return { desde: '2000-01-01', hasta: fechaLocalISO(base) };
}

// --------------------------------------------------------
// AVISOS FLOTANTES (TOASTS)
// Usado, por ejemplo, cuando falla el guardado en localStorage
// (storage lleno, modo privado, etc.) para que el usuario se
// entere en vez de que falle en silencio (sólo console.warn).
// --------------------------------------------------------
function mostrarToast(mensaje, tipo) {
    if (typeof document === 'undefined') return;
    const cont = document.getElementById('toastContainer');
    if (!cont) return;
    const estilos = {
        info: 'bg-blue-500/95 border-blue-400',
        danger: 'bg-brand-danger/95 border-red-400',
        success: 'bg-brand-success/95 border-emerald-400'
    };
    const toast = document.createElement('div');
    toast.className = `${estilos[tipo] || estilos.info} text-white text-sm px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-sm`;
    toast.innerText = mensaje;
    cont.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
}

// --------------------------------------------------------
// NÓMINA / TURNOS
// Sin backend, la nómina se guarda localmente en el navegador:
// se sube una vez (Excel/CSV con columnas Nombre y Turno) desde
// el modal "Actualizar Datos" y queda persistida.
// --------------------------------------------------------
async function cargarNominaDesdeBD() {
    if (!BACKEND_URL) {
        nominaGlobal = cargarNominaLocal();
        return;
    }
    try {
        const respuesta = await fetch(BACKEND_URL);
        if (respuesta.ok) {
            nominaGlobal = await respuesta.json();
            guardarNominaLocal(nominaGlobal);
        } else {
            nominaGlobal = cargarNominaLocal();
        }
    } catch (error) {
        console.warn('No se pudo conectar con el backend de nómina, uso la copia local.', error);
        nominaGlobal = cargarNominaLocal();
    }
}
function guardarNominaLocal(nomina) {
    try { localStorage.setItem(NOMINA_KEY, JSON.stringify(nomina)); }
    catch (e) { mostrarToast('No se pudo guardar la nómina en este navegador.', 'danger'); }
}
function cargarNominaLocal() {
    try {
        const raw = localStorage.getItem(NOMINA_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}
function extraerNomina(datos) {
    if (!datos || !datos.length) return [];
    const cols = Object.keys(datos[0]);
    const keyNombre = cols.find(c => ['nombre', 'nombre y apellido', 'operario'].includes(fixMojibake(c).toLowerCase()));
    const keyTurno = cols.find(c => ['turno', 'shift'].includes(fixMojibake(c).toLowerCase()));
    if (!keyNombre) return [];
    return datos
        .map(f => ({
            nombre: fixMojibake(String(f[keyNombre] || '')).trim(),
            turno: keyTurno ? fixMojibake(String(f[keyTurno] || '')).trim() : 'Sin Turno'
        }))
        .filter(n => n.nombre);
}

// --------------------------------------------------------
// METAS POR ZONA (configurables, ya no hardcodeadas)
// --------------------------------------------------------
function cargarObjetivos() {
    try {
        const raw = localStorage.getItem(OBJETIVOS_KEY);
        return raw ? Object.assign({}, OBJETIVOS_DEFAULT, JSON.parse(raw)) : Object.assign({}, OBJETIVOS_DEFAULT);
    } catch (e) { return Object.assign({}, OBJETIVOS_DEFAULT); }
}
function guardarObjetivos(obj) {
    OBJETIVOS_ZONA = obj;
    try { localStorage.setItem(OBJETIVOS_KEY, JSON.stringify(obj)); }
    catch (e) { mostrarToast('No se pudo guardar las metas en este navegador.', 'danger'); }
}
function llenarFormularioObjetivos() {
    const map = {
        objAbastecimiento: 'Abastecimiento', objAlmacenamiento: 'Almacenamiento',
        objPicking: 'Picking', objControl: 'Control', objDespacho: 'Despacho'
    };
    Object.entries(map).forEach(([id, zona]) => {
        const el = document.getElementById(id);
        if (el) el.value = OBJETIVOS_ZONA[zona];
    });
}
function guardarObjetivosDesdeFormulario() {
    const nuevo = {
        'Abastecimiento': Number(document.getElementById('objAbastecimiento').value) || OBJETIVOS_DEFAULT['Abastecimiento'],
        'Almacenamiento': Number(document.getElementById('objAlmacenamiento').value) || OBJETIVOS_DEFAULT['Almacenamiento'],
        'Picking': Number(document.getElementById('objPicking').value) || OBJETIVOS_DEFAULT['Picking'],
        'Control': Number(document.getElementById('objControl').value) || OBJETIVOS_DEFAULT['Control'],
        'Despacho': Number(document.getElementById('objDespacho').value) || OBJETIVOS_DEFAULT['Despacho'],
    };
    guardarObjetivos(nuevo);
    currentOperariosData = recalcularEficiencia(currentOperariosData);
    RenderizarTablaDB(currentOperariosData);
    generarNotificacionesEficiencia(currentOperariosData, false);
    guardarEstado();
    cerrarModalObjetivos();
}
function recalcularEficiencia(operarios) {
    return operarios.map(op => {
        const objetivo = OBJETIVOS_ZONA[op.zona] || 1500;
        return Object.assign({}, op, { objetivo, eficienciaPct: (op.total / objetivo) * 100 });
    }).sort((a, b) => b.eficienciaPct - a.eficienciaPct);
}

// INICIALIZADOR AL CARGAR LA PÁGINA
// (guardado tras "typeof document" para poder requerir este archivo
// desde Node -sin DOM- y testear las funciones puras de más arriba)
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    ConfigurarGraficosBase();
    llenarFormularioObjetivos();

    await cargarNominaDesdeBD();

    const guardado = cargarEstadoGuardado();
    if (guardado) {
        currentTRData = guardado.trData || currentTRData;
        currentOpsData = guardado.opsData || currentOpsData;
        currentOperariosData = guardado.operariosData || [];
        currentFechaReporte = guardado.fecha || currentFechaReporte;
        despachoEsOrdenesTR = guardado.despachoEsOrdenesTR || false;
    }
    actualizarFechaReporte();

    ActualizarDashboard(currentTRData, currentOpsData.abast, currentOpsData.almac, currentOpsData.pick, currentOpsData.ctrl, currentOpsData.desp);
    RenderizarTablaDB(currentOperariosData);
    // Se populan las notificaciones para que estén listas al abrir el panel,
    // pero sin encender el puntito rojo (no son "nuevas" en esta carga de página).
    generarNotificacionesEficiencia(currentOperariosData, false);
    renderizarComparacionKPIs();
});
}

// --------------------------------------------------------
// SISTEMA DE PESTAÑAS (TABS)
// --------------------------------------------------------
function switchTab(tab) {
    const viewDash = document.getElementById('viewDashboard');
    const viewDB = document.getElementById('viewDB');
    const btnDash = document.getElementById('btnTabDashboard');
    const btnDB = document.getElementById('btnTabDB');

    const activeClass = "px-5 py-1.5 text-sm rounded-lg bg-dark-700/80 text-white font-medium shadow-sm border border-dark-600/50 transition-all";
    const inactiveClass = "px-5 py-1.5 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-dark-700/50 transition-all border border-transparent";

    if (tab === 'dashboard') {
        viewDash.classList.remove('hidden');
        viewDash.classList.add('block');
        viewDB.classList.add('hidden');
        viewDB.classList.remove('block');

        btnDash.className = activeClass;
        btnDB.className = inactiveClass;
    } else {
        viewDB.classList.remove('hidden');
        viewDB.classList.add('block');
        viewDash.classList.add('hidden');
        viewDash.classList.remove('block');

        btnDB.className = activeClass;
        btnDash.className = inactiveClass;
    }
}

// --------------------------------------------------------
// FECHA DEL REPORTE
// Se muestra en dos lugares (header y arriba de la tabla DB) para
// que quede visible sin importar qué pestaña estés mandando en una
// captura de pantalla.
// --------------------------------------------------------
function actualizarFechaReporte() {
    const elHeader = document.getElementById('fechaReporte');
    const elDB = document.getElementById('fechaReporteDB');
    if (elHeader) elHeader.innerText = currentFechaReporte;
    if (elDB) elDB.innerText = currentFechaReporte;
}

// --------------------------------------------------------
// PERSISTENCIA (localStorage)
// --------------------------------------------------------
function guardarEstado() {
    try {
        const payload = {
            trData: currentTRData,
            opsData: currentOpsData,
            operariosData: currentOperariosData,
            fecha: currentFechaReporte,
            despachoEsOrdenesTR: despachoEsOrdenesTR
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('Error guardando en localStorage:', e);
        mostrarToast('No se pudo guardar el estado en este navegador (¿modo privado o almacenamiento lleno?).', 'danger');
    }
}

function cargarEstadoGuardado() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) { return null; }
}

function ConfigurarGraficosBase() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = '"Plus Jakarta Sans", sans-serif';
    Chart.defaults.plugins.tooltip.backgroundColor = '#1a1d27';
    Chart.defaults.plugins.tooltip.borderColor = '#262a36';
}

// --------------------------------------------------------
// ACTUALIZAR MÉTRICAS DEL DASHBOARD
// --------------------------------------------------------
let estadosSeleccionados = new Set(); // estados TR actualmente tildados en el filtro

function ActualizarDashboard(trData, abast, almac, pick, ctrl, desp) {
    currentOpsData = { abast, almac, pick, ctrl, desp };
    currentTRData = trData;
    guardarEstado();

    document.getElementById('cardAbastecimiento').innerText = abast.toLocaleString(LOCALE);
    document.getElementById('cardAlmacenamiento').innerText = almac.toLocaleString(LOCALE);
    document.getElementById('cardPicking').innerText = pick.toLocaleString(LOCALE);
    document.getElementById('cardControl').innerText = ctrl.toLocaleString(LOCALE);
    document.getElementById('cardDespacho').innerText = desp.toLocaleString(LOCALE);

    // La unidad de la tarjeta Despacho cambia según de dónde salió el número:
    // si vino del archivo de Flujo Operativo son unidades reales; si sólo
    // subiste el archivo de TR's, es un conteo de órdenes DISPATCHED (otra escala).
    const lblDespacho = document.getElementById('lblUnidadDespacho');
    if (lblDespacho) lblDespacho.innerText = despachoEsOrdenesTR ? 'órdenes (TR)' : 'unidades';

    // Aviso visible (no sólo la etiqueta chica de la tarjeta) de que el número
    // de Despacho no son unidades reales, para que no se lea como si lo fueran.
    const avisoDesp = document.getElementById('avisoDespacho');
    if (avisoDesp) {
        if (despachoEsOrdenesTR) {
            avisoDesp.classList.remove('hidden');
            avisoDesp.innerHTML = '<b>La tarjeta DESPACHO muestra órdenes (TR), no unidades reales.</b> No se cargó el archivo de Flujo Operativo (o no tenía la columna de despacho), así que se usó el conteo de órdenes DISPATCHED del archivo de TR\'s como referencia.';
        } else {
            avisoDesp.classList.add('hidden');
            avisoDesp.innerHTML = '';
        }
    }

    // Cada carga nueva empieza mostrando todos los estados (el set de estados
    // puede cambiar de un archivo a otro, así que no tiene sentido arrastrar
    // el filtro anterior).
    estadosSeleccionados = new Set(Object.keys(currentTRData));
    poblarFiltroEstados();
    renderizarSeccionTR();
}

// --------------------------------------------------------
// FILTRO DE ESTADOS TR (checkboxes en "Filtrar estados")
// --------------------------------------------------------
function filtrarEstados(trData) {
    const filtrado = {};
    Object.keys(trData).forEach(estado => {
        if (estadosSeleccionados.has(estado)) filtrado[estado] = trData[estado];
    });
    return filtrado;
}

function toggleFiltroEstadosPanel() {
    const panel = document.getElementById('panelFiltroEstados');
    if (panel) panel.classList.toggle('hidden');
}

function poblarFiltroEstados() {
    const cont = document.getElementById('listaFiltroEstados');
    if (!cont) return;
    const estados = Object.keys(currentTRData).sort();
    cont.innerHTML = estados.map(estado => {
        const checked = estadosSeleccionados.has(estado) ? 'checked' : '';
        const estadoEscapado = escapeHtml(estado).replace(/'/g, '&#39;');
        return `<label class="flex items-center gap-2 text-gray-300 hover:text-white cursor-pointer py-0.5">
            <input type="checkbox" ${checked} onchange="toggleEstadoFiltro('${estadoEscapado}')"
                class="rounded border-dark-600 bg-dark-900 text-brand-accent focus:ring-0 focus:ring-offset-0">
            ${escapeHtml(estado.replace(/_/g, ' '))}
        </label>`;
    }).join('') || '<p class="text-gray-500 text-center py-2">Sin estados cargados todavía.</p>';
    actualizarBadgeFiltroEstados();
}

function toggleEstadoFiltro(estado) {
    if (estadosSeleccionados.has(estado)) estadosSeleccionados.delete(estado);
    else estadosSeleccionados.add(estado);
    actualizarBadgeFiltroEstados();
    renderizarSeccionTR();
}

function seleccionarTodosEstados() {
    estadosSeleccionados = new Set(Object.keys(currentTRData));
    poblarFiltroEstados();
    renderizarSeccionTR();
}

function limpiarFiltroEstados() {
    estadosSeleccionados = new Set();
    poblarFiltroEstados();
    renderizarSeccionTR();
}

function actualizarBadgeFiltroEstados() {
    const badge = document.getElementById('filtroEstadosBadge');
    if (!badge) return;
    const total = Object.keys(currentTRData).length;
    const activos = estadosSeleccionados.size;
    if (activos < total) {
        badge.innerText = activos;
        badge.classList.remove('hidden');
        badge.classList.add('flex');
    } else {
        badge.classList.add('hidden');
        badge.classList.remove('flex');
    }
}

// --------------------------------------------------------
// RENDER DE LA SECCIÓN TR (tabla + gráficos), según el filtro activo
// --------------------------------------------------------
function renderizarSeccionTR() {
    const trDataFiltrada = filtrarEstados(currentTRData);

    const sortedTR = Object.entries(trDataFiltrada).sort((a, b) => b[1] - a[1]);
    const labels = sortedTR.map(item => item[0].replace(/_/g, ' '));
    const dataValues = sortedTR.map(item => item[1]);
    const totalTRs = dataValues.reduce((acc, val) => acc + val, 0);

    const tbody = document.getElementById('trTableBody');
    let trHtml = ''; // Buffer para evitar recalcular el DOM cientos de veces

    sortedTR.forEach(([estado, cantidad]) => {
        const porcentaje = totalTRs > 0 ? ((cantidad / totalTRs) * 100).toFixed(2) : '0.00';
        const badgeClass = BADGE_COLORS[estado] || 'bg-dark-700 text-gray-300';
        trHtml += `
            <tr class="hover:bg-dark-800/50 transition-colors">
                <td class="py-3"><span class="px-2 py-1 rounded text-xs font-semibold ${badgeClass}">${escapeHtml(estado.replace(/_/g, ' '))}</span></td>
                <td class="py-3 text-right font-medium text-white">${cantidad.toLocaleString(LOCALE)}</td>
                <td class="py-3 text-right text-gray-400">${porcentaje}%</td>
            </tr>`;
    });
    const sinEstadosCargados = Object.keys(currentTRData).length === 0;
    tbody.innerHTML = trHtml || `<tr><td colspan="3" class="py-6 text-center text-gray-500">${sinEstadosCargados ? 'Sin datos de TR\'s todavía.' : 'Ningún estado coincide con el filtro aplicado.'}</td></tr>`;

    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart(document.getElementById('trBarChart'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Cantidad', data: dataValues, backgroundColor: '#e52329', borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });

    const top5L = labels.slice(0, 5), top5V = dataValues.slice(0, 5);
    const restoV = dataValues.slice(5).reduce((a, b) => a + b, 0);
    const dl = restoV > 0 ? [...top5L, 'OTROS'] : top5L;
    const dv = restoV > 0 ? [...top5V, restoV] : top5V;
    const dc = restoV > 0 ? [...DOUGHNUT_COLORS.slice(0, 5), '#3f3f46'] : DOUGHNUT_COLORS.slice(0, 5);

    if (doughnutChartInstance) doughnutChartInstance.destroy();
    doughnutChartInstance = new Chart(document.getElementById('trDoughnutChart'), {
        type: 'doughnut',
        data: { labels: dl, datasets: [{ data: dv, backgroundColor: dc, borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false } } }
    });

    renderizarLeyendaDoughnut(dl, dv, dc, restoV > 0 ? totalTRs : dataValues.reduce((a, b) => a + b, 0));
}

function renderizarLeyendaDoughnut(labels, values, colors, total) {
    const cont = document.getElementById('doughnutLegend');
    if (!cont) return;
    cont.innerHTML = labels.map((l, i) => {
        const pct = total > 0 ? ((values[i] / total) * 100).toFixed(1) : '0.0';
        return `<li class="flex items-center justify-between">
            <span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full" style="background:${colors[i]}"></span>${escapeHtml(l)}</span>
            <span class="text-gray-400">${pct}%</span>
        </li>`;
    }).join('');
}

// --------------------------------------------------------
// MODALES Y LECTURA DE EXCEL
// --------------------------------------------------------
function abrirModalUpdate() { document.getElementById('modalUpdate').classList.remove('hidden'); }
function cerrarModalUpdate() { document.getElementById('modalUpdate').classList.add('hidden'); }

async function procesarArchivos() {
    const fileOps = document.getElementById('fileOps').files[0];
    const fileTR = document.getElementById('fileTR').files[0];
    const fileNomina = document.getElementById('fileNomina') ? document.getElementById('fileNomina').files[0] : null;

    if (!fileOps && !fileTR && !fileNomina) return alert("Selecciona al menos un archivo.");
    document.getElementById('btnProcesar').classList.add('opacity-50');
    if (document.getElementById('spinnerIcon')) document.getElementById('spinnerIcon').classList.remove('hidden');

    try {
        let nAbast = currentOpsData.abast, nAlmac = currentOpsData.almac, nPick = currentOpsData.pick, nCtrl = currentOpsData.ctrl, nDesp = currentOpsData.desp;
        const columnasFaltantes = [];
        let opsCargado = false; // ¿esta carga trajo un archivo de Flujo Operativo con filas?

        if (fileNomina) {
            const dataNomina = await leerExcel(fileNomina);
            const nomina = extraerNomina(dataNomina);
            if (nomina.length) {
                nominaGlobal = nomina;
                guardarNominaLocal(nominaGlobal);
            }
        }

        if (fileOps) {
            const dataOps = await leerExcel(fileOps);
            if (dataOps.length > 0) {
                const rAbast = sumarColumna(dataOps, COLUMNAS_OPS.abastecimiento);
                const rAlmac = sumarColumna(dataOps, COLUMNAS_OPS.almacenamiento);
                const rPick = sumarColumna(dataOps, COLUMNAS_OPS.picking);
                const rCtrl = sumarColumna(dataOps, COLUMNAS_OPS.control);
                const rDesp = sumarColumna(dataOps, COLUMNAS_OPS.despacho);

                nAbast = rAbast.total; nAlmac = rAlmac.total; nPick = rPick.total; nCtrl = rCtrl.total;
                if (rDesp.encontrada) { nDesp = rDesp.total; despachoEsOrdenesTR = false; }

                [['abastecimiento', rAbast], ['almacenamiento', rAlmac], ['picking', rPick], ['control', rCtrl], ['despacho', rDesp]]
                    .forEach(([key, r]) => { if (!r.encontrada) columnasFaltantes.push(ETIQUETAS_OPS[key]); });

                currentOperariosData = extraerOperariosDB(dataOps);
                generarNotificacionesEficiencia(currentOperariosData, true);
                opsCargado = true;
            } else {
                columnasFaltantes.push('El archivo de Flujo Operativo no tiene filas de datos.');
            }
        }

        if (fileTR) {
            const dataTR = await leerExcel(fileTR);
            const { estados: nuevosTR, columnasEncontradas } = extraerDatosTR(dataTR);
            if (Object.keys(nuevosTR).length > 0) {
                currentTRData = nuevosTR;
                if (!fileOps && currentTRData["DISPATCHED"]) { nDesp = currentTRData["DISPATCHED"]; despachoEsOrdenesTR = true; }
            } else {
                columnasFaltantes.push('No se pudo interpretar el archivo de Estados de TR\'s (revisá que tenga columnas de Estado y Cantidad).');
            }
        }

        mostrarAvisoColumnas(columnasFaltantes);

        currentFechaReporte = "Carga: " + new Date().toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        actualizarFechaReporte();

        ActualizarDashboard(currentTRData, nAbast, nAlmac, nPick, nCtrl, nDesp);
        RenderizarTablaDB(currentOperariosData);
        guardarEstado();
        guardarHistorial(opsCargado);
        renderizarComparacionKPIs();
        cerrarModalUpdate();

    } catch (error) {
        alert("Error procesando archivos.");
        console.error(error);
    } finally {
        document.getElementById('btnProcesar').classList.remove('opacity-50');
        if (document.getElementById('spinnerIcon')) document.getElementById('spinnerIcon').classList.add('hidden');
    }
}

function mostrarAvisoColumnas(faltantes) {
    const el = document.getElementById('avisoColumnas');
    if (!el) return;
    if (!faltantes || !faltantes.length) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<b>No se encontraron algunas columnas esperadas</b> (esas métricas pueden estar en 0 o desactualizadas):<br>` +
        faltantes.map(f => `• ${f}`).join('<br>');
}

function leerExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                resolve(XLSX.utils.sheet_to_json(firstSheet, { defval: 0 }));
            } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        reader.readAsArrayBuffer(file);
    });
}

function sumarColumna(datos, alias) {
    if (!datos.length) return { total: 0, encontrada: false };
    const cols = Object.keys(datos[0]);
    const realName = cols.find(c => alias.some(a => a.toLowerCase() === fixMojibake(c).toLowerCase()));
    if (!realName) return { total: 0, encontrada: false };
    const total = datos.reduce((sum, f) => sum + parseNumero(f[realName]), 0);
    return { total, encontrada: true };
}

// --------------------------------------------------------
// EXTRACCIÓN TR (PARA ARCHIVOS EN CRUDO)
// --------------------------------------------------------
function extraerDatosTR(datos) {
    let nuevos = {};
    if (!datos || datos.length === 0) return { estados: nuevos, columnasEncontradas: false };

    const aliasesEstado = ['estado', 'estado tr'];
    const aliasesCantidad = ['cantidad solicitada', 'cantidad', 'cant. solicitada', 'solicitada'];

    const cols = Object.keys(datos[0]);
    const keyEstado = cols.find(c => aliasesEstado.some(a => fixMojibake(c).toLowerCase().includes(a)));
    const keyCantidad = cols.find(c => aliasesCantidad.some(a => fixMojibake(c).toLowerCase().includes(a)));

    datos.forEach(f => {
        let est = "";
        let cant = 0;

        if (keyEstado && keyCantidad) {
            est = fixMojibake(String(f[keyEstado])).trim();
            cant = parseNumero(f[keyCantidad]);
        } else {
            // Si no encuentra la columna por nombre, sólo asume que es un resumen
            // si la estructura tiene sentido (2 o 3 columnas). Evita leer un
            // N° de orden como si fuera un "estado".
            const val = Object.values(f);
            if (val.length <= 3 && val.length >= 2) {
                est = fixMojibake(String(val[0])).trim();
                cant = parseNumero(val[1]);
            }
        }

        if (est && est !== "0" && est !== "undefined" && !est.toLowerCase().includes("total general")) {
            nuevos[est] = (nuevos[est] || 0) + cant;
        }
    });

    return { estados: nuevos, columnasEncontradas: !!(keyEstado && keyCantidad) };
}

// --------------------------------------------------------
// LÓGICA DE EXTRACCIÓN DB (EFICIENCIA Y ZONA)
// --------------------------------------------------------
// Columnas del Excel -> zona, en el mismo orden que aparecen las tarjetas KPI
const ZONA_COLUMNAS_DB = [
    ['Abastecimiento', COLUMNAS_OPS.abastecimiento],
    ['Almacenamiento', COLUMNAS_OPS.almacenamiento],
    ['Picking', COLUMNAS_OPS.picking],
    ['Control', COLUMNAS_OPS.control],
    ['Despacho', COLUMNAS_OPS.despacho],
];

function extraerOperariosDB(datos) {
    const buscarLlave = (fila, aliases) => {
        const key = Object.keys(fila).find(k => aliases.some(a => a.toLowerCase() === fixMojibake(k).toLowerCase()));
        return key ? parseNumero(fila[key]) : 0;
    };

    // Un operario que pickeó y también controló aparece en el Excel como
    // UNA sola fila con ambas columnas cargadas (ej: Brenda Centurión con
    // Cantidad ingresada=1040 y Cantidad controlada=586 en la misma fila).
    // Antes se sumaban en un único total bajo la zona dominante, perdiendo
    // el detalle; ahora se genera una fila por cada tarea con actividad,
    // agrupada por operario + zona (por si el operario aparece en más de
    // una fila del archivo, ej. un resumen por día).
    const porOperarioYZona = {}; // clave: nombreNormalizado + '||' + zona
    const nombreOriginal = {};   // nombreNormalizado -> nombre tal como se vio la primera vez

    datos.forEach(fila => {
        const nombreCol = Object.keys(fila).find(k => ['nombre y apellido', 'nombre', 'operario'].includes(fixMojibake(k).toLowerCase()));
        const nombreRaw = nombreCol ? fixMojibake(String(fila[nombreCol] || '')).trim() : '';
        const nombre = nombreRaw || 'Desconocido';
        const claveNombre = normalizarNombre(nombre);
        if (!nombreOriginal[claveNombre]) nombreOriginal[claveNombre] = nombre;

        ZONA_COLUMNAS_DB.forEach(([zona, aliases]) => {
            const cantidad = buscarLlave(fila, aliases);
            if (cantidad === 0) return; // sin actividad en esta tarea, no genera fila

            const clave = claveNombre + '||' + zona;
            if (!porOperarioYZona[clave]) porOperarioYZona[clave] = { claveNombre, zona, total: 0 };
            porOperarioYZona[clave].total += cantidad;
        });
    });

    let operarios = Object.values(porOperarioYZona).map(({ claveNombre, zona, total }) => {
        const nombre = nombreOriginal[claveNombre];
        const objetivo = OBJETIVOS_ZONA[zona] || 1500;
        const eficienciaPct = (total / objetivo) * 100;

        // Cruce con la nómina cargada (local o backend, ver cargarNominaDesdeBD)
        const operarioEnNomina = nominaGlobal.find(n => n.nombre && normalizarNombre(n.nombre) === claveNombre);
        const turnoAsignado = operarioEnNomina ? operarioEnNomina.turno : 'Sin Turno';

        return { nombre, total, zona, objetivo, eficienciaPct, turno: turnoAsignado };
    });

    return operarios.sort((a, b) => b.eficienciaPct - a.eficienciaPct);
}

// --------------------------------------------------------
// RENDERIZAR TABLA DE EFICIENCIA (Con Alertas Visuales)
// --------------------------------------------------------
let ordenDB = { campo: 'eficienciaPct', direccion: 'desc' };
let vistaDB = 'tarea'; // 'tarea' (una fila por tarea) | 'combinada' (una fila por operario)
let ultimaVistaDB = []; // lo que está actualmente en pantalla (filtrado+ordenado+combinado), para exportar

function RenderizarTablaDB(operarios) {
    currentOperariosData = operarios || [];
    poblarFiltroTurnosDB(currentOperariosData);
    actualizarIndicadoresOrden();
    aplicarFiltrosDB();
    renderizarComparativaTurnos(currentOperariosData);
}

// --------------------------------------------------------
// ANÁLISIS FINAL POR TURNO
// Compara, para cada turno, cuánto produjo en cada una de las
// 4 tareas principales (se suma op.total de los operarios cuya
// zona dominante es esa tarea). Usa siempre el dataset completo,
// sin verse afectado por los filtros de la tabla de arriba.
// --------------------------------------------------------
function calcularProductividadPorTurno(operarios) {
    const porTurno = {};
    (operarios || []).forEach(op => {
        if (!ZONAS_COMPARATIVA.includes(op.zona)) return; // ignora Despacho y Sin Asignar
        if (!porTurno[op.turno]) {
            porTurno[op.turno] = {};
            ZONAS_COMPARATIVA.forEach(z => { porTurno[op.turno][z] = 0; });
        }
        porTurno[op.turno][op.zona] += op.total;
    });
    return porTurno;
}

function renderizarComparativaTurnos(operarios) {
    const porTurno = calcularProductividadPorTurno(operarios);
    const turnos = Object.keys(porTurno).sort((a, b) => a.localeCompare(b));

    const tbody = document.getElementById('turnosComparativaBody');
    if (tbody) {
        if (!turnos.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-gray-500">No hay datos suficientes para comparar turnos.</td></tr>';
        } else {
            const maximos = {};
            ZONAS_COMPARATIVA.forEach(zona => {
                maximos[zona] = Math.max(...turnos.map(t => porTurno[t][zona]));
            });

            tbody.innerHTML = turnos.map(turno => {
                const datos = porTurno[turno];
                const total = ZONAS_COMPARATIVA.reduce((sum, z) => sum + datos[z], 0);
                const celdas = ZONAS_COMPARATIVA.map(zona => {
                    const esLider = datos[zona] > 0 && datos[zona] === maximos[zona];
                    return `<td class="p-3 text-right ${esLider ? 'text-white font-bold' : 'text-gray-300'}">
                        ${datos[zona].toLocaleString(LOCALE)}${esLider ? ' <i data-lucide="crown" class="w-3 h-3 inline text-brand-warning align-text-top"></i>' : ''}
                    </td>`;
                }).join('');
                return `<tr class="hover:bg-dark-800/50 transition-colors">
                    <td class="p-3 font-medium text-white">${escapeHtml(turno)}</td>
                    ${celdas}
                    <td class="p-3 text-right font-bold text-white">${total.toLocaleString(LOCALE)}</td>
                </tr>`;
            }).join('');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    const canvas = document.getElementById('turnosComparativaChart');
    if (!canvas) return;
    if (turnosChartInstance) { turnosChartInstance.destroy(); turnosChartInstance = null; }
    if (!turnos.length) return;

    turnosChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: turnos,
            datasets: ZONAS_COMPARATIVA.map(zona => ({
                label: zona,
                data: turnos.map(t => porTurno[t][zona]),
                backgroundColor: ZONA_COLOR_HEX[zona],
                borderRadius: 4,
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 12 } } },
            scales: { x: { grid: { display: false } } }
        }
    });
}

// --------------------------------------------------------
// FILTROS DE LA TABLA DB (nombre / zona / turno)
// --------------------------------------------------------
function poblarFiltroTurnosDB(operarios) {
    const sel = document.getElementById('filtroTurnoDB');
    if (!sel) return;
    const valorActual = sel.value;
    const turnos = [...new Set(operarios.map(op => op.turno))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = '<option value="">Todos los turnos</option>' +
        turnos.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if (turnos.includes(valorActual)) sel.value = valorActual;
}

function limpiarFiltrosDB() {
    const nombreEl = document.getElementById('filtroNombreDB');
    const zonaEl = document.getElementById('filtroZonaDB');
    const turnoEl = document.getElementById('filtroTurnoDB');
    if (nombreEl) nombreEl.value = '';
    if (zonaEl) zonaEl.value = '';
    if (turnoEl) turnoEl.value = '';
    aplicarFiltrosDB();
}

function aplicarFiltrosDB() {
    const nombreEl = document.getElementById('filtroNombreDB');
    const zonaEl = document.getElementById('filtroZonaDB');
    const turnoEl = document.getElementById('filtroTurnoDB');

    const nombreFiltro = nombreEl ? normalizarNombre(nombreEl.value) : '';
    const zonaFiltro = zonaEl ? zonaEl.value : '';
    const turnoFiltro = turnoEl ? turnoEl.value : '';

    // Los filtros se aplican siempre sobre las filas por tarea (así "filtrar
    // por Picking" muestra sólo lo que se hizo en Picking, incluso en vista
    // combinada); recién después se combina si corresponde.
    let filtrados = (currentOperariosData || []).filter(op => {
        if (nombreFiltro && !normalizarNombre(op.nombre).includes(nombreFiltro)) return false;
        if (zonaFiltro && op.zona !== zonaFiltro) return false;
        if (turnoFiltro && op.turno !== turnoFiltro) return false;
        return true;
    });

    const datosVista = vistaDB === 'combinada' ? combinarPorOperario(filtrados) : filtrados;
    ultimaVistaDB = ordenarOperarios(datosVista);
    renderizarFilasDB(ultimaVistaDB);
}

// --------------------------------------------------------
// VISTA COMBINADA: junta las filas por tarea de un mismo
// operario en una sola, sumando unidades y metas (la eficiencia
// combinada = total hecho / suma de metas de las tareas que
// realizó, no un promedio de porcentajes de escalas distintas).
// --------------------------------------------------------
function combinarPorOperario(operarios) {
    const grupos = {};
    operarios.forEach(op => {
        const clave = normalizarNombre(op.nombre);
        if (!grupos[clave]) {
            grupos[clave] = { nombre: op.nombre, turno: op.turno, zonas: [], total: 0, objetivo: 0 };
        }
        grupos[clave].zonas.push(op.zona);
        grupos[clave].total += op.total;
        grupos[clave].objetivo += op.objetivo;
    });
    return Object.values(grupos).map(g => ({
        nombre: g.nombre,
        turno: g.turno,
        zona: g.zonas.join(', '),
        zonas: g.zonas,
        total: g.total,
        objetivo: g.objetivo,
        eficienciaPct: g.objetivo > 0 ? (g.total / g.objetivo) * 100 : 0,
    }));
}

function toggleVistaDB() {
    vistaDB = vistaDB === 'tarea' ? 'combinada' : 'tarea';
    const texto = document.getElementById('btnVistaDBTexto');
    const btn = document.getElementById('btnVistaDB');
    if (texto) texto.innerText = vistaDB === 'combinada' ? 'Vista: Combinada' : 'Vista: Por tarea';
    if (btn) btn.classList.toggle('text-brand-accent', vistaDB === 'combinada');
    aplicarFiltrosDB();
}

// --------------------------------------------------------
// ORDEN DE LA TABLA DB (clic en headers)
// --------------------------------------------------------
function ordenarOperarios(lista) {
    const { campo, direccion } = ordenDB;
    const factor = direccion === 'asc' ? 1 : -1;
    return [...lista].sort((a, b) => {
        const va = a[campo], vb = b[campo];
        if (typeof va === 'string') return va.localeCompare(vb) * factor;
        return (va - vb) * factor;
    });
}

function ordenarPorColumna(campo) {
    if (ordenDB.campo === campo) {
        ordenDB.direccion = ordenDB.direccion === 'asc' ? 'desc' : 'asc';
    } else {
        ordenDB.campo = campo;
        ordenDB.direccion = (campo === 'eficienciaPct') ? 'desc' : 'asc';
    }
    actualizarIndicadoresOrden();
    aplicarFiltrosDB();
}

function actualizarIndicadoresOrden() {
    ['nombre', 'zona', 'turno', 'eficienciaPct'].forEach(campo => {
        const el = document.getElementById('ordenIcon-' + campo);
        if (!el) return;
        el.innerText = campo === ordenDB.campo ? (ordenDB.direccion === 'asc' ? '▲' : '▼') : '';
    });
}

// --------------------------------------------------------
// RENDER DE FILAS (con barra de progreso de eficiencia)
// --------------------------------------------------------
function renderizarFilasDB(operarios) {
    const tbody = document.getElementById('dbTableBody');
    const tfoot = document.getElementById('dbTableFoot');
    if (!tbody) return;

    if (!operarios || operarios.length === 0) {
        const hayDatos = currentOperariosData && currentOperariosData.length;
        tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-gray-500">${hayDatos ? 'Ningún operario coincide con los filtros aplicados.' : 'No hay datos de operarios para mostrar.'}</td></tr>`;
        if (tfoot) tfoot.classList.add('hidden');
        return;
    }

    const getZoneColor = (zona) => {
        const bgColors = {
            'Abastecimiento': 'bg-brand-warning/20 text-brand-warning',
            'Almacenamiento': 'bg-brand-accent/20 text-brand-accent',
            'Picking': 'bg-brand-purple/20 text-brand-purple',
            'Control': 'bg-brand-success/20 text-brand-success',
            'Despacho': 'bg-blue-500/20 text-blue-500'
        };
        return bgColors[zona] || 'bg-dark-700 text-gray-400';
    };

    let tableHtml = ''; // Se arma el HTML completo en variable y se inyecta una sola vez

    operarios.forEach((op) => {
        const isGoalMet = op.eficienciaPct >= 100;
        const isDanger = op.eficienciaPct < 70;

        const colorEficiencia = isGoalMet ? 'text-brand-success' : (isDanger ? 'text-brand-danger' : 'text-brand-warning');
        const colorBarra = isGoalMet ? 'bg-brand-success' : (isDanger ? 'bg-brand-danger' : 'bg-brand-warning');
        const rowHighlight = isDanger ? 'border-l-4 border-brand-danger bg-brand-danger/5' : 'border-l-4 border-transparent';
        const anchoBarra = Math.max(0, Math.min(100, op.eficienciaPct));

        // En vista combinada (op.zonas) un operario puede tener varias
        // zonas: se muestra un badge por cada una en vez de un solo texto.
        const badgesZona = (op.zonas || [op.zona]).map(z =>
            `<span class="px-2 py-1 rounded text-xs font-semibold ${getZoneColor(z)} mr-1 mb-1 inline-block">${escapeHtml(z)}</span>`
        ).join('');

        tableHtml += `
            <tr class="hover:bg-dark-800/50 transition-colors ${rowHighlight}">
                <td class="p-3 font-medium text-white">${escapeHtml(op.nombre)}</td>
                <td class="p-3">${badgesZona}</td>
                <td class="p-3 text-center text-gray-400 font-semibold text-xs tracking-wider uppercase">${escapeHtml(op.turno)}</td>
                <td class="p-3 text-right">
                    <div class="flex flex-col items-end gap-1">
                        <span class="font-bold ${colorEficiencia}">${op.eficienciaPct.toFixed(1)}%</span>
                        <div class="w-28 h-1.5 bg-dark-700 rounded-full overflow-hidden">
                            <div class="h-full ${colorBarra} rounded-full" style="width:${anchoBarra}%"></div>
                        </div>
                        <span class="text-xs text-gray-500">${op.total.toLocaleString(LOCALE)} / ${op.objetivo.toLocaleString(LOCALE)} u.</span>
                    </div>
                </td>
            </tr>`;
    });
    tbody.innerHTML = tableHtml;

    // Total de unidades de lo que está actualmente listado (todos si no hay
    // filtro, o sólo el turno/zona/búsqueda filtrada) — se actualiza solo.
    // Un mismo operario puede tener varias filas (una por cada tarea que
    // realizó), así que la cantidad de "operarios" se cuenta por nombre
    // único, no por fila.
    if (tfoot) {
        const totalUnidades = operarios.reduce((sum, op) => sum + op.total, 0);
        const operariosUnicos = new Set(operarios.map(op => normalizarNombre(op.nombre))).size;
        const totalEl = document.getElementById('dbTotalUnidades');
        const etiquetaEl = document.getElementById('dbTotalEtiqueta');
        if (totalEl) totalEl.innerText = totalUnidades.toLocaleString(LOCALE);
        if (etiquetaEl) {
            etiquetaEl.innerText = vistaDB === 'combinada'
                ? `(${operariosUnicos} operario${operariosUnicos === 1 ? '' : 's'})`
                : `(${operariosUnicos} operario${operariosUnicos === 1 ? '' : 's'}, ${operarios.length} tarea${operarios.length === 1 ? '' : 's'})`;
        }
        tfoot.classList.remove('hidden');
    }
}

// --------------------------------------------------------
// EXPORTAR LA TABLA DB A EXCEL
// Exporta exactamente lo que se está viendo: respeta los filtros
// de nombre/zona/turno, el orden de columna activo y si está en
// vista "Por tarea" o "Combinada".
// --------------------------------------------------------
function exportarTablaDB() {
    if (!ultimaVistaDB.length) {
        alert('No hay datos para exportar (revisá los filtros aplicados).');
        return;
    }

    const filasExport = ultimaVistaDB.map(op => ({
        'Nombre y Apellido': op.nombre,
        'Zona': op.zonas ? op.zonas.join(', ') : op.zona,
        'Turno': op.turno,
        'Total Unidades': op.total,
        'Meta': op.objetivo,
        'Eficiencia %': Number(op.eficienciaPct.toFixed(1)),
    }));

    const hoja = XLSX.utils.json_to_sheet(filasExport);
    hoja['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 }];

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Eficiencia');

    const fecha = new Date().toISOString().slice(0, 10);
    const sufijoVista = vistaDB === 'combinada' ? 'combinada' : 'por_tarea';
    XLSX.writeFile(libro, `eficiencia_operarios_${sufijoVista}_${fecha}.xlsx`);
}

// --------------------------------------------------------
// CENTRO DE NOTIFICACIONES Y ALERTAS
// --------------------------------------------------------
function toggleCentroNotificaciones() {
    const panel = document.getElementById('panelNotificaciones');
    if (!panel) return;

    panel.classList.toggle('hidden');

    if (!panel.classList.contains('hidden')) {
        const badge = document.getElementById('notifBadge');
        if (badge) badge.classList.add('hidden');
    }
}

function generarNotificacionesEficiencia(operarios, mostrarBadge) {
    if (mostrarBadge === undefined) mostrarBadge = true;
    const contenedor = document.getElementById('listaNotificaciones');
    const badge = document.getElementById('notifBadge');
    if (!contenedor) return;

    if (!operarios || operarios.length === 0) {
        contenedor.innerHTML = '<p class="text-gray-500 text-center py-4">No hay datos de eficiencia disponibles.</p>';
        if (badge) badge.classList.add('hidden');
        return;
    }

    // Un mismo operario puede tener varias filas (una por tarea), así que
    // "cuántos operarios" se cuenta por persona única, no por fila —
    // si no, alguien que supera el 100% en dos tareas contaría como dos.
    const totalOperarios = new Set(operarios.map(op => normalizarNombre(op.nombre))).size;
    const mejorOperario = operarios[0]; // ya viene ordenado por eficienciaPct desc
    const operariosDestacados = new Set(
        operarios.filter(op => op.eficienciaPct >= 100).map(op => normalizarNombre(op.nombre))
    ).size;
    const operariosBajoRendimiento = operarios.filter(op => op.eficienciaPct < 70);

    let notifs = [];

    if (mejorOperario && mejorOperario.eficienciaPct > 0) {
        notifs.push({
            titulo: 'Top Eficiencia del Turno',
            desc: `<b>${escapeHtml(mejorOperario.nombre)}</b> alcanzó un espectacular <b>${mejorOperario.eficienciaPct.toFixed(1)}%</b> en la zona de <b>${escapeHtml(mejorOperario.zona)}</b>.`,
            tipo: 'success',
            icon: 'award',
            tiempo: 'Hace un momento'
        });
    }

    notifs.push({
        titulo: 'Rendimiento Global',
        desc: `Actualmente, <b>${operariosDestacados} de ${totalOperarios} operarios</b> alcanzaron o superaron el objetivo productivo (100% de eficiencia) en al menos una tarea.`,
        tipo: 'info',
        icon: 'info',
        tiempo: 'Actualizado'
    });

    if (operariosBajoRendimiento.length > 0) {
        // Se indica la zona junto al nombre porque un mismo operario puede
        // aparecer más de una vez (una por cada tarea por debajo del 70%).
        const listaNombres = operariosBajoRendimiento.map(op =>
            `<li>${escapeHtml(op.nombre)} <span class="text-gray-500">(${escapeHtml(op.zona)})</span>: <b class="text-white">${op.eficienciaPct.toFixed(1)}%</b></li>`
        ).join('');

        notifs.push({
            titulo: 'Alerta de Rendimiento (< 70%)',
            desc: `Los siguientes operarios están por debajo del rendimiento esperado:<br><ul class="mt-1.5 ml-4 list-disc text-gray-400 space-y-0.5">${listaNombres}</ul>`,
            tipo: 'danger',
            icon: 'alert-triangle',
            tiempo: 'Requiere atención'
        });
    }

    contenedor.innerHTML = notifs.map(n => {
        const colorClass = n.tipo === 'success' ? 'text-brand-success' :
            n.tipo === 'danger' ? 'text-brand-danger' : 'text-blue-400';

        return `
        <div class="bg-dark-900 border border-dark-700 p-3 rounded-xl flex gap-3 items-start">
            <div class="p-2 rounded-lg bg-dark-800 ${colorClass} flex-shrink-0">
                <i data-lucide="${n.icon}" class="w-4 h-4"></i>
            </div>
            <div class="flex-1">
                <h5 class="text-white font-semibold mb-0.5">${n.titulo}</h5>
                <p class="text-gray-400 leading-relaxed">${n.desc}</p>
                <span class="text-[10px] text-gray-500 mt-1 block">${n.tiempo}</span>
            </div>
        </div>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (badge) { if (mostrarBadge) badge.classList.remove('hidden'); else badge.classList.add('hidden'); }
}

// --------------------------------------------------------
// HISTORIAL (ahora sí guarda y muestra algo)
// --------------------------------------------------------
function cargarHistorial() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

// --------------------------------------------------------
// COMPARACIÓN VS. LA CARGA ANTERIOR (usa el historial ya guardado)
// La última entrada del historial siempre coincide con el estado
// actualmente mostrado (guardarHistorial se llama junto con cada
// actualización), así que la "carga anterior" es la anteúltima.
// --------------------------------------------------------
function renderizarComparacionKPIs() {
    const hist = cargarHistorial();
    const previo = hist.length >= 2 ? hist[hist.length - 2] : null;

    Object.keys(CAMPOS_DELTA).forEach(campo => {
        const el = document.getElementById('delta' + CAMPOS_DELTA[campo]);
        if (!el) return;

        if (!previo) { el.innerHTML = ''; return; }

        const actual = currentOpsData[campo] || 0;
        const anterior = previo[campo] || 0;

        if (anterior === 0) {
            el.innerHTML = actual > 0 ? '<span class="text-blue-400">● Nuevo</span>' : '';
            return;
        }

        const deltaPct = ((actual - anterior) / anterior) * 100;
        const subio = deltaPct >= 0;
        const color = subio ? 'text-brand-success' : 'text-brand-danger';
        const flecha = subio ? '▲' : '▼';
        el.innerHTML = `<span class="${color} font-semibold">${flecha} ${Math.abs(deltaPct).toFixed(1)}%</span> <span class="text-gray-600">vs. anterior</span>`;
    });
}

function guardarHistorial(opsActualizado) {
    try {
        let hist = cargarHistorial();
        // currentOperariosData ya viene ordenado por eficienciaPct desc; un
        // mismo operario puede tener varias filas (una por tarea), así que
        // "totalOperarios" se cuenta por persona única, no por fila.
        const topOperario = currentOperariosData && currentOperariosData.length ? currentOperariosData[0] : null;
        const totalOperariosUnicos = currentOperariosData
            ? new Set(currentOperariosData.map(op => normalizarNombre(op.nombre))).size
            : 0;
        hist.push({
            fecha: currentFechaReporte,
            timestamp: new Date().toISOString(),
            dia: fechaLocalISO(),
            opsActualizado: opsActualizado !== false, // undefined (llamadas viejas) => true
            abast: currentOpsData.abast, almac: currentOpsData.almac, pick: currentOpsData.pick,
            ctrl: currentOpsData.ctrl, desp: currentOpsData.desp,
            despachoEsOrdenesTR: despachoEsOrdenesTR,
            totalOperarios: totalOperariosUnicos,
            topOperario: topOperario ? topOperario.nombre : null,
            topZona: topOperario ? topOperario.zona : null,
            topEficiencia: topOperario ? topOperario.eficienciaPct : null,
            // Snapshot completo para poder armar el reporte semanal después.
            operariosData: (currentOperariosData || []).map(op => ({
                nombre: op.nombre, total: op.total, zona: op.zona,
                objetivo: op.objetivo, turno: op.turno
            })),
            trData: Object.assign({}, currentTRData),
        });
        if (hist.length > 60) hist = hist.slice(hist.length - 60);

        // Con el snapshot de operarios cada entrada pesa más; si el storage
        // se llena, se recorta el historial progresivamente antes de rendirse.
        guardarConReintento(HISTORY_KEY, hist);
    } catch (e) {
        console.warn('No se pudo guardar el historial:', e);
        mostrarToast('No se pudo guardar el historial en este navegador.', 'danger');
    }
}

// Intenta guardar; si el navegador rechaza por falta de espacio, va
// recortando las entradas más viejas y reintenta.
function guardarConReintento(clave, arr) {
    let intento = [...arr];
    for (let i = 0; i < 6; i++) {
        try {
            localStorage.setItem(clave, JSON.stringify(intento));
            if (intento.length < arr.length) {
                mostrarToast(`El historial se recortó a las últimas ${intento.length} cargas por falta de espacio en el navegador.`, 'info');
            }
            return;
        } catch (e) {
            if (intento.length <= 5) throw e;
            intento = intento.slice(Math.ceil(intento.length / 2)); // descarta la mitad más vieja
        }
    }
}

let histTab = 'cargas';
let reportePeriodoActual = null; // último reporte calculado, para exportar a PDF

function diaDeEntrada(e) {
    return (e && (e.dia || (e.timestamp || '').slice(0, 10))) || '';
}

function abrirModalHistorial() {
    const r = rangoPreset('7dias');
    const desdeEl = document.getElementById('histDesde');
    const hastaEl = document.getElementById('histHasta');
    if (desdeEl && !desdeEl.value) desdeEl.value = r.desde;
    if (hastaEl && !hastaEl.value) hastaEl.value = r.hasta;
    switchHistTab(histTab);
    renderizarSeccionHistorial();
    document.getElementById('modalHistorial').classList.remove('hidden');
}
function cerrarModalHistorial() { document.getElementById('modalHistorial').classList.add('hidden'); }
function limpiarHistorial() {
    if (!confirm('¿Borrar todo el historial guardado en este navegador?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderizarSeccionHistorial();
}
// alias por compatibilidad con llamadas viejas
function renderizarHistorial() { renderizarSeccionHistorial(); }

function switchHistTab(tab) {
    histTab = tab;
    const vCargas = document.getElementById('histViewCargas');
    const vReporte = document.getElementById('histViewReporte');
    const bCargas = document.getElementById('btnHistCargas');
    const bReporte = document.getElementById('btnHistReporte');
    const act = 'px-4 py-1.5 text-sm rounded-lg bg-dark-700/80 text-white font-medium border border-dark-600/50 transition-all';
    const inact = 'px-4 py-1.5 text-sm rounded-lg text-gray-400 hover:text-white hover:bg-dark-700/50 transition-all border border-transparent';
    const esReporte = tab === 'reporte';
    if (vReporte) vReporte.classList.toggle('hidden', !esReporte);
    if (vCargas) vCargas.classList.toggle('hidden', esReporte);
    if (bReporte) bReporte.className = esReporte ? act : inact;
    if (bCargas) bCargas.className = esReporte ? inact : act;
}

function setRangoHistorial(preset) {
    let r;
    if (preset === 'todo') {
        const dias = cargarHistorial().map(diaDeEntrada).filter(Boolean).sort();
        r = dias.length ? { desde: dias[0], hasta: dias[dias.length - 1] } : rangoPreset('7dias');
    } else {
        r = rangoPreset(preset);
    }
    const desdeEl = document.getElementById('histDesde');
    const hastaEl = document.getElementById('histHasta');
    if (desdeEl) desdeEl.value = r.desde;
    if (hastaEl) hastaEl.value = r.hasta;
    renderizarSeccionHistorial();
}

function filtrarHistorialPorRango(desde, hasta) {
    return cargarHistorial().filter(e => {
        const d = diaDeEntrada(e);
        return d && (!desde || d >= desde) && (!hasta || d <= hasta);
    });
}

function renderizarSeccionHistorial() {
    const desde = (document.getElementById('histDesde') || {}).value || '';
    const hasta = (document.getElementById('histHasta') || {}).value || '';
    const entradas = filtrarHistorialPorRango(desde, hasta);

    const resumenEl = document.getElementById('histRangoResumen');
    if (resumenEl) {
        const dias = new Set(entradas.map(diaDeEntrada)).size;
        resumenEl.innerText = entradas.length
            ? `· ${entradas.length} carga${entradas.length === 1 ? '' : 's'} en ${dias} día${dias === 1 ? '' : 's'}`
            : '· sin cargas en este período';
    }

    renderizarListaCargas(entradas);
    reportePeriodoActual = armarReportePeriodo(entradas);
    renderizarReportePeriodo(reportePeriodoActual);
}

function renderizarListaCargas(entradas) {
    const cont = document.getElementById('listaHistorial');
    if (!cont) return;
    const lista = [...entradas].reverse();
    if (!lista.length) {
        cont.innerHTML = '<p class="text-gray-500 text-center py-6 text-sm">No hay cargas en este período. Probá ampliar el rango o tocar "Todo".</p>';
        return;
    }
    cont.innerHTML = lista.map(h => {
        const unidadDesp = h.despachoEsOrdenesTR ? 'órdenes TR' : 'u.';
        return `
        <div class="bg-dark-900 border border-dark-700 rounded-xl p-3 text-xs">
            <div class="flex justify-between items-center mb-2">
                <span class="text-white font-semibold">${escapeHtml(h.fecha || diaDeEntrada(h))}</span>
                ${h.opsActualizado === false ? '<span class="text-[10px] text-brand-warning bg-brand-warning/10 px-1.5 py-0.5 rounded">sólo TR</span>' : ''}
            </div>
            <div class="grid grid-cols-2 gap-1.5 text-gray-400">
                <span>Abastecimiento: <b class="text-gray-200">${(h.abast || 0).toLocaleString(LOCALE)}</b></span>
                <span>Almacenamiento: <b class="text-gray-200">${(h.almac || 0).toLocaleString(LOCALE)}</b></span>
                <span>Picking: <b class="text-gray-200">${(h.pick || 0).toLocaleString(LOCALE)}</b></span>
                <span>Control: <b class="text-gray-200">${(h.ctrl || 0).toLocaleString(LOCALE)}</b></span>
                <span class="col-span-2">Despacho: <b class="text-gray-200">${(h.desp || 0).toLocaleString(LOCALE)} ${unidadDesp}</b></span>
            </div>
            ${h.topOperario ? `<div class="mt-2 pt-2 border-t border-dark-700 text-gray-400">Top del día: <b class="text-brand-success">${escapeHtml(h.topOperario)}</b>${h.topZona ? ` <span class="text-gray-500">(${escapeHtml(h.topZona)})</span>` : ''} (${(h.topEficiencia || 0).toFixed(1)}%)</div>` : ''}
        </div>`;
    }).join('');
}

// --------------------------------------------------------
// AGREGACIÓN DEL REPORTE DE PERÍODO (función pura, testeable)
// Toma las entradas del historial de un rango y devuelve totales
// operativos, productividad acumulada por operario, comparativa
// por turno y estados TR del período.
// --------------------------------------------------------
function armarReportePeriodo(entradas) {
    // Una entrada por día calendario. Para operación y detalle de
    // operarios se prefiere la última carga del día que trajo un
    // archivo de Flujo Operativo; para TR, la última del día.
    const porDia = {};
    (entradas || []).forEach(e => {
        const dia = diaDeEntrada(e);
        if (!dia) return;
        if (!porDia[dia]) porDia[dia] = { ultima: e, conOps: null };
        if ((e.timestamp || '') >= (porDia[dia].ultima.timestamp || '')) porDia[dia].ultima = e;
        const tieneOps = e.opsActualizado !== false && Array.isArray(e.operariosData) && e.operariosData.length > 0;
        if (tieneOps && (!porDia[dia].conOps || (e.timestamp || '') >= (porDia[dia].conOps.timestamp || ''))) {
            porDia[dia].conOps = e;
        }
    });

    const dias = Object.keys(porDia).sort();
    const operaciones = { abast: 0, almac: 0, pick: 0, ctrl: 0, desp: 0 };
    const operacionesPorDia = [];
    const opMap = {};
    const trPeriodo = {};
    let diasConDetalle = 0;

    dias.forEach(dia => {
        const eOps = porDia[dia].conOps || porDia[dia].ultima;
        const eUlt = porDia[dia].ultima;

        ['abast', 'almac', 'pick', 'ctrl', 'desp'].forEach(k => { operaciones[k] += (eOps[k] || 0); });
        operacionesPorDia.push({
            dia,
            abast: eOps.abast || 0, almac: eOps.almac || 0, pick: eOps.pick || 0,
            ctrl: eOps.ctrl || 0, desp: eOps.desp || 0,
        });

        if (Array.isArray(eOps.operariosData) && eOps.operariosData.length) {
            diasConDetalle++;
            eOps.operariosData.forEach(op => {
                const clave = normalizarNombre(op.nombre) + '||' + op.zona;
                if (!opMap[clave]) {
                    opMap[clave] = { nombre: op.nombre, zona: op.zona, turno: op.turno, total: 0, metaAcum: 0, dias: new Set() };
                }
                opMap[clave].total += (op.total || 0);
                opMap[clave].metaAcum += (op.objetivo || 0);
                opMap[clave].dias.add(dia);
                if (op.turno) opMap[clave].turno = op.turno;
            });
        }

        if (eUlt.trData && typeof eUlt.trData === 'object') {
            Object.entries(eUlt.trData).forEach(([estado, cant]) => {
                trPeriodo[estado] = (trPeriodo[estado] || 0) + (Number(cant) || 0);
            });
        }
    });

    const operarios = Object.values(opMap).map(o => {
        const diasTrab = o.dias.size;
        return {
            nombre: o.nombre,
            zona: o.zona,
            turno: o.turno || 'Sin Turno',
            total: o.total,
            diasTrabajados: diasTrab,
            promedioDiario: diasTrab ? Math.round(o.total / diasTrab) : 0,
            metaPeriodo: o.metaAcum,
            eficienciaPct: o.metaAcum > 0 ? (o.total / o.metaAcum) * 100 : 0,
        };
    }).sort((a, b) => b.eficienciaPct - a.eficienciaPct);

    const porTurno = {};
    operarios.forEach(op => {
        if (!ZONAS_COMPARATIVA.includes(op.zona)) return;
        if (!porTurno[op.turno]) { porTurno[op.turno] = {}; ZONAS_COMPARATIVA.forEach(z => porTurno[op.turno][z] = 0); }
        porTurno[op.turno][op.zona] += op.total;
    });

    return {
        dias,
        rango: dias.length ? { desde: dias[0], hasta: dias[dias.length - 1] } : null,
        cantidadCargas: (entradas || []).length,
        diasConDetalle,
        operaciones,
        operacionesPorDia,
        operarios,
        operariosUnicos: new Set(operarios.map(o => normalizarNombre(o.nombre))).size,
        porTurno,
        trPeriodo,
    };
}

function renderizarReportePeriodo(rep) {
    const cont = document.getElementById('reportePeriodoContenido');
    if (!cont) return;

    if (!rep || !rep.dias.length) {
        cont.innerHTML = '<p class="text-gray-500 text-center py-8 text-sm">No hay cargas en el período seleccionado para armar un reporte.</p>';
        return;
    }

    const fmt = n => (n || 0).toLocaleString(LOCALE);
    const rango = rep.rango ? `${rep.rango.desde} a ${rep.rango.hasta}` : '';
    const o = rep.operaciones;
    const totalOps = o.abast + o.almac + o.pick + o.ctrl + o.desp;

    const tarjeta = (label, valor, color) => `
        <div class="bg-dark-900 border border-dark-700 rounded-xl p-3">
            <div class="text-[11px] text-gray-500 uppercase tracking-wide">${label}</div>
            <div class="text-lg font-bold ${color}">${fmt(valor)}</div>
        </div>`;

    let html = `
        <div>
            <div class="flex items-baseline justify-between mb-2 flex-wrap gap-1">
                <h4 class="text-white font-semibold text-sm">Resumen operativo del período</h4>
                <span class="text-xs text-gray-500">${escapeHtml(rango)} · ${rep.dias.length} día${rep.dias.length === 1 ? '' : 's'} con carga</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                ${tarjeta('Abastecimiento', o.abast, 'text-brand-warning')}
                ${tarjeta('Almacenamiento', o.almac, 'text-brand-accent')}
                ${tarjeta('Picking', o.pick, 'text-brand-purple')}
                ${tarjeta('Control', o.ctrl, 'text-brand-success')}
                ${tarjeta('Despacho', o.desp, 'text-blue-400')}
            </div>
            <div class="text-xs text-gray-500 mt-2">Total operativo del período: <b class="text-white">${fmt(totalOps)}</b> u.</div>
        </div>

        <div>
            <h4 class="text-white font-semibold text-sm mb-2">Operaciones por día</h4>
            <div class="overflow-x-auto custom-scrollbar">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="text-gray-400 border-b border-dark-700"><tr>
                        <th class="p-2">Día</th><th class="p-2 text-right">Abast.</th><th class="p-2 text-right">Almac.</th>
                        <th class="p-2 text-right">Picking</th><th class="p-2 text-right">Control</th><th class="p-2 text-right">Despacho</th>
                    </tr></thead>
                    <tbody class="divide-y divide-dark-800">
                        ${rep.operacionesPorDia.map(d => `<tr>
                            <td class="p-2 text-gray-300">${d.dia}</td>
                            <td class="p-2 text-right text-gray-300">${fmt(d.abast)}</td>
                            <td class="p-2 text-right text-gray-300">${fmt(d.almac)}</td>
                            <td class="p-2 text-right text-gray-300">${fmt(d.pick)}</td>
                            <td class="p-2 text-right text-gray-300">${fmt(d.ctrl)}</td>
                            <td class="p-2 text-right text-gray-300">${fmt(d.desp)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;

    if (rep.operarios.length) {
        html += `
        <div>
            <div class="flex items-baseline justify-between mb-2 flex-wrap gap-1">
                <h4 class="text-white font-semibold text-sm">Productividad por operario (${rep.operariosUnicos} operario${rep.operariosUnicos === 1 ? '' : 's'})</h4>
                <span class="text-[11px] text-gray-500">efic. = total del período / (meta diaria × días trabajados)</span>
            </div>
            <div class="overflow-x-auto custom-scrollbar max-h-72 overflow-y-auto">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="text-gray-400 border-b border-dark-700 bg-dark-800/80 sticky top-0"><tr>
                        <th class="p-2">Operario</th><th class="p-2">Turno</th><th class="p-2">Tarea</th>
                        <th class="p-2 text-right">Total</th><th class="p-2 text-right">Días</th>
                        <th class="p-2 text-right">Prom./día</th><th class="p-2 text-right">Efic.</th>
                    </tr></thead>
                    <tbody class="divide-y divide-dark-800">
                        ${rep.operarios.map(op => {
                            const c = op.eficienciaPct >= 100 ? 'text-brand-success' : (op.eficienciaPct < 70 ? 'text-brand-danger' : 'text-brand-warning');
                            return `<tr>
                                <td class="p-2 text-white">${escapeHtml(op.nombre)}</td>
                                <td class="p-2 text-gray-400 uppercase text-[10px]">${escapeHtml(op.turno)}</td>
                                <td class="p-2 text-gray-300">${escapeHtml(op.zona)}</td>
                                <td class="p-2 text-right text-gray-200">${fmt(op.total)}</td>
                                <td class="p-2 text-right text-gray-400">${op.diasTrabajados}</td>
                                <td class="p-2 text-right text-gray-400">${fmt(op.promedioDiario)}</td>
                                <td class="p-2 text-right font-bold ${c}">${op.eficienciaPct.toFixed(1)}%</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    } else {
        html += `<div class="text-xs text-brand-warning bg-brand-warning/10 border border-brand-warning/30 rounded-lg px-3 py-2">
            No hay detalle por operario en este período. El detalle por operario se guarda a partir de esta versión, así que va a estar disponible para las cargas nuevas.
        </div>`;
    }

    const turnos = Object.keys(rep.porTurno).sort((a, b) => a.localeCompare(b));
    if (turnos.length) {
        const maximos = {};
        ZONAS_COMPARATIVA.forEach(z => { maximos[z] = Math.max(...turnos.map(t => rep.porTurno[t][z])); });
        html += `
        <div>
            <h4 class="text-white font-semibold text-sm mb-2">Comparativa por turno (Abast. + Almac. + Picking + Control)</h4>
            <div class="overflow-x-auto custom-scrollbar">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="text-gray-400 border-b border-dark-700"><tr>
                        <th class="p-2">Turno</th>${ZONAS_COMPARATIVA.map(z => `<th class="p-2 text-right">${z}</th>`).join('')}<th class="p-2 text-right">Total</th>
                    </tr></thead>
                    <tbody class="divide-y divide-dark-800">
                        ${turnos.map(t => {
                            const d = rep.porTurno[t];
                            const tot = ZONAS_COMPARATIVA.reduce((s, z) => s + d[z], 0);
                            return `<tr>
                                <td class="p-2 text-white">${escapeHtml(t)}</td>
                                ${ZONAS_COMPARATIVA.map(z => {
                                    const lider = d[z] > 0 && d[z] === maximos[z];
                                    return `<td class="p-2 text-right ${lider ? 'text-white font-bold' : 'text-gray-300'}">${fmt(d[z])}${lider ? ' 👑' : ''}</td>`;
                                }).join('')}
                                <td class="p-2 text-right font-bold text-white">${fmt(tot)}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    const trEntries = Object.entries(rep.trPeriodo).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (trEntries.length) {
        const totalTR = trEntries.reduce((s, [, v]) => s + v, 0);
        html += `
        <div>
            <h4 class="text-white font-semibold text-sm mb-2">Estados de TR's (acumulado del período)</h4>
            <div class="overflow-x-auto custom-scrollbar">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="text-gray-400 border-b border-dark-700"><tr><th class="p-2">Estado</th><th class="p-2 text-right">Cantidad</th><th class="p-2 text-right">%</th></tr></thead>
                    <tbody class="divide-y divide-dark-800">
                        ${trEntries.map(([est, v]) => `<tr>
                            <td class="p-2 text-gray-300">${escapeHtml(est.replace(/_/g, ' '))}</td>
                            <td class="p-2 text-right text-gray-200">${fmt(v)}</td>
                            <td class="p-2 text-right text-gray-500">${totalTR ? ((v / totalTR) * 100).toFixed(1) : '0.0'}%</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }

    cont.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --------------------------------------------------------
// GENERACIÓN DE PDF (jsPDF + autotable, cargados por CDN)
// --------------------------------------------------------
function pdfDisponible() {
    return typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF;
}

function nuevoPDF(titulo, subtitulo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20);
    doc.text('Grupo Dexter', 14, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(80);
    doc.text(titulo, 14, 22);
    let y = 27;
    if (subtitulo) {
        doc.setFontSize(8.5); doc.setTextColor(130);
        doc.splitTextToSize(subtitulo, 180).forEach(linea => { doc.text(linea, 14, y); y += 4; });
    }
    doc.setTextColor(150); doc.setFontSize(7.5);
    doc.text('Generado ' + new Date().toLocaleString(LOCALE), 14, y);
    doc.__y = y + 5;
    return doc;
}

function seccionPDF(doc, titulo, head, body, opts) {
    if (doc.__y > 255) { doc.addPage(); doc.__y = 15; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20);
    doc.text(titulo, 14, doc.__y);
    doc.autoTable(Object.assign({
        head: [head], body,
        startY: doc.__y + 2,
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 1.5 },
        headStyles: { fillColor: [39, 39, 42], textColor: 255 },
        margin: { left: 14, right: 14 },
    }, opts || {}));
    doc.__y = doc.lastAutoTable.finalY + 8;
}

const ALINEAR_DERECHA = idx => idx.reduce((acc, i) => { acc[i] = { halign: 'right' }; return acc; }, {});

function exportarTablaDB() {
    if (!ultimaVistaDB.length) {
        alert('No hay datos para exportar (revisá los filtros aplicados).');
        return;
    }
    if (!pdfDisponible()) { alert('No se pudo cargar el generador de PDF. Revisá tu conexión e intentá de nuevo.'); return; }

    const filtros = [];
    const fN = (document.getElementById('filtroNombreDB') || {}).value;
    const fZ = (document.getElementById('filtroZonaDB') || {}).value;
    const fT = (document.getElementById('filtroTurnoDB') || {}).value;
    if (fN) filtros.push(`nombre "${fN}"`);
    if (fZ) filtros.push(`zona ${fZ}`);
    if (fT) filtros.push(`turno ${fT}`);

    const sub = `Eficiencia por operario · vista ${vistaDB === 'combinada' ? 'combinada' : 'por tarea'}`
        + (filtros.length ? ` · filtros: ${filtros.join(', ')}` : '')
        + (currentFechaReporte ? ` · ${currentFechaReporte}` : '');

    const doc = nuevoPDF('Reporte de eficiencia', sub);

    const body = ultimaVistaDB.map(op => [
        op.nombre,
        op.zonas ? op.zonas.join(', ') : op.zona,
        op.turno,
        (op.total || 0).toLocaleString(LOCALE),
        (op.objetivo || 0).toLocaleString(LOCALE),
        op.eficienciaPct.toFixed(1) + '%',
    ]);
    const totalU = ultimaVistaDB.reduce((s, op) => s + op.total, 0);
    body.push([
        { content: 'TOTAL', colSpan: 3, styles: { fontStyle: 'bold' } },
        { content: totalU.toLocaleString(LOCALE), styles: { fontStyle: 'bold', halign: 'right' } },
        '', '',
    ]);

    seccionPDF(doc, 'Detalle', ['Nombre y Apellido', 'Zona', 'Turno', 'Total', 'Meta', 'Efic. %'], body,
        { columnStyles: ALINEAR_DERECHA([3, 4, 5]) });

    doc.save(`eficiencia_${vistaDB === 'combinada' ? 'combinada' : 'por_tarea'}_${fechaLocalISO()}.pdf`);
}

function exportarReportePeriodoPDF() {
    const rep = reportePeriodoActual;
    if (!rep || !rep.dias.length) { alert('No hay datos en el período seleccionado para exportar.'); return; }
    if (!pdfDisponible()) { alert('No se pudo cargar el generador de PDF. Revisá tu conexión e intentá de nuevo.'); return; }

    const fmt = n => (n || 0).toLocaleString(LOCALE);
    const rango = rep.rango ? `${rep.rango.desde} a ${rep.rango.hasta}` : '';
    const doc = nuevoPDF('Reporte de período', `${rango} · ${rep.dias.length} día(s) con carga · ${rep.cantidadCargas} carga(s) registrada(s)`);

    const o = rep.operaciones;
    const totalOps = o.abast + o.almac + o.pick + o.ctrl + o.desp;
    seccionPDF(doc, 'Resumen operativo del período',
        ['Tarea', 'Total del período'],
        [
            ['Abastecimiento', fmt(o.abast)],
            ['Almacenamiento', fmt(o.almac)],
            ['Picking', fmt(o.pick)],
            ['Control', fmt(o.ctrl)],
            ['Despacho', fmt(o.desp)],
            [{ content: 'TOTAL OPERATIVO', styles: { fontStyle: 'bold' } }, { content: fmt(totalOps), styles: { fontStyle: 'bold', halign: 'right' } }],
        ],
        { columnStyles: ALINEAR_DERECHA([1]) });

    seccionPDF(doc, 'Operaciones por día',
        ['Día', 'Abast.', 'Almac.', 'Picking', 'Control', 'Despacho'],
        rep.operacionesPorDia.map(d => [d.dia, fmt(d.abast), fmt(d.almac), fmt(d.pick), fmt(d.ctrl), fmt(d.desp)]),
        { columnStyles: ALINEAR_DERECHA([1, 2, 3, 4, 5]) });

    if (rep.operarios.length) {
        seccionPDF(doc, `Productividad por operario (${rep.operariosUnicos} operario/s)`,
            ['Operario', 'Turno', 'Tarea', 'Total', 'Días', 'Prom./día', 'Efic. %'],
            rep.operarios.map(op => [
                op.nombre, op.turno, op.zona, fmt(op.total),
                String(op.diasTrabajados), fmt(op.promedioDiario), op.eficienciaPct.toFixed(1) + '%',
            ]),
            { columnStyles: ALINEAR_DERECHA([3, 4, 5, 6]) });
    }

    const turnos = Object.keys(rep.porTurno).sort((a, b) => a.localeCompare(b));
    if (turnos.length) {
        seccionPDF(doc, 'Comparativa por turno (Abast. + Almac. + Picking + Control)',
            ['Turno', ...ZONAS_COMPARATIVA, 'Total'],
            turnos.map(t => {
                const d = rep.porTurno[t];
                const tot = ZONAS_COMPARATIVA.reduce((s, z) => s + d[z], 0);
                return [t, ...ZONAS_COMPARATIVA.map(z => fmt(d[z])), fmt(tot)];
            }),
            { columnStyles: ALINEAR_DERECHA([1, 2, 3, 4, 5]) });
    }

    const trEntries = Object.entries(rep.trPeriodo).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (trEntries.length) {
        const totalTR = trEntries.reduce((s, [, v]) => s + v, 0);
        seccionPDF(doc, "Estados de TR's (acumulado del período)",
            ['Estado', 'Cantidad', '%'],
            trEntries.map(([e, v]) => [e.replace(/_/g, ' '), fmt(v), (totalTR ? (v / totalTR * 100).toFixed(1) : '0.0') + '%']),
            { columnStyles: ALINEAR_DERECHA([1, 2]) });
    }

    doc.save(`reporte_periodo_${rep.rango ? rep.rango.desde + '_a_' + rep.rango.hasta : fechaLocalISO()}.pdf`);
}

// --------------------------------------------------------
// MODAL DE METAS POR ZONA
// --------------------------------------------------------
function abrirModalObjetivos() {
    llenarFormularioObjetivos();
    document.getElementById('modalObjetivos').classList.remove('hidden');
}
function cerrarModalObjetivos() { document.getElementById('modalObjetivos').classList.add('hidden'); }

// --------------------------------------------------------
// EXPORTS (sólo para tests con Node; no afecta al navegador,
// donde "module" no existe y este bloque no se ejecuta)
// --------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseNumero, escapeHtml, fixMojibake, normalizarNombre,
        extraerDatosTR, extraerOperariosDB, sumarColumna, extraerNomina,
        calcularProductividadPorTurno, combinarPorOperario,
        armarReportePeriodo, fechaLocalISO, lunesDeLaSemana, rangoPreset
    };
}