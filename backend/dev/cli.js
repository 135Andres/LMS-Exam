import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from '../src/db/connection.js';
import { UserModel } from '../src/models/user.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const whitelistPath = path.resolve(__dirname, '../../backend-python/whitelist.json');

function readWhitelist() {
  try {
    const raw = JSON.parse(fs.readFileSync(whitelistPath, 'utf-8'));
    return raw.authorized_emails || [];
  } catch {
    return [];
  }
}

function writeWhitelist(emails) {
  fs.writeFileSync(whitelistPath, JSON.stringify({ authorized_emails: emails }, null, 2) + '\n');
}

function readWhitelistFull() {
  const emails = readWhitelist();
  return emails.map(e => ({ email: e, name: e.split('@')[0], role: 'user' }));
}

function listUsers() {
  getDb();
  const users = UserModel.listAll();
  console.log('\nUsuarios registrados:');
  console.log('='.repeat(60));
  console.log('Email                          | Role   | Registrado');
  console.log('-'.repeat(60));
  for (const u of users) {
    console.log(
      `${u.email.padEnd(32)}| ${u.role.padEnd(6)}| ${u.created_at || '—'}`,
    );
  }
  console.log();
  closeDb();
}

function whitelistAdd(email) {
  const list = readWhitelist();
  if (list.includes(email)) {
    console.log(`Ya existe: ${email}`);
    return;
  }
  list.push(email);
  writeWhitelist(list);
  console.log(`Agregado: ${email}`);
}

function whitelistRemove(email) {
  const list = readWhitelist();
  const filtered = list.filter(e => e !== email);
  if (filtered.length === list.length) {
    console.log(`No encontrado: ${email}`);
    return;
  }
  writeWhitelist(filtered);
  console.log(`Eliminado: ${email}`);
}

function whitelistList() {
  const list = readWhitelist();
  console.log('\nLista blanca:');
  console.log('='.repeat(40));
  for (const email of list) {
    console.log(`  ${email}`);
  }
  console.log();
}

async function generateOtp(email) {
  const { default: fetch } = await import('node-fetch');
  console.log(`\nSolicitando OTP para ${email} al servicio de auth...`);
  try {
    const res = await fetch('http://localhost:3001/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    console.log(`  Estado: ${res.status}`);
    console.log(`  Mensaje: ${data.message}`);
    console.log('  (Revisa la consola de Python para ver el código o el email)');
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }
  console.log();
}

function showLogs(n = 20) {
  getDb();
  const stmt = getDb().prepare(
    'SELECT email, action, ip, created_at FROM auth_log ORDER BY created_at DESC LIMIT ?'
  );
  const logs = stmt.all(n);
  console.log(`\nÚltimos ${logs.length} eventos:`);
  console.log('='.repeat(80));
  console.log('Email                          | Acción        | IP              | Fecha');
  console.log('-'.repeat(80));
  for (const l of logs) {
    console.log(
      `${(l.email || '').padEnd(32)}| ${(l.action || '').padEnd(14)}| ${(l.ip || '—').padEnd(16)}| ${l.created_at || '—'}`,
    );
  }
  console.log();
  closeDb();
}

function toggleAdmin(email) {
  getDb();
  const user = UserModel.findByEmail(email);
  if (!user) {
    console.log(`Usuario no encontrado: ${email}`);
    closeDb();
    return;
  }
  const newRole = user.role === 'admin' ? 'user' : 'admin';
  UserModel.setRole(email, newRole);
  console.log(`Rol cambiado: ${email} → ${newRole}`);
  closeDb();
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === 'help') {
    console.log(`
Developer CLI — LMS Exam

Comandos:
  users                              Listar usuarios registrados
  whitelist add <email>              Agregar email a lista blanca
  whitelist remove <email>           Quitar email de lista blanca
  whitelist list                     Listar lista blanca
  otp <email>                        Solicitar OTP al servicio de auth
  logs [n]                           Últimos n eventos de auth_log (default 20)
  admin <email>                      Alternar role admin
    `);
    return;
  }

  switch (cmd) {
    case 'users':
      listUsers();
      break;
    case 'whitelist': {
      const sub = args[1];
      if (sub === 'add') {
        const email = args[2];
        if (!email) { console.log('Uso: whitelist add <email>'); return; }
        whitelistAdd(email);
      } else if (sub === 'remove') {
        const email = args[2];
        if (!email) { console.log('Uso: whitelist remove <email>'); return; }
        whitelistRemove(email);
      } else if (sub === 'list') {
        whitelistList();
      } else {
        console.log('Subcomandos: add, remove, list');
      }
      break;
    }
    case 'otp': {
      const email = args[1];
      if (!email) { console.log('Uso: otp <email>'); return; }
      await generateOtp(email);
      break;
    }
    case 'logs': {
      const n = parseInt(args[1]) || 20;
      showLogs(n);
      break;
    }
    case 'admin': {
      const email = args[1];
      if (!email) { console.log('Uso: admin <email>'); return; }
      toggleAdmin(email);
      break;
    }
    default:
      console.log(`Comando desconocido: ${cmd}. Usa 'help' para ver los comandos.`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});