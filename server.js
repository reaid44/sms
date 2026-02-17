const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const hash = await bcrypt.hash(password, 10);
  const stmt = db.prepare('INSERT INTO users(username, password) VALUES(?,?)');
  stmt.run(username, hash, function (err) {
    if (err) return res.status(400).json({ error: 'Username likely taken' });
    const user = { id: this.lastID, username };
    res.json({ token: generateToken(user), user });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    const user = { id: row.id, username: row.username };
    res.json({ token: generateToken(user), user });
  });
});

app.get('/api/users', (req, res) => {
  db.all('SELECT id, username FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Auth error'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    return next();
  } catch (e) {
    return next(new Error('Auth error'));
  }
});

const online = new Map(); // userId -> socket.id

io.on('connection', (socket) => {
  const user = socket.user;
  online.set(user.id, socket.id);

  socket.on('private_message', (data) => {
    const { toUsername, content } = data;
    if (!toUsername || !content) return;
    db.get('SELECT id FROM users WHERE username = ?', [toUsername], (err, row) => {
      if (err || !row) return;
      const receiverId = row.id;
      const stmt = db.prepare('INSERT INTO messages(sender_id, receiver_id, content) VALUES(?,?,?)');
      stmt.run(user.id, receiverId, content, function () {
        const msg = {
          id: this.lastID,
          sender_id: user.id,
          receiver_id: receiverId,
          content,
          created_at: new Date().toISOString()
        };
        const recvSocketId = online.get(receiverId);
        socket.emit('message_sent', msg);
        if (recvSocketId) io.to(recvSocketId).emit('message', { from: user.username, content, created_at: msg.created_at });
      });
    });
  });

  socket.on('history', (data) => {
    const { withUsername } = data;
    if (!withUsername) return;
    db.get('SELECT id FROM users WHERE username = ?', [withUsername], (err, row) => {
      if (err || !row) return;
      const otherId = row.id;
      db.all(
        'SELECT m.id, m.content, m.created_at, s.username as sender, r.username as receiver FROM messages m JOIN users s ON m.sender_id=s.id JOIN users r ON m.receiver_id=r.id WHERE (m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?) ORDER BY m.created_at ASC',
        [user.id, otherId, otherId, user.id],
        (err2, rows) => {
          if (err2) return;
          socket.emit('history', rows);
        }
      );
    });
  });

  socket.on('disconnect', () => {
    online.delete(user.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on', PORT));
