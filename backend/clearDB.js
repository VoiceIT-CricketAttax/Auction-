const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://admin:password123!@cluster0auctiongameclus.ervjy3w.mongodb.net/')
  .then(async () => {
    await mongoose.connection.db.dropDatabase();
    console.log('Database cleared');
    mongoose.disconnect();
  })
  .catch(err => console.error(err));