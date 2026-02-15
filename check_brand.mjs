import db from './db.js';

try {
  console.log('=== Checking law brand ===\n');

  const lawBrand = await db.one('SELECT id, code, name FROM brands WHERE code = $1', ['law']);

  if (lawBrand) {
    console.log(`✅ Law brand found:`);
    console.log(`   ID: ${lawBrand.id}`);
    console.log(`   Code: ${lawBrand.code}`);
    console.log(`   Name: ${lawBrand.name}`);
  } else {
    console.log(`❌ Law brand NOT found`);
    console.log(`\nAll brands in database:`);
    const allBrands = await db.many('SELECT id, code, name FROM brands');
    allBrands.forEach(b => {
      console.log(`   - ${b.code}: ${b.name}`);
    });
  }

} catch (err) {
  console.error('Error:', err.message);
  console.error(err);
}

process.exit(0);
