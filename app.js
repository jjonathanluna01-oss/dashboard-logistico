// --------------------------------------------------------
// CONFIG
// --------------------------------------------------------
const LOCALE = 'es-AR';
const STORAGE_KEY = 'dexterDashboard_v2'; // Actualizado para evitar conflictos con caché vieja
const HISTORY_KEY = 'dexterDashboard_history_v2';

const DOUGHNUT_COLORS = ['#e52329', '#f59e0b', '#27272a', '#52525b', '#10b981', '#3f3f46'];

// Alias posibles para cada columna del reporte operativo (incluyendo Despacho)
const COLUMNAS_OPS = {
    abastecimiento: ['Cantidad ingresada', 'cantidad ingresada'],
    almacenamiento: ['Cantidad guardada', 'cantidad guardada'],
    picking: ['Cantidad pickeada', 'cantidad pickeada'],
    control: ['Cantidad controlada', 'cantidad controlada'],
    despacho: ['Cantidad despachada', 'cantidad despachada', 'despacho'],
};

// Colores de badge para estados
const BADGE_COLORS = {
    DISPATCHED: 'bg-brand-success/20 text-brand-success',
    CANCELLED: 'bg-brand-danger/20 text-brand-danger',
    CREATED: 'bg-brand-accent/20 text-brand-accent',
    IN_BRANCH_POSITION: 'bg-brand-purple/20 text-brand-purple',
    PRE_DISPATCH: 'bg-blue-500/20 text-blue-400',
    CONTROL: 'bg-brand-success/20 text-brand-success',
    PACKING: 'bg-brand-warning/20 text-brand-warning',
    CONFERENCE: 'bg-blue-500/20 text-blue-400',
    PAUSED_WITH_DIFFERENCES: 'bg-brand-danger/20 text-brand-danger',
    AWAITING_DELIVERY_NOTE: 'bg-brand-warning/20 text-brand-warning',
    AWAITING_SHIPPING_LABEL: 'bg-brand-warning/20 text-brand-warning',
    FINALIZED: 'bg-brand-success/20 text-brand-success',
};

// Variables Globales para almacenar las instancias de los gráficos
let barChartInstance = null;
let doughnutChartInstance = null;

// Datos Iniciales (Despacho en 0 por defecto para evitar valores erróneos)
let currentTRData = {
    "DISPATCHED": 0, "CREATED": 27669, "IN_BRANCH_POSITION": 5940, "PRE_DISPATCH": 4914,
    "CONTROL": 1895, "PACKING": 1843, "CONFERENCE": 1356, "CANCELLED": 646,
    "PAUSED_WITH_DIFFERENCES": 420, "AWAITING_DELIVERY_NOTE": 381, "AWAITING_SHIPPING_LABEL": 306, "FINALIZED": 171
};
let currentOpsData = { abast: 12762, almac: 17936, pick: 12777, ctrl: 13436, desp: 0 };
let currentFechaReporte = "Reporte Inicial (Sin Carga)";

// Inicializar el Dashboard al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    ConfigurarGraficosBase();

    // Intentar recuperar el último estado guardado en este navegador
    const guardado = cargarEstadoGuardado();
    if (guardado) {
        currentTRData = guardado.trData;
        currentOpsData = guardado.opsData;
        currentFechaReporte = guardado.fecha;
        document.getElementById('fechaReporte').innerText = currentFechaReporte;
    }

    ActualizarDashboard(
        currentTRData,
        currentOpsData.abast, currentOpsData.almac, currentOpsData.pick, currentOpsData.ctrl, currentOpsData.desp
    );
});

// --------------------------------------------------------
// PERSISTENCIA (localStorage)
// --------------------------------------------------------
function guardarEstado() {
    try {
        const payload = {
            trData: currentTRData,
            opsData: currentOpsData,
            fecha: currentFechaReporte,
            guardadoEn: new Date().toISOString()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('No se pudo guardar el estado en localStorage:', e);
    }
}

function cargarEstadoGuardado() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed.trData || !parsed.opsData) return null;
        // Evitar cargar por accidente el valor viejo de 298880 si estuviera cacheado
        if (parsed.opsData.desp === 298880) parsed.opsData.desp = 0;
        return parsed;
    } catch (e) {
        console.warn('No se pudo leer el estado guardado:', e);
        return null;
    }
}

// --------------------------------------------------------
// LÓGICA DE ACTUALIZACIÓN VISUAL (DOM Y GRÁFICOS)
// --------------------------------------------------------
function ConfigurarGraficosBase() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = '"Plus Jakarta Sans", sans-serif';
    Chart.defaults.plugins.tooltip.backgroundColor = '#1a1d27';
    Chart.defaults.plugins.tooltip.borderColor = '#262a36';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
}

function ActualizarDashboard(trData, abast, almac, pick, ctrl, desp) {
    // 0. Persistir el estado actual
    currentOpsData = { abast, almac, pick, ctrl, desp };
    guardarEstado();

    // 1. Actualizar Tarjetas Operativas
    document.getElementById('cardAbastecimiento').innerText = abast.toLocaleString(LOCALE);
    document.getElementById('cardAlmacenamiento').innerText = almac.toLocaleString(LOCALE);
    document.getElementById('cardPicking').innerText = pick.toLocaleString(LOCALE);
    document.getElementById('cardControl').innerText = ctrl.toLocaleString(LOCALE);
    document.getElementById('cardDespacho').innerText = desp.toLocaleString(LOCALE);

    // 2. Preparar Datos TR (ordenados de mayor a menor volumen)
    const sortedTR = Object.entries(trData).sort((a, b) => b[1] - a[1]);
    const labels = sortedTR.map(item => item[0].replace(/_/g, ' '));
    const dataValues = sortedTR.map(item => item[1]);
    const totalTRs = dataValues.reduce((acc, val) => acc + val, 0);

    // 3. Actualizar Tabla
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

    // 4. Actualizar Gráfico de Barras
    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart(document.getElementById('trBarChart'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Cantidad Solicitada',
                data: dataValues,
                backgroundColor: '#e52329',
                borderRadius: 4,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true },
                x: { grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });

    // 5. Actualizar Gráfico de Dona
    const top5Labels = labels.slice(0, 5);
    const top5Values = dataValues.slice(0, 5);
    const restoValor = dataValues.slice(5).reduce((acc, v) => acc + v, 0);

    const doughnutLabels = restoValor > 0 ? [...top5Labels, 'OTROS'] : top5Labels;
    const doughnutValues = restoValor > 0 ? [...top5Values, restoValor] : top5Values;
    const doughnutColors = restoValor > 0
        ? [...DOUGHNUT_COLORS.slice(0, 5), '#3f3f46']
        : DOUGHNUT_COLORS.slice(0, 5);

    if (doughnutChartInstance) doughnutChartInstance.destroy();
    doughnutChartInstance = new Chart(document.getElementById('trDoughnutChart'), {
        type: 'doughnut',
        data: {
            labels: doughnutLabels,
            datasets: [{
                data: doughnutValues,
                backgroundColor: doughnutColors,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            plugins: { legend: { display: false } }
        }
    });

    // Leyenda manual debajo de la dona
    const legendEl = document.getElementById('doughnutLegend');
    if (legendEl) {
        legendEl.innerHTML = doughnutLabels.map((label, i) => {
            const val = doughnutValues[i];
            const pct = totalTRs > 0 ? ((val / totalTRs) * 100).toFixed(1) : '0.0';
            return `
                <li class="flex items-center justify-between gap-2">
                    <span class="flex items-center gap-2 text-gray-300 truncate">
                        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color:${doughnutColors[i]}"></span>
                        ${label}
                    </span>
                    <span class="text-gray-500 flex-shrink-0">${pct}%</span>
                </li>`;
        }).join('');
    }
}

// --------------------------------------------------------
// LÓGICA DEL MODAL Y LECTURA DE EXCEL
// --------------------------------------------------------
function abrirModalUpdate() { document.getElementById('modalUpdate').classList.remove('hidden'); }
function cerrarModalUpdate() { document.getElementById('modalUpdate').classList.add('hidden'); }

function mostrarAvisoColumnas(mensajes) {
    const aviso = document.getElementById('avisoColumnas');
    if (!aviso) return;
    if (!mensajes || mensajes.length === 0) {
        aviso.classList.add('hidden');
        aviso.innerText = '';
        return;
    }
    aviso.classList.remove('hidden');
    aviso.innerText = '⚠ ' + mensajes.join(' · ');
}

async function procesarArchivos() {
    const fileOps = document.getElementById('fileOps').files[0];
    const fileTR = document.getElementById('fileTR').files[0];

    if (!fileOps && !fileTR) {
        alert("Por favor, selecciona al menos un archivo para actualizar.");
        return;
    }

    const btn = document.getElementById('btnProcesar');
    const icon = document.getElementById('spinnerIcon');
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    icon.classList.remove('hidden');
    icon.classList.add('animate-spin');

    const avisos = [];

    try {
        let nuevosAbast = currentOpsData.abast;
        let nuevosAlmac = currentOpsData.almac;
        let nuevosPick = currentOpsData.pick;
        let nuevosCtrl = currentOpsData.ctrl;
        let nuevosDesp = currentOpsData.desp;

        // 1. Leer Archivo Operativo (Cruzado directamente aquí)
        if (fileOps) {
            const dataOps = await leerExcel(fileOps);
            if (dataOps.length === 0) {
                avisos.push('El archivo operativo está vacío.');
            } else {
                const resAbast = sumarColumna(dataOps, COLUMNAS_OPS.abastecimiento);
                const resAlmac = sumarColumna(dataOps, COLUMNAS_OPS.almacenamiento);
                const resPick = sumarColumna(dataOps, COLUMNAS_OPS.picking);
                const resCtrl = sumarColumna(dataOps, COLUMNAS_OPS.control);
                const resDesp = sumarColumna(dataOps, COLUMNAS_OPS.despacho); // Cruce directo con Despacho

                nuevosAbast = resAbast.total;
                nuevosAlmac = resAlmac.total;
                nuevosPick = resPick.total;
                nuevosCtrl = resCtrl.total;

                if (resDesp.encontrada) {
                    nuevosDesp = resDesp.total; // Toma el despacho directamente del Excel operativo
                }

                if (!resAbast.encontrada) avisos.push('No se encontró "Cantidad ingresada".');
                if (!resAlmac.encontrada) avisos.push('No se encontró "Cantidad guardada".');
                if (!resPick.encontrada) avisos.push('No se encontró "Cantidad pickeada".');
                if (!resCtrl.encontrada) avisos.push('No se encontró "Cantidad controlada".');
                if (!resDesp.encontrada) avisos.push('No se encontró columna de Despacho en el Excel operativo.');
            }
        }

        // 2. Leer Archivo de TR's (Si se proporciona)
        if (fileTR) {
            const dataTR = await leerExcel(fileTR);
            const nuevosTR = extraerDatosTR(dataTR);
            if (Object.keys(nuevosTR).length === 0) {
                avisos.push('No se pudieron extraer estados válidos del archivo de TRs.');
            } else {
                currentTRData = nuevosTR;
                // Si no se cargó archivo operativo pero viene DISPATCHED en TRs, actualizar despacho opcionalmente
                if (!fileOps && Object.prototype.hasOwnProperty.call(currentTRData, "DISPATCHED")) {
                    nuevosDesp = currentTRData["DISPATCHED"];
                }
            }
        }

        // 3. Actualizar fecha, historial y dashboard
        currentFechaReporte = "Carga: " + new Date().toLocaleString(LOCALE, {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'});
        document.getElementById('fechaReporte').innerText = currentFechaReporte;
        
        guardarEnHistorial(currentFechaReporte, currentTRData, { abast: nuevosAbast, almac: nuevosAlmac, pick: nuevosPick, ctrl: nuevosCtrl, desp: nuevosDesp });
        
        ActualizarDashboard(currentTRData, nuevosAbast, nuevosAlmac, nuevosPick, nuevosCtrl, nuevosDesp);

        mostrarAvisoColumnas(avisos);
        cerrarModalUpdate();

    } catch (error) {
        console.error(error);
        alert("Hubo un error leyendo los archivos. Asegurate de que sean los reportes correctos.");
    } finally {
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        icon.classList.add('hidden');
        icon.classList.remove('animate-spin');
    }
}

// --------------------------------------------------------
// FUNCIONES AUXILIARES PARA PROCESAR EXCEL (SheetJS)
// --------------------------------------------------------
function leerExcel(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: 0 });
                resolve(jsonData);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

function sumarColumna(datos, aliasColumna) {
    if (datos.length === 0) return { total: 0, encontrada: false };

    const columnasReales = Object.keys(datos[0]);
    const nombreReal = columnasReales.find(col =>
        aliasColumna.some(alias => alias.trim().toLowerCase() === col.trim().toLowerCase())
    );

    if (!nombreReal) return { total: 0, encontrada: false };

    const total = datos.reduce((suma, fila) => {
        const valor = Number(fila[nombreReal]) || 0;
        return suma + valor;
    }, 0);

    return { total, encontrada: true };
}

function extraerDatosTR(datosJSON) {
    let nuevosTR = {};
    datosJSON.forEach(fila => {
        const valores = Object.values(fila);
        const estado = String(valores[0]).trim();
        const cantidad = Number(valores[1]) || 0;

        if (estado && estado !== "0" && estado !== "Total general" && estado !== "Etiquetas de fila") {
            nuevosTR[estado] = cantidad;
        }
    });
    return nuevosTR;
}

// --------------------------------------------------------
// LÓGICA DEL HISTORIAL
// --------------------------------------------------------
function guardarEnHistorial(fecha, trData, opsData) {
    try {
        let historial = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
        historial.unshift({ id: Date.now(), fecha, trData, opsData });
        if (historial.length > 15) historial.pop();
        localStorage.setItem(HISTORY_KEY, JSON.stringify(historial));
    } catch (e) { console.warn("Error guardando historial:", e); }
}

function abrirModalHistorial() {
    document.getElementById('modalHistorial').classList.remove('hidden');
    renderizarHistorial();
}

function cerrarModalHistorial() {
    document.getElementById('modalHistorial').classList.add('hidden');
}

function renderizarHistorial() {
    const contenedor = document.getElementById('listaHistorial');
    let historial = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    
    if (historial.length === 0) {
        contenedor.innerHTML = '<p class="text-gray-500 text-sm text-center py-6">No hay reportes anteriores guardados.</p>';
        return;
    }

    contenedor.innerHTML = historial.map(item => `
        <div onclick="cargarReporteHistorico(${item.id})" class="bg-dark-900 border border-dark-700 p-3 rounded-lg flex justify-between items-center hover:border-blue-500/50 hover:bg-dark-800 transition-all cursor-pointer group">
            <span class="text-sm font-medium text-gray-300 group-hover:text-blue-400 transition-colors">
                <i data-lucide="file-bar-chart-2" class="w-4 h-4 inline-block mr-2 mb-0.5 text-gray-500 group-hover:text-blue-400"></i>
                ${item.fecha}
            </span>
            <span class="text-xs bg-dark-700 text-gray-400 px-2 py-1 rounded group-hover:bg-blue-500/20 group-hover:text-blue-400 transition-colors">Cargar</span>
        </div>
    `).join('');
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function cargarReporteHistorico(id) {
    let historial = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    const reporte = historial.find(item => item.id === id);
    
    if (reporte) {
        currentTRData = reporte.trData;
        currentOpsData = reporte.opsData;
        currentFechaReporte = reporte.fecha;
        document.getElementById('fechaReporte').innerText = currentFechaReporte;
        
        ActualizarDashboard(currentTRData, currentOpsData.abast, currentOpsData.almac, currentOpsData.pick, currentOpsData.ctrl, currentOpsData.desp);
        cerrarModalHistorial();
    }
}

function limpiarHistorial() {
    if(confirm('¿Estás seguro de que quieres borrar todos los reportes anteriores?')) {
        localStorage.removeItem(HISTORY_KEY);
        renderizarHistorial();
    }
} 
   