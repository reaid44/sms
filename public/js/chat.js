const token = localStorage.getItem('token');
if (!token) location = '/';
const socket = io({ auth: { token } });

function parseJwt (t) {
  try {
    const b = t.split('.')[1];
    return JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/')));
  } catch (e) { return {}; }
}

const me = parseJwt(token).username || '';

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt) e.textContent = txt;
  return e;
}

let currentChat = null;

socket.on('connect_error', (err) => {
  console.error('socket err', err);
  if (err.message === 'Auth error') location = '/';
});

function appendMessage({from, content, created_at}){
  const wrap = document.getElementById('messages');
  const row = el('div', 'msg-row ' + (from === me ? 'me' : 'them'));
  const bubble = el('div', 'bubble ' + (from === me ? 'me' : 'them'));
  bubble.innerText = content;
  const ts = el('div', 'ts', new Date(created_at || Date.now()).toLocaleTimeString());
  bubble.appendChild(ts);
  row.appendChild(bubble);
  wrap.appendChild(row);
  wrap.scrollTop = wrap.scrollHeight;
}

socket.on('message', (m) => appendMessage({ from: m.from, content: m.content, created_at: m.created_at }));

socket.on('history', (rows) => {
  const node = document.getElementById('messages');
  node.innerHTML = '';
  rows.forEach(r => appendMessage({ from: r.sender, content: r.content, created_at: r.created_at }));
});

socket.on('message_sent', (m) => {
  appendMessage({ from: me, content: m.content, created_at: m.created_at });
});

async function loadUsers(filter) {
  const query = filter ? `?q=${encodeURIComponent(filter)}` : '';
  const res = await fetch(`/api/users${query}`);
  const users = await res.json();
  const ul = document.getElementById('users');
  ul.innerHTML = '';
  users.filter(u => u.username !== me).forEach(u => {
    const li = el('li');
    const avatar = el('div', 'avatar', u.username[0].toUpperCase());
    const meta = el('div', 'meta');
    const name = el('div', 'name', u.username);
    const last = el('div', 'last', 'Tap to open');
    meta.appendChild(name);
    meta.appendChild(last);
    li.appendChild(avatar);
    li.appendChild(meta);
    li.onclick = () => selectChat(u.username);
    ul.appendChild(li);
  });
}

function selectChat(username){
  currentChat = username;
  document.getElementById('chat-title').innerText = username;
  document.getElementById('messages').innerHTML = '';
  socket.emit('history', { withUsername: username });
}

document.getElementById('send').onclick = () => {
  const content = document.getElementById('content').value.trim();
  if (!currentChat || !content) return;
  socket.emit('private_message', { toUsername: currentChat, content });
  document.getElementById('content').value = '';
};

async function doSearch() {
  const query = document.getElementById('search').value.trim();
  if (!query) return loadUsers();
  await loadUsers(query);
  const ul = document.getElementById('users');
  const firstContact = ul.querySelector('li');
  if (firstContact) {
    const username = firstContact.querySelector('.name').textContent;
    selectChat(username);
  }
}

document.getElementById('searchBtn').onclick = doSearch;

document.getElementById('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

loadUsers();
