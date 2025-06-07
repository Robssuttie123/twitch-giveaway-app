const { startChatListener, resetEntries } = require('./chatListener');
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

let chatClient = null;
let giveawayEntries = new Set();
let giveawayCommand = '!giveaway';  // This can be updated dynamically

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET, 
  resave: false,
  saveUninitialized: true,
}));

// Serve static assets if needed (like socket.io.js) - you already serve overlay and dashboard explicitly

// On client connection (overlay or dashboard)
io.on('connection', (socket) => {
  console.log('Client connected via WebSocket');
  // Send current entries on connection
  socket.emit('entries', Array.from(giveawayEntries));
});

// Emit new giveaway entries to all connected clients
function onNewEntry(user) {
  const normalizedUser = user.toLowerCase();
  if (giveawayEntries.has(normalizedUser)) return; // Prevent duplicates
  console.log(`New giveaway entry: ${user}`);
  giveawayEntries.add(normalizedUser);
  io.emit('newEntry', user);
}

// Twitch app credentials
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/auth/twitch/callback';

// Serve overlay and dashboard pages
app.get('/overlay', (req, res) => {
  res.sendFile(path.join(__dirname, 'overlay.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Step 1: Redirect streamer to Twitch login page
app.get('/auth/twitch', (req, res) => {
  const scope = 'chat:read chat:edit user:read:email';
  const twitchAuthURL = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scope)}`;
  res.redirect(twitchAuthURL);
});

// Step 2: Handle Twitch OAuth callback
app.get('/auth/twitch/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Missing code in callback');
  }

  try {
    const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      },
    });

    req.session.accessToken = tokenResponse.data.access_token;
    req.session.refreshToken = tokenResponse.data.refresh_token;

    const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${req.session.accessToken}`,
        'Client-Id': CLIENT_ID,
      },
    });

    const username = userResponse.data.data[0].login;
    req.session.username = username;

    // Disconnect previous chat client if exists
    if (chatClient) {
      await chatClient.disconnect();
    }

    giveawayEntries = new Set(); // Reset entries on new login

    chatClient = startChatListener(
      username,
      req.session.accessToken,
      username,
      giveawayCommand,
      onNewEntry
    );

    res.redirect('/dashboard'); // Redirect to dashboard after login
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send('Error during Twitch OAuth callback');
  }
});

// Homepage - styled landing page with dashboard color scheme
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Welcome to the Giveaway App</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');
    body {
      margin: 0;
      height: 100vh;
      background: linear-gradient(135deg, #4a90e2, #9013fe);
      font-family: 'Montserrat', sans-serif;
      color: #fff;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    h1 {
      font-size: 3rem;
      font-weight: 700;
      margin-bottom: 1rem;
      text-shadow: 0 3px 6px rgba(0,0,0,0.7);
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    a.login-btn {
      display: inline-block;
      padding: 0.9rem 2rem;
      font-size: 1.2rem;
      font-weight: 700;
      color: white;
      background-color: #4a90e2;
      border-radius: 8px;
      text-decoration: none;
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      transition: background-color 0.3s ease;
    }
    a.login-btn:hover {
      background-color: #357abd;
    }
    footer {
      position: absolute;
      bottom: 1rem;
      width: 100%;
      text-align: center;
      font-size: 0.9rem;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 500;
      font-family: 'Montserrat', sans-serif;
    }
  </style>
</head>
<body>
  <h1>Welcome to the Simple Giveaway App</h1>
  <p> The most simple and efficient tool for Twitch giveaways! </p>
  <a href="/auth/twitch" class="login-btn">Login with Twitch</a>
  <footer>Powered by Robssuttie123</footer>
</body>
</html>`);
});

// Return current giveaway entries for dashboard
app.get('/giveaway/entries', (req, res) => {
  res.json({
    entries: Array.from(giveawayEntries),
    count: giveawayEntries.size,
  });
});

// Clear giveaway entries
app.post('/giveaway/clear', (req, res) => {
  giveawayEntries.clear();
  resetEntries();  // clear chatListener entries if applicable
  io.emit('entries', Array.from(giveawayEntries));
  res.sendStatus(200);
});

// Pick one or more random winners
app.get('/giveaway/winner', (req, res) => {
  const count = parseInt(req.query.count) || 1;

  if (giveawayEntries.size === 0) {
    return res.status(400).json({ error: 'No entries to pick from' });
  }

  const entriesArray = Array.from(giveawayEntries);

  if (count > entriesArray.length) {
    return res.status(400).json({ error: 'Not enough entries for that many winners' });
  }

  // Shuffle and pick unique winners
  const shuffled = entriesArray.sort(() => 0.5 - Math.random());
  const winners = shuffled.slice(0, count);

  io.emit('winner', winners);

  res.json({ winners });
});

// ** New endpoint to redraw a winner (same as /giveaway/winner) **
app.get('/giveaway/redraw_winner', (req, res) => {
  const count = parseInt(req.query.count) || 1;

  if (giveawayEntries.size === 0) {
    return res.status(400).json({ error: 'No entries to pick from' });
  }

  const entriesArray = Array.from(giveawayEntries);

  if (count > entriesArray.length) {
    return res.status(400).json({ error: 'Not enough entries for that many winners' });
  }

  // Shuffle and pick unique winners
  const shuffled = entriesArray.sort(() => 0.5 - Math.random());
  const winners = shuffled.slice(0, count);

  io.emit('winner', winners);

  res.json({ winners });
});

// Start a new giveaway - essentially clear current entries
app.post('/giveaway/new', (req, res) => {
  giveawayEntries.clear();
  resetEntries();
  io.emit('entries', Array.from(giveawayEntries));
  res.sendStatus(200);
});

// Kick a user from the giveaway
app.post('/giveaway/kick', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const normalizedUser = username.toLowerCase();
  if (giveawayEntries.has(normalizedUser)) {
    giveawayEntries.delete(normalizedUser);
    io.emit('entries', Array.from(giveawayEntries));
    return res.sendStatus(200);
  } else {
    return res.status(404).json({ error: 'User not found in entries' });
  }
});

// Update giveaway command dynamically
app.post('/giveaway/command', async (req, res) => {
  const { command } = req.body;

  if (!command || !command.startsWith('!')) {
    return res.status(400).json({ error: 'Invalid command. Must start with !' });
  }

  giveawayCommand = command;

  if (chatClient && req.session.accessToken && req.session.username) {
    try {
      await chatClient.disconnect();
      chatClient = startChatListener(
        req.session.username,
        req.session.accessToken,
        req.session.username,
        giveawayCommand,
        onNewEntry
      );
    } catch (err) {
      return res.status(500).json({ error: 'Failed to restart chat listener with new command' });
    }
  }

  res.json({ success: true, command });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`
));
