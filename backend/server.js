const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  console.log('Creating uploads directory at:', uploadsDir);
  fs.mkdirSync(uploadsDir, { recursive: true });
} else {
  console.log('Uploads directory already exists at:', uploadsDir);
}

// Serve static files from the uploads directory with enhanced logging
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    console.log(`Serving file: ${filePath}`);
    res.setHeader('Content-Type', 'image/jpeg'); // Adjust based on file type if needed
    res.setHeader('Access-Control-Allow-Origin', '*'); // Ensure CORS allows access
  }
}));

// Middleware to log all requests to /uploads
app.use('/uploads', (req, res, next) => {
  console.log(`Request for file: ${req.path}`);
  next();
});

// Test endpoint to list uploaded files
app.get('/api/list-files', (req, res) => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error('Error listing files:', err);
      return res.status(500).json({ error: 'Failed to list files' });
    }
    console.log('Listing files in uploads directory:', files);
    res.json(files);
  });
});

mongoose.connect('mongodb+srv://admin:password123!@cluster0auctiongameclus.ervjy3w.mongodb.net/auction_game?retryWrites=true&w=majority')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const teamSchema = new mongoose.Schema({
  name: String,
  budget: { type: Number, default: 100 },
  players: [{ name: String, price: Number, photo: String }],
});
const playerSchema = new mongoose.Schema({
  name: String,
  photo: String,
  sold: { type: Boolean, default: false },
});
const poolSchema = new mongoose.Schema({
  name: String,
  players: [playerSchema],
});
const soldPlayerSchema = new mongoose.Schema({
  playerId: String,
  playerName: String,
  team: String,
  finalPrice: Number,
  photo: String,
});
const auctionStatusSchema = new mongoose.Schema({
  ended: { type: Boolean, default: false },
});
const currentBidSchema = new mongoose.Schema({
  playerId: String,
  currentBid: Number,
  currentBidder: String,
});
const currentPoolSchema = new mongoose.Schema({
  poolId: String,
});

const Team = mongoose.model('Team', teamSchema);
const Player = mongoose.model('Player', playerSchema);
const Pool = mongoose.model('Pool', poolSchema);
const SoldPlayer = mongoose.model('SoldPlayer', soldPlayerSchema);
const AuctionStatus = mongoose.model('AuctionStatus', auctionStatusSchema);
const CurrentBid = mongoose.model('CurrentBid', currentBidSchema);
const CurrentPool = mongoose.model('CurrentPool', currentPoolSchema);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('Setting upload destination to:', uploadsDir);
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const playerName = file.originalname.split('.')[0].replace(/([A-Z])/g, ' $1').trim();
    const filename = `${playerName}-${Date.now()}${path.extname(file.originalname)}`;
    console.log('Generated filename:', filename);
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    console.log('File type allowed:', file.mimetype);
    cb(null, true);
  } else {
    console.log('File type not allowed:', file.mimetype);
    cb(new Error('Only image files (jpg, jpeg, png, gif) are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter
}).array('players');

app.get('/api/teams', async (req, res) => {
  const teams = await Team.find();
  console.log('Returning teams:', teams);
  res.json(teams);
});

app.post('/api/teams', async (req, res) => {
  const { name } = req.body;
  console.log('Creating team:', name);
  let team = await Team.findOne({ name });
  if (!team) {
    team = new Team({ name, budget: 100, players: [] });
    await team.save();
    console.log('Team created:', team);
  }
  const updatedTeams = await Team.find();
  io.emit('teamUpdate', updatedTeams);
  res.json(team);
});

app.post('/api/remove-team', async (req, res) => {
  const { name } = req.body;
  console.log('Removing team:', name);
  try {
    const team = await Team.findOneAndDelete({ name });
    if (!team) {
      console.log('Team not found:', name);
      return res.status(404).json({ error: 'Team not found' });
    }
    console.log('Team removed:', team);
    // Remove any sold players associated with this team
    await SoldPlayer.deleteMany({ team: name });
    // If the team is the current bidder, end the bid
    const currentBid = await CurrentBid.findOne({ currentBidder: name });
    if (currentBid) {
      await CurrentBid.deleteMany({ currentBidder: name });
      io.emit('bidEnded', {
        playerId: currentBid.playerId,
        team: null,
        finalPrice: null,
        playerName: null,
        photo: null,
      });
    }
    const updatedTeams = await Team.find();
    io.emit('teamUpdate', updatedTeams);
    res.json({ message: 'Team removed successfully' });
  } catch (err) {
    console.error('Error removing team:', err);
    res.status(500).json({ error: 'Failed to remove team' });
  }
});

app.get('/api/players', async (req, res) => {
  const pools = await Pool.find();
  const players = pools.flatMap(pool => pool.players);
  console.log('Returning players:', players);
  res.json(players);
});

app.get('/api/pools', async (req, res) => {
  const pools = await Pool.find();
  console.log('Returning pools:', pools);
  res.json(pools);
});

app.post('/api/upload-pool', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err.message);
      return res.status(400).json({ error: err.message || 'Upload failed: Only image files (jpg, jpeg, png, gif) are allowed' });
    }
    if (!req.files || req.files.length === 0) {
      console.error('No files uploaded');
      return res.status(400).json({ error: 'No files uploaded' });
    }
    console.log('Files uploaded successfully:', req.files.map(file => ({
      originalname: file.originalname,
      filename: file.filename,
      path: file.path,
      mimetype: file.mimetype
    })));
    const folderName = req.body.folderName || `Pool-${Date.now()}`;
    const players = req.files.map(file => {
      const playerName = file.originalname.split('.')[0].replace(/([A-Z])/g, ' $1').trim();
      const photoPath = `/uploads/${file.filename}`;
      const fullPath = path.join(__dirname, photoPath);
      if (!fs.existsSync(fullPath)) {
        console.error(`File does not exist after upload: ${fullPath}`);
        return null; // Skip this player if the file doesn't exist
      }
      console.log(`Storing player: ${playerName} with photo path: ${photoPath}`);
      return {
        name: playerName,
        photo: photoPath,
        sold: false
      };
    }).filter(player => player !== null); // Filter out any null entries
    if (players.length === 0) {
      console.error('No valid files to save after filtering');
      return res.status(400).json({ error: 'No valid image files to save' });
    }
    console.log('Players to save:', players);
    const pool = new Pool({
      name: folderName,
      players
    });
    try {
      await pool.save();
      console.log('Pool saved successfully:', pool);
      // Verify file existence after saving
      players.forEach(player => {
        const fullPath = path.join(__dirname, player.photo);
        if (fs.existsSync(fullPath)) {
          console.log(`File exists on server: ${fullPath}`);
        } else {
          console.error(`File does not exist on server after saving: ${fullPath}`);
        }
      });
    } catch (saveErr) {
      console.error('Error saving pool:', saveErr);
      return res.status(500).json({ error: 'Failed to save pool' });
    }
    const updatedPools = await Pool.find();
    console.log('Emitting poolUpdate with:', updatedPools);
    io.emit('poolUpdate', updatedPools);
    res.json(pool);
  });
});

app.post('/api/clear-pools', async (req, res) => {
  try {
    // Delete all files in the uploads directory
    fs.readdir(uploadsDir, (err, files) => {
      if (err) {
        console.error('Error reading uploads directory:', err);
      } else {
        files.forEach(file => {
          const filePath = path.join(uploadsDir, file);
          fs.unlinkSync(filePath);
          console.log(`Deleted file: ${filePath}`);
        });
      }
    });
    await Pool.deleteMany({});
    await CurrentPool.deleteMany({});
    console.log('Pools cleared successfully');
    io.emit('poolsCleared');
    res.json({ message: 'Pools cleared successfully' });
  } catch (err) {
    console.error('Error clearing pools:', err);
    res.status(500).json({ error: 'Failed to clear pools' });
  }
});

app.post('/api/clear-all-data', async (req, res) => {
  try {
    // Delete all files in the uploads directory
    fs.readdir(uploadsDir, (err, files) => {
      if (err) {
        console.error('Error reading uploads directory:', err);
      } else {
        files.forEach(file => {
          const filePath = path.join(uploadsDir, file);
          fs.unlinkSync(filePath);
          console.log(`Deleted file: ${filePath}`);
        });
      }
    });
    await Pool.deleteMany({});
    await Team.deleteMany({});
    await SoldPlayer.deleteMany({});
    await CurrentBid.deleteMany({});
    await AuctionStatus.deleteMany({});
    await CurrentPool.deleteMany({});
    console.log('All data cleared successfully');
    io.emit('allDataCleared');
    res.json({ message: 'All data cleared successfully' });
  } catch (err) {
    console.error('Error clearing all data:', err);
    res.status(500).json({ error: 'Failed to clear all data' });
  }
});

app.post('/api/set-current-pool', async (req, res) => {
  const { poolId } = req.body;
  try {
    await CurrentPool.deleteMany({});
    const pool = await Pool.findById(poolId);
    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }
    const currentPool = new CurrentPool({ poolId });
    await currentPool.save();
    console.log('Current pool set:', pool);
    res.json(pool);
  } catch (err) {
    console.error('Error setting current pool:', err);
    res.status(500).json({ error: 'Failed to set current pool' });
  }
});

app.get('/api/current-pool', async (req, res) => {
  try {
    const currentPool = await CurrentPool.findOne();
    if (!currentPool) {
      return res.json(null);
    }
    const pool = await Pool.findById(currentPool.poolId);
    console.log('Returning current pool:', pool);
    res.json(pool);
  } catch (err) {
    console.error('Error fetching current pool:', err);
    res.status(500).json({ error: 'Failed to fetch current pool' });
  }
});

app.get('/api/sold-players', async (req, res) => {
  const soldPlayers = await SoldPlayer.find();
  console.log('Returning sold players:', soldPlayers);
  res.json(soldPlayers);
});

app.get('/api/auction-status', async (req, res) => {
  let auctionStatus = await AuctionStatus.findOne();
  if (!auctionStatus) {
    auctionStatus = new AuctionStatus({ ended: false });
    await auctionStatus.save();
  }
  console.log('Returning auction status:', auctionStatus);
  res.json(auctionStatus);
});

app.get('/api/current-bid', async (req, res) => {
  const currentBid = await CurrentBid.findOne();
  console.log('Returning current bid:', currentBid);
  res.json(currentBid);
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('startBid', async ({ playerId, basePrice }) => {
    console.log('Starting bid for player:', playerId, 'with base price:', basePrice);
    const pools = await Pool.find();
    const player = pools.flatMap(pool => pool.players).find(p => p._id.toString() === playerId);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }
    if (player.sold) {
      socket.emit('error', { message: 'Player already sold' });
      return;
    }
    await CurrentBid.deleteMany({});
    const currentBid = new CurrentBid({
      playerId,
      currentBid: parseFloat(basePrice.toFixed(2)),
      currentBidder: null,
    });
    await currentBid.save();
    io.emit('bidStarted', {
      playerId,
      currentBid: parseFloat(basePrice.toFixed(2)),
      currentBidder: null,
    });
  });

  socket.on('placeBid', async ({ playerId, teamName }) => {
    console.log('Received placeBid from team:', teamName, 'for player:', playerId);
    const pools = await Pool.find();
    const player = pools.flatMap(pool => pool.players).find(p => p._id.toString() === playerId);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }
    const team = await Team.findOne({ name: teamName });
    if (!team) {
      socket.emit('error', { message: 'Team not found' });
      return;
    }
    const currentBidDoc = await CurrentBid.findOne({ playerId });
    if (!currentBidDoc) {
      socket.emit('error', { message: 'No active bid' });
      return;
    }
    let increment;
    if (currentBidDoc.currentBid < 5) {
      increment = 0.2; // 20 Lakhs
    } else if (currentBidDoc.currentBid < 10) {
      increment = 0.25; // 25 Lakhs
    } else {
      increment = 0.5; // 50 Lakhs
    }
    const newBid = parseFloat((currentBidDoc.currentBid + increment).toFixed(2));
    if (team.budget < newBid) {
      socket.emit('error', { message: 'Insufficient budget' });
      return;
    }
    currentBidDoc.currentBid = newBid;
    currentBidDoc.currentBidder = teamName;
    await currentBidDoc.save();
    console.log('Emitting bidUpdate:', { playerId, currentBid: newBid, currentBidder: teamName });
    io.emit('bidUpdate', {
      playerId,
      currentBid: newBid,
      currentBidder: teamName,
    });
  });

  socket.on('endBid', async (playerId) => {
    console.log('Ending bid for player:', playerId);
    const pools = await Pool.find();
    let poolToUpdate = pools.find(pool => pool.players.some(p => p._id.toString() === playerId));
    if (!poolToUpdate) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }
    const player = poolToUpdate.players.find(p => p._id.toString() === playerId);
    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }
    const currentBidDoc = await CurrentBid.findOne({ playerId });
    if (!currentBidDoc) {
      socket.emit('error', { message: 'No active bid' });
      return;
    }
    const currentBidder = currentBidDoc.currentBidder;
    if (!currentBidder) {
      player.sold = false;
      poolToUpdate.markModified('players');
      await poolToUpdate.save();
      io.emit('unsold', { playerId, message: `${player.name} went unsold` });
      await CurrentBid.deleteMany({ playerId });
      return;
    }
    const team = await Team.findOne({ name: currentBidder });
    const finalPrice = parseFloat(currentBidDoc.currentBid.toFixed(2));
    team.budget -= finalPrice;
    team.players.push({
      name: player.name,
      price: finalPrice,
      photo: player.photo,
    });
    await team.save();
    player.sold = true;
    poolToUpdate.markModified('players');
    await poolToUpdate.save();
    const soldPlayer = new SoldPlayer({
      playerId,
      playerName: player.name,
      team: currentBidder,
      finalPrice,
      photo: player.photo,
    });
    await soldPlayer.save();
    console.log('Emitting bidEnded:', { playerId, team: currentBidder, finalPrice, playerName: player.name, photo: player.photo });
    io.emit('bidEnded', {
      playerId,
      team: currentBidder,
      finalPrice,
      playerName: player.name,
      photo: player.photo,
    });
    io.emit('teamUpdate', await Team.find());
    await CurrentBid.deleteMany({ playerId });
  });

  socket.on('setCurrentPool', async (poolId) => {
    const pool = await Pool.findById(poolId);
    if (pool) {
      console.log('Emitting current pool update:', pool);
      io.emit('currentPoolUpdate', pool);
    }
  });

  socket.on('endAuction', async () => {
    let auctionStatus = await AuctionStatus.findOne();
    if (!auctionStatus) {
      auctionStatus = new AuctionStatus({ ended: true });
    } else {
      auctionStatus.ended = true;
    }
    await auctionStatus.save();
    io.emit('auctionEnded');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));