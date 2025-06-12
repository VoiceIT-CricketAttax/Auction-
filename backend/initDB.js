const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://admin:password123!@cluster0auctiongameclus.ervjy3w.mongodb.net/', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Connected to MongoDB');

    const Team = mongoose.model('Team', new mongoose.Schema({
      name: String,
      budget: Number,
      players: [{ name: String, price: Number }],
    }));

    const Player = mongoose.model('Player', new mongoose.Schema({
      name: String,
      basePrice: Number,
      currentBid: Number,
      currentBidder: String,
      sold: Boolean,
    }));

    // Clear existing data
    await Team.deleteMany({});
    await Player.deleteMany({});

    // Insert sample teams
    await Team.insertMany([
      { name: 'Team A', budget: 100, players: [] },
      { name: 'Team B', budget: 100, players: [] },
    ]);

    // Insert sample players
    await Player.insertMany([
      { name: 'Player 1', basePrice: 5, currentBid: 5, sold: false },
      { name: 'Player 2', basePrice: 3, currentBid: 3, sold: false },
      { name: 'Player 3', basePrice: 4, currentBid: 4, sold: false },
      { name: 'Player 4', basePrice: 6, currentBid: 6, sold: false },
    ]);

    console.log('Database initialized');
    mongoose.disconnect();
  })
  .catch(err => console.error('Error:', err));