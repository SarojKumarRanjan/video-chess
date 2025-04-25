import { PrismaClient } from '@prisma/client';

console.log('Initializing Prisma Client...');
const prisma = new PrismaClient({
 // log: ['query', 'info', 'warn', 'error'], // Log queries for debugging
});
console.log('Prisma Client Initialized.');

export default prisma;