export default function migrate(db) {
  console.log('Running migration: Add studentId to chat_room');

  // Add studentId column to chat_room
  db.prepare(`
    ALTER TABLE chat_room
    ADD COLUMN studentId TEXT REFERENCES user(id) ON DELETE CASCADE
  `).run();

  console.log('✓ Added studentId column to chat_room');
}
