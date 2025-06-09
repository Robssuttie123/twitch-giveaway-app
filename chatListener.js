const tmi = require('tmi.js');

// Store per-user chat clients and entries
const chatClients = new Map();
const userEntries = new Map();

function startChatListener(channelName, oauthToken, username, command, onNewEntry) {
  // Disconnect existing client if already present
  if (chatClients.has(username)) {
    chatClients.get(username).disconnect();
  }

  const client = new tmi.Client({
    options: { debug: true },
    identity: {
      username,
      password: `oauth:${oauthToken}`,
    },
    channels: [channelName],
  });

  // Create entry list for this user if not present
  if (!userEntries.has(username)) {
    userEntries.set(username, new Set());
  }

  client.connect().then(() => {
    console.log(`Connected to Twitch chat for ${username}`);
  });

  client.on('message', (channel, tags, message, self) => {
    if (self) return;

    if (message.trim().toLowerCase() === command.toLowerCase()) {
      const user = tags['display-name'] || tags['username'];
      const entries = userEntries.get(username);

      if (!entries.has(user.toLowerCase())) {
        entries.add(user.toLowerCase());
        onNewEntry(user, username); // Pass username to help app.js broadcast only to the right session
      }
    }
  });

  chatClients.set(username, client);
  return client;
}

function resetEntries(username) {
  if (userEntries.has(username)) {
    userEntries.set(username, new Set());
  }
}

function getEntries(username) {
  return Array.from(userEntries.get(username) || []);
}

function kickEntry(username, entry) {
  if (userEntries.has(username)) {
    const entries = userEntries.get(username);
    entries.delete(entry.toLowerCase());
  }
}

module.exports = {
  startChatListener,
  resetEntries,
  getEntries,
  kickEntry,
};
