const tmi = require('tmi.js');

const enteredUsers = new Set(); // ✅ Moved outside the function for persistent tracking

/**
 * Clears the list of users who have already entered the giveaway.
 */
function resetEntries() {
  enteredUsers.clear();
}

/**
 * Connects to Twitch chat and listens for a giveaway command.
 * @param {string} channel - The Twitch channel to join.
 * @param {string} oauthToken - OAuth token from Twitch (with chat scopes).
 * @param {string} giveawayCommand - The command viewers type to enter giveaway, e.g. "!giveaway".
 * @param {function} onNewEntry - Callback when a new user enters.
 * @returns {object} The connected tmi.js client.
 */
function startChatListener(identityUsername, oauthToken, channelName, giveawayCommand, onNewEntry) {
  const normalizedCommand = giveawayCommand.trim().toLowerCase();
  const formattedToken = oauthToken.startsWith('oauth:') ? oauthToken : `oauth:${oauthToken}`;

  const client = new tmi.Client({
    options: { debug: true },
    identity: {
      username: identityUsername,
      password: formattedToken,
    },
    channels: [channelName],
  });

  client.connect().catch(err => {
    console.error('Failed to connect to Twitch chat:', err);
  });

  client.on('message', (channel, userstate, message, self) => {
    if (self) return;

    if (message.trim().toLowerCase() === normalizedCommand) {
      const username = (userstate['username'] || '').toLowerCase();
      if (username && !enteredUsers.has(username)) {
        enteredUsers.add(username);
        console.log(`New chat entry: ${username}`);
        onNewEntry(username);
      }
    }
  });

  client.on('disconnected', (reason) => {
    console.warn(`Twitch chat disconnected: ${reason}`);
  });

  client.on('reconnect', () => {
    console.log('Twitch chat reconnecting...');
  });

  return client;
}

module.exports = { startChatListener, resetEntries };
