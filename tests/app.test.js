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
