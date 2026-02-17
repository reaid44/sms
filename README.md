# SMS Real-time Web App

Minimal real-time private-chat app using Express, Socket.io, SQLite, JWT and bcrypt.

Quick start:

1. Install dependencies: `npm install`
2. Initialize DB: `npm run init-db`
3. Start: `npm start`

Open http://localhost:3000

Flask variant:

1. Install Python deps: `pip install -r requirements.txt`
2. Initialize DB for Flask (same DB used): `python db_init_py.py`
3. Run Flask server: `python app.py`

Flask serves the same frontend from `/public` and listens on port 5000 by default.
# sms