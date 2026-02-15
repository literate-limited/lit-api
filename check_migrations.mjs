import db from './db.js';

try {
  const migrations = await db.many('SELECT * FROM migrations ORDER BY executed_at DESC LIMIT 10');
  console.log('Recent migrations:');
  migrations.forEach(m => {
    console.log(`  - ${m.name} (${m.executed_at})`);
  });
} catch (err) {
  console.error('Error:', err.message);
}

process.exit(0);
