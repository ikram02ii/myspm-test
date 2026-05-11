import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:G00gle.com.my@123@localhost:5432/myspm'
});

try {
  const result = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users'
    ORDER BY ordinal_position
  `);
  
  console.log('✅ Users table columns:');
  result.rows.forEach(row => {
    console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
  });
} catch (err) {
  console.error('Error:', err);
} finally {
  await pool.end();
}
