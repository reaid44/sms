import os
import sqlite3
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
from datetime import datetime

JWT_SECRET = os.environ.get('JWT_SECRET', 'change_this_secret')
DB_PATH = './data.sqlite'

app = Flask(__name__, static_folder='public', static_url_path='')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def generate_token(user):
    return jwt.encode({'id': user['id'], 'username': user['username']}, JWT_SECRET, algorithm='HS256')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json or {}
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'error': 'Missing fields'}), 400
    pw_hash = generate_password_hash(password)
    try:
        db = get_db()
        cur = db.cursor()
        cur.execute('INSERT INTO users(username, password) VALUES (?, ?)', (username, pw_hash))
        db.commit()
        user_id = cur.lastrowid
        user = {'id': user_id, 'username': username}
        return jsonify({'token': generate_token(user), 'user': user})
    except Exception:
        return jsonify({'error': 'Username likely taken'}), 400

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'error': 'Missing fields'}), 400
    db = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM users WHERE username = ?', (username,))
    row = cur.fetchone()
    if not row:
        return jsonify({'error': 'Invalid credentials'}), 400
    if not check_password_hash(row['password'], password):
        return jsonify({'error': 'Invalid credentials'}), 400
    user = {'id': row['id'], 'username': row['username']}
    return jsonify({'token': generate_token(user), 'user': user})

@app.route('/api/users')
def users():
    db = get_db()
    cur = db.cursor()
    q = request.args.get('q', '').strip()
    if q:
        cur.execute('SELECT id, username FROM users WHERE username LIKE ? COLLATE NOCASE ORDER BY username LIMIT 50', (f'%{q}%',))
    else:
        cur.execute('SELECT id, username FROM users')
    rows = cur.fetchall()
    out = [{'id': r['id'], 'username': r['username']} for r in rows]
    return jsonify(out)

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def static_files(path):
    if path != '' and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')

online = {}  # user_id -> sid

def verify_token(token):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return payload
    except Exception:
        return None

@socketio.on('connect')
def handle_connect(auth):
    token = None
    if isinstance(auth, dict):
        token = auth.get('token')
    if not token:
        print('[CONNECT] auth error: no token')
        return False
    payload = verify_token(token)
    if not payload:
        print('[CONNECT] auth error: invalid token')
        return False
    user_id = payload.get('id')
    username = payload.get('username')
    # store mapping
    online[user_id] = request.sid
    print(f'[CONNECT] user_id={user_id} username={username} sid={request.sid} | online={list(online.items())}')

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    remove = None
    for uid, s in list(online.items()):
        if s == sid:
            remove = uid
            break
    if remove:
        del online[remove]

@socketio.on('private_message')
def on_private_message(data):
    sid = request.sid
    sender_id = None
    for uid, s in online.items():
        if s == sid:
            sender_id = uid
            break
    if not sender_id:
        print(f'[ERROR] sender_id not found for sid {sid}')
        return
    to_username = data.get('toUsername')
    content = data.get('content')
    if not to_username or not content:
        print(f'[ERROR] missing toUsername or content')
        return
    db = get_db()
    cur = db.cursor()
    cur.execute('SELECT id FROM users WHERE username = ?', (to_username,))
    row = cur.fetchone()
    if not row:
        print(f'[ERROR] receiver username {to_username} not found')
        return
    receiver_id = row['id']
    cur.execute('INSERT INTO messages(sender_id, receiver_id, content, created_at) VALUES (?,?,?,?)',
                (sender_id, receiver_id, content, datetime.utcnow().isoformat()))
    db.commit()
    msg = {'sender_id': sender_id, 'receiver_id': receiver_id, 'content': content, 'created_at': datetime.utcnow().isoformat()}
    print(f'[MSG] {sender_id} → {receiver_id}: {content}')
    # emit to sender
    emit('message_sent', msg)
    # emit to receiver if online
    recv_sid = online.get(receiver_id)
    print(f'[ONLINE] {receiver_id} sid={recv_sid}, all online={list(online.items())}')
    if recv_sid:
        cur.execute('SELECT username FROM users WHERE id = ?', (sender_id,))
        srow = cur.fetchone()
        sender_username = srow['username'] if srow else 'Unknown'
        msg_data = {'from': sender_username, 'content': content, 'created_at': msg['created_at']}
        print(f'[EMIT] sending to {recv_sid}: {msg_data}')
        socketio.emit('message', msg_data, to=recv_sid)
    else:
        print(f'[OFFLINE] receiver {receiver_id} ({to_username}) is offline')

@socketio.on('history')
def on_history(data):
    sid = request.sid
    sender_id = None
    for uid, s in online.items():
        if s == sid:
            sender_id = uid
            break
    if not sender_id:
        return
    with_username = data.get('withUsername')
    if not with_username:
        return
    db = get_db()
    cur = db.cursor()
    cur.execute('SELECT id FROM users WHERE username = ?', (with_username,))
    row = cur.fetchone()
    if not row:
        return
    other_id = row['id']
    cur.execute('''SELECT m.id, m.content, m.created_at, s.username as sender, r.username as receiver
                   FROM messages m
                   JOIN users s ON m.sender_id = s.id
                   JOIN users r ON m.receiver_id = r.id
                   WHERE (m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?)
                   ORDER BY m.created_at ASC''', (sender_id, other_id, other_id, sender_id))
    rows = cur.fetchall()
    out = [{'id': r['id'], 'content': r['content'], 'created_at': r['created_at'], 'sender': r['sender'], 'receiver': r['receiver']} for r in rows]
    emit('history', out, to=sid)

if __name__ == '__main__':
    port = int(os.environ.get('FLASK_PORT', 5000))
    try:
        socketio.run(app, host='0.0.0.0', port=port, debug=True)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print('Failed to start server:', e)
