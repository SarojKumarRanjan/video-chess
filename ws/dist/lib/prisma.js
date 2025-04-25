"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
console.log('Initializing Prisma Client...');
const prisma = new client_1.PrismaClient({
// log: ['query', 'info', 'warn', 'error'], // Log queries for debugging
});
console.log('Prisma Client Initialized.');
exports.default = prisma;
