const { startChatListener, resetEntries } = require('./chatListener');
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// CORS configuration
app.use(cors({
  origin: 'https://robssuttie123.github.io',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(cors({
  origin: 'https://robssuttie123.github.io',
  credentials: true
}));

let chatClient = null;
let giveawayEntries = new Set();
let giveawayCommand = '!giveaway';  // This can be updated dynamically

const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// Session middleware for handling user-specific sessions
app.set('trust proxy', 1); // trust first proxy (Render, in this case)

app.use(session({
  secret: process.env.SESSION_SECRET || 'BLANK_FOR_TESTING',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    sameSite: 'None'
  }
}));

// Auth middleware to ensure users are logged in for certain routes
function authMiddleware(req, res, next) {
  if (req.session && req.session.username) {
    next(); // Proceed if authenticated
  } else {
    res.redirect('/'); // Redirect to login if not authenticated
  }
}

// Route to start a giveaway and store data in session
app.post('/start-giveaway', authMiddleware, (req, res) => {
  const { giveawayName, giveawayItems } = req.body;

  // Store giveaway data in session for the authenticated user
  req.session.giveaway = {
    giveawayName,
    giveawayItems,
  };

  res.send({ message: 'Giveaway started successfully' });
});

// Route to fetch the current user's giveaway data
app.get('/get-giveaway', authMiddleware, (req, res) => {
  if (req.session.giveaway) {
    res.send(req.session.giveaway);
  } else {
    res.send({ message: 'No giveaway found for this user' });
  }
});

// Route to handle overlay (still keeping your existing functionality)
app.get('/api/overlay-id', (req, res) => {
  console.log('[overlay-id] session:', req.session);
  console.log('Session:', req.session);  // Debugging line
  if (req.session && req.session.overlayId) {
    res.json({ overlayId: req.session.overlayId });
  } else {
    res.status(404).json({ error: 'Overlay ID not found' });
  }
});

app.get('/overlay', (req, res) => {
  res.sendFile(path.join(__dirname, 'overlay.html'));
});

app.get('/dashboard', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Serve static assets if needed (like socket.io.js) - you already serve overlay and dashboard explicitly

// On client connection (overlay or dashboard)
io.on('connection', (socket) => {
  console.log('Client connected via WebSocket');
  socket.emit('entries', Array.from(giveawayEntries));

  socket.on('disconnect', () => {
    console.log('Client disconnected');

    // Optional: delay chat disconnect to allow page reloads
    setTimeout(async () => {
      if (chatClient) {
        await chatClient.disconnect();
        chatClient = null;
        console.log('Chat client disconnected after delay.');
      }
    }, 60 * 60 * 1000); // 1 hour, because Gingr is slow
  });
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
const REDIRECT_URI = process.env.REDIRECT_URI;

// Serve overlay and dashboard pages
app.get('/overlay/:overlayId', (req, res) => {
  // Serve the overlay page without authentication checks
  res.sendFile(path.join(__dirname, 'overlay.html')); // or whatever HTML page you're serving
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

    req.session.overlayId = crypto.randomBytes(16).toString('hex');

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

app.get('/logout', async (req, res) => {
  if (chatClient) {
    await chatClient.disconnect();
    chatClient = null;
    console.log('Chat client disconnected on logout.');
  }
  req.session.destroy(() => {
    res.redirect('/?loggedout=true');
  });
});

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
      position: relative;
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
    .popup {
      position: fixed;
      bottom: 2rem;
      background-color: rgba(0,0,0,0.8);
      padding: 1rem 2rem;
      border-radius: 10px;
      color: #fff;
      font-weight: 600;
      box-shadow: 0 3px 10px rgba(0,0,0,0.5);
      animation: fadein 0.3s ease;
    }
    @keyframes fadein {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <h1>Welcome to the Simple Giveaway App</h1>
  <p> The most simple and efficient tool for Twitch giveaways! </p>
  <a href="/auth/twitch" class="login-btn">Login with Twitch</a>
  <footer>Powered by Robssuttie123</footer>

  <script>
    // Show logout popup if ?loggedout=true in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('loggedout') === 'true') {
      const popup = document.createElement('div');
      popup.className = 'popup';
      popup.innerText = 'You have been logged out successfully!';
      document.body.appendChild(popup);
      setTimeout(() => {
        popup.remove();
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 4000);
    }
  </script>
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
