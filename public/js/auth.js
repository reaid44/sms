async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

const loginBtn = document.getElementById('login');
const regBtn = document.getElementById('register');
const msg = document.getElementById('msg');

loginBtn.onclick = async () => {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const r = await post('/api/login', { username, password });
  if (r.token) {
    localStorage.setItem('token', r.token);
    window.location = '/chat.html';
  } else msg.innerText = r.error || 'Login failed';
};

regBtn.onclick = async () => {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const r = await post('/api/register', { username, password });
  if (r.token) {
    localStorage.setItem('token', r.token);
    window.location = '/chat.html';
  } else msg.innerText = r.error || 'Register failed';
};
