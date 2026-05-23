const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

const router = express.Router();

// PostgreSQL connection — DB was set up by the init-db-migrator container
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'notesdb',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notes ORDER BY created_at DESC');
    global.metrics.notesRead++;
    res.json({ notes: result.rows, total: result.rowCount });
  } catch (err) {
    console.error('DB read error:', err.message);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notes WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
    global.metrics.notesRead++;
    res.json(result.rows[0]);
  } catch (err) {
    console.error('DB read error:', err.message);
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

router.post('/', async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }
  try {
    const id = uuidv4();
    const result = await pool.query(
      'INSERT INTO notes (id, title, content) VALUES ($1, $2, $3) RETURNING *',
      [id, title, content]
    );
    global.metrics.notesCreated++;
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('DB write error:', err.message);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM notes WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('DB delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

module.exports = router;
