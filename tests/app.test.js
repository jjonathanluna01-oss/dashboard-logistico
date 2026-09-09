const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    parseNumero,
    escapeHtml,
    fixMojibake,
    normalizarNombre,
    extraerDatosTR,
    extraerOperariosDB,
    sumarColumna,
    extraerNomina,
    calcularProductividadPorTurno,
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
    assert.equal(operarios.length, 3); // Abastecimiento, Control y Despacho; no Almacenamiento ni Picking (0)

    const porZona = Object.fromEntries(operarios.map(op => [op.zona, op.total]));
    assert.deepEqual(porZona, { Abastecimiento: 1040, Control: 586, Despacho: 12 });
    operarios.forEach(op => assert.equal(op.nombre, 'Brenda Centurion'));
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
