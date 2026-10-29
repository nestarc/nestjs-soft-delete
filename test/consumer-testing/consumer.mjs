import 'reflect-metadata';
import * as root from '@nestarc/soft-delete';
import * as testing from '@nestarc/soft-delete/testing';
import exercise from './exercise.cjs';
await exercise(root, testing);
console.log('ESM consumer passed');
