const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    parseNumero,
    escapeHtml,
    fixMojibake,
    normalizarNombre,
    extraerDatosTR,
    extraerRegistrosTR,
    extraerOperariosDB,
    sumarColumna,
    extraerNomina,
    calcularProductividadPorTurno,
    combinarPorOperario,
    armarReportePeriodo,
    fechaLocalISO,
    lunesDeLaSemana,
    rangoPreset,
} = require('../app.js');

test('parseNumero: numeros ya numericos pasan igual', () => {
    assert.equal(parseNumero(1500), 1500);
    assert.equal(parseNumero(0), 0);
});

test('parseNumero: formato AR con miles y decimales ("1.234,56")', () => {
    assert.equal(parseNumero('1.234,56'), 1234.56);
});

test('parseNumero: solo coma decimal ("1234,56")', () => {
    assert.equal(parseNumero('1234,56'), 1234.56);
});

test('parseNumero: formato estandar con punto decimal', () => {
    assert.equal(parseNumero('1234.56'), 1234.56);
});

test('parseNumero: vacio, null o texto invalido da 0', () => {
    assert.equal(parseNumero(''), 0);
    assert.equal(parseNumero(null), 0);
    assert.equal(parseNumero(undefined), 0);
    assert.equal(parseNumero('abc'), 0);
});

test('escapeHtml: neutraliza tags y comillas', () => {
    assert.equal(
        escapeHtml('<img src=x onerror=alert(1)>'),
        '&lt;img src=x onerror=alert(1)&gt;'
    );
    assert.equal(escapeHtml(`O'Brien & "Cía"`), 'O&#39;Brien &amp; &quot;Cía&quot;');
});

test('fixMojibake: revierte UTF-8 mal leido como CP1252', () => {
    assert.equal(fixMojibake('LÃ³pez'), 'López');
});

test('fixMojibake: texto ya correcto queda intacto', () => {
    assert.equal(fixMojibake('López'), 'López');
});

test('normalizarNombre: unifica mayusculas y espacios', () => {
    assert.equal(normalizarNombre('  Juan   Perez '), 'juan perez');
    assert.equal(normalizarNombre('JUAN PEREZ'), 'juan perez');
});

test('extraerOperariosDB: fila sin nombre cae en "Desconocido", no en "0"', () => {
    const datos = [
        { 'Nombre y Apellido': 0, 'Cantidad pickeada': 50 },
    ];
    const operarios = extraerOperariosDB(datos);
    assert.equal(operarios.length, 1);
    assert.equal(operarios[0].nombre, 'Desconocido');
    assert.equal(operarios[0].total, 50);
});

test('extraerOperariosDB: agrupa el mismo operario aunque cambie mayusculas/espacios', () => {
    const datos = [
        { 'Nombre y Apellido': 'Juan Perez', 'Cantidad pickeada': 100 },
        { 'Nombre y Apellido': 'JUAN  PEREZ', 'Cantidad pickeada': 50 },
    ];
    const operarios = extraerOperariosDB(datos);
    assert.equal(operarios.length, 1);
    assert.equal(operarios[0].total, 150);
});

test('extraerOperariosDB: ignora filas sin datos operativos', () => {
    const datos = [{ 'Nombre y Apellido': 'Juan Perez', 'Cantidad pickeada': 0 }];
    assert.equal(extraerOperariosDB(datos).length, 0);
});

test('extraerOperariosDB: separa las tareas de un mismo operario en filas distintas', () => {
    // Caso real: un operario aparece en una sola fila del Excel con varias
    // columnas de tarea cargadas a la vez (ingreso + control + despacho).
    const datos = [{
        'Nombre y Apellido': 'Brenda Centurion',
        'Cantidad ingresada': 1040,
        'Cantidad guardada': 0,
        'Cantidad pickeada': 0,
        'Cantidad controlada': 586,
        'Cantidad Despachada': 12,
    }];
    const operarios = extraerOperariosDB(datos);
    // Abastecimiento y Control; Despacho NO se mide por operario (la columna
    // trae un valor fijo para todos en el export del WMS).
    assert.equal(operarios.length, 2);

    const porZona = Object.fromEntries(operarios.map(op => [op.zona, op.total]));
    assert.deepEqual(porZona, { Abastecimiento: 1040, Control: 586 });
    operarios.forEach(op => assert.equal(op.nombre, 'Brenda Centurion'));
});

test('extraerOperariosDB: Despacho nunca genera fila por operario', () => {
    const datos = [{ 'Nombre y Apellido': 'Enzo Arce', 'Cantidad Despachada': 12, 'Cantidad pickeada': 800 }];
    const operarios = extraerOperariosDB(datos);
    assert.equal(operarios.length, 1);
    assert.equal(operarios[0].zona, 'Picking');
});

test('extraerOperariosDB: la misma tarea del mismo operario en dos filas se suma (no se duplica)', () => {
    const datos = [
        { 'Nombre y Apellido': 'Juan Perez', 'Cantidad pickeada': 100, 'Cantidad controlada': 20 },
        { 'Nombre y Apellido': 'Juan Perez', 'Cantidad pickeada': 50 },
    ];
    const operarios = extraerOperariosDB(datos);
    assert.equal(operarios.length, 2);
    const porZona = Object.fromEntries(operarios.map(op => [op.zona, op.total]));
    assert.deepEqual(porZona, { Picking: 150, Control: 20 });
});

test('extraerDatosTR: suma cantidades por estado usando columnas nombradas', () => {
    const datos = [
        { 'Estado': 'DISPATCHED', 'Cantidad Solicitada': 10 },
        { 'Estado': 'DISPATCHED', 'Cantidad Solicitada': 5 },
        { 'Estado': 'CREATED', 'Cantidad Solicitada': 3 },
    ];
    const { estados, columnasEncontradas } = extraerDatosTR(datos);
    assert.equal(columnasEncontradas, true);
    assert.deepEqual(estados, { DISPATCHED: 15, CREATED: 3 });
});

test('extraerDatosTR: ignora la fila de "Total General"', () => {
    const datos = [
        { 'Estado': 'DISPATCHED', 'Cantidad Solicitada': 10 },
        { 'Estado': 'Total General', 'Cantidad Solicitada': 10 },
    ];
    const { estados } = extraerDatosTR(datos);
    assert.deepEqual(estados, { DISPATCHED: 10 });
});

test('extraerRegistrosTR: un registro por fila, con la fila cruda completa adentro (para la base de datos)', () => {
    const datos = [
        { 'Estado': 'DISPATCHED', 'Cantidad Solicitada': 10, 'N Orden': 'A1', 'Cliente': 'Acme' },
        { 'Estado': 'CREATED', 'Cantidad Solicitada': 3, 'N Orden': 'A2', 'Cliente': 'Beta' },
    ];
    const { registros, columnasEncontradas } = extraerRegistrosTR(datos);
    assert.equal(columnasEncontradas, true);
    assert.equal(registros.length, 2);
    assert.equal(registros[0].estado, 'DISPATCHED');
    assert.equal(registros[0].cantidad, 10);
    assert.deepEqual(registros[0].datos, datos[0]); // se guarda la fila entera, no solo estado+cantidad
    assert.equal(registros[1].datos['Cliente'], 'Beta');
});

test('extraerRegistrosTR: extraerDatosTR sigue dando el mismo agregado (se arma sobre extraerRegistrosTR)', () => {
    const datos = [
        { 'Estado': 'DISPATCHED', 'Cantidad Solicitada': 10 },
        { 'Estado': 'DISPATCHED', 'Cantidad Solicitada': 5 },
        { 'Estado': 'CREATED', 'Cantidad Solicitada': 3 },
    ];
    assert.deepEqual(extraerDatosTR(datos).estados, { DISPATCHED: 15, CREATED: 3 });
    assert.equal(extraerRegistrosTR(datos).registros.length, 3);
});

test('sumarColumna: encuentra la columna por alias sin importar mayusculas', () => {
    const datos = [{ 'cantidad pickeada': 10 }, { 'cantidad pickeada': 5 }];
    const r = sumarColumna(datos, ['Cantidad pickeada', 'cantidad pickeada']);
    assert.equal(r.encontrada, true);
    assert.equal(r.total, 15);
});

test('sumarColumna: columna ausente devuelve encontrada=false', () => {
    const datos = [{ 'otra cosa': 10 }];
    const r = sumarColumna(datos, ['Cantidad pickeada', 'cantidad pickeada']);
    assert.equal(r.encontrada, false);
    assert.equal(r.total, 0);
});

test('extraerNomina: celda de nombre vacia (defval 0) no rompe el filtro', () => {
    const datos = [
        { 'Nombre': 'Juan Perez', 'Turno': 'Mañana' },
        { 'Nombre': 0, 'Turno': 'Tarde' },
    ];
    const nomina = extraerNomina(datos);
    assert.equal(nomina.length, 1);
    assert.equal(nomina[0].nombre, 'Juan Perez');
});

test('calcularProductividadPorTurno: suma por turno y zona, ignora Despacho y Sin Asignar', () => {
    const operarios = [
        { nombre: 'A', zona: 'Picking', turno: 'Mañana', total: 100 },
        { nombre: 'B', zona: 'Picking', turno: 'Mañana', total: 50 },
        { nombre: 'C', zona: 'Control', turno: 'Mañana', total: 30 },
        { nombre: 'D', zona: 'Picking', turno: 'Tarde', total: 200 },
        { nombre: 'E', zona: 'Despacho', turno: 'Mañana', total: 999 },
        { nombre: 'F', zona: 'Sin Asignar', turno: 'Mañana', total: 999 },
    ];
    const resultado = calcularProductividadPorTurno(operarios);
    assert.deepEqual(resultado['Mañana'], { Abastecimiento: 0, Almacenamiento: 0, Picking: 150, Control: 30 });
    assert.deepEqual(resultado['Tarde'], { Abastecimiento: 0, Almacenamiento: 0, Picking: 200, Control: 0 });
    assert.equal(resultado['Mañana'].Picking, 150);
});

test('calcularProductividadPorTurno: sin operarios en zonas comparables da objeto vacio', () => {
    const operarios = [{ nombre: 'A', zona: 'Despacho', turno: 'Mañana', total: 500 }];
    assert.deepEqual(calcularProductividadPorTurno(operarios), {});
});

test('combinarPorOperario: suma total y metas de las tareas de un mismo operario', () => {
    const filas = [
        { nombre: 'Brenda Centurion', zona: 'Abastecimiento', turno: 'Mañana', total: 1040, objetivo: 1600 },
        { nombre: 'Brenda Centurion', zona: 'Control', turno: 'Mañana', total: 586, objetivo: 1500 },
        { nombre: 'Brenda Centurion', zona: 'Despacho', turno: 'Mañana', total: 12, objetivo: 1500 },
    ];
    const combinado = combinarPorOperario(filas);
    assert.equal(combinado.length, 1);
    assert.equal(combinado[0].total, 1638); // 1040 + 586 + 12
    assert.equal(combinado[0].objetivo, 4600); // 1600 + 1500 + 1500
    assert.equal(Math.round(combinado[0].eficienciaPct * 100) / 100, Math.round((1638 / 4600 * 100) * 100) / 100);
    assert.deepEqual(combinado[0].zonas, ['Abastecimiento', 'Control', 'Despacho']);
});

test('combinarPorOperario: no mezcla operarios distintos ni ve afectada por mayusculas', () => {
    const filas = [
        { nombre: 'Juan Perez', zona: 'Picking', turno: 'Mañana', total: 100, objetivo: 1000 },
        { nombre: 'JUAN PEREZ', zona: 'Control', turno: 'Mañana', total: 50, objetivo: 1500 },
        { nombre: 'Maria Lopez', zona: 'Picking', turno: 'Tarde', total: 300, objetivo: 1000 },
    ];
    const combinado = combinarPorOperario(filas);
    assert.equal(combinado.length, 2);
    const juan = combinado.find(o => o.nombre === 'Juan Perez');
    assert.equal(juan.total, 150);
});

// --- Reporte de período ---

function entrada(dia, opsData, opts) {
    return Object.assign({
        dia,
        timestamp: dia + 'T21:00:00.000Z',
        opsActualizado: true,
        abast: 0, almac: 0, pick: 0, ctrl: 0, desp: 0,
        operariosData: opsData || [],
        trData: {},
    }, opts || {});
}

test('armarReportePeriodo: acumula operaciones y productividad por operario a lo largo de los dias', () => {
    const entradas = [
        entrada('2026-09-07',
            [{ nombre: 'Juan Perez', total: 800, zona: 'Picking', objetivo: 1000, turno: 'Mañana' }],
            { pick: 800 }),
        entrada('2026-09-08',
            [{ nombre: 'Juan Perez', total: 1200, zona: 'Picking', objetivo: 1000, turno: 'Mañana' }],
            { pick: 1200 }),
    ];
    const rep = armarReportePeriodo(entradas);
    assert.equal(rep.dias.length, 2);
    assert.equal(rep.operaciones.pick, 2000);
    assert.equal(rep.operarios.length, 1);
    assert.equal(rep.operarios[0].total, 2000);
    assert.equal(rep.operarios[0].diasTrabajados, 2);
    assert.equal(rep.operarios[0].promedioDiario, 1000);
    assert.equal(rep.operarios[0].metaPeriodo, 2000); // 1000 x 2 dias
    assert.equal(rep.operarios[0].eficienciaPct, 100);
});

test('armarReportePeriodo: si un dia tiene 2 cargas, se queda con la ultima', () => {
    const entradas = [
        entrada('2026-09-07', [{ nombre: 'Ana', total: 500, zona: 'Control', objetivo: 1500, turno: 'Tarde' }], { ctrl: 500, timestamp: '2026-09-07T12:00:00.000Z' }),
        entrada('2026-09-07', [{ nombre: 'Ana', total: 900, zona: 'Control', objetivo: 1500, turno: 'Tarde' }], { ctrl: 900, timestamp: '2026-09-07T19:00:00.000Z' }),
    ];
    const rep = armarReportePeriodo(entradas);
    assert.equal(rep.dias.length, 1);
    assert.equal(rep.operaciones.ctrl, 900);
    assert.equal(rep.operarios[0].total, 900);
    assert.equal(rep.operarios[0].diasTrabajados, 1);
});

test('armarReportePeriodo: una carga solo-TR no pisa el detalle de operarios del dia', () => {
    const entradas = [
        entrada('2026-09-07', [{ nombre: 'Ana', total: 900, zona: 'Control', objetivo: 1500, turno: 'Tarde' }], { ctrl: 900, timestamp: '2026-09-07T12:00:00.000Z' }),
        entrada('2026-09-07', [], { opsActualizado: false, trData: { DISPATCHED: 50 }, timestamp: '2026-09-07T20:00:00.000Z' }),
    ];
    const rep = armarReportePeriodo(entradas);
    assert.equal(rep.operaciones.ctrl, 900);      // de la carga con ops, no de la solo-TR
    assert.equal(rep.operarios.length, 1);
    assert.equal(rep.operarios[0].total, 900);
    assert.equal(rep.trPeriodo.DISPATCHED, 50);   // el TR de la ultima carga si cuenta
});

test('armarReportePeriodo: comparativa por turno suma las 4 zonas principales del periodo', () => {
    const entradas = [
        entrada('2026-09-07', [
            { nombre: 'A', total: 1000, zona: 'Picking', objetivo: 1000, turno: 'Mañana' },
            { nombre: 'B', total: 500, zona: 'Control', objetivo: 1500, turno: 'Mañana' },
            { nombre: 'C', total: 300, zona: 'Despacho', objetivo: 1500, turno: 'Mañana' },
        ]),
    ];
    const rep = armarReportePeriodo(entradas);
    assert.deepEqual(rep.porTurno['Mañana'], { Abastecimiento: 0, Almacenamiento: 0, Picking: 1000, Control: 500 });
});

test('armarReportePeriodo: entradas sin operariosData (formato viejo) no rompen', () => {
    const rep = armarReportePeriodo([{ dia: '2026-09-01', timestamp: '2026-09-01T21:00:00Z', abast: 100 }]);
    assert.equal(rep.operaciones.abast, 100);
    assert.equal(rep.operarios.length, 0);
    assert.equal(rep.dias.length, 1);
});

test('fechaLocalISO: formatea la fecha local como YYYY-MM-DD', () => {
    assert.equal(fechaLocalISO(new Date(2026, 8, 5)), '2026-09-05'); // mes 8 = septiembre
    assert.match(fechaLocalISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test('lunesDeLaSemana: devuelve el lunes de esa semana', () => {
    // 2026-09-10 es jueves -> lunes 2026-09-07
    assert.equal(fechaLocalISO(lunesDeLaSemana(new Date(2026, 8, 10))), '2026-09-07');
    // un domingo (2026-09-13) -> lunes anterior 2026-09-07
    assert.equal(fechaLocalISO(lunesDeLaSemana(new Date(2026, 8, 13))), '2026-09-07');
});

test('rangoPreset: "semana" va del lunes a hoy; "7dias" son 7 dias corridos', () => {
    const hoy = new Date(2026, 8, 10); // jueves
    assert.deepEqual(rangoPreset('semana', hoy), { desde: '2026-09-07', hasta: '2026-09-10' });
    assert.deepEqual(rangoPreset('7dias', hoy), { desde: '2026-09-04', hasta: '2026-09-10' });
    assert.deepEqual(rangoPreset('semana-pasada', hoy), { desde: '2026-08-31', hasta: '2026-09-06' });
});
