const LOCALE = 'es-AR';
const STORAGE_KEY = 'dexterDashboard_v2';
const HISTORY_KEY = 'dexterDashboard_history_v2';

const DOUGHNUT_COLORS = ['#e52329', '#f59e0b', '#27272a', '#52525b', '#10b981', '#3f3f46'];

const COLUMNAS_OPS = {
    abastecimiento: ['Cantidad ingresada', 'cantidad ingresada'],
    almacenamiento: ['Cantidad guardada', 'cantidad guardada'],
    picking: ['Cantidad pickeada', 'cantidad pickeada'],
    control: ['Cantidad controlada', 'cantidad controlada'],
    despacho: ['Cantidad Despachada', 'cantidad despachada', 'despacho'],
};

const BADGE_COLORS = {
    DISPATCHED: 'bg-brand-success/20 text-brand-success', CANCELLED: 'bg-brand-danger/20 text-brand-danger',
    CREATED: 'bg-brand-accent/20 text-brand-accent', IN_BRANCH_POSITION: 'bg-brand-purple/20 text-brand-purple',
    PRE_DISPATCH: 'bg-blue-500/20 text-blue-400', CONTROL: 'bg-brand-success/20 text-brand-success',
    PACKING: 'bg-brand-warning/20 text-brand-warning', CONFERENCE: 'bg-blue-500/20 text-blue-400',
    PAUSED_WITH_DIFFERENCES: 'bg-brand-danger/20 text-brand-danger', FINALIZED: 'bg-brand-success/20 text-brand-success',
};

let barChartInstance = null;
let doughnutChartInstance = null;

let currentTRData = { "DISPATCHED": 0, "CREATED": 0 };
let currentOpsData = { abast: 0, almac: 0, pick: 0, ctrl: 0, desp: 0 };
let currentOperariosData = []; 
let currentFechaReporte = "Reporte Inicial (Sin Carga)";

// --------------------------------------------------------
// INICIALIZADOR AL CARGAR LA PÁGINA
// --------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    ConfigurarGraficosBase();

    const guardado = cargarEstadoGuardado();
    if (guardado) {
        currentTRData = guardado.trData || currentTRData;
        currentOpsData = guardado.opsData || currentOpsData;
        currentOperariosData = guardado.operariosData || [];
        currentFechaReporte = guardado.fecha || currentFechaReporte;
        document.getElementById('fechaReporte').innerText = currentFechaReporte;
    }

    ActualizarDashboard(currentTRData, currentOpsData.abast, currentOpsData.almac, currentOpsData.pick, currentOpsData.ctrl, currentOpsData.desp);
    RenderizarTablaDB(currentOperariosData);
});

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
// PERSISTENCIA (localStorage)
// --------------------------------------------------------
function guardarEstado() {
    try {
        const payload = {
            trData: currentTRData,
            opsData: currentOpsData,
            operariosData: currentOperariosData,
            fecha: currentFechaReporte
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) { console.warn('Error guardando en localStorage:', e); }
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
function ActualizarDashboard(trData, abast, almac, pick, ctrl, desp) {
    currentOpsData = { abast, almac, pick, ctrl, desp };
    guardarEstado();

    document.getElementById('cardAbastecimiento').innerText = abast.toLocaleString(LOCALE);
    document.getElementById('cardAlmacenamiento').innerText = almac.toLocaleString(LOCALE);
    document.getElementById('cardPicking').innerText = pick.toLocaleString(LOCALE);
    document.getElementById('cardControl').innerText = ctrl.toLocaleString(LOCALE);
    document.getElementById('cardDespacho').innerText = desp.toLocaleString(LOCALE);

    const sortedTR = Object.entries(trData).sort((a, b) => b[1] - a[1]);
    const labels = sortedTR.map(item => item[0].replace(/_/g, ' '));
    const dataValues = sortedTR.map(item => item[1]);
    const totalTRs = dataValues.reduce((acc, val) => acc + val, 0);

    const tbody = document.getElementById('trTableBody');
    tbody.innerHTML = '';
    sortedTR.forEach(([estado, cantidad]) => {
        const porcentaje = totalTRs > 0 ? ((cantidad / totalTRs) * 100).toFixed(2) : '0.00';
        const badgeClass = BADGE_COLORS[estado] || 'bg-dark-700 text-gray-300';
        tbody.innerHTML += `
            <tr class="hover:bg-dark-800/50 transition-colors">
                <td class="py-3"><span class="px-2 py-1 rounded text-xs font-semibold ${badgeClass}">${estado.replace(/_/g, ' ')}</span></td>
                <td class="py-3 text-right font-medium text-white">${cantidad.toLocaleString(LOCALE)}</td>
                <td class="py-3 text-right text-gray-400">${porcentaje}%</td>
            </tr>`;
    });

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
}

// --------------------------------------------------------
// MODALES Y LECTURA DE EXCEL
// --------------------------------------------------------
function abrirModalUpdate() { document.getElementById('modalUpdate').classList.remove('hidden'); }
function cerrarModalUpdate() { document.getElementById('modalUpdate').classList.add('hidden'); }

async function procesarArchivos() {
    const fileOps = document.getElementById('fileOps').files[0];
    const fileTR = document.getElementById('fileTR').files[0];

    if (!fileOps && !fileTR) return alert("Selecciona al menos un archivo.");
    document.getElementById('btnProcesar').classList.add('opacity-50');
    if (document.getElementById('spinnerIcon')) document.getElementById('spinnerIcon').classList.remove('hidden');

    try {
        let nAbast = currentOpsData.abast, nAlmac = currentOpsData.almac, nPick = currentOpsData.pick, nCtrl = currentOpsData.ctrl, nDesp = currentOpsData.desp;

        if (fileOps) {
            const dataOps = await leerExcel(fileOps);
            if (dataOps.length > 0) {
                nAbast = sumarColumna(dataOps, COLUMNAS_OPS.abastecimiento).total;
                nAlmac = sumarColumna(dataOps, COLUMNAS_OPS.almacenamiento).total;
                nPick = sumarColumna(dataOps, COLUMNAS_OPS.picking).total;
                nCtrl = sumarColumna(dataOps, COLUMNAS_OPS.control).total;
                const rDesp = sumarColumna(dataOps, COLUMNAS_OPS.despacho);
                if (rDesp.encontrada) nDesp = rDesp.total;
                
                currentOperariosData = extraerOperariosDB(dataOps);
                generarNotificacionesEficiencia(currentOperariosData);
            }
        }

        if (fileTR) {
            const dataTR = await leerExcel(fileTR);
            const nuevosTR = extraerDatosTR(dataTR);
            if (Object.keys(nuevosTR).length > 0) {
                currentTRData = nuevosTR;
                if (!fileOps && currentTRData["DISPATCHED"]) nDesp = currentTRData["DISPATCHED"];
            }
        }

        currentFechaReporte = "Carga: " + new Date().toLocaleString(LOCALE, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        document.getElementById('fechaReporte').innerText = currentFechaReporte;

        ActualizarDashboard(currentTRData, nAbast, nAlmac, nPick, nCtrl, nDesp);
        RenderizarTablaDB(currentOperariosData);
        guardarEstado();
        cerrarModalUpdate();

    } catch (error) {
        alert("Error procesando archivos.");
        console.error(error);
    } finally {
        document.getElementById('btnProcesar').classList.remove('opacity-50');
        if (document.getElementById('spinnerIcon')) document.getElementById('spinnerIcon').classList.add('hidden');
    }
}

function leerExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                resolve(XLSX.utils.sheet_to_json(firstSheet, { defval: 0 }));
            } catch (err) { reject(err); }
        };
        reader.readAsArrayBuffer(file);
    });
}

function sumarColumna(datos, alias) {
    if (!datos.length) return { total: 0, encontrada: false };
    const cols = Object.keys(datos[0]);
    const realName = cols.find(c => alias.some(a => a.toLowerCase() === c.toLowerCase()));
    if (!realName) return { total: 0, encontrada: false };
    const total = datos.reduce((sum, f) => sum + (Number(f[realName]) || 0), 0);
    return { total, encontrada: true };
}

// --------------------------------------------------------
// LA FUNCIÓN NUEVA DE EXTRACCIÓN TR (PARA ARCHIVOS EN CRUDO)
// --------------------------------------------------------
function extraerDatosTR(datos) {
    let nuevos = {};
    if (!datos || datos.length === 0) return nuevos;

    const aliasesEstado = ['estado', 'estado tr'];
    const aliasesCantidad = ['cantidad solicitada', 'cantidad', 'cant. solicitada', 'solicitada'];

    const cols = Object.keys(datos[0]);
    const keyEstado = cols.find(c => aliasesEstado.some(a => c.toLowerCase().includes(a)));
    const keyCantidad = cols.find(c => aliasesCantidad.some(a => c.toLowerCase().includes(a)));

    datos.forEach(f => {
        let est = "";
        let cant = 0;

        if (keyEstado && keyCantidad) {
            est = String(f[keyEstado]).trim();
            cant = Number(f[keyCantidad]) || 0;
        } else {
            const val = Object.values(f);
            if (val.length >= 2) {
                est = String(val[0]).trim();
                cant = Number(val[1]) || 0;
            }
        }

        if (est && est !== "0" && est !== "undefined" && !est.toLowerCase().includes("total general")) {
            nuevos[est] = (nuevos[est] || 0) + cant;
        }
    });
    
    return nuevos;
}

// --------------------------------------------------------
// LÓGICA DE EXTRACCIÓN DB (EFICIENCIA Y ZONA)
// --------------------------------------------------------
function extraerOperariosDB(datos) {
    const OBJETIVOS_ZONA = {
        'Abastecimiento': 1500,
        'Almacenamiento': 1800,
        'Picking': 1500,
        'Control': 2000,
        'Despacho': 1500
    };

    const buscarLlave = (fila, aliases) => {
        const key = Object.keys(fila).find(k => aliases.some(a => a.toLowerCase() === k.toLowerCase()));
        return key ? Number(fila[key]) || 0 : 0;
    };

    let operarios = datos.map(fila => {
        const nombreCol = Object.keys(fila).find(k => ['nombre y apellido', 'nombre'].includes(k.toLowerCase()));
        const nombre = nombreCol ? fila[nombreCol] : 'Desconocido';

        const ing = buscarLlave(fila, COLUMNAS_OPS.abastecimiento);
        const gua = buscarLlave(fila, COLUMNAS_OPS.almacenamiento);
        const pick = buscarLlave(fila, COLUMNAS_OPS.picking);
        const ctrl = buscarLlave(fila, COLUMNAS_OPS.control);
        const desp = buscarLlave(fila, COLUMNAS_OPS.despacho);

        const total = ing + gua + pick + ctrl + desp;

        let zona = 'Sin Asignar';
        let max = 0;
        if (ing > max) { max = ing; zona = 'Abastecimiento'; }
        if (gua > max) { max = gua; zona = 'Almacenamiento'; }
        if (pick > max) { max = pick; zona = 'Picking'; }
        if (ctrl > max) { max = ctrl; zona = 'Control'; }
        if (desp > max) { max = desp; zona = 'Despacho'; }

        const objetivo = OBJETIVOS_ZONA[zona] || 1500;
        const eficienciaPct = (total / objetivo) * 100;

        return { nombre, total, zona, objetivo, eficienciaPct };
    });

    return operarios.filter(op => op.total > 0).sort((a, b) => b.eficienciaPct - a.eficienciaPct);
}

// --------------------------------------------------------
// RENDERIZAR TABLA DE EFICIENCIA (Con Alertas Visuales)
// --------------------------------------------------------
function RenderizarTablaDB(operarios) {
    const tbody = document.getElementById('dbTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    if (operarios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="py-6 text-center text-gray-500">No hay datos de operarios para mostrar.</td></tr>';
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

    operarios.forEach((op) => {
        const style = getZoneColor(op.zona);
        const isGoalMet = op.eficienciaPct >= 100;
        const isDanger = op.eficienciaPct < 70; 
        
        const colorEficiencia = isGoalMet ? 'text-brand-success' : (isDanger ? 'text-brand-danger' : 'text-brand-warning');
        const rowHighlight = isDanger ? 'border-l-4 border-brand-danger bg-brand-danger/5' : 'border-l-4 border-transparent';

        tbody.innerHTML += `
            <tr class="hover:bg-dark-800/50 transition-colors ${rowHighlight}">
                <td class="p-3 font-medium text-white">${op.nombre}</td>
                <td class="p-3"><span class="px-2 py-1 rounded text-xs font-semibold ${style}">${op.zona}</span></td>
                <td class="p-3 text-right">
                    <div class="flex flex-col items-end">
                        <span class="font-bold ${colorEficiencia}">${op.eficienciaPct.toFixed(1)}%</span>
                        <span class="text-xs text-gray-500">${op.total.toLocaleString(LOCALE)} / ${op.objetivo.toLocaleString(LOCALE)} u.</span>
                    </div>
                </td>
            </tr>`;
    });
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

function generarNotificacionesEficiencia(operarios) {
    const contenedor = document.getElementById('listaNotificaciones');
    const badge = document.getElementById('notifBadge');
    if (!contenedor) return;

    if (!operarios || operarios.length === 0) {
        contenedor.innerHTML = '<p class="text-gray-500 text-center py-4">No hay datos de eficiencia disponibles.</p>';
        if (badge) badge.classList.add('hidden');
        return;
    }

    const totalOperarios = operarios.length;
    const mejorOperario = operarios[0];
    const operariosDestacados = operarios.filter(op => op.eficienciaPct >= 100).length;
    const operariosBajoRendimiento = operarios.filter(op => op.eficienciaPct < 70);

    let notifs = [];

    if (mejorOperario && mejorOperario.eficienciaPct > 0) {
        notifs.push({
            titulo: 'Top Eficiencia del Turno',
            desc: `<b>${mejorOperario.nombre}</b> alcanzó un espectacular <b>${mejorOperario.eficienciaPct.toFixed(1)}%</b> en la zona de <b>${mejorOperario.zona}</b>.`,
            tipo: 'success',
            icon: 'award',
            tiempo: 'Hace un momento'
        });
    }

    notifs.push({
        titulo: 'Rendimiento Global',
        desc: `Actualmente, <b>${operariosDestacados} de ${totalOperarios} operarios</b> alcanzaron o superaron el objetivo productivo (100% de eficiencia).`,
        tipo: 'info',
        icon: 'info',
        tiempo: 'Actualizado'
    });

    if (operariosBajoRendimiento.length > 0) {
        const listaNombres = operariosBajoRendimiento.map(op => 
            `<li>${op.nombre}: <b class="text-white">${op.eficienciaPct.toFixed(1)}%</b></li>`
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
    if (badge) badge.classList.remove('hidden'); 
}

// --------------------------------------------------------
// HISTORIAL
// --------------------------------------------------------
function abrirModalHistorial() { document.getElementById('modalHistorial').classList.remove('hidden'); }
function cerrarModalHistorial() { document.getElementById('modalHistorial').classList.add('hidden'); }
function limpiarHistorial() { localStorage.removeItem(HISTORY_KEY); }