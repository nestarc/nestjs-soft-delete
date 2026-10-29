require('reflect-metadata');
const root = require('@nestarc/soft-delete');
const testing = require('@nestarc/soft-delete/testing');
require('./exercise.cjs')(root, testing).then(() => console.log('CommonJS consumer passed'));
