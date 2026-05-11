import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:G00gle.com.my@123@localhost:5432/myspm'
});

const alterStatements = [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255) UNIQUE',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS login_attempts INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(50)',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id VARCHAR(255)',
];

async function addColumns() {
  const client = await pool.connect();
  try {
    console.log('🔧 Adding missing columns to users table...');
    
    for (const statement of alterStatements) {
      try {
        await client.query(statement);
        const columnName = statement.match(/ADD COLUMN IF NOT EXISTS (\w+)/)[1];
        console.log(`  ✅ Added column: ${columnName}`);
      } catch (err) {
        console.log(`  ℹ️  Column already exists or skipped`);
      }
    }
    
    // Verify all columns exist
    const result = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);
    
    console.log('\n✅ All columns in users table:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}`);
    });
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

addColumns();
